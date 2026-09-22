import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getUserDisplayNames } from '@/lib/userDisplayNames';

export const dynamic = 'force-dynamic';

function noStoreJson(body, init) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

// Authenticated, current-user-only read used by Profile and Badge. It is not
// an invalidation endpoint: every request reads the event-scoped source of
// truth, so an APN correction is visible on the next navigation immediately.
export async function GET() {
  const cookieStore = await cookies();
  let userUuid = null;
  try {
    userUuid = JSON.parse(decodeURIComponent(cookieStore.get('iph_user')?.value))?.uuid ?? null;
  } catch {}

  if (!userUuid) return noStoreJson({ error: 'Not logged in' }, { status: 401 });

  try {
    const names = await getUserDisplayNames(await getCurrentEventId(), userUuid);
    return noStoreJson({ names });
  } catch (error) {
    console.error('[auth/display-names]', error.message);
    return noStoreJson({ error: 'Failed to load display names' }, { status: 500 });
  }
}
