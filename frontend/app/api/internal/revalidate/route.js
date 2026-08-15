import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';

// This route's entire job is to run fresh on every call — it must never be
// cached/optimized itself, or an on-demand revalidation trigger could be
// served a stale response instead of actually running.
export const dynamic = 'force-dynamic';

// Called by admin-side save handlers (iph-apn) to push near-instant
// invalidation of specific ISR-cached pages/data, instead of waiting on a
// fixed polling/revalidate interval. Body: { secret, path } or { secret, tag }.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ revalidated: false, error: 'invalid_json' }, { status: 400 });
  }

  const { secret, path, tag } = body ?? {};

  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ revalidated: false, error: 'unauthorized' }, { status: 401 });
  }

  if (!path && !tag) {
    return NextResponse.json({ revalidated: false, error: 'missing_path_or_tag' }, { status: 400 });
  }

  if (path) revalidatePath(path);
  if (tag) revalidateTag(tag);

  return NextResponse.json({ revalidated: true, now: Date.now() });
}
