import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join, resolve, extname } from 'path';

const MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
};

export async function GET(request, { params }) {
  const segments = (await params).path;

  const uploadsRoot = resolve(join(process.cwd(), 'public', 'uploads'));
  const filePath   = resolve(join(uploadsRoot, ...segments));

  // Prevent directory traversal
  if (!filePath.startsWith(uploadsRoot + '/')) {
    return new NextResponse(null, { status: 400 });
  }

  const contentType = MIME[extname(filePath).toLowerCase()];
  if (!contentType) {
    return new NextResponse(null, { status: 415 });
  }

  try {
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    if (err.code === 'ENOENT') return new NextResponse(null, { status: 404 });
    console.error('[uploads] read error:', err.message);
    return new NextResponse(null, { status: 500 });
  }
}
