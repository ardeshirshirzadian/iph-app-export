import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set('iph_user', '', { path: '/', maxAge: 0 });
  return Response.json({ success: true });
}
