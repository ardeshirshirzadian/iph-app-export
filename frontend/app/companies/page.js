import { getCachedCompaniesPageTitle } from '@/lib/pageTitleCache';
import { getCurrentEventId } from '@/lib/currentEvent';
import CompaniesClient from './CompaniesClient';

export default async function CompaniesPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedCompaniesPageTitle(await getCurrentEventId());
  return <CompaniesClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
