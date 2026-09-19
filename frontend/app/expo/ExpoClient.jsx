'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { toPersianDigits } from '@/lib/utils';

// Kiosk display: unattended, always-on, tab always "visible" (no
// visibilitychange pause like QuestClient's poller -- there's no user to
// background this tab). Self-rescheduling setTimeout, same shape as
// QuestClient.js's 45s XP poll, just admin-configurable and much shorter.
const DEFAULT_POLL_SECONDS = 8;
const MIN_POLL_SECONDS = 5; // mirrors the server-enforced floor -- see lib/expoScreenConfig.js
const FADE_MS = 300;

function sameLeaderboard(a, b) {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row.user_uuid === b[i]?.user_uuid && row.total_xp === b[i]?.total_xp);
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

function RankIcon({ rankIcon, size }) {
  if (!rankIcon?.icon) return null;
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
// FixedLayout's own comment): XP score leftmost, then the name, then the
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
        {/* Confirmed-invite count -- same "hidden entirely at 0" rule as
            app/quest/QuestClient.js's own LeaderboardRow (referral_count is
            only ever non-null while the unlimited-mode referral mission is
            active, see route.js's isUnlimitedReferralActive gate). */}
        {entry.referral_count > 0 && (
          <div style={{ fontSize: inviteFontSize, color: colors.textMuted, marginTop: 4 }}>
            {toPersianDigits(entry.referral_count)} دعوت
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
        <RankIcon rankIcon={rankIcon} size={48} />
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

function QrBlock({ appUrl }) {
  return (
    <div style={{ background: '#fff', padding: 18, borderRadius: 20, lineHeight: 0, flexShrink: 0 }}>
      <QRCodeSVG value={appUrl} size={180} bgColor="#ffffff" fgColor="#0b1220" level="M" />
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

// One of the three fixed download boxes (Bazaar / Myket / web version) --
// same rectangular box (label + admin-uploadable logo) for all three, and
// per explicit product decision NONE of them are clickable/tappable --
// Bazaar/Myket just indicate availability there, and the web box just
// displays its plain address text, no live link on this kiosk screen.
// Logo stays fixed on the left (first child, inherited LTR direction from
// FixedLayout); the text block is flex:1 + textAlign right so it hugs the
// box's right edge regardless of label length, instead of clustering at
// flex-start and leaving a ragged gap for short labels. `subLabel` (used
// only by the web box) renders as a second, smaller/muted line -- e.g. the
// "نسخه وب اپلیکیشن" main label above the app.iphexpo.com address.
function StoreBox({ label, subLabel, logoPath, colors, fontSize, subFontSize }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: colors.rowBg,
        border: `1px solid ${colors.border}`,
        borderRadius: 16,
        padding: '12px 20px',
        width: 240,
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
            fontSize,
            fontWeight: 700,
            color: colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
        {subLabel ? (
          <div
            style={{
              fontSize: subFontSize,
              fontWeight: 500,
              color: colors.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: 2,
            }}
          >
            {subLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// The one and only layout: fixed positions, admin controls content/colors,
// not placement. Replaces Phase 0/1's vertical/horizontal presets entirely
// -- see the Phase 2 decision in lib/expoScreenConfig.js's own comments.
// Built LTR at the outer level purely for unambiguous "top-right"/
// "bottom-left" geometry regardless of Persian text direction; each
// text-bearing child sets its own dir="rtl" independently.
function FixedLayout({ logo, appUrl, config, colors, rankIcons, leaderboard, fading }) {
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

      {/* Middle: admin-editable title centered above the live top-3 leaderboard */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <div dir="rtl" style={{ fontSize: config.title_font_size, fontWeight: 800, color: colors.text, textAlign: 'center' }}>
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

      {/* Bottom bar: QR bottom-left, three download boxes to its right */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 40 }}>
        <QrBlock appUrl={appUrl} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <StoreBox label="دانلود از کافه بازار" logoPath={config.bazaar_logo_path} colors={colors} fontSize={config.box_label_font_size} />
          <StoreBox label="دانلود از مایکت" logoPath={config.myket_logo_path} colors={colors} fontSize={config.box_label_font_size} />
          <StoreBox
            label="نسخه وب اپلیکیشن"
            subLabel={displayDomain(config.web_link_url)}
            logoPath={config.web_logo_path}
            colors={colors}
            fontSize={config.box_label_font_size}
            subFontSize={config.web_address_font_size}
          />
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
    <FixedLayout
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
