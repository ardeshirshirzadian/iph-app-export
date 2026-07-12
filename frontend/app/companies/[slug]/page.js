import CompanyDetailClient from './CompanyDetailClient';

export const dynamic = 'force-dynamic';

export default async function CompanyDetailPage({ params }) {
  const { slug } = await params;
  return <CompanyDetailClient slug={slug} />;
}
