import CompanyDetailClient from './CompanyDetailClient';

export default async function CompanyDetailPage({ params }) {
  const { slug } = await params;
  return <CompanyDetailClient slug={slug} />;
}
