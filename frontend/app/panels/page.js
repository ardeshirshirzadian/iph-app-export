import { getCachedPanelsPageTitle } from '@/lib/pageTitleCache';
import PanelsClient from './PanelsClient';

export default async function PanelsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedPanelsPageTitle();
  return <PanelsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
