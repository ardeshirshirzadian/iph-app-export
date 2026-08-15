import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';

// Page-scoped cache entries for the 6 "simple" home variants — each is the
// SINGLE cached data-fetching path for that page's title/subtitle, consumed
// by BOTH its dedicated route (app/[x]/page.js) and app/page.js's matching
// home variant, so there is exactly one cache entry per tag regardless of
// which route triggered the read. Same principle as lib/questPageCache.js /
// lib/badgePageCache.js. Tags are unchanged from each page's own prior
// caching step — see app/settings/page.js for the original rationale.
export const getCachedCompaniesPageTitle = unstable_cache(
  () => getPageTitle('companies'),
  ['companies-page-title'],
  { tags: ['companies-page-title'], revalidate: 300 }
);

export const getCachedPanelsPageTitle = unstable_cache(
  () => getPageTitle('panels'),
  ['panels-page-title'],
  { tags: ['panels-page-title'], revalidate: 300 }
);

export const getCachedMapPageTitle = unstable_cache(
  () => getPageTitle('map'),
  ['map-page-title'],
  { tags: ['map-page-title'], revalidate: 300 }
);

export const getCachedChatPageTitle = unstable_cache(
  () => getPageTitle('chat'),
  ['chat-page-title'],
  { tags: ['chat-page-title'], revalidate: 300 }
);

// getPageTitle has 12+ other call sites; only this page's own call site is
// cached/tagged, the shared function itself is untouched.
export const getCachedGalleryPageTitle = unstable_cache(
  () => getPageTitle('gallery'),
  ['gallery-page-title'],
  { tags: ['gallery-page-title'], revalidate: 300 }
);

export const getCachedNewsPageTitle = unstable_cache(
  () => getPageTitle('news'),
  ['news-page-title'],
  { tags: ['news-page-title'], revalidate: 300 }
);
