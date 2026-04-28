// api/regime.js — Vercel Serverless Function
// GET /api/regime → returns the latest cached regime data from Redis
// Called by index.html on every page load instead of hitting Yahoo Finance directly
// Falls back gracefully if Redis is empty (first deploy, before cron has run)

async function redis(…args) {
const url   = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) throw new Error(‘UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing’);

const res = await fetch(url, {
method: ‘POST’,
headers: {
Authorization: `Bearer ${token}`,
‘Content-Type’: ‘application/json’
},
body: JSON.stringify(args)
});

if (!res.ok) {
const text = await res.text();
throw new Error(`Upstash error ${res.status}: ${text}`);
}

const json = await res.json();
return json.result;
}

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);

if (req.method === ‘OPTIONS’) return res.status(200).end();
if (req.method !== ‘GET’) return res.status(405).json({ ok: false, error: ‘Method not allowed’ });

try {
const raw = await redis(‘GET’, ‘regime:current’);

```
if (!raw) {
  // Redis is empty — cron hasn't run yet. Tell the dashboard to fall back to Yahoo.
  return res.status(200).json({
    ok: true,
    cached: false,
    message: 'No cached data yet — dashboard should fetch from Yahoo Finance directly'
  });
}

const data = JSON.parse(raw);

// Also fetch the last 5 history entries if stored
const histRaw = await redis('GET', 'regime:history');
const history = histRaw ? JSON.parse(histRaw) : null;

return res.status(200).json({
  ok: true,
  cached: true,
  updatedAt: data.updatedAt,
  regime: {
    q:            data.q,
    rawQ:         data.rawQ,
    date:         data.date,
    spyClose:     data.spyClose,
    g:            data.g,
    i:            data.i,
    ig:           data.ig,
    energyPremium: data.energyPremium,
    usingDBA:     data.usingDBA,
    history:      history || data.history || []
  }
});
```

} catch (err) {
console.error(‘regime.js error:’, err);
return res.status(500).json({ ok: false, error: err.message });
}
};
