import { getCachedChatPageTitle } from '@/lib/pageTitleCache';
import ChatClient from './ChatClient';

export default async function ChatPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedChatPageTitle();
  return <ChatClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
