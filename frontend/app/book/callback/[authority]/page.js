import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function OldBookCallbackAuthorityPage({ params, searchParams }) {
  const { authority } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams(sp).toString();
  redirect(`/cart/callback/${authority}${qs ? `?${qs}` : ''}`);
}
