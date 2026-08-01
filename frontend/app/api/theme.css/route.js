import { getThemeColors, buildColorStyle } from '@/lib/getThemeColors';
import { getButtonStyles, buildButtonCssVars } from '@/lib/getButtonStyles';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [colors, btnStyles] = await Promise.all([getThemeColors(), getButtonStyles()]);
  const css = buildColorStyle(colors) + '\n\n' + buildButtonCssVars(btnStyles);
  return new Response(css, {
    headers: {
      'Content-Type': 'text/css',
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
