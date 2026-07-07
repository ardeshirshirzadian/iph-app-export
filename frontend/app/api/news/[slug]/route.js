import { NextResponse } from 'next/server';

const GQL = 'https://api.rasayesh.com/graphql';
const EVENT_ORIGIN = process.env.NEXT_PUBLIC_EVENT_ORIGIN || 'https://2025.iphexpo.com';

export async function GET(request, { params }) {
  const { slug } = await params;
  try {
    const res = await fetch(GQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-rasayesh-site': 'iph',
        'origin': EVENT_ORIGIN,
        'referer': `${EVENT_ORIGIN}/`,
      },
      body: JSON.stringify({
        query: `{ eventBlogPost(slug: ${JSON.stringify(slug)}) {
          id title slug body excerpt thumbnail created_at
          categories { id name }
          tags { id name }
        } }`,
      }),
      cache: 'no-store',
    });
    const data = await res.json();
    const post = data.data?.eventBlogPost ?? null;
    if (!post) return NextResponse.json({ post: null }, { status: 404 });
    return NextResponse.json({ post });
  } catch (err) {
    console.error('[api/news/slug]', err.message);
    return NextResponse.json({ post: null }, { status: 500 });
  }
}
