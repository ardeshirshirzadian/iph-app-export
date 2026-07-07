import PostClient from './PostClient';

export const dynamic = 'force-dynamic';

export default async function NewsPostPage({ params }) {
  const { slug } = await params;
  return <PostClient slug={slug} />;
}
