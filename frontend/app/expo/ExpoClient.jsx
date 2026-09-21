'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { toPersianDigits } from '@/lib/utils';
import { getExpoTitleFontWeight } from '@/lib/expoTitleFontWeight';

// Kiosk display: unattended, always-on, tab always "visible" (no
// visibilitychange pause like QuestClient's poller -- there's no user to
// background this tab). Self-rescheduling setTimeout, same shape as
// QuestClient.js's 45s XP poll, just admin-configurable and much shorter.
const DEFAULT_POLL_SECONDS = 8;
const MIN_POLL_SECONDS = 5; // mirrors the server-enforced floor -- see lib/expoScreenConfig.js
const FADE_MS = 300;

function sameLeaderboard(a, b) {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row.user_uuid === b[i]?.user_uuid
    && row.total_xp === b[i]?.total_xp
    && row.referral_count === b[i]?.referral_count
    && row.occupation_label_fa === b[i]?.occupation_label_fa
    && row.occupation_label_en === b[i]?.occupation_label_en);
}

// Same admin-configurable rank-medal icon (SVG path, uploaded image path,
// or emoji) app/quest/QuestClient.js's own LeaderboardRow renders -- see
// lib/expoScreenConfig.js's buildRankIcon, which resolves this from the
// exact same quest_content_blocks main.icon_rank_1/2/3 rows. Only the
// display size differs; this kiosk renders it much larger than the in-app
// leaderboard row.
function isSvgIconPath(path) {
  return typeof path === 'string' && path.startsWith('/') && path.toLowerCase().endsWith('.svg');
}

function RankIcon({ rankIcon, rank, size, fallbackColor }) {
  if (!rankIcon?.icon) {
    return (
      <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: fallbackColor }}>
        {toPersianDigits(rank)}
      </span>
    );
  }
  const { icon, color } = rankIcon;

  if (icon.startsWith('/')) {
    if (isSvgIconPath(icon)) {
      return (
        <span
          style={{
            display: 'block',
            width: size,
            height: size,
            flexShrink: 0,
            backgroundColor: color,
            WebkitMaskImage: `url('${icon}')`,
            WebkitMaskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskImage: `url('${icon}')`,
            maskSize: 'contain',
            maskRepeat: 'no-repeat',
            maskPosition: 'center',
          }}
        />
      );
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />;
  }
  return <span style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>;
}

// Row built LEFT-to-RIGHT (per the outer LTR layout convention -- see
// ExpoLayout's own comment): XP score leftmost, then the name, then the
// avatar photo, then the rank medal icon rightmost -- per explicit product
// feedback on the first live screenshot (swapped from the original
// icon+avatar-left / name+score-right arrangement).
function LeaderboardRow({ entry, rankIcon, colors, nameFontSize, scoreFontSize }) {
  // Sized off nameFontSize (no dedicated admin font-size fields for these
  // two -- same proportional-sizing approach as levelBadgeSize/
  // levelIconDisplaySize in app/quest/QuestClient.js), not hardcoded, so
  // they scale together with an admin's font-size changes.
  const badgeFontSize = Math.max(14, Math.round(nameFontSize * 0.42));
  const inviteFontSize = Math.max(14, Math.round(nameFontSize * 0.4));
  const occupation = entry.occupation_label_fa || entry.occupation_label_en;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '20px 32px',
        background: colors.rowBg,
        border: `1px solid ${colors.border}`,
        borderRadius: 24,
      }}
    >
      {/* Level badge -- same badgeColor text / badgeColor+"20" pill background
          convention as app/quest/QuestClient.js's own LeaderboardRow badge. */}
      {entry.level_name ? (
        <div
          style={{
            padding: '6px 16px',
            borderRadius: 999,
            fontSize: badgeFontSize,
            fontWeight: 700,
            color: entry.level_color,
            background: `${entry.level_color}20`,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {entry.level_name}
        </div>
      ) : null}
      <div style={{ fontSize: scoreFontSize, fontWeight: 800, color: colors.accent, flexShrink: 0 }}>
        {toPersianDigits(entry.total_xp)}
      </div>
      <div dir="rtl" style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: nameFontSize,
            fontWeight: 700,
            color: colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.display_name_fa}
        </div>
        {occupation && (
          <div style={{ display: 'flex', minWidth: 0, marginTop: 4, fontSize: inviteFontSize, color: colors.textMuted, whiteSpace: 'nowrap' }}>
            <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{occupation}</span>
          </div>
        )}
      </div>
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: '50%',
          overflow: 'hidden',
          // Deliberately not colors.rowBg -- this must stay visible as an
          // empty placeholder even when the row background is the same
          // color (e.g. a light custom bg), for users with no profile photo.
          background: 'rgba(128,128,128,0.25)',
          flexShrink: 0,
        }}
      >
        {entry.profile_photo_url ? (
          // Plain <img>, not next/image: profile photos are Rasayesh-hosted
          // remote URLs, same pattern quest/leaderboard's own client rendering
          // already uses for this exact field.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.profile_photo_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
      </div>
      <div style={{ width: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <RankIcon rankIcon={rankIcon} rank={entry.rank} size={48} fallbackColor={colors.text} />
      </div>
    </div>
  );
}

function LeaderboardBlock({ leaderboard, rankIcons, colors, fading, nameFontSize, scoreFontSize }) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 860,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {leaderboard.length === 0 ? (
        <div style={{ color: colors.textMuted, textAlign: 'center', fontSize: 24 }} dir="rtl">
          در حال بارگذاری...
        </div>
      ) : (
        leaderboard.map((entry) => (
          <LeaderboardRow
            key={entry.user_uuid}
            entry={entry}
            rankIcon={rankIcons[entry.rank]}
            colors={colors}
            nameFontSize={nameFontSize}
            scoreFontSize={scoreFontSize}
          />
        ))
      )}
    </div>
  );
}

function QrBlock({ appUrl, config, colors, qrSize }) {
  // Empty or malformed legacy values use the same plain matrix defaults.
  // Every valid admin-selected hex color passes through unchanged.
  const validHex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  const fg = validHex.test(config.qr_fg_color_hex || '') ? config.qr_fg_color_hex : '#0b1220';
  const bg = validHex.test(config.qr_bg_color_hex || '') ? config.qr_bg_color_hex : '#ffffff';
  const webAddressColor = validHex.test(config.web_address_color || '')
    ? config.web_address_color
    : undefined;
  const domain = displayDomain(config.web_link_url || appUrl);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <QRCodeSVG value={appUrl} size={qrSize} marginSize={4} bgColor={bg} fgColor={fg} level="M" />
      {domain && (
        <div dir="ltr" style={{ fontSize: config.web_address_font_size, fontWeight: 500, color: webAddressColor || colors.textMuted, whiteSpace: 'nowrap' }}>
          {domain}
        </div>
      )}
    </div>
  );
}

function LogoImage({ logo, height }) {
  return (
    <Image
      src={logo.path}
      alt=""
      width={logo.width}
      height={logo.height}
      style={{ width: 'auto', height, objectFit: 'contain' }}
      priority
    />
  );
}

// Strips the scheme (and any trailing slash) off an admin-entered URL for
// plain on-screen display -- "https://app.iphexpo.com/" -> "app.iphexpo.com".
function displayDomain(url) {
  if (!url) return '';
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

// One of the three download boxes (Bazaar / Myket / Web App) --
// same rectangular box (label + admin-uploadable logo) for all three, and
// per explicit product decision NONE of them are clickable/tappable --
// they just indicate availability on the respective platform. The web URL
// is intentionally displayed only underneath the QR code by QrBlock.
// Logo stays fixed on the left (first child, inherited LTR direction from
// ExpoLayout); the text block is flex:1 + textAlign right so it hugs the
// box's right edge regardless of label length, instead of clustering at
// flex-start and leaving a ragged gap for short labels.
function StoreBox({ label, logoPath, colors, fontSize, height }) {
  // The APN permits QR sizes as small as 120px. Keep an unusually large
  // admin-selected label from overflowing a box that was compacted to fit
  // that QR; normal configured label sizes remain unchanged.
  const safeFontSize = Math.min(fontSize, height - 4);
  const labelWasCompacted = safeFontSize !== fontSize;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: colors.rowBg,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        height,
        padding: '0 20px',
        width: 300,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoPath} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : null}
      </div>
      <div dir="rtl" style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
        <div
          style={{
            fontSize: safeFontSize,
            fontWeight: 700,
            lineHeight: labelWasCompacted ? 1 : undefined,
            color: colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_QR_SIZE = 180;
// 36px logo + the box's two 1px borders: the smallest possible box without
// clipping its existing logo treatment.
const MIN_DOWNLOAD_BOX_HEIGHT = 38;
const MAX_DOWNLOAD_BOX_HEIGHT = 62;
const PREFERRED_DOWNLOAD_GAP = 18;

function getBottomLayoutMetrics(configuredQrSize) {
  const parsedQrSize = Number(configuredQrSize);
  const qrSize = Number.isFinite(parsedQrSize) && parsedQrSize > 0
    ? parsedQrSize
    : DEFAULT_QR_SIZE;

  // At the normal 180px QR this produces 48px boxes and 18px gaps (more
  // separation than the previous 14px). At small QR sizes the boxes compact
  // only as far as 38px; space-between then naturally reduces the gaps
  // without allowing overlap or negative space.
  const boxHeight = Math.min(
    MAX_DOWNLOAD_BOX_HEIGHT,
    Math.max(
      MIN_DOWNLOAD_BOX_HEIGHT,
      Math.floor((qrSize - (PREFERRED_DOWNLOAD_GAP * 2)) / 3)
    )
  );

  return { qrSize, boxHeight };
}

// The one and only live flex layout: admin controls content/colors, not
// placement. Replaces Phase 0/1's vertical/horizontal presets entirely --
// see the Phase 2 decision in lib/expoScreenConfig.js's own comments.
// Built LTR at the outer level purely for unambiguous "top-right"/
// "bottom-left" geometry regardless of Persian text direction; each
// text-bearing child sets its own dir="rtl" independently.
function ExpoLayout({ logo, appUrl, config, colors, rankIcons, leaderboard, fading }) {
  const slogan = typeof config.slogan_text === 'string' ? config.slogan_text.trim() : '';
  const titleFontWeight = getExpoTitleFontWeight(config.title_font_weight);
  const { qrSize, boxHeight } = getBottomLayoutMetrics(config.qr_size);
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 64px',
        boxSizing: 'border-box',
        direction: 'ltr',
        gap: 32,
        // Explicit, not just inherited from <body> -- identical var/fallback
        // to globals.css's own `body { font-family: ... }` rule (admin's
        // active-font system, lib/getActiveFont.js via app/layout.js), so
        // this kiosk page can never drift onto its own separate font choice.
        fontFamily: 'var(--active-font-family, "Vazirmatn"), sans-serif',
      }}
    >
      {/* Logo alone, high up and toward the right */}
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end' }}>
        <LogoImage logo={logo} height={76} />
      </div>

      {/* Middle: admin-editable title centered above the live leaderboard. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <div dir="rtl" style={{ width: '100%', maxWidth: 860, fontSize: config.title_font_size, fontWeight: titleFontWeight, color: colors.text, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {config.title_text}
        </div>
        <LeaderboardBlock
          leaderboard={leaderboard}
          rankIcons={rankIcons}
          colors={colors}
          fading={fading}
          nameFontSize={config.name_font_size}
          scoreFontSize={config.score_font_size}
        />
      </div>

      {/* Bottom: optional slogan above three store boxes and the QR/web address. */}
      <div style={{ position: 'relative' }}>
        {slogan && (
          <div dir="rtl" style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 24px)', width: '100%', fontSize: config.slogan_font_size ?? 34, fontWeight: 800, lineHeight: 1.4, color: colors.text, textAlign: 'right' }}>
            {slogan}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 40, '--expo-qr-size': `${qrSize}px` }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: 'var(--expo-qr-size)' }}>
            <StoreBox label={config.download_label_1 ?? 'دانلود از کافه بازار'} logoPath={config.bazaar_logo_path} colors={colors} fontSize={config.box_label_font_size} height={boxHeight} />
            <StoreBox label={config.download_label_2 ?? 'دانلود از مایکت'} logoPath={config.myket_logo_path} colors={colors} fontSize={config.box_label_font_size} height={boxHeight} />
            <StoreBox label={config.download_label_3 ?? 'نسخه وب اپلیکیشن'} logoPath={config.web_logo_path} colors={colors} fontSize={config.box_label_font_size} height={boxHeight} />
          </div>
          <QrBlock appUrl={appUrl} config={config} colors={colors} qrSize={qrSize} />
        </div>
      </div>
    </div>
  );
}

export default function ExpoClient({ appUrl, initialDisplay }) {
  const [display, setDisplay] = useState(initialDisplay);
  const [leaderboard, setLeaderboard] = useState([]);
  const [fading, setFading] = useState(false);
  const leaderboardRef = useRef([]);
  const displayRef = useRef(initialDisplay);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timerId = null;
    let fadeTimerId = null;

    async function pollOnce() {
      try {
        const res = await fetch('/api/expo/screen', { cache: 'no-store' });
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();

        if (data.config && data.colors && data.rankIcons && data.logo) {
          const nextDisplay = { config: data.config, colors: data.colors, logo: data.logo, rankIcons: data.rankIcons };
          displayRef.current = nextDisplay;
          setDisplay(nextDisplay);
        }

        const nextLeaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];
        if (sameLeaderboard(leaderboardRef.current, nextLeaderboard)) return;

        setFading(true);
        fadeTimerId = setTimeout(() => {
          if (!mountedRef.current) return;
          leaderboardRef.current = nextLeaderboard;
          setLeaderboard(nextLeaderboard);
          setFading(false);
        }, FADE_MS);
      } catch {
        // Transient fetch failure -- next poll tries again, current display stays put.
      }
    }

    // Re-reads displayRef.current each time, so an admin-changed
    // poll_interval_seconds takes effect starting from the very next
    // scheduled fetch, without needing a page reload.
    function schedule() {
      const seconds = Math.max(MIN_POLL_SECONDS, Number(displayRef.current?.config?.poll_interval_seconds) || DEFAULT_POLL_SECONDS);
      timerId = setTimeout(async () => {
        await pollOnce();
        if (mountedRef.current) schedule();
      }, seconds * 1000);
    }

    pollOnce();
    schedule();

    return () => {
      mountedRef.current = false;
      clearTimeout(timerId);
      clearTimeout(fadeTimerId);
    };
  }, []);

  return (
    <ExpoLayout
      logo={display.logo}
      appUrl={appUrl}
      config={display.config}
      colors={display.colors}
      rankIcons={display.rankIcons}
      leaderboard={leaderboard}
      fading={fading}
    />
  );
}
