// TEMPORARY: Reads static content from DB (quest_content_blocks).
// When real quest logic is added, replace content.missions / content.leaderboard
// / content.badges with live API data. The `content` prop only drives copy & order.
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";

// ── Hardcoded non-CMS constants ────────────────────────────────────────────
// These represent live gameplay state, not static content — they stay here
// until real quest logic replaces them.

const BASE_THRESHOLDS = [
  { min: 0,   max: 200      },
  { min: 200, max: 500      },
  { min: 500, max: Infinity },
];

const FALLBACK_LEVEL_ICONS = ["🌱", "🕵️", "😎"];

const FALLBACK_LEVEL_NAMES = ["تازه‌وارد", "کاوشگر", "کاربلد"];

const LEVEL_COLORS_BY_IDX = ["#64748b", "#22c55e", "#f59e0b"];

const RANK_ICONS = { 1: "🥇", 2: "🥈", 3: "🥉" };

// ── Fallback content (used if DB table not yet seeded) ─────────────────────

const FALLBACK_MISSIONS = [
  { id: 1, icon: "🏛️", title: "بازدید از ۳ غرفه",          description: "از ۳ غرفه مختلف نمایشگاه بازدید کن",   xpReward: 60,  progress: 1, total: 3 },
  { id: 2, icon: "💬", title: "اولین مکالمه",               description: "با دستیار هوش مصنوعی چت کن",           xpReward: 30,  progress: 1, total: 1 },
  { id: 3, icon: "⭐", title: "غرفه برتر",                  description: "از غرفه ویژه نمایشگاه بازدید کن",       xpReward: 50,  progress: 0, total: 1 },
  { id: 4, icon: "🎤", title: "شرکت در مراسم افتتاحیه",    description: "در مراسم افتتاحیه شرکت کن",             xpReward: 300, progress: 0, total: 1 },
];

const FALLBACK_LEADERBOARD = [
  { rank: 1,  name: "اردشیر شیرزادیان", company: "بازدیدکننده",          xp: 850, level: "کاربلد"     },
  { rank: 2,  name: "علی محمدی",         company: "داروسازی البرز",        xp: 580, level: "کاربلد"     },
  { rank: 3,  name: "سارا احمدی",        company: "شرکت دارو پخش",         xp: 430, level: "کاوشگر"     },
  { rank: 4,  name: "محمد حسینی",        company: "داروسازی تهران شیمی",   xp: 390, level: "کاوشگر"     },
  { rank: 5,  name: "فاطمه رضایی",       company: "داروسازی اکسیر",        xp: 310, level: "کاوشگر"     },
  { rank: 6,  name: "رضا کریمی",         company: "داروسازی روز دارو",     xp: 270, level: "کاوشگر"     },
  { rank: 7,  name: "مریم نجفی",         company: "شرکت پخش رازی",         xp: 210, level: "کاوشگر"     },
  { rank: 8,  name: "حسین موسوی",        company: "داروسازی زهراوی",       xp: 180, level: "تازه‌وارد"  },
  { rank: 9,  name: "زهرا صادقی",        company: "تجهیزات پزشکی پارس",   xp: 95,  level: "تازه‌وارد"  },
  { rank: 10, name: "امیر قاسمی",        company: "شرکت فن‌آوران طب",     xp: 60,  level: "تازه‌وارد"  },
];

const FALLBACK_BADGES = [
  { id: 1, icon: "🏛️", name: "کاوشگر غرفه‌ها",     description: "از ۳ غرفه بازدید کردی",                    earned: true  },
  { id: 2, icon: "💬", name: "گفتگوگر",             description: "اولین مکالمه با دستیار هوش مصنوعی",        earned: true  },
  { id: 3, icon: "⭐", name: "کاشف ویژه",           description: "غرفه ویژه نمایشگاه را پیدا کن",            earned: false },
  { id: 4, icon: "🎯", name: "نشانه‌گیر دقیق",      description: "۵ غرفه را اسکن کن",                        earned: false },
  { id: 5, icon: "🔥", name: "ماراتون‌کار",         description: "۱۰ غرفه را در یک روز اسکن کن",             earned: false },
  { id: 6, icon: "📅", name: "پایه ثابت نمایشگاه", description: "حضور ۳ روز متوالی در نمایشگاه",            earned: false },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function iconOf(v) { return typeof v === 'object' && v ? (v.icon || '') : (v || ''); }
function iconSizeOf(v, def) { return typeof v === 'object' && v ? (v.icon_size ?? def) : def; }

function getXpProgress(xp, thresholds) {
  const idx = thresholds.findIndex((l) => xp >= l.min && xp < l.max);
  const current = thresholds[idx !== -1 ? idx : thresholds.length - 1];
  if (current.max === Infinity) return { pct: 100, current, currentIdx: thresholds.length - 1, next: null };
  const next = thresholds[thresholds.indexOf(current) + 1];
  const pct = Math.round(((xp - current.min) / (current.max - current.min)) * 100);
  return { pct, current, currentIdx: thresholds.indexOf(current), next };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function LevelTimeline({ currentLevel, thresholds, levelColors }) {
  const currentIdx = thresholds.findIndex((l) => l.name === currentLevel);
  return (
    <div className="mt-4">
      <div className="flex items-center">
        {thresholds.map((level, idx) => (
          <Fragment key={level.name}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center border-2 flex-shrink-0 transition-colors"
              style={{
                borderColor: idx <= currentIdx ? "var(--accent)" : "var(--border)",
                opacity: idx <= currentIdx ? 1 : 0.3,
              }}
            >
              {level.icon && level.icon.startsWith('/') ? (
                <img src={level.icon} alt="" style={{ width: level.iconSize ?? 16, height: level.iconSize ?? 16, objectFit: 'contain' }} />
              ) : (
                <span style={{ fontSize: level.iconSize ?? 14, lineHeight: 1 }}>{level.icon}</span>
              )}
            </div>
            {idx < thresholds.length - 1 && (
              <div
                className="flex-1 h-px transition-colors"
                style={{ background: idx < currentIdx ? "var(--accent)" : "var(--border)" }}
              />
            )}
          </Fragment>
        ))}
      </div>
      <div className="flex mt-1.5">
        {thresholds.map((level, idx) => (
          <Fragment key={level.name}>
            <span
              className="text-[9px] font-bold w-7 text-center flex-shrink-0 leading-4"
              style={{
                color: idx <= currentIdx ? "var(--accent)" : "var(--text-dim)",
                opacity: idx <= currentIdx ? 1 : 0.3,
              }}
            >
              {level.name}
            </span>
            {idx < thresholds.length - 1 && <div className="flex-1" />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, thresholds, levelColors, labels }) {
  const { pct, current, currentIdx, next } = useMemo(
    () => getXpProgress(user.xp, thresholds),
    [user.xp, thresholds]
  );
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(t);
  }, []);

  const color = levelColors[currentIdx] || levelColors[levelColors.length - 1];

  return (
    <div
      className="backdrop-blur-xl border border-[#00ffb3]/20 rounded-3xl p-5"
      style={{ background: "var(--surface)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{labels.userCardLabel}</p>
          <h2 className="font-bold text-lg leading-7" style={{ color: "var(--text)" }}>{user.name}</h2>
        </div>
        <div
          className="px-3 py-1 rounded-full text-xs font-bold border"
          style={{
            color,
            borderColor: color + "40",
            backgroundColor: color + "15",
          }}
        >
          {current.icon} {current.name}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm mb-2">
        <span style={{ color: "var(--text-muted)" }}>{labels.xpLabel}</span>
        <span className="font-bold" style={{ color: "var(--accent)" }}>{user.xp} XP</span>
      </div>

      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: animated ? `${pct}%` : "0%",
            background: "var(--accent)",
            boxShadow: "0 0 8px var(--accent)",
          }}
        />
      </div>

      {next && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            {labels.nextLevelPrefix} {next.name}
          </span>
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            {next.min - user.xp} {labels.xpRemainingSuffix}
          </span>
        </div>
      )}

      <LevelTimeline currentLevel={current.name} thresholds={thresholds} levelColors={levelColors} />
    </div>
  );
}

function ScanButton({ isDark, label }) {
  return (
    <Link href="/quest/scan" className="flex flex-col items-center gap-3 group">
      <div className="relative">
        {isDark && (
          <>
            <span className="absolute inset-0 rounded-full bg-[#00ffb3]/20 animate-ping" />
            <span
              className="absolute inset-[-6px] rounded-full bg-[#00ffb3]/10 animate-ping"
              style={{ animationDelay: "0.3s" }}
            />
          </>
        )}
        <button
          className="relative w-20 h-20 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(0,255,179,0.5)] group-hover:shadow-[0_0_45px_rgba(0,255,179,0.7)] transition-shadow duration-300 group-hover:scale-105 active:scale-95 transition-transform"
          style={{ background: "var(--accent)" }}
        >
          <svg
            width="36"
            height="36"
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
      <span className="font-bold text-sm tracking-wide" style={{ color: "var(--accent)" }}>
        {label}
      </span>
    </Link>
  );
}

function MissionCard({ mission }) {
  const pct = useMemo(
    () => (mission.total > 0 ? Math.round((mission.progress / mission.total) * 100) : 0),
    [mission.progress, mission.total]
  );
  const done = mission.progress >= mission.total;

  return (
    <div
      className={`backdrop-blur-xl border rounded-2xl p-4 flex items-center gap-4 transition-colors ${
        done ? "border-[#00ffb3]/30 bg-[#00ffb3]/5" : "border-[var(--border)]"
      }`}
      style={done ? undefined : { background: "var(--surface-2)" }}
    >
      <div
        className={`w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center ${
          done ? "bg-[#00ffb3]/20" : ""
        }`}
        style={done ? undefined : { background: "var(--surface-2)" }}
      >
        {mission.icon && mission.icon.startsWith('/') ? (
          <img src={mission.icon} alt="" style={{ width: mission.icon_size ?? 36, height: mission.icon_size ?? 36, objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: mission.icon_size ?? 36, lineHeight: 1 }}>{mission.icon}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span
            className="font-medium text-sm leading-7"
            style={{ color: done ? "var(--accent)" : "var(--text)" }}
          >
            {mission.title}
          </span>
          <span className="text-xs font-bold flex-shrink-0 mr-2" style={{ color: "var(--accent)" }}>
            +{mission.xpReward} XP
          </span>
        </div>
        <p className="text-xs leading-6 mb-1.5 truncate" style={{ color: "var(--text-dim)" }}>
          {mission.description}
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: "var(--accent)" }}
            />
          </div>
          <span className="text-xs flex-shrink-0" style={{ color: "var(--text-dim)" }}>
            {mission.progress}/{mission.total}
          </span>
        </div>
      </div>

      {done && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--accent)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round" style={{ stroke: "var(--bg)" }}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </div>
  );
}

function LeaderboardTab({ users, levelColors, thresholds }) {
  const levelNameToColor = useMemo(() => {
    const map = {};
    thresholds.forEach((t, i) => { map[t.name] = levelColors[i] || levelColors[levelColors.length - 1]; });
    return map;
  }, [thresholds, levelColors]);

  return (
    <div className="space-y-2">
      {users.map((user) => {
        const isMe = false;
        const color = levelNameToColor[user.level] || levelColors[0];
        return (
          <div
            key={user.rank}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 border transition-colors ${
              isMe ? "border-[#00ffb3]/40 bg-[#00ffb3]/5" : "border-[var(--border)]"
            }`}
            style={isMe ? undefined : { background: "var(--surface-2)" }}
          >
            <div className="w-8 text-center flex-shrink-0">
              {RANK_ICONS[user.rank] ? (
                <span className="text-lg">{RANK_ICONS[user.rank]}</span>
              ) : (
                <span className="text-sm font-bold" style={{ color: isMe ? "var(--accent)" : "var(--text-dim)" }}>
                  {user.rank}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-6 truncate"
                style={{ color: isMe ? "var(--accent)" : "var(--text)" }}>
                {user.name}
                {isMe && <span className="text-[10px] font-normal mr-1.5 opacity-60">(شما)</span>}
              </p>
              <p className="text-[11px] leading-5 truncate" style={{ color: "var(--text-dim)" }}>
                {user.company}
              </p>
            </div>
            <div className="text-left flex-shrink-0">
              <p className="text-sm font-black leading-5" style={{ color: isMe ? "var(--accent)" : "var(--text)" }}>
                {user.xp}
              </p>
              <p className="text-[10px] leading-4" style={{ color: "var(--text-dim)" }}>XP</p>
            </div>
            <div
              className="px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
              style={{ color, background: color + "20" }}
            >
              {user.level}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BadgesTab({ badges }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {badges.map((badge, idx) => (
        <div
          key={badge.id ?? idx}
          className={`rounded-2xl p-4 border text-center transition-colors ${
            badge.earned ? "border-[#00ffb3]/30 bg-[#00ffb3]/5" : "border-[var(--border)]"
          }`}
          style={badge.earned ? undefined : { background: "var(--surface-2)", opacity: 0.5 }}
        >
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: badge.earned ? "rgba(0,255,179,0.15)" : "var(--surface-hover)" }}
          >
            {badge.icon && badge.icon.startsWith('/') ? (
              <img src={badge.icon} alt="" style={{ width: badge.icon_size ?? 36, height: badge.icon_size ?? 36, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: badge.icon_size ?? 36, lineHeight: 1 }}>{badge.icon}</span>
            )}
          </div>
          <p className="text-sm font-bold leading-6"
            style={{ color: badge.earned ? "var(--accent)" : "var(--text-muted)" }}>
            {badge.name}
          </p>
          <p className="text-[11px] leading-5 mt-0.5" style={{ color: "var(--text-dim)" }}>
            {badge.description}
          </p>
          {badge.earned && (
            <div
              className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(0,255,179,0.15)", color: "var(--accent)" }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              کسب شده
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function getLogoUrl(logo, baseUrl) {
  if (!logo) return null;
  let parsed = logo;
  if (typeof logo === 'string') {
    try { parsed = JSON.parse(logo); } catch { return null; }
  }
  const src = parsed?.jpg?.['128'] || parsed?.jpg?.['64'];
  if (!src) return null;
  return (baseUrl || '') + src;
}

function BoothsBottomSheet({ open, onClose, title, isRTL, lang, booths, scannedIds, boothsLoading, logoBaseUrl }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [open]);

  if (!open && !visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={onClose}
      />
      <div
        dir={isRTL ? "rtl" : "ltr"}
        className="relative w-full max-w-md backdrop-blur-xl border-t border-x border-[var(--border)] rounded-t-3xl transition-transform duration-300 ease-out"
        style={{ background: "var(--sheet-bg)", transform: visible ? "translateY(0)" : "translateY(100%)" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--border)" }} />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <h2 className="font-bold text-base leading-7" style={{ color: "var(--text)" }}>{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--surface-2)";
              e.currentTarget.style.color = "var(--text-dim)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              strokeWidth="2.5" strokeLinecap="round" stroke="currentColor">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto max-h-[65vh] px-4 py-3 space-y-2 pb-8">
          {boothsLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-[var(--border)]"
                style={{ background: "var(--surface-2)", opacity: 0.5 }}>
                <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "var(--border)" }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 rounded-full w-3/4" style={{ background: "var(--border)" }} />
                  <div className="h-2.5 rounded-full w-1/2" style={{ background: "var(--border)" }} />
                </div>
              </div>
            ))
          ) : booths.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
              هنوز غرفه‌ای ثبت نشده
            </div>
          ) : booths.map((booth) => {
            const scanned = scannedIds.has(booth.id);
            const logoUrl = getLogoUrl(booth.logo, logoBaseUrl);
            const name = lang === 'fa'
              ? (booth.brand_name_fa || booth.brand_name_en || '—')
              : (booth.brand_name_en || booth.brand_name_fa || '—');
            const firstLetter = (booth.brand_name_fa || booth.brand_name_en || '؟').charAt(0);
            return (
              <div
                key={booth.id}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 border transition-colors ${
                  scanned ? "bg-[#00ffb3]/5 border-[#00ffb3]/20" : "border-[var(--border)]"
                }`}
                style={scanned ? undefined : { background: "var(--surface-2)", opacity: 0.7 }}
              >
                {/* Logo or initial */}
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt=""
                    style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'contain', background: '#fff', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                ) : (
                  <div
                    style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-dim)' }}
                  >
                    {firstLetter}
                  </div>
                )}

                {/* Name + location */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium leading-6 truncate"
                      style={{ color: scanned ? "var(--text)" : "var(--text-muted)" }}>
                      {name}
                    </span>
                    {booth.is_sponsor && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                        ویژه
                      </span>
                    )}
                  </div>
                  {booth.hall_name && (
                    <div className="text-[11px] leading-4" style={{ color: "var(--text-dim)" }}>
                      {lang === 'fa' ? 'سالن' : 'Hall'} {booth.hall_name}
                      {booth.booth_no && <> • {lang === 'fa' ? 'غرفه' : 'Booth'} {booth.booth_no}</>}
                    </div>
                  )}
                </div>

                {/* XP */}
                <span className="text-xs font-bold flex-shrink-0" style={{ color: "var(--accent)" }}>
                  +{booth.xp} XP
                </span>

                {/* Scanned indicator */}
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                  style={{ background: scanned ? "rgba(0,255,179,0.15)" : "var(--surface-hover)" }}
                >
                  {scanned ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                      style={{ stroke: "var(--accent)" }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ stroke: "var(--text-dim)" }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main client component ───────────────────────────────────────────────────

export default function QuestClient({ content, title, subtitle, title_en, subtitle_en }) {
  const [boothsOpen, setBoothsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("missions");
  const [isDark, setIsDark] = useState(true);
  const { lang, isRTL } = useLang();

  const [booths, setBooths] = useState([]);
  const [scannedIds, setScannedIds] = useState(new Set());
  const [boothsLoading, setBoothsLoading] = useState(true);
  const [logoBaseUrl, setLogoBaseUrl] = useState('');

  const [questStats, setQuestStats] = useState({ name_fa: '', name_en: '', xp: 0, total_scans: 0, today_scans: 0 });

  useEffect(() => {
    fetch('/api/quest/booths')
      .then(r => r.json())
      .then(d => {
        setBooths(d.booths ?? []);
        setScannedIds(new Set(d.scanned_ids ?? []));
        setLogoBaseUrl(d.logoBaseUrl || '');
      })
      .catch(() => {})
      .finally(() => setBoothsLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/quest/stats')
      .then(r => r.json())
      .then(d => setQuestStats(d))
      .catch(() => {});
  }, []);

  const c = useMemo(() => ({
    ...(content?.main || {}),
    ...(lang === 'en' ? (content?.main_en || {}) : {}),
  }), [content?.main, content?.main_en, lang]);

  // Build level thresholds using CMS names + icons but hardcoded XP ranges
  const levelThresholds = useMemo(() => [
    { name: c.level_0_name || FALLBACK_LEVEL_NAMES[0], icon: iconOf(c.icon_level_0) || FALLBACK_LEVEL_ICONS[0], iconSize: iconSizeOf(c.icon_level_0, 14), ...BASE_THRESHOLDS[0] },
    { name: c.level_1_name || FALLBACK_LEVEL_NAMES[1], icon: iconOf(c.icon_level_1) || FALLBACK_LEVEL_ICONS[1], iconSize: iconSizeOf(c.icon_level_1, 14), ...BASE_THRESHOLDS[1] },
    { name: c.level_2_name || FALLBACK_LEVEL_NAMES[2], icon: iconOf(c.icon_level_2) || FALLBACK_LEVEL_ICONS[2], iconSize: iconSizeOf(c.icon_level_2, 14), ...BASE_THRESHOLDS[2] },
  ], [c]);

  const missions    = content?.missions?.length    > 0 ? content.missions    : FALLBACK_MISSIONS;
  const leaderboard = content?.leaderboard?.length > 0 ? content.leaderboard : FALLBACK_LEADERBOARD;
  const badges      = content?.badges?.length      > 0 ? content.badges      : FALLBACK_BADGES;

  const tabs = useMemo(() => [
    { id: "missions",    icon: iconOf(c.icon_tab_missions)    || "🎯", iconSize: iconSizeOf(c.icon_tab_missions,    18), text: c.tab_missions    || "مأموریت‌ها" },
    { id: "leaderboard", icon: iconOf(c.icon_tab_leaderboard) || "🏅", iconSize: iconSizeOf(c.icon_tab_leaderboard, 18), text: c.tab_leaderboard || "لیدربورد"   },
    { id: "badges",      icon: iconOf(c.icon_tab_badges)      || "🎖️", iconSize: iconSizeOf(c.icon_tab_badges,      18), text: c.tab_badges      || "بج‌ها"      },
  ], [c]);

  const labels = useMemo(() => ({
    userCardLabel:      c.user_card_label      || "کاربر",
    xpLabel:            c.xp_label             || "امتیاز فعلی",
    nextLevelPrefix:    c.next_level_prefix    || "تا سطح بعدی:",
    xpRemainingSuffix:  c.xp_remaining_suffix  || "XP مانده",
    scanButtonLabel:    c.scan_button_label    || "اسکن QR غرفه",
    statXpLabel:        c.stat_xp_label        || "امتیاز امروز",
    statScannedLabel:   c.stat_scanned_label   || "غرفه اسکن‌شده",
    statRankLabel:      c.stat_rank_label      || "رتبه شما",
    viewListLabel:      c.view_list_label      || "مشاهده لیست",
    missionsTodayLabel: c.missions_today_label || "مأموریت‌های امروز",
    boothsSheetTitle:   c.booths_sheet_title   || "غرفه‌های نمایشگاه",
  }), [c]);

  useEffect(() => {
    const check = () => setIsDark(!document.documentElement.classList.contains("light"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const missionList = useMemo(
    () => missions.map((m, i) => <MissionCard key={m.id ?? i} mission={m} />),
    [missions]
  );

  return (
    <main dir={isRTL ? "rtl" : "ltr"} lang={lang} className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4 pb-32">

        <PageHeader title={title || c.title || "Booth Quest"} subtitle={subtitle || c.subtitle || ""} title_en={title_en} subtitle_en={subtitle_en} />

        <UserCard
          user={{
            name: lang === 'en' ? (questStats.name_en || questStats.name_fa) : questStats.name_fa,
            xp: questStats.xp,
          }}
          thresholds={levelThresholds}
          levelColors={LEVEL_COLORS_BY_IDX}
          labels={labels}
        />

        <div className="flex justify-center my-8">
          <ScanButton isDark={isDark} label={labels.scanButtonLabel} />
        </div>

        <div
          className="flex rounded-2xl p-1 mb-6 border border-[var(--border)]"
          style={{ background: "var(--surface-2)" }}
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 py-2 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-1"
                style={{
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "var(--bg)" : "var(--text-dim)",
                }}
              >
                {tab.icon && tab.icon.startsWith('/') ? (
                  <img src={tab.icon} alt="" style={{ width: tab.iconSize, height: tab.iconSize, objectFit: 'contain', flexShrink: 0 }} />
                ) : (
                  <span style={{ fontSize: tab.iconSize, lineHeight: 1 }}>{tab.icon}</span>
                )}
                {tab.text}
              </button>
            );
          })}
        </div>

        {activeTab === "missions" && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-6">
              {(() => {
                const toFA = (n) => lang === 'fa' ? String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(n);
                return [
                  { label: labels.statXpLabel,      value: toFA(questStats.xp),          unit: "XP",   icon: "⚡", onClick: null,                      highlight: false },
                  { label: labels.statScannedLabel, value: toFA(questStats.total_scans), unit: "غرفه", icon: "📍", onClick: () => setBoothsOpen(true), highlight: true  },
                  { label: labels.statRankLabel,    value: "—",                           unit: "",     icon: "🏅", onClick: null,                      highlight: false },
                ];
              })().map((stat) => (
                <div
                  key={stat.label}
                  onClick={stat.onClick ?? undefined}
                  className={`backdrop-blur-xl border rounded-2xl p-3 text-center transition-colors ${
                    stat.highlight ? "cursor-pointer active:scale-95" : "border-[var(--border)] cursor-default"
                  } ${stat.onClick && !stat.highlight ? "cursor-pointer active:scale-95" : ""}`}
                  style={{
                    background: "var(--surface-2)",
                    borderColor: stat.highlight ? "var(--border-accent)" : undefined,
                  }}
                >
                  <div className="text-xl mb-1">{stat.icon}</div>
                  <div className="font-black text-lg leading-tight" style={{ color: "var(--accent)" }}>
                    {stat.value}
                    <span className="text-xs font-normal" style={{ color: "var(--accent)", opacity: 0.6 }}>
                      {" "}{stat.unit}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5 leading-5" style={{ color: "var(--text-dim)" }}>
                    {stat.label}
                  </p>
                  {stat.highlight && (
                    <p className="text-[9px] mt-1.5 flex items-center justify-center gap-0.5"
                      style={{ color: "var(--accent)", opacity: 0.5 }}>
                      <span>{labels.viewListLabel}</span>
                      <span>←</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs px-1 mb-3" style={{ color: "var(--text-dim)" }}>
              {labels.missionsTodayLabel}
            </p>
            <div className="space-y-3">{missionList}</div>
          </>
        )}

        {activeTab === "leaderboard" && (
          <LeaderboardTab
            users={leaderboard}
            levelColors={LEVEL_COLORS_BY_IDX}
            thresholds={levelThresholds}
          />
        )}

        {activeTab === "badges" && <BadgesTab badges={badges} />}
      </div>

      <BoothsBottomSheet
        open={boothsOpen}
        onClose={() => setBoothsOpen(false)}
        title={labels.boothsSheetTitle}
        isRTL={isRTL}
        lang={lang}
        booths={booths}
        scannedIds={scannedIds}
        boothsLoading={boothsLoading}
        logoBaseUrl={logoBaseUrl}
      />

      <BottomNav />
    </main>
  );
}
