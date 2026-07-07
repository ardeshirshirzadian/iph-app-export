import { NextResponse } from 'next/server';

const GQL = 'https://api.rasayesh.com/graphql';
const EVENT_ORIGIN = process.env.NEXT_PUBLIC_EVENT_ORIGIN || 'https://2025.iphexpo.com';

async function gql(query) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'iph',
      'origin': EVENT_ORIGIN,
      'referer': `${EVENT_ORIGIN}/`,
    },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  return res.json();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    if (type === 'categories') {
      const data = await gql(
        '{ eventGalleryCategories(mainEventId: 1, all: true) { id name_fa name_en } }'
      );
      return NextResponse.json({ categories: data.data?.eventGalleryCategories ?? [] });
    }

    if (type === 'subcategories') {
      const categoryId = parseInt(searchParams.get('categoryId') || '0', 10);
      if (!categoryId) return NextResponse.json({ subCategories: [] });
      const data = await gql(
        `{ eventGallerySubCategories(categoryId: ${categoryId}, all: true) { id name_fa name_en } }`
      );
      return NextResponse.json({ subCategories: data.data?.eventGallerySubCategories ?? [] });
    }

    if (type === 'pictures') {
      const subCategoryId = parseInt(searchParams.get('subCategoryId') || '0', 10);
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
      if (!subCategoryId) return NextResponse.json({ pictures: [] });
      const data = await gql(
        `{ eventGalleryPictures(subCategoryId: ${subCategoryId}, rowsPerPage: 20, page: ${page}) { id picture } }`
      );
      return NextResponse.json({ pictures: data.data?.eventGalleryPictures ?? [] });
    }

    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  } catch (err) {
    console.error('[api/gallery]', err.message);
    return NextResponse.json({ categories: [], subCategories: [], pictures: [] });
  }
}
