import { getCachedPanelsPageTitle } from '@/lib/pageTitleCache';
import { getCurrentEventId } from '@/lib/currentEvent';
import PanelsClient from './PanelsClient';

export default async function PanelsPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedPanelsPageTitle(await getCurrentEventId());
  return <PanelsClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
