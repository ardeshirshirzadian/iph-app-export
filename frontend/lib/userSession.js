import crypto from 'crypto';

// Companion to the client-readable iph_user cookie: iph_user is httpOnly:false
// (the app reads it from document.cookie) so anyone with page-script access
// can rewrite its contents to claim any uuid. iph_session is httpOnly and
// HMAC-signed with USER_SESSION_SECRET, so proxy.js can confirm an iph_user
// cookie's claimed identity was actually issued by us for this event, not
// forged client-side. See proxy.js's user-auth section for the check.
export const SESSION_COOKIE_NAME = 'iph_session';
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // mirrors iph_user's maxAge

function sign(body) {
  return crypto.createHmac('sha256', process.env.USER_SESSION_SECRET).update(body).digest('base64url');
}

export function createSessionToken({ uuid, event_id, tokenVersion }) {
  const payload = {
    uuid,
    event_id,
    tokenVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SEC,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

// Returns the decoded payload if the token's signature and expiry are valid,
// otherwise null. Never throws -- every caller treats null as "not signed in".
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  try {
    const expected = sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
