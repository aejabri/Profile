// UDWF+ dashboard data API — reads the PUBLIC mirror feed (no auth).
// Log:     https://raw.githubusercontent.com/aejabri/Profile/main/udwf/udwf_scan_log.md
// Markets: https://raw.githubusercontent.com/aejabri/Profile/main/udwf/markets.json
// Falls back to Yahoo, then a static seed, so the ticker never goes blank.

const LOG_URL = "https://raw.githubusercontent.com/aejabri/Profile/main/udwf/udwf_scan_log.md";
const MK_URL  = "https://raw.githubusercontent.com/aejabri/Profile/main/udwf/markets.json";

const STAGES = ["regime-oracle","scanrouter","engine fan-out","PPR + spy-gex-live","governance-guardrail","risk-router","emit"];

const INDICES = [
  { sym:"^DJI",  yahoo:"^DJI",  label:"DJI",  name:"Dow Jones" },
  { sym:"^IXIC", yahoo:"^IXIC", label:"IXIC", name:"Nasdaq Comp" },
  { sym:"^GSPC", yahoo:"^GSPC", label:"SPX",  name:"S&P 500" },
];

const INDEX_SEED = {
  asOf: "seed",
  indices: [
    { sym:"^DJI",  label:"DJI",  name:"Dow Jones",   price:51492.55, change:-507.12, pct:-0.98 },
    { sym:"^IXIC", label:"IXIC", name:"Nasdaq Comp", price:26021.66, change:-354.69, pct:-1.34 },
    { sym:"^GSPC", label:"SPX",  name:"S&P 500",     price:7420.10,  change:-91.25,  pct:-1.21 },
  ],
};

// 6 scheduled scans (KSA / ET, Mon–Fri). Cron ids match the Perplexity tasks.
const SCHEDULE = [
  { id:"7c28c988", name:"Premarket #1 (GPATO microcap)", ksa:"15:30", et:"08:30", engine:"GPATO", h:15, m:30 },
  { id:"0b4603cd", name:"Premarket #2",                   ksa:"16:35", et:"09:35", engine:"GPATO", h:16, m:35 },
  { id:"d2764927", name:"Premarket #3",                   ksa:"16:40", et:"09:40", engine:"GPATO", h:16, m:40 },
  { id:"b43b7859", name:"Cash-Open (MOMO+ large-cap)",    ksa:"17:00", et:"10:00", engine:"MOMO+", h:17, m:0  },
  { id:"100435fc", name:"Afternoon (LIS late-ignition)",  ksa:"21:00", et:"14:00", engine:"LIS",   h:21, m:0  },
  { id:"8ea0b494", name:"Post-Close (NBW night-before)",  ksa:"23:30", et:"16:30", engine:"NBW",   h:23, m:30 },
];

async function fetchLogText(){
  try{
    const r = await fetch(LOG_URL, { cache:"no-store" });
    if(r.ok){ return { text: await r.text(), source:"github" }; }
  }catch(e){}
  return { text:"", source:"none" };
}

async function fetchMarketsJson(){
  try{
    const r = await fetch(MK_URL, { cache:"no-store" });
    if(r.ok){
      const j = await r.json();
      if(j && Array.isArray(j.indices) && j.indices.length){ j.source="github"; return j; }
    }
  }catch(e){}
  return null;
}

async function fetchYahoo(){
  try{
    const syms = INDICES.map(i=>encodeURIComponent(i.yahoo)).join(",");
    const r = await fetch("https://query1.finance.yahoo.com/v7/finance/quote?symbols="+syms, { cache:"no-store" });
    if(!r.ok) return null;
    const j = await r.json();
    const res = (j && j.quoteResponse && j.quoteResponse.result) || [];
    if(!res.length) return null;
    const bySym = {};
    res.forEach(q=>{ bySym[q.symbol]=q; });
    const indices = INDICES.map(i=>{
      const q = bySym[i.yahoo] || {};
      return {
        sym:i.sym, label:i.label, name:i.name,
        price: q.regularMarketPrice!=null? q.regularMarketPrice : null,
        change: q.regularMarketChange!=null? q.regularMarketChange : null,
        pct: q.regularMarketChangePercent!=null? q.regularMarketChangePercent : null,
      };
    });
    return { asOf:"yahoo-live", indices, source:"yahoo" };
  }catch(e){ return null; }
}

async function fetchMarkets(){
  const gh = await fetchMarketsJson();
  if(gh) return gh;
  const y = await fetchYahoo();
  if(y) return y;
  const seed = JSON.parse(JSON.stringify(INDEX_SEED)); seed.source="seed"; return seed;
}

// Parse the udwf_scan_log.md RUN ENTRIES into structured runs + baseline regime.
function parseLog(text){
  const runs = [];
  let baselineRegime = "";
  if(!text) return { runs, baselineRegime };

  const bm = text.match(/MONITORING STARTED[^\n]*\n([\s\S]*?)(?:\n### |\n## |$)/i);
  if(bm){
    const rl = bm[1].match(/Regime:[^\n]*/i);
    if(rl) baselineRegime = rl[0].replace(/^[-\s]*Regime:\s*/i,"").trim();
  }

  // Each run begins with a "### " header line.
  const blocks = text.split(/\n(?=### )/);
  blocks.forEach(b=>{
    const hm = b.match(/^### (.+)$/m);
    if(!hm) return;
    const header = hm[1].trim();
    if(/MONITORING STARTED/i.test(header)) return;
    const grab = (label)=>{
      const re = new RegExp("(?:^|\\n)[-*\\s]*\\*{0,2}"+label+"\\*{0,2}\\s*:?\\s*(.+)","i");
      const mm = b.match(re);
      return mm ? mm[1].replace(/\*\*/g,"").trim() : "";
    };
    const regimeLine = grab("Regime");
    let regime = "UNKNOWN";
    if(/RISK[_ ]?OFF/i.test(regimeLine)) regime="RISK_OFF";
    else if(/RISK[_ ]?ON/i.test(regimeLine)) regime="RISK_ON";
    else if(/NEUTRAL/i.test(regimeLine)) regime="NEUTRAL";
    runs.push({
      header,
      regime,
      regimeLine,
      board: grab("Board"),
      topPick: grab("Top pick"),
      killed: grab("Killed at gates"),
      followup: grab("Follow-up"),
    });
  });
  return { runs, baselineRegime };
}

// Next Mon–Fri occurrence of an h:m KSA time, in minutes from now.
function nextRun(h, m){
  const now = new Date();
  const ksaNow = new Date(now.getTime() + (3*60 - now.getTimezoneOffset())*60000); // UTC+3
  for(let d=0; d<8; d++){
    const cand = new Date(ksaNow);
    cand.setDate(ksaNow.getDate()+d);
    cand.setHours(h, m, 0, 0);
    const dow = cand.getDay(); // 0 Sun..6 Sat
    if(dow===0 || dow===6) continue;
    if(cand.getTime() <= ksaNow.getTime()) continue;
    const mins = Math.round((cand.getTime() - ksaNow.getTime())/60000);
    const pad = n=>String(n).padStart(2,"0");
    const nextKsa = cand.getFullYear()+"-"+pad(cand.getMonth()+1)+"-"+pad(cand.getDate())+" "+pad(h)+":"+pad(m);
    return { nextKsa, inMinutes: mins };
  }
  return { nextKsa:null, inMinutes:null };
}

const crypto = require("crypto");
function getCookie(req, name){
  const c = req.headers.cookie || "";
  const m = c.match(new RegExp("(?:^|;\\s*)"+name+"=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}
function validSession(req){
  const secret = process.env.SESSION_SECRET || "dev-secret";
  const tok = getCookie(req, "udwf_sess");
  if(!tok || tok.indexOf(".")<0) return false;
  const [b,s] = tok.split(".");
  const exp = crypto.createHmac("sha256", secret).update(b).digest("base64url");
  if(s !== exp) return false;
  try{ const p = JSON.parse(Buffer.from(b,"base64url").toString()); return !(p.exp && Date.now()>p.exp); }catch(e){ return false; }
}

module.exports = async (req, res) => {
  res.setHeader("cache-control","no-store");
  if(!validSession(req)){
    res.setHeader("content-type","application/json");
    res.status(401).end(JSON.stringify({ ok:false, error:"auth required" }));
    return;
  }
  const [{ text, source }, markets] = await Promise.all([ fetchLogText(), fetchMarkets() ]);
  const { runs, baselineRegime } = parseLog(text);
  const schedule = SCHEDULE.map(s=>{
    const nx = nextRun(s.h, s.m);
    return { id:s.id, name:s.name, ksa:s.ksa, et:s.et, engine:s.engine, nextKsa:nx.nextKsa, inMinutes:nx.inMinutes };
  });
  res.setHeader("content-type","application/json");
  res.setHeader("cache-control","no-store");
  res.status(200).end(JSON.stringify({
    source, fetchedAt:new Date().toISOString(),
    stages:STAGES, schedule, markets, runs, baselineRegime,
  }));
};
