import { getCachedCompaniesPageTitle } from '@/lib/pageTitleCache';
import CompaniesClient from './CompaniesClient';

export default async function CompaniesPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedCompaniesPageTitle();
  return <CompaniesClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
