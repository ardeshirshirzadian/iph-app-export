import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';
import CompaniesClient from './CompaniesClient';

// Page-scoped cache entry — see app/settings/page.js for the full rationale.
const getCachedCompaniesPageTitle = unstable_cache(
  () => getPageTitle('companies'),
  ['companies-page-title'],
  { tags: ['companies-page-title'], revalidate: 300 }
);

export default async function CompaniesPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedCompaniesPageTitle();
  return <CompaniesClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
