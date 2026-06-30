import { notFound } from 'next/navigation';
import { query } from '@/lib/db';
import CompanyDetailClient from './CompanyDetailClient';

export const dynamic = 'force-dynamic';

async function getCompany(slug) {
  try {
    const result = await query(
      `SELECT id, slug, brand_name_fa, brand_name_en, legal_name_fa, legal_name_en,
              logo, website, description_fa, description_en,
              phones, emails, address_fa, address_en, industry_id,
              hall_name, booth_no
       FROM companies
       WHERE slug = $1
       LIMIT 1`,
      [slug]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  } catch {
    return null;
  }
}

async function getLogoBaseUrl() {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'companies_config'"
    );
    return result.rows[0]?.value?.logo_base_url ?? '';
  } catch {
    return '';
  }
}

export default async function CompanyDetailPage({ params }) {
  const { slug } = await params;
  const [company, logoBaseUrl] = await Promise.all([getCompany(slug), getLogoBaseUrl()]);
  if (!company) notFound();
  return <CompanyDetailClient company={company} logoBaseUrl={logoBaseUrl} />;
}
