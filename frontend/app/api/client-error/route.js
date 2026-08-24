import { NextResponse } from 'next/server';

// Minimal server-visible sink for uncaught client-render exceptions, wired
// from app/error.js and app/global-error.js. No DB table, no external
// service -- just console.error so occurrences show up in `docker logs`,
// the same place other runtime diagnostics in this app already surface.
export async function POST(request) {
  try {
    const body = await request.json();
    console.error('[client-error]', JSON.stringify({
      message: typeof body?.message === 'string' ? body.message.slice(0, 2000) : undefined,
      stack: typeof body?.stack === 'string' ? body.stack.slice(0, 4000) : undefined,
      digest: body?.digest,
      url: body?.url,
      boundary: body?.boundary || 'error',
      userAgent: request.headers.get('user-agent'),
      time: new Date().toISOString(),
    }));
  } catch (err) {
    console.error('[client-error] failed to parse report:', err);
  }
  return NextResponse.json({ ok: true });
}
