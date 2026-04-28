// api/refresh.js
// Vercel Cron: “0 23 * * 1-5” (5pm CT / 11pm UTC, weekdays)
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, RESEND_API_KEY, CRON_SECRET

// ── Redis (body-format, matches subscribe.js and regime.js) ──────────────────
async function redis(…args) {
const url   = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) throw new Error(‘Upstash env vars missing’);
const r = await fetch(url, {
method: ‘POST’,
headers: { Authorization: `Bearer ${token}`, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify(args)
});
if (!r.ok) { const t = await r.text(); throw new Error(`Upstash ${r.status}: ${t}`); }
return (await r.json()).result;
}

// ── Yahoo via allorigins proxy (direct Yahoo calls blocked server-side) ───────
async function fetchYahoo(ticker, days) {
const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${days}d`;
const pUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`;
const r = await fetch(pUrl);
if (!r.ok) throw new Error(`Yahoo ${ticker} HTTP ${r.status}`);
const j = await r.json();
const res = j.chart.result[0];
return res.timestamp
.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: res.indicators.quote[0].close[i] }))
.filter(x => x.c != null);
}

// ── Signal calculation ────────────────────────────────────────────────────────
function ret(arr, i, k) {
if (i < k || !arr[i] || !arr[i-k] || !arr[i-k].c) return null;
return (arr[i].c - arr[i-k].c) / arr[i-k].c;
}

function calcSignals(spy, dbc, gld, dba) {
const n = spy.length;
if (n < 64) return null;
const idx = (arr, d) => { const i = arr.findIndex(x => x.d === d); return i; };
const latest = spy[n-1];
const g20 = ret(spy, n-1, 20);
const di = idx(dbc, latest.d); const gi = idx(gld, latest.d); const ai = idx(dba, latest.d);
const d20 = di >= 20 ? ret(dbc, di, 20) : null;
const a20 = ai >= 20 ? ret(dba, ai, 20) : null;
const g20g = gi >= 20 ? ret(gld, gi, 20) : null;
const d63 = di >= 63 ? ret(dbc, di, 63) : null;
const a63 = ai >= 63 ? ret(dba, ai, 63) : null;
const g63 = gi >= 63 ? ret(gld, gi, 63) : null;
const ep = d20 != null && a20 != null ? d20 - a20 : null;
const usingDBA = ep != null && ep > 0.06;
const ic20 = usingDBA ? a20 : d20;
const ic63 = (d63 != null && a63 != null && (d63 - a63) > 0.06) ? a63 : d63;
const i20  = ic20 != null && g20g != null ? (ic20 + g20g) / 2 : null;
const ig63 = ic63 != null && g63  != null ? (ic63 + g63)  / 2 : null;
return { date: latest.d, spyClose: latest.c, g: g20, i: i20, ig: ig63, energyPremium: ep, usingDBA };
}

function rawQ(g, i) {
if (g == null || i == null) return null;
if (g >= 0 && i < 0) return 1;
if (g >= 0 && i >= 0) return 2;
if (g < 0 && i >= 0) return 3;
return 4;
}

// ── ETF / label data ──────────────────────────────────────────────────────────
const QNAMES  = { 1:‘Goldilocks’, 2:‘Overheating’, 3:‘Stagflation’, 4:‘Deflation’ };
const QARROWS = { 1:‘Growth ↑  Inflation ↓’, 2:‘Growth ↑  Inflation ↑’, 3:‘Growth ↓  Inflation ↑’, 4:‘Growth ↓  Inflation ↓’ };
const RECS    = { 1:[‘QQQ’,‘IWF’,‘MGK’,‘SMH’,‘XLK’,‘XLY’,‘XHB’,‘IWM’], 2:[‘XLE’,‘XLB’,‘SLV’,‘DBC’,‘GLD’,‘XLI’,‘SMH’,‘XHB’], 3:[‘GLD’,‘SLV’,‘USO’,‘XLE’,‘SHY’,‘XLK’], 4:[‘XLU’,‘XLP’,‘XLV’,‘IEF’,‘IEI’,‘SHY’] };
const SHORTS  = { 1:[‘XLE’,‘EEM’,‘TLT’,‘EWU’], 2:[‘TLT’,‘HYG’,‘FXY’,‘FXE’], 3:[‘TLT’,‘IEF’,‘EMB’,‘FXY’], 4:[‘USO’,‘DBC’,‘VNM’,‘XLE’] };
const QCOL    = { 1:’#2fd98a’, 2:’#f0a030’, 3:’#e85555’, 4:’#5b9ef0’ };
const QBG     = { 1:‘background:#0c1f16;border:1px solid #2fd98a;’, 2:‘background:#201500;border:1px solid #f0a030;’, 3:‘background:#1f0c0c;border:1px solid #e85555;’, 4:‘background:#0c1220;border:1px solid #5b9ef0;’ };
const pct = v => v == null ? ‘—’ : (v >= 0 ? ‘+’ : ‘’) + (v * 100).toFixed(2) + ‘%’;

// ── Email ─────────────────────────────────────────────────────────────────────
function buildEmail(prevQ, newQ, sig) {
const col = QCOL[newQ];
return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">

<title>Regime Change</title></head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <p style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8e8b86;">⬛ MACRO REGIME TRACKER</p>
  <div style="${QBG[newQ]}border-radius:12px;padding:24px;margin:16px 0;">
    <p style="font-size:11px;color:#8e8b86;margin:0 0 4px;">⚡ CONFIRMED REGIME CHANGE</p>
    <p style="font-size:11px;color:#8e8b86;margin:0 0 8px;">Q${prevQ} ${QNAMES[prevQ]} → Q${newQ} ${QNAMES[newQ]}</p>
    <p style="font-size:32px;font-weight:800;color:${col};margin:0 0 4px;">Q${newQ} ${QNAMES[newQ]}</p>
    <p style="font-size:14px;color:#c0bdb8;margin:0;">${QARROWS[newQ]}</p>
  </div>
  <div style="background:#161819;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:20px;margin-bottom:16px;">
    <p style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8e8b86;margin:0 0 12px;">SIGNALS — ${sig.date}</p>
    <table><tr>
      <td style="padding-right:24px;"><p style="font-size:10px;color:#8e8b86;margin:0 0 4px;">Growth (SPY 20d)</p><p style="font-family:monospace;font-size:20px;font-weight:600;color:${sig.g>=0?'#2fd98a':'#e85555'};margin:0;">${pct(sig.g)}</p></td>
      <td style="padding-right:24px;"><p style="font-size:10px;color:#8e8b86;margin:0 0 4px;">Inflation (20d)</p><p style="font-family:monospace;font-size:20px;font-weight:600;color:${sig.i>=0?'#f0a030':'#5b9ef0'};margin:0;">${pct(sig.i)}</p></td>
      <td><p style="font-size:10px;color:#8e8b86;margin:0 0 4px;">Gate (63d)</p><p style="font-family:monospace;font-size:20px;font-weight:600;color:${sig.ig>=0?'#f0a030':'#2fd98a'};margin:0;">${pct(sig.ig)}</p></td>
    </tr></table>
    ${sig.usingDBA ? `<p style="font-size:11px;color:#8e8b86;font-family:monospace;margin:12px 0 0;">⚠ DBA active — energy premium ${pct(sig.energyPremium)}</p>` : ''}
  </div>
  <div style="background:#161819;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:20px;margin-bottom:16px;">
    <p style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8e8b86;margin:0 0 8px;">LONG ETFs</p>
    <p style="font-family:monospace;font-size:14px;color:${col};margin:0 0 14px;">${RECS[newQ].join(' · ')}</p>
    <p style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8e8b86;margin:0 0 8px;">SHORT CANDIDATES</p>
    <p style="font-family:monospace;font-size:14px;color:#e85555;margin:0;">${SHORTS[newQ].join(' · ')}</p>
  </div>
  <p style="font-size:11px;color:#5e5b58;line-height:1.8;border-top:1px solid rgba(255,255,255,.09);padding-top:16px;">
    <strong style="color:#8e8b86;">⚠ NOT INVESTMENT ADVICE.</strong> For informational purposes only.
    Past regime accuracy does not guarantee future results. Consult a qualified financial advisor.
  </p>
</div></body></html>`;
}

async function sendAlert(subscribers, prevQ, newQ, sig) {
if (!subscribers.length || !process.env.RESEND_API_KEY) return 0;
const r = await fetch(‘https://api.resend.com/emails’, {
method: ‘POST’,
headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({
from: ‘Macro Regime Tracker [alerts@scripture-platform.io](mailto:alerts@scripture-platform.io)’,
to: subscribers,
subject: `⚡ Regime Change: Q${prevQ} ${QNAMES[prevQ]} → Q${newQ} ${QNAMES[newQ]} [${sig.date}]`,
html: buildEmail(prevQ, newQ, sig)
})
});
if (!r.ok) { const t = await r.text(); throw new Error(`Resend: ${t}`); }
return subscribers.length;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
// Auth check for manual GET triggers
if (req.method === ‘GET’) {
const auth = req.headers.authorization;
if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
return res.status(401).json({ error: ‘Unauthorized’ });
}
}

const log = [];
try {
log.push(‘Fetching Yahoo data…’);
const [spy, dbc, gld, dba] = await Promise.all([
fetchYahoo(‘SPY’, 270), fetchYahoo(‘DBC’, 270),
fetchYahoo(‘GLD’, 270), fetchYahoo(‘DBA’, 270)
]);
log.push(`SPY:${spy.length} DBC:${dbc.length} GLD:${gld.length} DBA:${dba.length}`);

```
const sig = calcSignals(spy, dbc, gld, dba);
if (!sig) throw new Error('Not enough price history');
log.push(`Signals: g=${pct(sig.g)} i=${pct(sig.i)} ig=${pct(sig.ig)} date=${sig.date}`);

// Load previous state
const prevRaw = await redis('GET', 'regime:current');
let prev = null;
try { prev = prevRaw ? (typeof prevRaw === 'string' ? JSON.parse(prevRaw) : prevRaw) : null; } catch(e) {}
const prevQ = prev ? prev.q : null;
const prevHistory = prev ? (prev.history || []) : [];

// Today's entry
const rq = rawQ(sig.g, sig.i);
// Q4 gate: block Q4 if 63d inflation gate still positive
const gatedQ = rq === 4 && sig.ig != null && sig.ig > 0 ? (prevQ || 3) : rq;
const todayEntry = { date: sig.date, spyClose: sig.spyClose, rawQ: gatedQ, g: sig.g, i: sig.i, ig: sig.ig };
const history = [...prevHistory.slice(-4), todayEntry];

// 3-day confirmation
let confirmedQ = prevQ || 2;
if (history.length >= 3) {
  const last3 = history.slice(-3);
  if (last3.every(h => h.rawQ === last3[0].rawQ)) confirmedQ = last3[0].rawQ;
}
log.push(`Raw Q${gatedQ} → Confirmed Q${confirmedQ} (prev Q${prevQ})`);

// Store to Redis — both keys
const payload = { ...sig, q: confirmedQ, rawQ: gatedQ, history, updatedAt: new Date().toISOString() };
await redis('SET', 'regime:current', JSON.stringify(payload));
await redis('SET', 'regime:history', JSON.stringify(history));
log.push('Stored regime:current and regime:history');

// Email alert on confirmed regime change
let sent = 0;
if (prevQ !== null && confirmedQ !== prevQ) {
  log.push(`Regime change Q${prevQ}→Q${confirmedQ} — fetching subscribers...`);
  const subs = await redis('SMEMBERS', 'alerts:subscribers');
  const subList = Array.isArray(subs) ? subs : [];
  log.push(`Subscribers: ${subList.length}`);
  sent = await sendAlert(subList, prevQ, confirmedQ, sig);
  log.push(`Emails sent: ${sent}`);
} else {
  log.push(`No regime change — Q${confirmedQ} maintained`);
}

return res.status(200).json({
  ok: true, date: sig.date, regime: confirmedQ, regimeName: QNAMES[confirmedQ],
  changed: prevQ !== null && confirmedQ !== prevQ, emailsSent: sent, log
});
```

} catch (err) {
console.error(‘refresh.js error:’, err);
return res.status(500).json({ ok: false, error: err.message, log });
}
};
