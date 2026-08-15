import { unstable_cache } from 'next/cache';
import { getPageTitle } from '@/lib/getPageTitles';
import ChatClient from './ChatClient';

// Page-scoped cache entry — see app/settings/page.js for the full rationale.
const getCachedChatPageTitle = unstable_cache(
  () => getPageTitle('chat'),
  ['chat-page-title'],
  { tags: ['chat-page-title'], revalidate: 300 }
);

export default async function ChatPage() {
  const { title, subtitle, title_en, subtitle_en } = await getCachedChatPageTitle();
  return <ChatClient title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />;
}
