import { grantChatBadge, grantChatMissionXp } from '@/lib/grantChatMissionXp';
import { getCurrentEventId } from '@/lib/currentEvent';

export async function POST(request) {
  const requestBody = await request.json();
  // event_id is resolved server-side from the hostname (same pattern as
  // app/api/chat/config/route.js) rather than sent by ChatClient.jsx — this
  // codebase has no precedent for handing a raw event_id to a client
  // component, every other server touchpoint re-resolves it itself instead.
  const eventId = await getCurrentEventId();
  const body = { ...requestBody, event_id: eventId };

  // Badge fires unconditionally the moment the message is accepted for
  // sending -- independent of whether either backend ever answers.
  await grantChatBadge();

  const PRIMARY_URL = 'http://93.118.140.186:18085/chat';   // سرور GPU شرکت
  const FALLBACK_URL = 'http://172.17.0.1:8000/chat';        // بک‌اند لوکال VPS (CPU)

  async function tryFetch(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const data = await tryFetch(PRIMARY_URL, 15_000);
    // A "queued" ack has no answer yet — XP waits for /chat/status to report
    // 'done'. Any other status here (exact/RAG/fallback) is a real answer.
    if (data?.status !== 'queued') await grantChatMissionXp();
    return Response.json(data);
  } catch (primaryErr) {
    console.warn('Primary chatbot backend (GPU server) failed, falling back to VPS:', primaryErr.message);
    try {
      const data = await tryFetch(FALLBACK_URL, 90_000);
      if (data?.status !== 'queued') await grantChatMissionXp();
      return Response.json(data);
    } catch (fallbackErr) {
      console.error('Fallback chatbot backend (VPS) also failed:', fallbackErr.message);
      // Total outage — badge already granted above; XP correctly withheld,
      // no answer was ever produced.
      return Response.json(
        { answer: 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.' },
        { status: 502 }
      );
    }
  }
}
