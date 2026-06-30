export async function POST(request) {
  const body = await request.json();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch('http://172.17.0.1:8000/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    return Response.json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      return Response.json(
        { answer: 'پاسخ‌گویی کمی طول کشید، لطفاً دوباره تلاش کنید' },
        { status: 504 }
      );
    }
    return Response.json(
      { answer: 'خطا در ارتباط با سرور. لطفاً دوباره تلاش کنید.' },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
