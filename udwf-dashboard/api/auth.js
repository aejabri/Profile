// UDWF+ dashboard auth API (self-contained — no GitHub token needed).
// POST {action:"login",  password}                       -> sets session cookie if user password matches
// POST {action:"change", adminPassword, newUserPassword}  -> rewrites the user password (admin-gated)
// POST {action:"check"}                                   -> validates current session cookie
//
// User password = SHA256(USER_SALT + pass) stored in env USER_SALT/USER_HASH (changeable).
// Admin password = SHA256(ADMIN_SALT + pass) in env ADMIN_SALT/ADMIN_HASH (fixed, not UI-changeable).
// "change" updates USER_SALT/USER_HASH via the Vercel REST API and redeploys (~30s to take effect).
// Session = signed HMAC token in an httpOnly cookie.

const crypto = require("crypto");

const PROJECT = "udwf-dashboard";
const TEAM    = "team_8DVxZgPyC9Jo1S2MO6QVd1qa";

function sha256(s){ return crypto.createHash("sha256").update(s).digest("hex"); }

function sign(payload, secret){
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return body + "." + sig;
}
function verifyToken(token, secret){
  if(!token || token.indexOf(".")<0) return null;
  const [body, sig] = token.split(".");
  const exp = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if(sig !== exp) return null;
  try{
    const p = JSON.parse(Buffer.from(body,"base64url").toString());
    if(p.exp && Date.now() > p.exp) return null;
    return p;
  }catch(e){ return null; }
}
function getCookie(req, name){
  const c = req.headers.cookie || "";
  const m = c.match(new RegExp("(?:^|;\\s*)"+name+"=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
async function readBody(req){
  if(req.body){ return typeof req.body==="string" ? JSON.parse(req.body) : req.body; }
  return await new Promise((resolve)=>{
    let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ try{ resolve(JSON.parse(d||"{}")); }catch(e){ resolve({}); } });
  });
}

// --- Vercel API helpers (run on Vercel's network, can reach api.vercel.com) ---
async function vercelUpsertEnv(token, key, value){
  const base = "https://api.vercel.com";
  const qs = "?teamId="+TEAM;
  // find existing env id for this key (production target)
  const list = await fetch(base+"/v9/projects/"+PROJECT+"/env"+qs, {
    headers:{ "Authorization":"Bearer "+token } });
  let id = null;
  if(list.ok){
    const j = await list.json();
    const hit = (j.envs||[]).find(e=>e.key===key && (e.target||[]).indexOf("production")>=0);
    if(hit) id = hit.id;
  }
  if(id){
    const r = await fetch(base+"/v9/projects/"+PROJECT+"/env/"+id+qs, {
      method:"PATCH",
      headers:{ "Authorization":"Bearer "+token, "Content-Type":"application/json" },
      body: JSON.stringify({ value }) });
    return r.ok;
  } else {
    const r = await fetch(base+"/v10/projects/"+PROJECT+"/env"+qs, {
      method:"POST",
      headers:{ "Authorization":"Bearer "+token, "Content-Type":"application/json" },
      body: JSON.stringify({ key, value, type:"encrypted", target:["production"] }) });
    return r.ok;
  }
}
async function vercelRedeploy(token){
  const base = "https://api.vercel.com";
  const qs = "?teamId="+TEAM;
  // get latest production deployment to clone
  const dl = await fetch(base+"/v6/deployments?projectId="+PROJECT+"&target=production&limit=1"+("&teamId="+TEAM), {
    headers:{ "Authorization":"Bearer "+token } });
  if(!dl.ok) return false;
  const dj = await dl.json();
  const last = (dj.deployments||[])[0];
  if(!last) return false;
  const r = await fetch(base+"/v13/deployments"+qs, {
    method:"POST",
    headers:{ "Authorization":"Bearer "+token, "Content-Type":"application/json" },
    body: JSON.stringify({ name: PROJECT, deploymentId: last.uid, target:"production" }) });
  return r.ok;
}

module.exports = async (req, res) => {
  res.setHeader("content-type","application/json");
  res.setHeader("cache-control","no-store");

  const SECRET     = process.env.SESSION_SECRET || "dev-secret";
  const USER_SALT  = process.env.USER_SALT || "";
  const USER_HASH  = process.env.USER_HASH || "";
  const ADMIN_SALT = process.env.ADMIN_SALT || "";
  const ADMIN_HASH = process.env.ADMIN_HASH || "";
  const VTOKEN     = process.env.VERCEL_API_TOKEN || "";

  if(req.method !== "POST"){ res.status(405).end(JSON.stringify({ok:false,error:"POST only"})); return; }

  let body;
  try{ body = await readBody(req); }catch(e){ res.status(400).end(JSON.stringify({ok:false,error:"bad body"})); return; }
  const action = body.action;

  // ---- check current session ----
  if(action === "check"){
    const p = verifyToken(getCookie(req,"udwf_sess"), SECRET);
    res.status(200).end(JSON.stringify({ ok: !!p }));
    return;
  }

  // ---- login ----
  if(action === "login"){
    if(!USER_SALT || !USER_HASH){ res.status(500).end(JSON.stringify({ok:false,error:"server not configured"})); return; }
    const ok = sha256(USER_SALT + (body.password||"")) === USER_HASH;
    if(!ok){ res.status(401).end(JSON.stringify({ok:false,error:"incorrect password"})); return; }
    const token = sign({ r:"user", exp: Date.now() + 1000*60*60*24*30 }, SECRET); // 30 days
    res.setHeader("Set-Cookie", "udwf_sess="+encodeURIComponent(token)+"; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age="+(60*60*24*30));
    res.status(200).end(JSON.stringify({ ok:true }));
    return;
  }

  // ---- change user password (admin-gated) ----
  if(action === "change"){
    if(!ADMIN_SALT || !ADMIN_HASH){ res.status(500).end(JSON.stringify({ok:false,error:"admin not configured"})); return; }
    const adminOk = sha256(ADMIN_SALT + (body.adminPassword||"")) === ADMIN_HASH;
    if(!adminOk){ res.status(403).end(JSON.stringify({ok:false,error:"incorrect admin password"})); return; }
    const np = (body.newUserPassword||"").trim();
    if(np.length < 4){ res.status(400).end(JSON.stringify({ok:false,error:"new password too short (min 4)"})); return; }
    if(!VTOKEN){ res.status(500).end(JSON.stringify({ok:false,error:"password change not configured"})); return; }
    const newSalt = crypto.randomBytes(8).toString("hex");
    const newHash = sha256(newSalt + np);
    const s1 = await vercelUpsertEnv(VTOKEN, "USER_SALT", newSalt);
    const s2 = await vercelUpsertEnv(VTOKEN, "USER_HASH", newHash);
    if(!s1 || !s2){ res.status(500).end(JSON.stringify({ok:false,error:"could not save"})); return; }
    await vercelRedeploy(VTOKEN); // ~30s to go live
    res.status(200).end(JSON.stringify({ ok:true, note:"takes ~30s to go live" }));
    return;
  }

  res.status(400).end(JSON.stringify({ok:false,error:"unknown action"}));
};
