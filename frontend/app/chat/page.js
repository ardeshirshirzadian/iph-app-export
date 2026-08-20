import { getCachedChatPageTitle } from '@/lib/pageTitleCache';
import { getCurrentEventId } from '@/lib/currentEvent';
import ChatClient from './ChatClient';

export default async function ChatPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedChatPageTitle(await getCurrentEventId());
  return <ChatClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
