import { getPageTitle } from '@/lib/getPageTitles';
import CompaniesClient from './CompaniesClient';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('companies');
  return <CompaniesClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
