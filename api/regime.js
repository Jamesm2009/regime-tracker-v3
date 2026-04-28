// api/regime.js
module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var url   = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(200).json({
      ok: false,
      cached: false,
      error: 'Env vars missing',
      urlSet: !!url,
      tokenSet: !!token
    });
  }

  // Same POST-body format that works in subscribe.js
  async function redisGet(key) {
    var r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', key])
    });
    var j = await r.json();
    return j.result;
  }

  try {
    var raw = await redisGet('regime:current');

    if (!raw) {
      return res.status(200).json({ ok: true, cached: false });
    }

    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;

    var histRaw = await redisGet('regime:history');
    var history = histRaw
      ? (typeof histRaw === 'string' ? JSON.parse(histRaw) : histRaw)
      : (data.history || []);

    return res.status(200).json({
      ok: true,
      cached: true,
      updatedAt: data.updatedAt || null,
      regime: {
        q:             data.q             || 2,
        rawQ:          data.rawQ          || data.q || 2,
        date:          data.date          || null,
        spyClose:      data.spyClose      || null,
        g:             data.g             != null ? data.g  : null,
        i:             data.i             != null ? data.i  : null,
        ig:            data.ig            != null ? data.ig : null,
        energyPremium: data.energyPremium || null,
        usingDBA:      data.usingDBA      || false,
        history:       history
      }
    });

  } catch(e) {
    return res.status(200).json({ ok: true, cached: false, error: e.message });
  }
};
