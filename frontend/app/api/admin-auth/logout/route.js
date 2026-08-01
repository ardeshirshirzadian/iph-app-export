import { NextResponse } from 'next/server';

function clearSession(response) {
  response.cookies.set('iph_admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function GET(request) {
  const origin = new URL(request.url).origin;
  return clearSession(NextResponse.redirect(new URL('/apn/login', origin)));
}

export async function POST() {
  return clearSession(NextResponse.json({ success: true }));
}
