// api/refresh.js — Vercel Serverless Function
// Cron schedule: "0 23 * * 1-5"  (5pm CT / 11pm UTC, weekdays)
// Env vars required: UPSTASH_URL, UPSTASH_TOKEN, RESEND_API_KEY

// ─── Upstash Redis helpers ───────────────────────────────────────────────────
async function redisGet(key) {
  const res = await fetch(`${process.env.UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` }
  });
  const json = await res.json();
  return json.result; // null if not found
}

async function redisSet(key, value) {
  const res = await fetch(`${process.env.UPSTASH_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([value])
  });
  return res.ok;
}

async function redisSAdd(key, member) {
  const res = await fetch(`${process.env.UPSTASH_URL}/sadd/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([member])
  });
  return res.ok;
}

async function redisSmembers(key) {
  const res = await fetch(`${process.env.UPSTASH_URL}/smembers/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_TOKEN}` }
  });
  const json = await res.json();
  return Array.isArray(json.result) ? json.result : [];
}

// ─── Yahoo Finance fetch ─────────────────────────────────────────────────────
async function fetchYahoo(ticker, days) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=${days}d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  if (!res.ok) throw new Error(`Yahoo fetch failed: ${ticker} HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart.result[0];
  const timestamps = result.timestamp;
  const closes = result.indicators.quote[0].close;
  return timestamps
    .map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: closes[i] }))
    .filter(x => x.c != null);
}

// ─── Signal calculation ──────────────────────────────────────────────────────
function retVal(arr, i, k) {
  if (i < k || !arr[i] || !arr[i - k] || !arr[i - k].c) return null;
  return (arr[i].c - arr[i - k].c) / arr[i - k].c;
}

function calcSignals(spy, dbc, gld, dba) {
  const n = spy.length;
  if (n < 64) return null;

  const dbcMap = {};
  dbc.forEach((x, i) => { dbcMap[x.d] = i; });
  const gldMap = {};
  gld.forEach((x, i) => { gldMap[x.d] = i; });
  const dbaMap = {};
  dba.forEach((x, i) => { dbaMap[x.d] = i; });

  const latest = spy[n - 1];
  const g20 = retVal(spy, n - 1, 20);

  const di = dbcMap[latest.d] !== undefined ? dbcMap[latest.d] : -1;
  const gi = gldMap[latest.d] !== undefined ? gldMap[latest.d] : -1;
  const ai = dbaMap[latest.d] !== undefined ? dbaMap[latest.d] : -1;

  const d20 = di >= 20 ? retVal(dbc, di, 20) : null;
  const a20 = ai >= 20 ? retVal(dba, ai, 20) : null;
  const g20g = gi >= 20 ? retVal(gld, gi, 20) : null;
  const d63 = di >= 63 ? retVal(dbc, di, 63) : null;
  const a63 = ai >= 63 ? retVal(dba, ai, 63) : null;
  const g63 = gi >= 63 ? retVal(gld, gi, 63) : null;

  // Hybrid DBC/DBA swap if energy premium > 6pp
  const useHybridDBA20 = d20 != null && a20 != null && (d20 - a20) > 0.06;
  const useHybridDBA63 = d63 != null && a63 != null && (d63 - a63) > 0.06;

  const ic20 = useHybridDBA20 ? a20 : d20;
  const ic63 = useHybridDBA63 ? a63 : d63;

  const i20 = ic20 != null && g20g != null ? (ic20 + g20g) / 2 : null;
  const ig63 = ic63 != null && g63 != null ? (ic63 + g63) / 2 : null;

  return {
    date: latest.d,
    spyClose: latest.c,
    g: g20,
    i: i20,
    ig: ig63,
    energyPremium: d20 != null && a20 != null ? d20 - a20 : null,
    usingDBA: useHybridDBA20
  };
}

function getQuadrant(g, i, ig, prevQ) {
  if (g == null || i == null) return prevQ || 2;
  let raw;
  if (g >= 0 && i < 0) raw = 1;
  else if (g >= 0 && i >= 0) raw = 2;
  else if (g < 0 && i >= 0) raw = 3;
  else raw = 4;

  // Q4 gate: block if 63d inflation still elevated
  if (raw === 4 && ig != null && ig > 0) return prevQ || 3;
  return raw;
}

// ─── Email helpers ────────────────────────────────────────────────────────────
const QNAMES  = { 1: 'Goldilocks', 2: 'Overheating', 3: 'Stagflation', 4: 'Deflation' };
const QARROWS = { 1: 'Growth ↑  Inflation ↓', 2: 'Growth ↑  Inflation ↑', 3: 'Growth ↓  Inflation ↑', 4: 'Growth ↓  Inflation ↓' };
const RECS    = { https://scripture-platform.io}
  1: ['QQQ', 'IWF', 'MGK', 'SMH', 'XLK', 'XLY', 'XHB', 'IWM'],
  2: ['XLE', 'XLB', 'SLV', 'DBC', 'GLD', 'XLI', 'SMH', 'XHB'],
  3: ['GLD', 'SLV', 'USO', 'XLE', 'SHY', 'XLK'],
  4: ['XLU', 'XLP', 'XLV', 'IEF', 'IEI', 'SHY']
};
const SHORTS  = {
  1: ['XLE', 'EEM', 'TLT', 'EWU'],
  2: ['TLT', 'HYG', 'FXY', 'FXE'],
  3: ['TLT', 'IEF', 'EMB', 'FXY'],
  4: ['USO', 'DBC', 'VNM', 'XLE']
};
const QCOLOURS = { 1: '#2fd98a', 2: '#f0a030', 3: '#e85555', 4: '#5b9ef0' };
const QBG     = {
  1: 'background:#0c1f16;border:1px solid #2fd98a;',
  2: 'background:#201500;border:1px solid #f0a030;',
  3: 'background:#1f0c0c;border:1px solid #e85555;',
  4: 'background:#0c1220;border:1px solid #5b9ef0;'
};

function pct(v) {
  return v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
}

function buildEmailHtml(prevQ, newQ, signals) {
  const col = QCOLOURS[newQ];
  const longs = RECS[newQ].join(' · ');
  const shorts = SHORTS[newQ].join(' · ');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Regime Change Alert</title>
</head>
<body style="margin:0;padding:0;background:#0c0d0f;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">

  <div style="margin-bottom:24px;">
    <span style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8e8b86;">
      ⬛ MACRO REGIME TRACKER
    </span>
  </div>

  <div style="${QBG[newQ]}border-radius:12px;padding:24px;margin-bottom:24px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8e8b86;margin-bottom:8px;">
      ⚡ CONFIRMED REGIME CHANGE
    </div>
    <div style="font-size:11px;color:#8e8b86;margin-bottom:4px;">
      Q${prevQ} ${QNAMES[prevQ]} → Q${newQ} ${QNAMES[newQ]}
    </div>
    <div style="font-size:32px;font-weight:800;color:${col};line-height:1;margin-bottom:6px;">
      Q${newQ} ${QNAMES[newQ]}
    </div>
    <div style="font-size:14px;color:#c0bdb8;">
      ${QARROWS[newQ]}
    </div>
  </div>

  <div style="background:#161819;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8e8b86;margin-bottom:14px;">
      LIVE SIGNALS — ${signals.date}
    </div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div>
        <div style="font-size:10px;color:#8e8b86;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Growth (SPY 20d)</div>
        <div style="font-family:monospace;font-size:20px;font-weight:600;color:${signals.g >= 0 ? '#2fd98a' : '#e85555'};">${pct(signals.g)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#8e8b86;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Inflation (Hybrid 20d)</div>
        <div style="font-family:monospace;font-size:20px;font-weight:600;color:${signals.i >= 0 ? '#f0a030' : '#5b9ef0'};">${pct(signals.i)}</div>
      </div>
      <div>
        <div style="font-size:10px;color:#8e8b86;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Gate (63d)</div>
        <div style="font-family:monospace;font-size:20px;font-weight:600;color:${signals.ig >= 0 ? '#f0a030' : '#2fd98a'};">${pct(signals.ig)}</div>
      </div>
    </div>
    ${signals.usingDBA ? `<div style="margin-top:12px;font-size:11px;color:#8e8b86;font-family:monospace;">⚠ DBA active — energy premium ${pct(signals.energyPremium)} above DBA (geopolitical filter)</div>` : ''}
  </div>

  <div style="background:#161819;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:20px;margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8e8b86;margin-bottom:10px;">RECOMMENDED LONG ETFs</div>
    <div style="font-family:monospace;font-size:14px;color:${col};">${longs}</div>
    <div style="margin-top:14px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8e8b86;margin-bottom:10px;">SHORT CANDIDATES</div>
    <div style="font-family:monospace;font-size:14px;color:#e85555;">${shorts}</div>
  </div>

  <div style="border-top:1px solid rgba(255,255,255,.09);padding-top:20px;font-size:11px;color:#5e5b58;line-height:1.8;">
    <strong style="color:#8e8b86;">⚠ NOT INVESTMENT ADVICE.</strong>
    This alert is for informational purposes only. Past regime accuracy does not guarantee future results. 
    All signals are algorithmic and based on publicly available market data. 
    Consult a qualified financial advisor before making any investment decision.
    <br><br>
    You are receiving this because you subscribed to Macro Regime Tracker alerts.
  </div>

</div>
</body>
</html>`;
}

async function sendRegimeChangeEmail(subscribers, prevQ, newQ, signals) {
  if (!subscribers.length) return { sent: 0 };

  const html = buildEmailHtml(prevQ, newQ, signals);

  const payload = {
    from: 'Macro Regime Tracker <alerts@scripture-platofrm.io>', // ← update with your Resend verified domain
    to: subscribers,
    subject: `⚡ Regime Change: Q${prevQ} ${QNAMES[prevQ]} → Q${newQ} ${QNAMES[newQ]} [${signals.date}]`,
    html
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }

  return { sent: subscribers.length };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Allow Vercel Cron (GET with cron secret) or manual POST trigger
  if (req.method === 'GET') {
    const authHeader = req.headers.authorization;
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const log = [];
  try {
    log.push('Fetching Yahoo Finance data...');
    const [spy, dbc, gld, dba] = await Promise.all([
      fetchYahoo('SPY', 270),
      fetchYahoo('DBC', 270),
      fetchYahoo('GLD', 270),
      fetchYahoo('DBA', 270)
    ]);
    log.push(`SPY: ${spy.length} days, DBC: ${dbc.length}, GLD: ${gld.length}, DBA: ${dba.length}`);

    const signals = calcSignals(spy, dbc, gld, dba);
    if (!signals) throw new Error('Not enough price history to calculate signals');
    log.push(`Signals: g=${pct(signals.g)} i=${pct(signals.i)} ig=${pct(signals.ig)} date=${signals.date}`);

    // Get previous stored state
    const prevRaw = await redisGet('regime:current');
    const prev = prevRaw ? JSON.parse(prevRaw) : null;
    const prevQ = prev ? prev.q : null;

    // Build rolling 5-day history for confirmation check
    const prevHistory = prev ? (prev.history || []) : [];
    const todayEntry = {
      date: signals.date,
      rawQ: getQuadrant(signals.g, signals.i, signals.ig, prevQ),
      g: signals.g,
      i: signals.i,
      ig: signals.ig
    };

    // Keep last 5 days of history
    const history = [...prevHistory.slice(-4), todayEntry];

    // 3-day confirmation: need 3 consecutive days with same raw Q
    let confirmedQ = prevQ || 2;
    if (history.length >= 3) {
      const last3 = history.slice(-3);
      if (last3.every(h => h.rawQ === last3[0].rawQ)) {
        confirmedQ = last3[0].rawQ;
      }
    }

    const payload = {
      ...signals,
      q: confirmedQ,
      rawQ: todayEntry.rawQ,
      history,
      updatedAt: new Date().toISOString()
    };

    await redisSet('regime:current', JSON.stringify(payload));
    log.push(`Stored regime:current — Q${confirmedQ} (raw Q${todayEntry.rawQ})`);

    // Send alert if confirmed regime changed
    let emailResult = { sent: 0 };
    const regimeChanged = prevQ !== null && confirmedQ !== prevQ;
    if (regimeChanged) {
      log.push(`Regime change detected: Q${prevQ} → Q${confirmedQ}. Sending emails...`);
      const subscribers = await redisSmembers('alerts:subscribers');
      log.push(`Subscribers: ${subscribers.length}`);
      if (subscribers.length > 0) {
        emailResult = await sendRegimeChangeEmail(subscribers, prevQ, confirmedQ, signals);
        log.push(`Emails sent: ${emailResult.sent}`);
      }
    } else {
      log.push(`No regime change (Q${confirmedQ} maintained)`);
    }

    return res.status(200).json({
      ok: true,
      date: signals.date,
      regime: confirmedQ,
      regimeName: QNAMES[confirmedQ],
      changed: regimeChanged,
      emailsSent: emailResult.sent,
      log
    });

  } catch (err) {
    console.error('refresh.js error:', err);
    return res.status(500).json({ ok: false, error: err.message, log });
  }
}
