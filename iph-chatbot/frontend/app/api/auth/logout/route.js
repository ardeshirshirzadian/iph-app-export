import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  const clear = { path: '/', maxAge: 0 };
  cookieStore.set('iph_access_token', '', clear);
  cookieStore.set('iph_refresh_token', '', clear);
  cookieStore.set('iph_user', '', clear);
  return Response.json({ success: true });
}
