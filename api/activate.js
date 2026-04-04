import fs from 'fs';
import path from 'path';

const lastActivation = { time: 0 };

function extractUserId(jwt) {
  try {
    const payload = jwt.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).sub;
  } catch {
    return null;
  }
}

function getHeaders(token, userId) {
  return {
    'accept': 'application/json',
    'authorization': `Bearer ${token}`,
    'content-type': 'application/json',
    'cookie': `jwt_token=${token}`,
    'user-agent': 'Duodroid/6.26.2 Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7)',
    'x-amzn-trace-id': `User=${userId}`,
  };
}

async function loadCodes() {
  try {
    const r = await fetch('https://duolingo-super.vercel.app/data/codes.txt');
    if (!r.ok) return [];
    const text = await r.text();
    return text.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function extractCode(link) {
  if (link.includes('family-plan/')) return link.split('family-plan/')[1].split('?')[0];
  return link;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const now = Date.now();
  const elapsed = now - lastActivation.time;

  if (elapsed < 10000) {
    const wait = Math.ceil((10000 - elapsed) / 1000);
    return res.status(429).json({ error: `Too many requests. Please wait ${wait}s and try again.` });
  }

  const { token } = req.body || {};

  if (!token?.trim()) return res.status(400).json({ error: 'JWT token is required.' });

  const jwt = token.trim().replace(/'/g, '');

  if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(jwt))
    return res.status(400).json({ error: 'Invalid JWT token format.' });

  const userId = extractUserId(jwt);
  if (!userId) return res.status(400).json({ error: 'Could not read user ID from token.' });

  let userInfo;
  try {
    const r = await fetch(`https://www.duolingo.com/2017-06-30/users/${userId}`, {
      headers: getHeaders(jwt, userId)
    });
    if (r.status === 401) return res.status(401).json({ error: 'Token is expired or invalid.' });
    if (!r.ok) return res.status(400).json({ error: `Duolingo error: ${r.status}` });
    userInfo = await r.json();
  } catch {
    return res.status(500).json({ error: 'Could not connect to Duolingo.' });
  }

  if (userInfo.hasPlus)
    return res.status(400).json({ error: `@${userInfo.username} already has Super Duolingo.` });

  const codes = await loadCodes();
  if (!codes.length) return res.status(503).json({ error: 'No codes available. Try again later.' });

  lastActivation.time = Date.now();

  for (const raw of codes) {
    const code = extractCode(raw);
    try {
      const checkRes = await fetch(
        `https://www.duolingo.com/2017-06-30/family-plan/invite/${code}`,
        { headers: getHeaders(jwt, userId) }
      );
      if (!checkRes.ok) continue;
      const checkData = await checkRes.json();
      if (!checkData.isValid) continue;

      const joinRes = await fetch(
        `https://www.duolingo.com/2017-06-30/users/${userId}/family-plan/members/invite/${code}`,
        { method: 'POST', headers: getHeaders(jwt, userId) }
      );

      if (joinRes.ok) {
        return res.status(200).json({
          success: true,
          message: `Super Duolingo activated successfully for @${userInfo.username}!`
        });
      }
    } catch {
      continue;
    }
  }

  return res.status(500).json({ error: 'All codes failed. Please try again later.' });
}
