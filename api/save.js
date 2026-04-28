// api/save.js
// POST /api/save — called by the dashboard after it calculates signals client-side
// Saves regime data to Redis so future loads can read from cache

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  var url   = process.env.UPSTASH_URL;
  var token = process.env.UPSTASH_TOKEN;
  if (!url || !token) return res.status(500).json({ ok: false, error: 'Env vars missing' });

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { return res.status(400).json({ ok: false, error: 'Bad JSON' }); } }
  if (!body || !body.regime) return res.status(400).json({ ok: false, error: 'Missing regime data' });

  async function redisSet(key, value) {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, typeof value === 'string' ? value : JSON.stringify(value)])
    });
    if (!r.ok) { var t = await r.text(); throw new Error('Upstash ' + r.status + ': ' + t); }
    return (await r.json()).result;
  }

  async function redisGet(key) {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key])
    });
    var j = await r.json();
    return j.result;
  }

  async function redisSMembers(key) {
    var r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SMEMBERS', key])
    });
    var j = await r.json();
    return Array.isArray(j.result) ? j.result : [];
  }

  try {
    var incoming = body.regime;
    var prevRaw  = await redisGet('regime:current');
    var prev     = null;
    try { prev = prevRaw ? (typeof prevRaw === 'string' ? JSON.parse(prevRaw) : prevRaw) : null; } catch(e) {}
    var prevQ    = prev ? prev.q : null;

    var payload  = {
      q:             incoming.q,
      rawQ:          incoming.rawQ || incoming.q,
      date:          incoming.date,
      spyClose:      incoming.spyClose,
      g:             incoming.g,
      i:             incoming.i,
      ig:            incoming.ig,
      energyPremium: incoming.energyPremium || null,
      usingDBA:      incoming.usingDBA      || false,
      history:       incoming.history       || [],
      updatedAt:     new Date().toISOString()
    };

    await redisSet('regime:current', payload);
    await redisSet('regime:history', payload.history);

    // Send email alert if regime changed
    var emailsSent = 0;
    var changed = prevQ !== null && payload.q !== prevQ;
    if (changed && process.env.RESEND_API_KEY) {
      var subs = await redisSMembers('alerts:subscribers');
      if (subs.length > 0) {
        var QNAMES = { 1:'Goldilocks', 2:'Overheating', 3:'Stagflation', 4:'Deflation' };
        var RECS   = { 1:['QQQ','IWF','MGK','SMH','XLK','XLY','XHB','IWM'], 2:['XLE','XLB','SLV','DBC','GLD','XLI','SMH','XHB'], 3:['GLD','SLV','USO','XLE','SHY','XLK'], 4:['XLU','XLP','XLV','IEF','IEI','SHY'] };
        var SHORTS = { 1:['XLE','EEM','TLT','EWU'], 2:['TLT','HYG','FXY','FXE'], 3:['TLT','IEF','EMB','FXY'], 4:['USO','DBC','VNM','XLE'] };
        var QCOL   = { 1:'#2fd98a', 2:'#f0a030', 3:'#e85555', 4:'#5b9ef0' };
        var pct = function(v) { return v == null ? '-' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%'; };
        var html = '<!DOCTYPE html><html><body style="background:#0c0d0f;font-family:Arial,sans-serif;color:#eeebe5;padding:32px;">'
          + '<p style="font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#8e8b86;">MACRO REGIME TRACKER</p>'
          + '<div style="border-radius:12px;padding:24px;margin:16px 0;border:1px solid ' + QCOL[payload.q] + ';">'
          + '<p style="margin:0 0 4px;font-size:11px;color:#8e8b86;">CONFIRMED REGIME CHANGE: Q' + prevQ + ' ' + QNAMES[prevQ] + ' to Q' + payload.q + ' ' + QNAMES[payload.q] + '</p>'
          + '<p style="margin:0;font-size:32px;font-weight:800;color:' + QCOL[payload.q] + ';">Q' + payload.q + ' ' + QNAMES[payload.q] + '</p></div>'
          + '<p>Growth: ' + pct(payload.g) + ' &nbsp; Inflation: ' + pct(payload.i) + ' &nbsp; Gate: ' + pct(payload.ig) + '</p>'
          + '<p><strong>Long:</strong> ' + (RECS[payload.q] || []).join(', ') + '</p>'
          + '<p><strong>Short:</strong> ' + (SHORTS[payload.q] || []).join(', ') + '</p>'
          + '<hr style="border-color:rgba(255,255,255,.1);margin-top:24px;">'
          + '<p style="font-size:11px;color:#5e5b58;">NOT INVESTMENT ADVICE. For informational purposes only.</p>'
          + '</body></html>';
        var er = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Macro Regime Tracker <alerts@scripture-platform.io>',
            to: subs,
            subject: 'Regime Change: Q' + prevQ + ' to Q' + payload.q + ' ' + QNAMES[payload.q] + ' [' + payload.date + ']',
            html: html
          })
        });
        if (er.ok) emailsSent = subs.length;
      }
    }

    return res.status(200).json({ ok: true, saved: true, q: payload.q, changed: changed, emailsSent: emailsSent });

  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
