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

  try {
    var r = await fetch(url + '/get/regime:current', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var j = await r.json();

    if (!j.result) {
      return res.status(200).json({ ok: true, cached: false });
    }

    var data = JSON.parse(j.result);

    var r2 = await fetch(url + '/get/regime:history', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var j2 = await r2.json();
    var history = j2.result ? JSON.parse(j2.result) : (data.history || []);

    return res.status(200).json({
      ok: true,
      cached: true,
      updatedAt: data.updatedAt || null,
      regime: {
        q:             data.q    || 2,
        rawQ:          data.rawQ || data.q || 2,
        date:          data.date || null,
        spyClose:      data.spyClose || null,
        g:             data.g  != null ? data.g  : null,
        i:             data.i  != null ? data.i  : null,
        ig:            data.ig != null ? data.ig : null,
        energyPremium: data.energyPremium || null,
        usingDBA:      data.usingDBA || false,
        history:       history
      }
    });

  } catch(e) {
    return res.status(200).json({ ok: true, cached: false, error: e.message });
  }
};
