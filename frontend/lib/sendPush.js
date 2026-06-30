// Server-only: send a Web Push notification to all stored subscriptions.
// The VAPID private key never leaves this file — it is never sent to the browser.

import webpush from 'web-push';
import { query } from '@/lib/db';
import { toPersianDigits } from './utils.js';

// Lazy-initialize so the module can be imported during build even without VAPID keys in env.
let _vapidConfigured = false;
function ensureVapid() {
  if (_vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@iphexpo.com',
    pub,
    priv
  );
  _vapidConfigured = true;
  return true;
}

function toAbsoluteUrl(path) {
  if (!path) return undefined;
  if (path.startsWith('http')) return path;
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : path;
}

export async function sendPushToAll({ title, body, icon, image, link }) {
  if (!ensureVapid()) {
    console.warn('[sendPush] VAPID keys not configured — skipping Web Push');
    return;
  }

  title = toPersianDigits(title);
  if (body) body = toPersianDigits(body);

  let rows;
  try {
    const result = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions');
    rows = result.rows;
  } catch (err) {
    console.error('[sendPush] Failed to fetch subscriptions:', err.message);
    return;
  }

  if (!rows.length) return;

  const payload = JSON.stringify({
    title,
    body: body || '',
    icon: toAbsoluteUrl(icon),
    image: toAbsoluteUrl(image),
    link,
  });
  const expiredIds = [];

  await Promise.allSettled(
    rows.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
await webpush.sendNotification(subscription, payload);
      } catch (err) {
        // 410 Gone = subscription expired/unsubscribed; clean it up
        if (err.statusCode === 410 || err.statusCode === 404) {
          expiredIds.push(row.id);
        } else {
          console.error(`[sendPush] Failed to send to ${row.endpoint.slice(0, 40)}…:`, err.message);
        }
      }
    })
  );

  if (expiredIds.length) {
    try {
      await query(
        `DELETE FROM push_subscriptions WHERE id = ANY($1::int[])`,
        [expiredIds]
      );
      console.log(`[sendPush] Cleaned up ${expiredIds.length} expired subscription(s)`);
    } catch (err) {
      console.error('[sendPush] Failed to clean up expired subscriptions:', err.message);
    }
  }
}
