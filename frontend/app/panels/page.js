import { getPageTitle } from '@/lib/getPageTitles';
import PanelsClient from './PanelsClient';

export const dynamic = 'force-dynamic';

export default async function PanelsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('panels');
  return <PanelsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
