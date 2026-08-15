import { NextResponse } from 'next/server';
import { getCachedCompaniesConfig } from '@/lib/getCompaniesConfig';

export async function GET() {
  try {
    const config = await getCachedCompaniesConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error('Companies config GET error:', error);
    return NextResponse.json({ error: 'Failed to get companies config' }, { status: 500 });
  }
}
