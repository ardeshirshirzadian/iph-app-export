import { getPageTitle } from '@/lib/getPageTitles';
import BadgeClient from './BadgeClient';

export const dynamic = 'force-dynamic';

export default async function BadgePage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('badge');
  return <BadgeClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
