'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { QRCodeSVG } from 'qrcode.react';
import { toPersianDigits } from '@/lib/utils';

// Kiosk display: unattended, always-on, tab always "visible" (no
// visibilitychange pause like QuestClient's poller -- there's no user to
// background this tab). Self-rescheduling setTimeout, same shape as
// QuestClient.js's 45s XP poll, just shorter and unconditional.
const POLL_MS = 8000;
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

export default function ExpoClient({ logo, appUrl }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [fading, setFading] = useState(false);
  const leaderboardRef = useRef([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let timerId = null;
    let fadeTimerId = null;

    async function pollOnce() {
      try {
        const res = await fetch('/api/expo/leaderboard', { cache: 'no-store' });
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();
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

    function schedule() {
      timerId = setTimeout(async () => {
        await pollOnce();
        if (mountedRef.current) schedule();
      }, POLL_MS);
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
      <Image
        src={logo.path}
        alt=""
        width={logo.width}
        height={logo.height}
        style={{ width: 'auto', height: 72, objectFit: 'contain' }}
        priority
      />

      <div
        style={{
          width: '100%',
          maxWidth: 720,
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

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <div style={{ fontSize: 38, fontWeight: 800, color: '#fff', textAlign: 'center' }}>
          اسکن کن و جایزه ببر
        </div>
        <div style={{ background: '#fff', padding: 18, borderRadius: 20, lineHeight: 0 }}>
          <QRCodeSVG value={appUrl} size={180} bgColor="#ffffff" fgColor="#0b1220" level="M" />
        </div>
      </div>
    </div>
  );
}
