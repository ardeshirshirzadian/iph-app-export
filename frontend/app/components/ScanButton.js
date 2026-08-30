"use client";

import Link from "next/link";

// Moved out of app/quest/QuestClient.js so BottomNav.js (rendered on every
// page, not just /quest) can mount the same button. Visuals/JSX unchanged.

// The original hardcoded design was an 80px circle with a 36px icon, a 6px
// ping-ring outset, and 30px/45px (rest/hover) shadow blur. `size` scales
// every one of those off this same 80px baseline, so admin-configured
// icon_size values that aren't 80 don't produce a disproportionate icon
// inside the circle or an oversized/undersized glow.
const BASE_SIZE = 80;

function hexToRgba(hex, alpha) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function ScanButton({ isDark, label, glowColor, size = BASE_SIZE, showLabel = true }) {
  // glowColor is only a real value once an admin explicitly sets
  // scan_glow_color -- there's no static default for it (see
  // BottomNav.js's SCAN_GLOW_DEFAULTS comment). hexToRgba returns null for
  // anything that isn't a literal #rrggbb (undefined, or an invalid
  // string), so the fallback below is what actually runs for every event
  // until an admin opts in: color-mix() against the live --accent CSS var
  // (set per-event via the theme-colors settings), resolved by the browser
  // at paint time -- NOT a hardcoded hex, which is what caused this field
  // to be added.
  const shadowColor      = hexToRgba(glowColor, 0.5) || 'color-mix(in srgb, var(--accent) 50%, transparent)';
  const shadowColorHover = hexToRgba(glowColor, 0.7) || 'color-mix(in srgb, var(--accent) 70%, transparent)';
  const pingColor20      = hexToRgba(glowColor, 0.2) || 'color-mix(in srgb, var(--accent) 20%, transparent)';
  const pingColor10      = hexToRgba(glowColor, 0.1) || 'color-mix(in srgb, var(--accent) 10%, transparent)';

  const scale = size / BASE_SIZE;
  const iconSize   = Math.round(36 * scale);
  const ringOutset = Math.round(6  * scale);
  const shadowBlur      = Math.round(30 * scale);
  const shadowBlurHover = Math.round(45 * scale);

  return (
    <Link href="/quest/scan" className="flex flex-col items-center gap-3 group">
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          '--scan-glow-shadow': shadowColor,
          '--scan-glow-shadow-hover': shadowColorHover,
          '--scan-glow-blur': `${shadowBlur}px`,
          '--scan-glow-blur-hover': `${shadowBlurHover}px`,
        }}
      >
        {isDark && (
          <>
            <span className="absolute inset-0 rounded-full animate-ping" style={{ background: pingColor20 }} />
            <span
              className="absolute rounded-full animate-ping"
              style={{ inset: `-${ringOutset}px`, animationDelay: "0.3s", background: pingColor10 }}
            />
          </>
        )}
        <button
          className="relative rounded-full flex items-center justify-center shadow-[0_0_var(--scan-glow-blur)_var(--scan-glow-shadow)] group-hover:shadow-[0_0_var(--scan-glow-blur-hover)_var(--scan-glow-shadow-hover)] transition-shadow duration-300 group-hover:scale-105 active:scale-95 transition-transform"
          style={{ width: size, height: size, background: "var(--accent)" }}
        >
          <svg
            width={iconSize}
            height={iconSize}
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: "var(--bg)" }}
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <path d="M14 14h2v2h-2z" />
            <path d="M16 16h5v5h-2v-3h-3z" />
          </svg>
        </button>
      </div>
      {showLabel && (
        <span className="font-bold text-sm tracking-wide" style={{ color: "var(--accent)" }}>
          {label}
        </span>
      )}
    </Link>
  );
}
