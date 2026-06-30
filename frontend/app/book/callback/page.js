import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function OldBookCallbackPage({ searchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(sp).toString();
  redirect(`/cart/callback${qs ? `?${qs}` : ''}`);
}
