import { existsSync } from 'fs';
import { join } from 'path';
import { getAppIdentity } from '@/lib/getAppIdentity';

export const dynamic = 'force-dynamic';

export default async function manifest() {
  const identity = await getAppIdentity();

  const uploadsDir = join(process.cwd(), 'public', 'uploads', 'icons');
  const icon192Src = existsSync(join(uploadsDir, 'icon-192.png'))
    ? '/uploads/icons/icon-192.png'
    : '/icons/icon-192.png';
  const icon512Src = existsSync(join(uploadsDir, 'icon-512.png'))
    ? '/uploads/icons/icon-512.png'
    : '/icons/icon-512.png';

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
        src: icon192Src,
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: icon512Src,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
