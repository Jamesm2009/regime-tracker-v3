// api/subscribe.js — Vercel Serverless Function
// POST /api/subscribe   { "email": "you@example.com" }  → subscribe
// DELETE /api/subscribe { "email": "you@example.com" }  → unsubscribe
// GET  /api/subscribe                                    → debug: returns subscriber count

async function redis(...args) {
  const url = process.env.UPSTASH_URL;
  const token = process.env.UPSTASH_TOKEN;

  if (!url || !token) {
    throw new Error('UPSTASH_URL or UPSTASH_TOKEN env var is missing');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
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

function isValidEmail(email) {
  return typeof email === 'string'
    && email.length >= 6
    && email.indexOf('@') > 0
    && email.indexOf('.') > email.indexOf('@');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — debug: verify the function is deployed and Redis is reachable
  if (req.method === 'GET') {
    try {
      const count = await redis('SCARD', 'alerts:subscribers');
      return res.status(200).json({
        ok: true,
        subscriberCount: count,
        upstashConnected: true,
        message: 'subscribe.js is deployed and Redis is reachable'
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err.message,
        upstashUrl: process.env.UPSTASH_URL ? 'set' : 'MISSING',
        upstashToken: process.env.UPSTASH_TOKEN ? 'set' : 'MISSING'
      });
    }
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ ok: false, error: 'Invalid JSON body' }); }
  }

  const email = ((body && body.email) || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  }

  // POST — add subscriber
  if (req.method === 'POST') {
    try {
      const added = await redis('SADD', 'alerts:subscribers', email);
      return res.status(200).json({
        ok: true,
        email,
        added: added === 1,
        message: added === 1 ? 'Subscribed successfully' : 'Already subscribed'
      });
    } catch (err) {
      console.error('subscribe POST error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // DELETE — remove subscriber
  if (req.method === 'DELETE') {
    try {
      await redis('SREM', 'alerts:subscribers', email);
      return res.status(200).json({ ok: true, email, message: 'Unsubscribed' });
    } catch (err) {
      console.error('subscribe DELETE error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
