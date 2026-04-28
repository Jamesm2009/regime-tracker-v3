module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  var url   = process.env.UPSTASH_REDIS_REST_URL;
  var token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Debug: show all env var keys visible to this function
  var allKeys = Object.keys(process.env).filter(function(k) {
    return k.indexOf('UPSTASH') > -1 || k.indexOf('RESEND') > -1 || k.indexOf('CRON') > -1;
  });

  if (!url || !token) {
    return res.status(200).json({
      ok: false,
      cached: false,
      error: 'Env vars missing',
      urlSet: !!url,
      tokenSet: !!token,
      visibleEnvKeys: allKeys
    });
  }

  try {
    var r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', 'regime:current'])
    });
    var j = await r.json();

    if (!j.result) {
      return res.status(200).json({ ok: true, cached: false });
    }

    var data = typeof j.result === 'string' ? JSON.parse(j.result) : j.result;

    var r2 = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', 'regime:history'])
    });
    var j2 = await r2.json();
    var history = j2.result
      ? (typeof j2.result === 'string' ? JSON.parse(j2.result) : j2.result)
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
