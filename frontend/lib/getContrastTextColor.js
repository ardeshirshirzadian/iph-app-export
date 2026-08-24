// WCAG relative-luminance based text-color picker.
// Threshold 0.179 is the precise crossover point where contrast-vs-black equals
// contrast-vs-white (solving (L+0.05)/0.05 = 1.05/(L+0.05)), not the naive 0.5 --
// this matters for real accent colors that fall between the two (e.g. ~0.28).

function parseHex(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastTextColor(bgHex, { dark = '#021f20', light = '#f0faf8', threshold = 0.179 } = {}) {
  return relativeLuminance(bgHex) > threshold ? dark : light;
}

// Resolves a variant's declared background (opaque hex, 'transparent', or an
// rgba() translucent overlay) against the real page background it's painted
// over, so contrast can be computed against what's actually rendered.
export function resolveEffectiveBackground(colorStr, backingHex) {
  const s = colorStr.trim();
  if (s === 'transparent') return backingHex;
  if (s.startsWith('#')) return s;

  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (!m) throw new Error(`resolveEffectiveBackground: unrecognized color format "${colorStr}"`);

  const [, r, g, b, a] = m;
  const alpha = a === undefined ? 1 : parseFloat(a);
  const overlay = [parseFloat(r), parseFloat(g), parseFloat(b)];
  if (alpha >= 1) return toHex(overlay);

  const backing = parseHex(backingHex);
  const blended = overlay.map((c, i) => alpha * c + (1 - alpha) * backing[i]);
  return toHex(blended);
}
