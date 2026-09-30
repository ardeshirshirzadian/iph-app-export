import { getAppIdentity } from '@/lib/getAppIdentity';
import { getPwaIcons } from '@/lib/getPwaIcons';
import { getCurrentEventId } from '@/lib/currentEvent';

export const dynamic = 'force-dynamic';

export default async function manifest() {
  const eventId = await getCurrentEventId();
  const [identity, icons] = await Promise.all([getAppIdentity(eventId), getPwaIcons(eventId)]);

  return {
    name: identity.title,
    short_name: identity.short_name,
    description: identity.description,
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#021f20',
    theme_color: '#021f20',
    lang: 'fa',
    dir: 'rtl',
    icons: [
      {
        src: icons['icon-192'],
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: icons['icon-512'],
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
