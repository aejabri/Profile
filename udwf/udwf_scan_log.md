# UDWF+ Scheduled Scan — Persistent Monitoring Log

This is the single running log for the UDWF+ gated pipeline scheduled scans.

**Contract**
- Each scheduled run **READS this log first** (prior dated results inform the new scan — continuity, no cold starts).
- Then **APPENDS** one new timestamped entry: the gated board + the top pick + explicit follow-up advice.
- Timestamps are dual-clock: **Asia/Riyadh primary, ET in parentheses**.
- Engine focus per window: 15:30 KSA premarket (GPATO microcap), 17:00 cash-open (MOMO+ large-cap), 21:00 afternoon (LIS late-ignition), 23:30 post-close (NBW night-before).
- Runs Mon–Fri (US trading days). Live data only. Not investment advice.

**How to read the follow-up advice line:** it carries forward to the next run — e.g. a QUEUE'd name with a trigger, an open position to manage, or a level to watch. The next run checks whether that follow-up resolved before proposing anything fresh.

---

## MONITORING STARTED

- **Started:** 2026-06-18 10:51 KSA (03:51 ET, Thu)
- **Engine:** UDWF+ gated 7-stage pipeline (regime-oracle → scanrouter → engine fan-out → PPR/GEX → governance → risk-router → emit)
- **Schedule (Asia/Riyadh, Mon–Fri):** 15:30 premarket · 17:00 cash-open · 21:00 afternoon · 23:30 post-close
- **Notify:** Telegram + in-app/dashboard + this log
- **Baseline regime at start (from this morning's run):** 🔴 RISK_OFF · VIX 18.44 (+12.37%) · VIX9D/VIX 1.01 backwardation · SPY 740.96 (-1.25%) · QQQ 722.51 (-1.01%) · IWM 289.88 (-0.75%). After-hours relief mild (SPY +0.56%), not a reversal.
- **Carry-forward follow-up:** No fresh SIZE off-session; watch MU (24th AH) and FDX (23rd AH) as week's catalyst tone-setters. First live run = premarket 15:30 KSA today.

---

<!-- New run entries are appended below this line, newest at the bottom. -->

## RUN ENTRIES

_(none yet — first scheduled run will append here)_
