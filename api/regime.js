// api/regime.js
// GET /api/regime — returns cached regime data from Redis
// Returns { ok, cached, regime } or { ok, cached:false } if empty

module.exports = async function handler(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘GET, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);
if (req.method === ‘OPTIONS’) return res.status(200).end();

const url   = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

// Env var check — return clear error, never crash
if (!url || !token) {
return res.status(500).json({
ok: false,
error: ‘Missing env vars’,
upstashUrl: url ? ‘set’ : ‘MISSING’,
upstashToken: token ? ‘set’ : ‘MISSING’
});
}

// Single helper — POST body format, same as subscribe.js
async function redisGet(key) {
const r = await fetch(url, {
method: ‘POST’,
headers: { Authorization: `Bearer ${token}`, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify([‘GET’, key])
});
if (!r.ok) throw new Error(`Upstash ${r.status}`);
const j = await r.json();
return j.result; // null if key doesn’t exist
}

try {
const raw = await redisGet(‘regime:current’);

```
// Nothing stored yet — cron hasn't run
if (raw === null || raw === undefined) {
  return res.status(200).json({ ok: true, cached: false });
}

// Safely parse — if corrupt, return uncached rather than crash
let data;
try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; }
catch (e) { return res.status(200).json({ ok: true, cached: false, parseError: e.message }); }

// Fetch history separately (may not exist on first run after update)
let history = data.history || [];
try {
  const histRaw = await redisGet('regime:history');
  if (histRaw) {
    history = typeof histRaw === 'string' ? JSON.parse(histRaw) : histRaw;
  }
} catch (e) { /* use history from regime:current if regime:history fetch fails */ }

return res.status(200).json({
  ok: true,
  cached: true,
  updatedAt: data.updatedAt || null,
  regime: {
    q:             data.q            || 2,
    rawQ:          data.rawQ         || data.q || 2,
    date:          data.date         || null,
    spyClose:      data.spyClose     || null,
    g:             data.g            != null ? data.g  : null,
    i:             data.i            != null ? data.i  : null,
    ig:            data.ig           != null ? data.ig : null,
    energyPremium: data.energyPremium != null ? data.energyPremium : null,
    usingDBA:      data.usingDBA     || false,
    history:       history
  }
});
```

} catch (err) {
// Never crash — return a fallback so dashboard uses Yahoo
return res.status(200).json({ ok: true, cached: false, error: err.message });
}
};
