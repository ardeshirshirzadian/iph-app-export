import { getThemeColors, buildColorStyle } from '@/lib/getThemeColors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const colors = await getThemeColors();
  const css = buildColorStyle(colors);
  return new Response(css, {
    headers: {
      'Content-Type': 'text/css',
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
