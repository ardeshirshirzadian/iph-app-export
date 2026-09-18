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

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

function sameLeaderboard(a, b) {
  if (a.length !== b.length) return false;
  return a.every((row, i) => row.user_uuid === b[i]?.user_uuid && row.total_xp === b[i]?.total_xp);
}

function LeaderboardRow({ entry }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '20px 32px',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 24,
      }}
    >
      <div style={{ fontSize: 44, width: 64, textAlign: 'center', flexShrink: 0 }}>
        {RANK_MEDALS[entry.rank - 1] || toPersianDigits(entry.rank)}
      </div>
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.12)',
          flexShrink: 0,
        }}
      >
        {entry.profile_photo_url ? (
          // Plain <img>, not next/image: profile photos are Rasayesh-hosted
          // remote URLs, same pattern quest/leaderboard's own client rendering
          // already uses for this exact field.
          <img
            src={entry.profile_photo_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 30,
          fontWeight: 700,
          color: '#fff',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.display_name_fa}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#ffd166', flexShrink: 0 }}>
        {toPersianDigits(entry.total_xp)}
      </div>
    </div>
  );
}

function LeaderboardBlock({ leaderboard, fading, maxWidth }) {
  return (
    <div
      style={{
        width: '100%',
        maxWidth,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {leaderboard.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.5)', textAlign: 'center', fontSize: 24 }}>
          در حال بارگذاری...
        </div>
      ) : (
        leaderboard.map((entry) => <LeaderboardRow key={entry.user_uuid} entry={entry} />)
      )}
    </div>
  );
}

function SloganBlock({ config }) {
  return (
    <div style={{ fontSize: 38, fontWeight: 800, color: '#fff', textAlign: 'center' }}>
      {config.slogan_fa}
      {config.slogan_en ? (
        <div style={{ fontSize: 18, fontWeight: 500, color: 'rgba(255,255,255,0.65)', marginTop: 8, direction: 'ltr' }}>
          {config.slogan_en}
        </div>
      ) : null}
    </div>
  );
}

function QrBlock({ appUrl }) {
  return (
    <div style={{ background: '#fff', padding: 18, borderRadius: 20, lineHeight: 0 }}>
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

// Vertical: matches Phase 0's original layout exactly -- logo top,
// leaderboard middle, slogan+QR bottom, one column. Meant for a portrait
// touch-stand screen.
function VerticalLayout({ logo, appUrl, config, leaderboard, fading }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: 'linear-gradient(180deg, #0b1220 0%, #131c31 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '56px 40px',
        boxSizing: 'border-box',
        direction: 'rtl',
        gap: 40,
      }}
    >
      <LogoImage logo={logo} height={72} />

      {config.show_leaderboard ? (
        <LeaderboardBlock leaderboard={leaderboard} fading={fading} maxWidth={720} />
      ) : (
        <div />
      )}

      {(config.show_slogan || config.show_qr) && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          {config.show_slogan && <SloganBlock config={config} />}
          {config.show_qr && <QrBlock appUrl={appUrl} />}
        </div>
      )}
    </div>
  );
}

// Horizontal: a single wide venue screen preset -- left column carries
// identity/CTA (logo, slogan, QR), right column carries the live
// leaderboard with more horizontal room per row than the vertical preset.
function HorizontalLayout({ logo, appUrl, config, leaderboard, fading }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        background: 'linear-gradient(180deg, #0b1220 0%, #131c31 100%)',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 64px',
        boxSizing: 'border-box',
        direction: 'rtl',
        gap: 64,
      }}
    >
      <div
        style={{
          flex: '0 0 34%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
          height: '100%',
        }}
      >
        <LogoImage logo={logo} height={88} />
        {config.show_slogan && <SloganBlock config={config} />}
        {config.show_qr && <QrBlock appUrl={appUrl} />}
      </div>

      {config.show_leaderboard && (
        <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <LeaderboardBlock leaderboard={leaderboard} fading={fading} maxWidth={900} />
        </div>
      )}
    </div>
  );
}

export default function ExpoClient({ logo, appUrl, initialConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [leaderboard, setLeaderboard] = useState([]);
  const [fading, setFading] = useState(false);
  const leaderboardRef = useRef([]);
  const configRef = useRef(initialConfig);
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

        if (data.config) {
          configRef.current = data.config;
          setConfig(data.config);
        }

        const next = Array.isArray(data.leaderboard) ? data.leaderboard : [];
        if (sameLeaderboard(leaderboardRef.current, next)) return;

        setFading(true);
        fadeTimerId = setTimeout(() => {
          if (!mountedRef.current) return;
          leaderboardRef.current = next;
          setLeaderboard(next);
          setFading(false);
        }, FADE_MS);
      } catch {
        // Transient fetch failure -- next poll tries again, current display stays put.
      }
    }

    // Re-reads configRef.current each time, so an admin-changed
    // poll_interval_seconds takes effect starting from the very next
    // scheduled fetch, without needing a page reload.
    function schedule() {
      const seconds = Math.max(MIN_POLL_SECONDS, Number(configRef.current?.poll_interval_seconds) || DEFAULT_POLL_SECONDS);
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

  const Layout = config.orientation === 'horizontal' ? HorizontalLayout : VerticalLayout;
  return <Layout logo={logo} appUrl={appUrl} config={config} leaderboard={leaderboard} fading={fading} />;
}
