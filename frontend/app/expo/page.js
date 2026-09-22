export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getExpoScreenDisplay } from '@/lib/expoScreenConfig';
import ExpoClient from './ExpoClient';

export default async function ExpoPage() {
  const currentEventId = await getCurrentEventId();
  // Fetched directly here (not through the cached /api/expo/screen path) so
  // the very first server-rendered paint already reflects the admin's saved
  // config/colors/logo -- no flash of stale defaults before the client's
  // first poll lands. This page is already force-dynamic, so there's no
  // caching concern from calling the plain (uncached) helper. The logo
  // itself is resolved inside getExpoScreenDisplay (theme_mode-aware, same
  // header_logo row app/api/header/route.js serves).
  const initialDisplay = await getExpoScreenDisplay(currentEventId);

  // The QR's app-download target is just this same request's own host --
  // correct per-event automatically (app.iphexpo.com for IranPharma, the
  // equivalent for any other event's domain) with no extra config/DB lookup.
  const headersList = await headers();
  const host = headersList.get('host') || 'app.iphexpo.com';
  const appUrl = `https://${host}`;

  return <ExpoClient appUrl={appUrl} initialDisplay={initialDisplay} />;
}
