import { NextResponse } from 'next/server';

const GQL = 'https://api.rasayesh.com/graphql';
const EVENT_ORIGIN = process.env.NEXT_PUBLIC_EVENT_ORIGIN || 'https://2025.iphexpo.com';

async function rasayeshGql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'iph',
      'origin': EVENT_ORIGIN,
      'referer': `${EVENT_ORIGIN}/`,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  return res.json();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const latest = searchParams.get('latest') === 'true';

  try {
    if (latest) {
      const data = await rasayeshGql(
        `{ eventLatestBlogPosts(mainEventId: 1, count: 5) { id title excerpt thumbnail slug created_at } }`
      );
      return NextResponse.json({ posts: data.data?.eventLatestBlogPosts ?? [] });
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const search = searchParams.get('search') || '';
    const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';

    const [postsRes, countRes] = await Promise.all([
      rasayeshGql(
        `query($page: Int, $search: String, $order: String) {
          eventBlogPosts(mainEventId: 1, page: $page, rowsPerPage: 12, search: $search, orderBy: "created_at", order: $order) {
            id title excerpt thumbnail slug created_at
          }
        }`,
        { page, search, order }
      ),
      rasayeshGql(
        `query($search: String) { eventBlogPostsCount(mainEventId: 1, search: $search) }`,
        { search }
      ),
    ]);

    return NextResponse.json({
      posts: postsRes.data?.eventBlogPosts ?? [],
      total: countRes.data?.eventBlogPostsCount ?? 0,
    });
  } catch (err) {
    console.error('[api/news]', err.message);
    return NextResponse.json({ posts: [], total: 0 });
  }
}
