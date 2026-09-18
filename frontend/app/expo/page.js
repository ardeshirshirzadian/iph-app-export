export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { getExpoScreenConfig } from '@/lib/expoScreenConfig';
import ExpoClient from './ExpoClient';

// Same static fallback shape as components/Logo.jsx's STATIC_FALLBACKS.dark_fa
// -- used when no admin has uploaded a header_logo for this event yet.
const LOGO_FALLBACK = { path: '/logo/logo-l-fa.png', width: 4500, height: 1033 };

// Reuses the exact header_logo app_settings row app/api/header/route.js
// already serves for the header/Logo.jsx component -- no separate
// logo-storage mechanism for this feature (Phase 1 decision: the admin's
// expo-screen config has no logo field of its own). `dark_fa`: this kiosk
// page renders on a dark background by design, and Logo.jsx's own
// `${theme}_${lang}` convention pairs "dark" with a logo meant to sit on a
// dark background.
async function getEventLogo(eventId) {
  try {
    const { rows } = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'header_logo'",
      [eventId]
    );
    return rows[0]?.value?.dark_fa || LOGO_FALLBACK;
  } catch {
    return LOGO_FALLBACK;
  }
}

export default async function ExpoPage() {
  const currentEventId = await getCurrentEventId();
  const [logo, initialConfig] = await Promise.all([
    getEventLogo(currentEventId),
    // Fetched directly here (not through the cached /api/expo/screen path)
    // so the very first server-rendered paint already reflects the admin's
    // saved config -- no flash of Phase 0's hardcoded defaults before the
    // client's first poll lands. This page is already force-dynamic, so
    // there's no caching concern from calling the plain (uncached) helper.
    getExpoScreenConfig(currentEventId),
  ]);

  // The QR's app-download target is just this same request's own host --
  // correct per-event automatically (app.iphexpo.com for IranPharma, the
  // equivalent for any other event's domain) with no extra config/DB lookup.
  const headersList = await headers();
  const host = headersList.get('host') || 'app.iphexpo.com';
  const appUrl = `https://${host}`;

  return <ExpoClient logo={logo} appUrl={appUrl} initialConfig={initialConfig} />;
}
