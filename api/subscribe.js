// api/subscribe.js — Vercel Serverless Function
// Handles POST /api/subscribe  { email: "user@example.com" }
// and          DELETE /api/subscribe { email: "user@example.com" }
// Saves/removes emails from Upstash Redis set "alerts:subscribers"

async function redisCommand(cmd, ...args) {
  const body = [cmd, ...args];
  const res = await fetch(process.env.UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length > 4 && email.includes('@') && email.includes('.');
}

export default async function handler(req, res) {
  // CORS — allow the dashboard origin to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  const email = (body?.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address' });
  }

  if (req.method === 'POST') {
    // Add to Redis set (SADD is idempotent — safe to call repeatedly)
    const result = await redisCommand('SADD', 'alerts:subscribers', email);
    const added = result.result === 1; // 1 = new, 0 = already existed
    return res.status(200).json({
      ok: true,
      email,
      added,
      message: added ? 'Subscribed successfully' : 'Already subscribed'
    });
  }

  if (req.method === 'DELETE') {
    await redisCommand('SREM', 'alerts:subscribers', email);
    return res.status(200).json({ ok: true, email, message: 'Unsubscribed' });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
