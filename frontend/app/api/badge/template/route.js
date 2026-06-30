import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getTokenFromCookies } from '@/lib/rasayeshClient';
import { query } from '@/lib/db';

async function fetchLiveTemplate(templateId, adminToken) {
  const res = await fetch('https://api.rasayesh.com/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'admin',
      'origin': 'https://apn.rasayesh.com',
      'referer': 'https://apn.rasayesh.com/',
      'authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      query: `{ eventTemplate(id: ${templateId}) { key value } }`,
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.errors?.length) return null;
  const result = json.data?.eventTemplate;
  if (!result) return null;
  try {
    return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
  } catch {
    return result.value ?? null;
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const token = getTokenFromCookies(cookieStore);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [badgeResult, tokenResult] = await Promise.all([
      query("SELECT value FROM app_settings WHERE key = 'badge_page'"),
      query("SELECT value FROM app_settings WHERE key = 'rasayesh_admin_token'"),
    ]);

    const badgeSettings = badgeResult.rows[0]?.value ?? {};
    const adminToken = tokenResult.rows[0]?.value?.token ?? '';
    const templateId = Number(badgeSettings.card_template_id) || 0;

    if (!templateId) return NextResponse.json({ template: null });

    // Cache hit: stored template belongs to the current template ID
    const cachedId = Number(badgeSettings.cached_template_id) || 0;
    if (cachedId === templateId && badgeSettings.cached_template) {
      return NextResponse.json({ template: badgeSettings.cached_template });
    }

    // Cache miss: attempt a live fetch
    if (adminToken) {
      try {
        const templateValue = await fetchLiveTemplate(templateId, adminToken);
        if (templateValue) {
          // Persist to cache (fire-and-forget — don't block the response)
          const updated = {
            ...badgeSettings,
            cached_template: templateValue,
            cached_template_id: templateId,
            cached_template_at: new Date().toISOString(),
          };
          query(
            "INSERT INTO app_settings (key, value) VALUES ('badge_page', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [JSON.stringify(updated)]
          ).catch(err => console.error('[badge/template] cache save:', err.message));

          return NextResponse.json({ template: templateValue });
        }
      } catch (err) {
        console.error('[badge/template] live fetch error:', err.message);
      }
    }

    // Live fetch failed or no token — fall back to stale cache rather than showing nothing
    if (badgeSettings.cached_template) {
      return NextResponse.json({ template: badgeSettings.cached_template });
    }

    return NextResponse.json({ template: null });
  } catch (err) {
    console.error('[badge/template]', err.message);
    return NextResponse.json({ template: null });
  }
}
