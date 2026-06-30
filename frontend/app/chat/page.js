import { getPageTitle } from '@/lib/getPageTitles';
import ChatClient from './ChatClient';

export const dynamic = 'force-dynamic';

export default async function ChatPage() {
  const { title, subtitle, title_en, subtitle_en } = await getPageTitle('chat');
  return <ChatClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
