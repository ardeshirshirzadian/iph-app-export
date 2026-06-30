import crypto from 'crypto';

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// adminData: { adminId, username, isSuperAdmin, permissions }
export function createAdminToken(secret, adminData = {}) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE_MS, ...adminData })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

// Returns full payload object on success, null on failure.
// Payload shape: { exp, adminId, username, isSuperAdmin, permissions }
export function verifyAdminToken(token, secret) {
  if (!token || !secret) return null;
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
