import { grantChatMissionXp } from '@/lib/grantChatMissionXp';

export async function POST(request) {
  const body = await request.json();

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
    // A "queued" ack has no answer yet — only grant the mission XP once we
    // actually have a real response (immediate here, or later via /chat/status).
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
      return Response.json(
        { answer: 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.' },
        { status: 502 }
      );
    }
  }
}
