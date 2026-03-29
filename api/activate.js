import fs from 'fs';
import path from 'path';

function extractUserId(jwt) {
  try {
    const payload = jwt.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).sub;
  } catch { return null; }
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

function loadCodes() {
  try {
    const filePath = path.join(process.cwd(), 'data', 'codes.txt');
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n').map(l => l.trim()).filter(Boolean);
  } catch { return []; }
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

  const { token } = req.body || {};
  if (!token?.trim()) return res.status(400).json({ error: 'Thiếu JWT token' });

  const jwt = token.trim().replace(/'/g, '');

  if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(jwt))
    return res.status(400).json({ error: 'JWT token sai định dạng' });

  const userId = extractUserId(jwt);
  if (!userId) return res.status(400).json({ error: 'Không đọc được user ID từ token' });

  // Lấy user info
  let userInfo;
  try {
    const r = await fetch(`https://www.duolingo.com/2017-06-30/users/${userId}`, {
      headers: getHeaders(jwt, userId)
    });
    if (r.status === 401) return res.status(401).json({ error: 'Token hết hạn hoặc không hợp lệ' });
    if (!r.ok) return res.status(400).json({ error: `Lỗi Duolingo: ${r.status}` });
    userInfo = await r.json();
  } catch {
    return res.status(500).json({ error: 'Không kết nối được Duolingo' });
  }

  if (userInfo.hasPlus)
    return res.status(400).json({ error: `@${userInfo.username} đã có Super Duolingo rồi` });

  // Tìm code hợp lệ + join
  const codes = loadCodes();
  if (!codes.length) return res.status(503).json({ error: 'Hết code, thử lại sau' });

  for (const raw of codes) {
    const code = extractCode(raw);
    try {
      // Check validity
      const checkRes = await fetch(
        `https://www.duolingo.com/2017-06-30/family-plan/invite/${code}`,
        { headers: getHeaders(jwt, userId) }
      );
      if (!checkRes.ok) continue;
      const checkData = await checkRes.json();
      if (!checkData.isValid) continue;

      // Join
      const joinRes = await fetch(
        `https://www.duolingo.com/2017-06-30/users/${userId}/family-plan/members/invite/${code}`,
        { method: 'POST', headers: getHeaders(jwt, userId) }
      );
      if (joinRes.ok) {
        return res.status(200).json({
          success: true,
          message: `✅ Kích hoạt Super Duolingo thành công cho @${userInfo.username}!`
        });
      }
    } catch { continue; }
  }

  return res.status(500).json({ error: 'Tất cả code đều thất bại, thử lại sau' });
}
