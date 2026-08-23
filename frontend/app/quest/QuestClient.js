// TEMPORARY: Reads static content from DB (quest_content_blocks).
// When real quest logic is added, replace content.missions / content.leaderboard
// / content.badges with live API data. The `content` prop only drives copy & order.
"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { toPersianDigits } from "@/lib/utils";

// ── Appearance config defaults (matched to current hardcoded values) ───────

const APPEARANCE_DEFAULTS = {
  dark: {
    mission_title_size: 14,    mission_title_color: '#ffffff',
    mission_subtitle_size: 12, mission_subtitle_color: '#94a3b8',
    leaderboard_size: 14,      leaderboard_color: '#ffffff',
    badge_title_size: 14,      badge_title_color: '#94a3b8',
    active_border_color: '#00ffb3',
    // scan_glow_color intentionally has NO default here -- when the admin
    // hasn't set one, ScanButton falls through to the event's live
    // --accent CSS var via color-mix(), not a hardcoded hex (see
    // ScanButton below). A static default here would reintroduce the
    // wrong-fixed-color-on-every-other-event bug this field exists to fix.
    rotation_text_size: 11,    rotation_text_color: '#94a3b8',
  },
  light: {
    mission_title_size: 14,    mission_title_color: '#0f172a',
    mission_subtitle_size: 12, mission_subtitle_color: '#475569',
    leaderboard_size: 14,      leaderboard_color: '#0f172a',
    badge_title_size: 14,      badge_title_color: '#475569',
    active_border_color: '#047857',
    // scan_glow_color: see comment in `dark` above -- same reasoning.
    rotation_text_size: 11,    rotation_text_color: '#475569',
  },
};

function hexToRgba(hex, alpha) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Hardcoded non-CMS constants ────────────────────────────────────────────
// These represent live gameplay state, not static content — they stay here
// until real quest logic replaces them.

const FALLBACK_LEVELS = [
  { name_fa: "تازه‌وارد", name_en: "Newcomer", icon_value: "🌱", icon_size: 14, min_xp: 0,   max_xp: 200,  color: "#64748b" },
  { name_fa: "کاوشگر",    name_en: "Explorer", icon_value: "🕵️",  icon_size: 14, min_xp: 200, max_xp: 500,  color: "#22c55e" },
  { name_fa: "کاربلد",    name_en: "Expert",   icon_value: "😎",  icon_size: 14, min_xp: 500, max_xp: null, color: "#f59e0b" },
];

const RANK_ICONS = { 1: "🥇", 2: "🥈", 3: "🥉" };

// ── Fallback content (used only if /api/quest fails) ──────────────────────

const FALLBACK_MISSIONS = [
  { id: 1, icon: "🏛️", title: "بازدید از ۳ غرفه",          description: "از ۳ غرفه مختلف نمایشگاه بازدید کن",   xpReward: 60,  progress: 0, total: 3 },
  { id: 2, icon: "💬", title: "اولین مکالمه",               description: "با دستیار هوش مصنوعی چت کن",           xpReward: 30,  progress: 0, total: 1 },
  { id: 3, icon: "⭐", title: "غرفه برتر",                  description: "از غرفه ویژه نمایشگاه بازدید کن",       xpReward: 50,  progress: 0, total: 1 },
  { id: 4, icon: "🎤", title: "شرکت در مراسم افتتاحیه",    description: "در مراسم افتتاحیه شرکت کن",             xpReward: 300, progress: 0, total: 1 },
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

// A circular badge's visible area is only the circle inscribed in its
// bounding square (~78.5% of it) — content sized to nearly fill the square
// pokes past the round border at its corners. Scale the diameter by √2 (the
// side-of-square-inscribed-in-circle ratio) so a square-ish icon of size N
// is fully contained by the circle, not just by its bounding box.
function levelBadgeSize(iconSize) {
  const size = iconSize ?? 14;
  return Math.max(32, Math.ceil(size * Math.SQRT2) + 12);
}

// With the circle hidden, the icon has no clipping/inscribing constraint to
// respect — let it grow to fill the box the circle used to occupy (minus a
// small margin) instead of staying pinned at its circle-inscribed size.
function levelIconDisplaySize(iconSize, showCircle) {
  const size = iconSize ?? 14;
  if (showCircle) return size;
  return levelBadgeSize(iconSize) - 8;
}

function LevelTimeline({ currentLevel, thresholds, levelColors, showCircle = true }) {
  const currentIdx = thresholds.findIndex((l) => l.name === currentLevel);
  return (
    <div className="mt-4">
      <div className="flex items-center overflow-x-auto pb-1">
        {thresholds.map((level, idx) => {
          const badgeSize = levelBadgeSize(level.iconSize);
          const iconSize = levelIconDisplaySize(level.iconSize, showCircle);
          return (
            <Fragment key={level.name}>
              <div
                className="rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
                style={{
                  width: badgeSize,
                  height: badgeSize,
                  border: showCircle ? `2px solid ${idx <= currentIdx ? "var(--accent)" : "var(--border)"}` : "none",
                  opacity: idx <= currentIdx ? 1 : 0.3,
                }}
              >
                {level.icon && level.icon.startsWith('/') ? (
                  <img src={level.icon} alt="" style={{ width: iconSize, height: iconSize, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: iconSize, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{level.icon}</span>
                )}
              </div>
              {idx < thresholds.length - 1 && (
                <div
                  className="flex-1 h-px transition-colors"
                  style={{ background: idx < currentIdx ? "var(--accent)" : "var(--border)", minWidth: 16 }}
                />
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="flex mt-1.5 overflow-x-auto">
        {thresholds.map((level, idx) => {
          const badgeSize = levelBadgeSize(level.iconSize);
          return (
            <Fragment key={level.name}>
              <span
                className="text-[9px] font-bold text-center flex-shrink-0 leading-4"
                style={{
                  width: badgeSize,
                  color: idx <= currentIdx ? "var(--accent)" : "var(--text-dim)",
                  opacity: idx <= currentIdx ? 1 : 0.3,
                }}
              >
                {level.name}
              </span>
              {idx < thresholds.length - 1 && <div className="flex-1" style={{ minWidth: 16 }} />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function UserCard({ user, thresholds, levelColors, labels, lang, showLevelCircle = true }) {
  const { pct, current, currentIdx, next } = useMemo(
    () => getXpProgress(user.xp, thresholds),
    [user.xp, thresholds]
  );
  const [animated, setAnimated] = useState(false);
  const [xpFlash, setXpFlash] = useState(false);
  const prevXpRef = useRef(user.xp);
  const animatedXp = useAnimatedCounter(user.xp);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(t);
  }, []);

  // Brief glow flash when XP increases (e.g. after a poll detects new XP)
  useEffect(() => {
    if (user.xp > prevXpRef.current) {
      setXpFlash(true);
      const t = setTimeout(() => setXpFlash(false), 1200);
      prevXpRef.current = user.xp;
      return () => clearTimeout(t);
    }
    prevXpRef.current = user.xp;
  }, [user.xp]);

  const color = levelColors[currentIdx] || levelColors[levelColors.length - 1];

  return (
    <div
      className="backdrop-blur-xl border rounded-3xl p-5"
      style={{ background: "var(--surface)", borderColor: "color-mix(in srgb, var(--accent) 20%, transparent)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{labels.userCardLabel}</p>
          <h2 className="font-bold text-lg leading-7" style={{ color: "var(--text)" }}>{user.name}</h2>
        </div>
        <div
          className="px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5"
          style={{
            color,
            borderColor: color + "40",
            backgroundColor: color + "15",
          }}
        >
          {current.icon && current.icon.startsWith('/') ? (
            <img src={current.icon} alt="" style={{ width: current.iconSize ?? 14, height: current.iconSize ?? 14, objectFit: 'contain', flexShrink: 0 }} />
          ) : (
            <span style={{ fontSize: current.iconSize ?? 14, lineHeight: 1 }}>{current.icon}</span>
          )}
          <span>{current.name}</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm mb-2">
        <span style={{ color: "var(--text-muted)" }}>{labels.xpLabel}</span>
        <span
          className="font-bold transition-all duration-500"
          style={{
            color: "var(--accent)",
            textShadow: xpFlash ? '0 0 16px var(--accent), 0 0 32px color-mix(in srgb, var(--accent) 40%, transparent)' : undefined,
          }}
        >
          {lang === 'fa'
            ? `${dNum(animatedXp, lang)}+ ${labels.xpUnit}`
            : (<>+{dNum(animatedXp, lang)} {labels.xpUnit}</>)}
        </span>
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
            {dNum(Math.max(0, next.min - animatedXp), lang)} {labels.xpRemainingSuffix}
          </span>
        </div>
      )}

      <LevelTimeline currentLevel={current.name} thresholds={thresholds} levelColors={levelColors} showCircle={showLevelCircle} />
    </div>
  );
}

// Shown instead of UserCard while questStats/levels are still loading — never
// render FALLBACK_LEVELS' placeholder icon/name as if it were the real user.
function UserCardSkeleton() {
  return (
    <div
      className="backdrop-blur-xl border rounded-3xl p-5 animate-pulse"
      style={{ background: "var(--surface)", borderColor: "color-mix(in srgb, var(--accent) 20%, transparent)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="space-y-2">
          <div className="h-2.5 w-16 rounded-full" style={{ background: "var(--border)" }} />
          <div className="h-4 w-28 rounded-full" style={{ background: "var(--border)" }} />
        </div>
        <div className="h-6 w-20 rounded-full" style={{ background: "var(--border)" }} />
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="h-2.5 w-10 rounded-full" style={{ background: "var(--border)" }} />
        <div className="h-2.5 w-16 rounded-full" style={{ background: "var(--border)" }} />
      </div>
      <div className="h-2.5 rounded-full" style={{ background: "var(--border)" }} />
      <div className="mt-4 flex items-center gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-full flex-shrink-0" style={{ width: 32, height: 32, background: "var(--border)" }} />
        ))}
      </div>
    </div>
  );
}

function ScanButton({ isDark, label, glowColor }) {
  // glowColor is only a real value once an admin explicitly sets
  // scan_glow_color -- there's no static default for it (see
  // APPEARANCE_DEFAULTS above). hexToRgba returns null for anything that
  // isn't a literal #rrggbb (undefined, or an invalid string), so the
  // fallback below is what actually runs for every event until an admin
  // opts in: color-mix() against the live --accent CSS var (set per-event
  // via the theme-colors settings), resolved by the browser at paint time --
  // NOT a hardcoded hex, which is what caused this field to be added.
  const shadowColor      = hexToRgba(glowColor, 0.5) || 'color-mix(in srgb, var(--accent) 50%, transparent)';
  const shadowColorHover = hexToRgba(glowColor, 0.7) || 'color-mix(in srgb, var(--accent) 70%, transparent)';
  const pingColor20      = hexToRgba(glowColor, 0.2) || 'color-mix(in srgb, var(--accent) 20%, transparent)';
  const pingColor10      = hexToRgba(glowColor, 0.1) || 'color-mix(in srgb, var(--accent) 10%, transparent)';
  return (
    <Link href="/quest/scan" className="flex flex-col items-center gap-3 group">
      <div
        className="relative"
        style={{ '--scan-glow-shadow': shadowColor, '--scan-glow-shadow-hover': shadowColorHover }}
      >
        {isDark && (
          <>
            <span className="absolute inset-0 rounded-full animate-ping" style={{ background: pingColor20 }} />
            <span
              className="absolute inset-[-6px] rounded-full animate-ping"
              style={{ animationDelay: "0.3s", background: pingColor10 }}
            />
          </>
        )}
        <button
          className="relative w-20 h-20 rounded-full flex items-center justify-center shadow-[0_0_30px_var(--scan-glow-shadow)] group-hover:shadow-[0_0_45px_var(--scan-glow-shadow-hover)] transition-shadow duration-300 group-hover:scale-105 active:scale-95 transition-transform"
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

function useLiveNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function featuredBoothCountdownText(nextRotationIso, lang, now) {
  if (!nextRotationIso) return null;
  const remaining = new Date(nextRotationIso).getTime() - now;
  if (remaining <= 0) return lang === 'fa' ? '⟳ در حال چرخش...' : '⟳ Rotating soon...';
  const minutes = Math.ceil(remaining / 60_000);
  return lang === 'fa'
    ? `⟳ چرخش بعدی: ${toPersianNum(minutes)} دقیقه دیگر`
    : `⟳ Next rotation: ${minutes} min`;
}

function MissionCard({ mission, xpUnit, onQuizClick, onFeaturedClick, onSurveyClick, onSocialShareClick, lang: langProp }) {
  const pct = useMemo(
    () => (mission.total > 0 ? Math.round((mission.progress / mission.total) * 100) : 0),
    [mission.progress, mission.total]
  );
  const done = mission.progress >= mission.total;
  const isQuiz = mission.mission_type === 'quiz';
  const isFeaturedBooth = mission.mission_type === 'featured_booth';
  const isSurvey = mission.mission_type === 'survey';
  const isSocialShare = mission.mission_type === 'social_share';
  const quizAttempted = isQuiz && !!mission.quiz_attempted;
  const surveySubmitted = isSurvey && !!mission.survey_submitted;
  const socialShareStatus = isSocialShare ? (mission.social_share_status || null) : null;
  const socialShareNote = isSocialShare ? (mission.social_share_note || null) : null;
  const quizClickable = isQuiz && !done && !quizAttempted && typeof onQuizClick === 'function';
  const surveyClickable = isSurvey && !done && !surveySubmitted && typeof onSurveyClick === 'function';
  const featuredClickable = isFeaturedBooth && typeof onFeaturedClick === 'function';
  // Social share: clickable if no pending submission, not yet approved
  const socialShareClickable = isSocialShare && !done && socialShareStatus !== 'pending' && typeof onSocialShareClick === 'function';

  const now = useLiveNow(isFeaturedBooth && !done);
  const countdownText = isFeaturedBooth
    ? featuredBoothCountdownText(mission.featured_booth_next_rotation, langProp, now)
    : null;

  const handleClick = quizClickable ? onQuizClick
    : surveyClickable ? onSurveyClick
    : socialShareClickable ? onSocialShareClick
    : featuredClickable ? onFeaturedClick
    : undefined;

  // 44px (the old fixed w-11/h-11) already matched the 36px default icon plus
  // 8px padding — keep that same padding so the container scales with a
  // per-mission icon_size instead of clipping it at a fixed size.
  const iconBoxSize = Math.max(44, (mission.icon_size ?? 36) + 8);

  return (
    <div
      onClick={handleClick}
      className={`backdrop-blur-xl border rounded-2xl p-4 flex items-center gap-4 transition-colors ${
        (quizClickable || surveyClickable || socialShareClickable || featuredClickable) ? "cursor-pointer active:scale-[0.98]" : ""
      }`}
      style={done
        ? { borderColor: "var(--quest-active-border)", background: "var(--quest-active-bg)" }
        : { background: "var(--surface-2)", borderColor: "var(--border)" }
      }
    >
      <div
        className="rounded-xl flex-shrink-0 flex items-center justify-center"
        style={{ width: iconBoxSize, height: iconBoxSize, background: done ? "var(--quest-active-icon-bg)" : "var(--surface-2)" }}
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
            className="font-medium leading-7"
            style={{ fontSize: "var(--quest-title-size)", color: "var(--quest-title-color)" }}
          >
            {dNum(mission.title, langProp)}
          </span>
          <span className="text-xs font-bold flex-shrink-0 mr-2" style={{ color: "var(--accent)" }}>
            {langProp === 'fa'
              ? `${dNum(isFeaturedBooth ? (mission.featuredBoothBonusXp ?? mission.xpReward) : mission.xpReward, langProp)}+ ${xpUnit || "XP"}`
              : (<>+{dNum(isFeaturedBooth ? (mission.featuredBoothBonusXp ?? mission.xpReward) : mission.xpReward, langProp)} {xpUnit || "XP"}</>)}
          </span>
        </div>
        <p className="leading-6 mb-1.5 truncate" style={{ fontSize: "var(--quest-subtitle-size)", color: "var(--quest-subtitle-color)" }}>
          {dNum(mission.description, langProp)}
        </p>
        {isFeaturedBooth ? (
          <div className="flex items-center justify-between gap-2">
            {done ? (
              <span className="text-[11px] font-bold" style={{ color: "var(--accent)" }}>✓ کشف شد!</span>
            ) : countdownText ? (
              <span style={{ fontSize: "var(--quest-rotation-size)", color: "var(--quest-rotation-color)" }}>{countdownText}</span>
            ) : <span />}
            {featuredClickable && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                {langProp === 'fa' ? 'مشاهده غرفه‌ها ←' : 'See booths →'}
              </span>
            )}
          </div>
        ) : isQuiz ? (
          <div className="flex items-center justify-between gap-2">
            {done ? (
              <span className="text-[11px] font-bold" style={{ color: "var(--accent)" }}>پاسخ صحیح ✓</span>
            ) : quizAttempted ? (
              <span className="text-[11px] font-medium" style={{ color: "#f87171" }}>پاسخ داده شده</span>
            ) : <span />}
            {quizClickable && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                {langProp === 'fa' ? 'شرکت کن ←' : 'Join →'}
              </span>
            )}
          </div>
        ) : isSurvey ? (
          <div className="flex items-center justify-between gap-2">
            {done || surveySubmitted ? (
              <span className="text-[11px] font-bold" style={{ color: "var(--accent)" }}>پاسخ داده شده ✓</span>
            ) : <span />}
            {surveyClickable && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                {langProp === 'fa' ? 'شرکت در نظرسنجی ←' : 'Take Survey →'}
              </span>
            )}
          </div>
        ) : isSocialShare ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between gap-2">
              {done || socialShareStatus === 'approved' ? (
                <span className="text-[11px] font-bold" style={{ color: "var(--accent)" }}>تایید شد ✅</span>
              ) : socialShareStatus === 'pending' ? (
                <span className="text-[11px] font-medium" style={{ color: '#f59e0b' }}>در انتظار بررسی ⏳</span>
              ) : socialShareStatus === 'rejected' ? (
                <span className="text-[11px] font-medium" style={{ color: '#f87171' }}>رد شد ❌</span>
              ) : <span />}
              {socialShareClickable && (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                  {socialShareStatus === 'rejected'
                    ? (langProp === 'fa' ? 'ارسال مجدد ←' : 'Resubmit →')
                    : (langProp === 'fa' ? 'اشتراک‌گذاری کن ←' : 'Share →')}
                </span>
              )}
            </div>
            {socialShareStatus === 'rejected' && socialShareNote && (
              <p className="text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}>{socialShareNote}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, background: "var(--accent)" }}
              />
            </div>
            <span className="text-xs flex-shrink-0" style={{ color: "var(--text-dim)" }}>
              {dNum(mission.progress, langProp)}/{dNum(mission.total, langProp)}
            </span>
          </div>
        )}
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

function AvatarPlaceholder({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ borderRadius: '50%', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }}>
      <circle cx="16" cy="13" r="5" fill="rgba(255,255,255,0.25)" />
      <path d="M6 27c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LeaderboardRow({ user, isMe, badgeColor, badgeLabel, xpUnit, lang }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-4 py-3 border transition-colors"
      style={isMe
        ? { borderColor: "var(--quest-active-border)", background: "var(--quest-active-bg)" }
        : { borderColor: "var(--border)", background: "var(--surface-2)" }
      }
    >
      <div className="w-8 text-center flex-shrink-0">
        {RANK_ICONS[user.rank] ? (
          <span className="text-lg">{RANK_ICONS[user.rank]}</span>
        ) : (
          <span className="text-sm font-bold" style={{ color: isMe ? "var(--accent)" : "var(--text-dim)" }}>
            {dNum(user.rank, lang)}
          </span>
        )}
      </div>
      {user.profile_photo_url ? (
        <img
          src={user.profile_photo_url}
          alt=""
          width={32} height={32}
          className="flex-shrink-0 object-cover"
          style={{ borderRadius: '50%', width: 32, height: 32 }}
        />
      ) : (
        <AvatarPlaceholder size={32} />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bold leading-6 truncate"
          style={{ fontSize: "var(--quest-lb-size)", color: isMe ? "var(--accent)" : "var(--quest-lb-color)" }}>
          {user.name}
          {isMe && <span className="text-[10px] font-normal mr-1.5 opacity-60">(شما)</span>}
        </p>
        {user.company ? (
          <p className="text-[11px] leading-5 truncate" style={{ color: "var(--text-dim)" }}>
            {user.company}
          </p>
        ) : null}
      </div>
      <div className="text-left flex-shrink-0">
        <p className="font-black leading-5" style={{ fontSize: "var(--quest-lb-size)", color: isMe ? "var(--accent)" : "var(--quest-lb-color)" }}>
          {dNum(user.xp, lang)}
        </p>
        <p className="text-[10px] leading-4" style={{ color: "var(--text-dim)" }}>{xpUnit || "XP"}</p>
      </div>
      {badgeLabel && (
        <div
          className="px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0"
          style={{ color: badgeColor, background: badgeColor + "20" }}
        >
          {badgeLabel}
        </div>
      )}
    </div>
  );
}

function LeaderboardTab({ users, levelColors, thresholds, currentUserUuid, xpUnit, lang, levels }) {
  const [subTab, setSubTab] = useState('overall');
  const [levelCache, setLevelCache] = useState({});

  const levelNameToColor = useMemo(() => {
    const map = {};
    thresholds.forEach((t, i) => { map[t.name] = levelColors[i] || levelColors[levelColors.length - 1]; });
    return map;
  }, [thresholds, levelColors]);

  const activeLevels = useMemo(
    () => (levels || []).filter(l => l.is_active !== false),
    [levels]
  );

  useEffect(() => {
    if (subTab === 'overall') return;
    const key = subTab;
    if (levelCache[key] !== undefined) return;
    setLevelCache(c => ({ ...c, [key]: null }));
    fetch(`/api/quest/leaderboard?level=${key}`)
      .then(r => r.json())
      .then(d => setLevelCache(c => ({ ...c, [key]: { leaderboard: d.leaderboard || [], currentUser: d.currentUser || null } })))
      .catch(() => setLevelCache(c => ({ ...c, [key]: { leaderboard: [], currentUser: null } })));
  }, [subTab]);

  const subTabBar = activeLevels.length > 0 ? (
    <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 scrollbar-hide">
      <button
        onClick={() => setSubTab('overall')}
        className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
        style={{
          background: subTab === 'overall' ? "var(--accent)" : "var(--surface-2)",
          color: subTab === 'overall' ? "var(--bg)" : "var(--text-dim)",
          border: subTab === 'overall' ? '1px solid transparent' : '1px solid var(--border)',
        }}
      >
        {lang === 'en' ? 'Overall' : 'کلی'}
      </button>
      {activeLevels.map(level => {
        const key = String(level.id);
        const isActive = subTab === key;
        const color = level.color || '#64748b';
        const name = lang === 'en' ? (level.name_en || level.name_fa) : level.name_fa;
        const iconIsImg = level.icon_type === 'image' && level.icon_value?.startsWith('/');
        return (
          <button
            key={level.id}
            onClick={() => setSubTab(key)}
            className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold transition-all"
            style={{
              background: isActive ? color + '22' : "var(--surface-2)",
              color: isActive ? color : "var(--text-dim)",
              border: `1px solid ${isActive ? color + '66' : 'var(--border)'}`,
            }}
          >
            {iconIsImg
              ? <img src={level.icon_value} alt="" style={{ width: level.icon_size ?? 14, height: level.icon_size ?? 14, objectFit: 'contain', flexShrink: 0 }} />
              : <span style={{ fontSize: level.icon_size ?? 14, lineHeight: 1 }}>{level.icon_value || '⭐'}</span>
            }
            {name}
          </button>
        );
      })}
    </div>
  ) : null;

  if (subTab === 'overall') {
    return (
      <div className="space-y-2">
        {subTabBar}
        {users === null ? (
          <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
            {lang === 'en' ? 'Loading...' : 'در حال بارگذاری...'}
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
            {lang === 'en' ? 'No users on the leaderboard yet' : 'هنوز کسی در لیدربورد امتیازی کسب نکرده'}
          </div>
        ) : (
          users.map((user) => {
            const isMe = !!currentUserUuid && user.user_uuid === currentUserUuid;
            const color = levelNameToColor[user.level] || levelColors[0];
            return (
              <LeaderboardRow key={user.rank} user={user} isMe={isMe} badgeColor={color} badgeLabel={user.level} xpUnit={xpUnit} lang={lang} />
            );
          })
        )}
      </div>
    );
  }

  const levelId = parseInt(subTab, 10);
  const level = activeLevels.find(l => l.id === levelId);
  const levelName = level ? (lang === 'en' ? (level.name_en || level.name_fa) : level.name_fa) : '';
  const levelColor = level?.color || '#64748b';
  const cache = levelCache[subTab];

  if (cache === null || cache === undefined) {
    return (
      <div className="space-y-2">
        {subTabBar}
        <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
          {lang === 'en' ? 'Loading...' : 'در حال بارگذاری...'}
        </div>
      </div>
    );
  }

  const levelRows = cache.leaderboard.map(item => ({
    rank:              item.rank,
    user_uuid:         item.user_uuid,
    name:              lang === 'en' ? (item.display_name_en || item.display_name_fa || 'شرکت‌کننده') : (item.display_name_fa || 'شرکت‌کننده'),
    company:           '',
    xp:                item.total_xp,
    profile_photo_url: item.profile_photo_url || null,
  }));

  const currentInList = levelRows.find(r => r.user_uuid === currentUserUuid);
  const cu = cache.currentUser;
  const showExtraMe = cu && !currentInList;

  return (
    <div className="space-y-2">
      {subTabBar}
      {levelRows.length === 0 ? (
        <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
          {lang === 'en' ? 'No users at this level yet' : 'هنوز کاربری در این سطح نیست'}
        </div>
      ) : (
        levelRows.map(user => (
          <LeaderboardRow
            key={user.rank}
            user={user}
            isMe={!!currentUserUuid && user.user_uuid === currentUserUuid}
            badgeColor={levelColor}
            badgeLabel={levelName}
            xpUnit={xpUnit}
            lang={lang}
          />
        ))
      )}
      {showExtraMe && (
        <>
          <div className="text-center text-xs py-1" style={{ color: "var(--text-dim)" }}>• • •</div>
          <LeaderboardRow
            key="current-user-extra"
            user={{
              rank:              cu.rank,
              user_uuid:         cu.user_uuid || currentUserUuid,
              name:              lang === 'en' ? (cu.display_name_en || cu.display_name_fa || 'شما') : (cu.display_name_fa || 'شما'),
              company:           '',
              xp:                cu.total_xp,
              profile_photo_url: cu.profile_photo_url || null,
            }}
            isMe={true}
            badgeColor={levelColor}
            badgeLabel={levelName}
            xpUnit={xpUnit}
            lang={lang}
          />
        </>
      )}
    </div>
  );
}

// Shown instead of MissionCard while missions are still loading.
function MissionCardSkeleton() {
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4 animate-pulse"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <div className="rounded-xl flex-shrink-0" style={{ width: 44, height: 44, background: "var(--border)" }} />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 rounded-full w-2/3" style={{ background: "var(--border)" }} />
        <div className="h-2.5 rounded-full w-1/2" style={{ background: "var(--border)" }} />
      </div>
    </div>
  );
}

function BadgeCard({ badge, onQuizClick, onFeaturedClick, onSurveyClick, onSocialShareClick, lang }) {
  const isQuiz = badge.badge_type === 'quiz';
  const isFeaturedBooth = badge.badge_type === 'featured_booth';
  const isSurvey = badge.badge_type === 'survey';
  const isSocialShare = badge.badge_type === 'social_share';
  const socialShareStatus = isSocialShare ? (badge.social_share_status || null) : null;
  const socialShareNote = isSocialShare ? (badge.social_share_note || null) : null;
  const quizClickable = isQuiz && !badge.earned && !badge.quiz_attempted && typeof onQuizClick === 'function';
  const surveyClickable = isSurvey && !badge.earned && !badge.survey_submitted && typeof onSurveyClick === 'function';
  const featuredClickable = isFeaturedBooth && typeof onFeaturedClick === 'function';
  const socialShareClickable = isSocialShare && !badge.earned && socialShareStatus !== 'pending' && typeof onSocialShareClick === 'function';

  const now = useLiveNow(isFeaturedBooth && !badge.earned);
  const countdownText = isFeaturedBooth
    ? featuredBoothCountdownText(badge.featured_booth_next_rotation, lang, now)
    : null;

  const handleBadgeClick = quizClickable ? () => onQuizClick(badge)
    : surveyClickable ? () => onSurveyClick(badge)
    : socialShareClickable ? () => onSocialShareClick(badge)
    : featuredClickable ? () => onFeaturedClick(badge)
    : undefined;

  return (
    <div
      onClick={handleBadgeClick}
      className={`rounded-2xl p-4 border text-center transition-colors ${
        (quizClickable || surveyClickable || socialShareClickable || featuredClickable) ? "cursor-pointer active:scale-[0.97]" : ""
      }`}
      style={badge.earned
        ? { borderColor: "var(--quest-active-border)", background: "var(--quest-active-bg)" }
        : { background: "var(--surface-2)", borderColor: "var(--border)", opacity: quizClickable || surveyClickable || socialShareClickable || isFeaturedBooth ? 1 : 0.5 }
      }
    >
      <div
        className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
        style={{ background: badge.earned ? "var(--quest-active-icon-bg)" : "var(--surface-hover)" }}
      >
        {badge.icon && badge.icon.startsWith('/') ? (
          <img src={badge.icon} alt="" style={{ width: badge.icon_size ?? 36, height: badge.icon_size ?? 36, objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: badge.icon_size ?? 36, lineHeight: 1 }}>{badge.icon}</span>
        )}
      </div>
      <p className="font-bold leading-6"
        style={{ fontSize: "var(--quest-badge-size)", color: badge.earned ? "var(--accent)" : "var(--quest-badge-color)" }}>
        {dNum(badge.name, lang)}
      </p>
      <p className="text-[11px] leading-5 mt-0.5" style={{ color: "var(--text-dim)" }}>
        {dNum(badge.description, lang)}
      </p>
      {badge.earned ? (
        <div
          className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          کسب شده
        </div>
      ) : isFeaturedBooth ? (
        <div className="mt-2 flex flex-col items-center gap-1">
          {countdownText && <p style={{ fontSize: "var(--quest-rotation-size)", color: "var(--quest-rotation-color)" }}>{countdownText}</p>}
          {featuredClickable && (
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
              {lang === 'fa' ? 'مشاهده غرفه‌ها ←' : 'See booths →'}
            </span>
          )}
        </div>
      ) : isQuiz && badge.quiz_attempted ? (
        <p className="mt-2 text-[11px]" style={{ color: "#f87171" }}>پاسخ داده شده</p>
      ) : isQuiz ? (
        <div className="mt-2">
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
            {lang === 'fa' ? 'شرکت کن ←' : 'Join →'}
          </span>
        </div>
      ) : isSurvey && badge.survey_submitted ? (
        <p className="mt-2 text-[11px] font-bold" style={{ color: "var(--accent)" }}>پاسخ داده شده ✓</p>
      ) : isSurvey ? (
        <div className="mt-2">
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
            {lang === 'fa' ? 'شرکت در نظرسنجی ←' : 'Take Survey →'}
          </span>
        </div>
      ) : isSocialShare ? (
        <div className="mt-2 flex flex-col items-center gap-0.5">
          {badge.earned || socialShareStatus === 'approved' ? (
            <p className="text-[11px] font-bold" style={{ color: "var(--accent)" }}>تایید شد ✅</p>
          ) : socialShareStatus === 'pending' ? (
            <p className="text-[11px] font-medium" style={{ color: '#f59e0b' }}>در انتظار بررسی ⏳</p>
          ) : socialShareStatus === 'rejected' ? (
            <>
              <p className="text-[11px] font-medium" style={{ color: '#f87171' }}>رد شد ❌</p>
              {socialShareNote && <p className="text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}>{socialShareNote}</p>}
              {socialShareClickable && (
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                  style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
                  {lang === 'fa' ? 'ارسال مجدد ←' : 'Resubmit →'}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)" }}>
              {lang === 'fa' ? 'اشتراک‌گذاری کن ←' : 'Share →'}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Shown instead of BadgeCard while badges are still loading.
function BadgeCardSkeleton() {
  return (
    <div
      className="rounded-2xl p-4 border text-center animate-pulse"
      style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
    >
      <div className="w-14 h-14 rounded-2xl mx-auto mb-3" style={{ background: "var(--border)" }} />
      <div className="h-3 rounded-full w-3/4 mx-auto mb-1.5" style={{ background: "var(--border)" }} />
      <div className="h-2.5 rounded-full w-full" style={{ background: "var(--border)" }} />
    </div>
  );
}

function BadgesTab({ badges, onQuizClick, onFeaturedClick, onSurveyClick, onSocialShareClick, lang }) {
  if (badges === null) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <BadgeCardSkeleton key={i} />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {badges.map((badge, idx) => (
        <BadgeCard
          key={badge.id ?? idx}
          badge={badge}
          onQuizClick={onQuizClick}
          onFeaturedClick={onFeaturedClick}
          onSurveyClick={onSurveyClick}
          onSocialShareClick={onSocialShareClick}
          lang={lang}
        />
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
  const src =
    parsed?.jpg?.['128'] || parsed?.jpg?.['64'] || parsed?.jpg?.['32'] ||
    parsed?.png?.['128'] || parsed?.png?.['64'] || parsed?.png?.['32'] ||
    parsed?.webp?.['128'] || parsed?.webp?.['64'] || parsed?.webp?.['32'] ||
    parsed?.['128'] || parsed?.['64'] || parsed?.['32'];
  if (!src) return null;
  return (baseUrl || '') + src;
}

// Per-item component so each booth logo tracks its own load error independently.
// On 404 (image exists in DB but missing on server), falls back to letter avatar.
function BoothLogo({ logoUrl, firstLetter }) {
  const [err, setErr] = useState(false);
  if (!logoUrl || err) {
    return (
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-dim)' }}>
        {firstLetter}
      </div>
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      onError={() => setErr(true)}
      style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'contain', background: '#fff', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)' }}
    />
  );
}

function useCooldownTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function getCooldownMinutes(lastScanAt, hours, now) {
  if (!lastScanAt) return null;
  const elapsed = now - new Date(lastScanAt).getTime();
  const cooldownMs = Math.max(1, hours || 1) * 60 * 60 * 1000;
  const remaining = cooldownMs - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 60000) : 0;
}

// dNum: apply Persian digits when lang==='fa', otherwise plain string
function dNum(n, lang) {
  if (n === null || n === undefined) return '';
  return lang === 'fa' ? toPersianDigits(n) : String(n);
}
// toPersianNum kept for callers that are already inside a lang==='fa' guard
function toPersianNum(n) { return toPersianDigits(n); }

// Smoothly counts displayed value from old to new when `target` changes.
// Renders 60fps via requestAnimationFrame; cleans up on unmount or re-trigger.
function useAnimatedCounter(target, duration = 800) {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);   // current rendered value (avoids stale closure)
  const rafRef = useRef(null);
  const prevTargetRef = useRef(target);

  useEffect(() => {
    if (target === prevTargetRef.current) return;
    prevTargetRef.current = target;

    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

    const from = displayRef.current;
    const diff = target - from;
    const startTime = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - t) ** 3; // cubic ease-out
      const val = Math.round(from + diff * eased);
      displayRef.current = val;
      setDisplay(val);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [target, duration]);

  return display;
}

function repeatRuleLabel(booth, lang) {
  const hours = booth.repeatable_scan_hours || 1;
  const startH = booth.repeatable_start_hour ?? 0;
  const endH = booth.repeatable_end_hour ?? 24;
  const isFullDay = startH === 0 && endH >= 24;
  if (lang === 'fa') {
    const h = toPersianNum(hours);
    if (isFullDay) return `🔄 هر ${h} ساعت`;
    return `🔄 هر ${h} ساعت (${toPersianNum(startH)} تا ${toPersianNum(endH)})`;
  }
  if (isFullDay) return `🔄 Every ${hours}h`;
  return `🔄 Every ${hours}h (${startH}:00–${endH}:00)`;
}

function BoothsBottomSheet({ open, onClose, title, isRTL, lang, booths, scannedIds, boothsLoading, logoBaseUrl, xpUnit, featuredBoothPoolIds }) {
  const [visible, setVisible] = useState(false);
  const now = useCooldownTick();

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
    <div className="fixed inset-0 z-[200] flex items-end justify-center">
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
            const cooldownMins = booth.repeatable_scan
              ? getCooldownMinutes(booth.last_scan_at, booth.repeatable_scan_hours, now)
              : null;
            return (
              <div
                key={booth.id}
                className="flex items-center gap-3 rounded-2xl px-3 py-2.5 border transition-colors"
                style={scanned
                  ? { background: "color-mix(in srgb, var(--accent) 5%, transparent)", borderColor: "color-mix(in srgb, var(--accent) 20%, transparent)" }
                  : { background: "var(--surface-2)", opacity: 0.7, borderColor: "var(--border)" }}
              >
                {/* Logo or initial — BoothLogo handles onError fallback */}
                <BoothLogo logoUrl={logoUrl} firstLetter={firstLetter} />

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
                      {lang === 'fa' ? 'سالن' : 'Hall'} {dNum(booth.hall_name, lang)}
                      {booth.booth_no && <> • {lang === 'fa' ? 'غرفه' : 'Booth'} {dNum(booth.booth_no, lang)}</>}
                    </div>
                  )}
                  {booth.repeatable_scan && (
                    cooldownMins !== null && cooldownMins > 0 ? (
                      <div className="text-[10px] leading-4 mt-0.5" style={{ color: "#f59e0b" }}>
                        {lang === 'fa' ? `🔄 بازنشانی: ${toPersianNum(cooldownMins)} دقیقه دیگر` : `🔄 Resets in ${cooldownMins} min`}
                      </div>
                    ) : (
                      <div className="text-[10px] leading-4 mt-0.5" style={{ color: cooldownMins === 0 ? "var(--accent)" : "var(--text-dim)" }}>
                        {repeatRuleLabel(booth, lang)}
                        {cooldownMins === 0 && (lang === 'fa' ? ' ✓' : ' ✓')}
                      </div>
                    )
                  )}
                </div>

                {/* XP — hidden for featured_booth pool booths to avoid spoiling the treasure hunt */}
                {!featuredBoothPoolIds?.has(booth.id) && (
                  <span className="text-xs font-bold flex-shrink-0" style={{ color: "var(--accent)" }}>
                    {lang === 'fa'
                      ? `${dNum(booth.xp, lang)}+ ${xpUnit || "XP"}`
                      : (<>+{dNum(booth.xp, lang)} {xpUnit || "XP"}</>)}
                  </span>
                )}

                {/* Scanned indicator */}
                <div
                  className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                  style={{ background: scanned ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "var(--surface-hover)" }}
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

// ── Featured Booth Pool Sheet ──────────────────────────────────────────────

function FeaturedBoothPoolSheet({ open, onClose, item, isRTL, lang, logoBaseUrl }) {
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

  const companies = item?.featured_booth_pool_companies || [];
  const isBadge = !!item?.isFeaturedBadge;
  const itemTitle = item?.title || item?.name || (lang === 'fa' ? 'غرفه‌های این ماموریت' : 'Mission Booths');

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center">
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
          <div>
            <h2 className="font-bold text-base leading-7" style={{ color: "var(--text)" }}>
              {lang === 'fa' ? (isBadge ? 'غرفه‌های این بج' : 'غرفه‌های این ماموریت') : (isBadge ? 'Badge Booths' : 'Mission Booths')}
            </h2>
            <p className="text-xs leading-5" style={{ color: "var(--text-dim)" }}>{itemTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-hover)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              strokeWidth="2.5" strokeLinecap="round" stroke="currentColor">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto max-h-[65vh] px-4 pt-3 pb-8">
          {/* Framing message — tells user what to do without revealing the active booth */}
          <div className="mb-3 px-1 py-2.5 rounded-xl text-xs leading-6"
            style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)", color: "var(--text-dim)", borderRight: isRTL ? "3px solid color-mix(in srgb, var(--accent) 30%, transparent)" : "none", borderLeft: !isRTL ? "3px solid color-mix(in srgb, var(--accent) 30%, transparent)" : "none", paddingRight: isRTL ? 10 : 6, paddingLeft: !isRTL ? 10 : 6 }}>
            {lang === 'fa'
              ? 'یکی از این غرفه‌ها به‌صورت تصادفی انتخاب شده — غرفه فعال را با اسکن QR هر کدام پیدا کن.'
              : 'One of these booths is randomly selected as the active target — find it by scanning the QR code of each.'}
          </div>

          <div className="space-y-2">
            {companies.length === 0 ? (
              <div className="text-center py-8 text-sm" style={{ color: "var(--text-dim)" }}>
                {lang === 'fa' ? 'غرفه‌ای در این استخر ثبت نشده' : 'No booths in this pool'}
              </div>
            ) : companies.map((c) => {
              const name = lang === 'fa'
                ? (c.brand_name_fa || c.brand_name_en || '—')
                : (c.brand_name_en || c.brand_name_fa || '—');
              const logoUrl = getLogoUrl(c.logo, logoBaseUrl);
              const firstLetter = (c.brand_name_fa || c.brand_name_en || '؟').charAt(0);
              const gotBonus = !!c.user_got_bonus;
              const scanned  = !!c.user_scanned;
              return (
                <div key={c.company_id}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 border"
                  style={
                    gotBonus
                      ? { background: "rgba(251,191,36,0.07)", borderColor: "rgba(251,191,36,0.35)" }
                      : scanned
                        ? { background: "color-mix(in srgb, var(--accent) 5%, transparent)", borderColor: "color-mix(in srgb, var(--accent) 20%, transparent)" }
                        : { background: "var(--surface-2)", borderColor: "var(--border)" }
                  }
                >
                  <BoothLogo logoUrl={logoUrl} firstLetter={firstLetter} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium leading-6 truncate" style={{ color: "var(--text)" }}>
                        {name}
                      </span>
                      {gotBonus && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "rgba(251,191,36,0.18)", color: "#fbbf24" }}>
                          {lang === 'fa' ? '🎉 جایزه گرفتی!' : '🎉 Bonus earned!'}
                        </span>
                      )}
                    </div>
                    {(c.hall_name || c.booth_no) && (
                      <div className="text-[11px] leading-4" style={{ color: "var(--text-dim)" }}>
                        {c.hall_name && <>{lang === 'fa' ? 'سالن' : 'Hall'} {dNum(c.hall_name, lang)}</>}
                        {c.hall_name && c.booth_no && <> • </>}
                        {c.booth_no && <>{lang === 'fa' ? 'غرفه' : 'Booth'} {dNum(c.booth_no, lang)}</>}
                      </div>
                    )}
                  </div>
                  {/* Scan status indicator */}
                  {gotBonus ? (
                    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-base"
                      style={{ background: "rgba(251,191,36,0.18)" }}>
                      ⭐
                    </div>
                  ) : scanned ? (
                    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                      style={{ background: "color-mix(in srgb, var(--accent) 15%, transparent)" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                        style={{ stroke: "var(--accent)" }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quiz Modal ─────────────────────────────────────────────────────────────

function QuizModal({ quiz, onClose, onComplete, lang }) {
  const [phase, setPhase] = useState(quiz?.quiz_hint_type && quiz.quiz_hint_type !== 'none' ? 'hint' : 'question');
  const [videoEnded, setVideoEnded] = useState(false);
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // null | 'correct' | 'wrong' | 'already'

  const isRTL = lang === 'fa';
  const hasHint = quiz?.quiz_hint_type && quiz.quiz_hint_type !== 'none';
  const hintUrl = quiz?.quiz_hint_url;

  const question = lang === 'en' ? (quiz?.quiz_question_en || quiz?.quiz_question_fa) : quiz?.quiz_question_fa;
  const options = lang === 'en'
    ? (Array.isArray(quiz?.quiz_options_en) && quiz.quiz_options_en.length === 4 ? quiz.quiz_options_en : quiz?.quiz_options_fa)
    : quiz?.quiz_options_fa;

  async function handleSubmit() {
    if (selected === null || submitting || result) return;
    setSubmitting(true);
    try {
      const body = quiz.isBadge
        ? { badgeId: quiz.id, selectedIndex: selected }
        : { missionId: quiz.id, selectedIndex: selected };
      const res = await fetch('/api/quest/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error === 'already_attempted') {
        setResult('already');
      } else {
        setResult(data.correct ? 'correct' : 'wrong');
        if (data.correct && onComplete) onComplete();
      }
    } catch {
      setResult('wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={result ? onClose : undefined} />
      <div
        className="relative w-full max-w-md rounded-t-3xl border-t border-x border-[var(--border-accent)] pb-10 overflow-hidden"
        style={{ background: "var(--sheet-bg)", maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-bold text-base" style={{ color: "var(--text)" }}>
            {lang === 'fa' ? 'سؤال چهارگزینه‌ای' : 'Quiz'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Hint phase */}
        {phase === 'hint' && hasHint && (
          <div className="px-5 pb-4">
            {quiz.quiz_hint_type === 'image' ? (
              <img src={hintUrl} alt="" className="w-full rounded-2xl mb-4 object-contain max-h-64" />
            ) : quiz.quiz_hint_type === 'video' ? (
              <div className="relative mb-4">
                <video
                  src={hintUrl}
                  className="w-full rounded-2xl"
                  autoPlay
                  playsInline
                  controlsList="nodownload nofullscreen noremoteplayback"
                  onEnded={() => setVideoEnded(true)}
                  style={{ pointerEvents: videoEnded ? 'auto' : 'none' }}
                />
                {!videoEnded && (
                  <div className="absolute bottom-2 right-2 text-xs px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.6)' }}>
                    {lang === 'fa' ? 'تا پایان ویدیو صبر کنید' : 'Watch until end'}
                  </div>
                )}
              </div>
            ) : null}
            <p className="font-bold text-sm leading-7 mb-4" style={{ color: "var(--text)" }}>
              {question}
            </p>
            <button
              onClick={() => setPhase('question')}
              disabled={quiz.quiz_hint_type === 'video' && !videoEnded}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all"
              style={{
                background: (quiz.quiz_hint_type === 'video' && !videoEnded) ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--accent)',
                color: (quiz.quiz_hint_type === 'video' && !videoEnded) ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--bg)',
              }}
            >
              {lang === 'fa' ? 'ادامه' : 'Continue'}
            </button>
          </div>
        )}

        {/* Question phase */}
        {phase === 'question' && !result && (
          <div className="px-5 pb-4">
            <p className="font-bold text-sm leading-7 mb-4" style={{ color: "var(--text)" }}>
              {question}
            </p>
            <div className="space-y-2.5 mb-5">
              {Array.isArray(options) && options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  className="w-full text-right px-4 py-3 rounded-xl border text-sm font-medium transition-all"
                  style={{
                    borderColor: selected === i ? 'var(--accent)' : 'var(--border)',
                    background: selected === i ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-2)',
                    color: selected === i ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
            <button
              onClick={handleSubmit}
              disabled={selected === null || submitting}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all"
              style={{
                background: selected === null ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--accent)',
                color: selected === null ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--bg)',
              }}
            >
              {submitting ? '…' : (lang === 'fa' ? 'ثبت پاسخ' : 'Submit')}
            </button>
          </div>
        )}

        {/* Result phase */}
        {result && (
          <div className="px-5 pb-4 text-center">
            {result === 'correct' ? (
              <>
                <div className="text-5xl mb-3">🎉</div>
                <p className="font-black text-xl mb-1" style={{ color: 'var(--accent)' }}>
                  {lang === 'fa' ? 'درست بود!' : 'Correct!'}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                  {lang === 'fa' ? 'مأموریت تکمیل شد و امتیاز اعطا شد' : 'Mission completed and XP awarded'}
                </p>
              </>
            ) : result === 'already' ? (
              <>
                <div className="text-5xl mb-3">🔒</div>
                <p className="font-bold text-lg mb-1" style={{ color: '#fbbf24' }}>
                  {lang === 'fa' ? 'قبلاً پاسخ داده‌اید' : 'Already answered'}
                </p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-3">❌</div>
                <p className="font-bold text-xl mb-1" style={{ color: '#f87171' }}>
                  {lang === 'fa' ? 'اشتباه' : 'Incorrect'}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                  {lang === 'fa' ? 'فقط یک بار می‌توانید پاسخ دهید — این مأموریت قفل شد' : 'You can only answer once — this mission is now locked'}
                </p>
              </>
            )}
            <button
              onClick={onClose}
              className="mt-5 w-full py-3 rounded-xl font-bold text-sm"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              {lang === 'fa' ? 'بستن' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Survey Modal ───────────────────────────────────────────────────────────

function SurveyModal({ survey, onClose, onComplete, lang }) {
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // null | 'ok' | 'already' | 'error'
  const [validationErr, setValidationErr] = useState('');

  const isRTL = lang === 'fa';
  const fields = Array.isArray(survey?.survey_fields) ? survey.survey_fields : [];

  function setAnswer(fieldId, value) {
    setAnswers(prev => ({ ...prev, [fieldId]: value }));
  }

  function toggleCheckbox(fieldId, option) {
    setAnswers(prev => {
      const cur = Array.isArray(prev[fieldId]) ? prev[fieldId] : [];
      return { ...prev, [fieldId]: cur.includes(option) ? cur.filter(o => o !== option) : [...cur, option] };
    });
  }

  function validate() {
    for (const field of fields) {
      if (field.type === 'description') continue;
      if (field.required) {
        const val = answers[field.id];
        if (field.type === 'checkbox') {
          if (!Array.isArray(val) || val.length === 0) {
            return lang === 'fa' ? 'لطفاً تمام فیلدهای اجباری را پر کنید' : 'Please fill all required fields';
          }
        } else {
          if (!val || (typeof val === 'string' && !val.trim())) {
            return lang === 'fa' ? 'لطفاً تمام فیلدهای اجباری را پر کنید' : 'Please fill all required fields';
          }
        }
      }
    }
    return null;
  }

  async function handleSubmit() {
    if (submitting || result) return;
    const err = validate();
    if (err) { setValidationErr(err); return; }
    setValidationErr('');
    setSubmitting(true);
    try {
      const body = survey.isBadge
        ? { badgeId: survey.id, answers }
        : { missionId: survey.id, answers };
      const res = await fetch('/api/quest/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error === 'already_submitted') {
        setResult('already');
      } else if (!res.ok) {
        setResult('error');
      } else {
        setResult('ok');
        if (onComplete) onComplete();
      }
    } catch {
      setResult('error');
    } finally {
      setSubmitting(false);
    }
  }

  const title = lang === 'en'
    ? (survey?.title_en || survey?.title || 'Survey')
    : (survey?.title || 'نظرسنجی');

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={result ? onClose : undefined} />
      <div
        className="relative w-full max-w-md rounded-t-3xl border-t border-x border-[var(--border-accent)] pb-10 overflow-hidden"
        style={{ background: "var(--sheet-bg)", maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[var(--border)]">
          <h2 className="font-bold text-base" style={{ color: "var(--text)" }}>
            📋 {title}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--surface-2)", color: "var(--text-dim)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {result ? (
          <div className="px-5 py-8 text-center">
            {result === 'ok' ? (
              <>
                <div className="text-5xl mb-3">✅</div>
                <p className="font-black text-xl mb-1" style={{ color: 'var(--accent)' }}>
                  {lang === 'fa' ? 'ممنون از پاسخ شما!' : 'Thank you!'}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                  {lang === 'fa' ? 'پاسخ‌های شما ثبت شد و مأموریت تکمیل گردید' : 'Your answers were recorded and the mission completed'}
                </p>
              </>
            ) : result === 'already' ? (
              <>
                <div className="text-5xl mb-3">🔒</div>
                <p className="font-bold text-lg mb-1" style={{ color: '#fbbf24' }}>
                  {lang === 'fa' ? 'قبلاً پاسخ داده‌اید' : 'Already submitted'}
                </p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-3">⚠️</div>
                <p className="font-bold text-lg mb-1" style={{ color: '#f87171' }}>
                  {lang === 'fa' ? 'خطا در ثبت پاسخ' : 'Submission error'}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                  {lang === 'fa' ? 'لطفاً دوباره امتحان کنید' : 'Please try again'}
                </p>
              </>
            )}
            <button
              onClick={onClose}
              className="mt-6 w-full py-3 rounded-xl font-bold text-sm"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              {lang === 'fa' ? 'بستن' : 'Close'}
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5">
            {fields.map((field) => {
              const labelText = lang === 'en'
                ? (field.label_en || field.label_fa)
                : field.label_fa;
              const options = lang === 'en'
                ? (Array.isArray(field.options_en) && field.options_en.length > 0 ? field.options_en : field.options_fa)
                : field.options_fa;
              const descText = lang === 'en'
                ? (field.description_text_en || field.description_text_fa)
                : field.description_text_fa;

              if (field.type === 'description') {
                return (
                  <div key={field.id} className="rounded-xl px-4 py-3 text-sm leading-7"
                    style={{ background: 'color-mix(in srgb, var(--accent) 5%, transparent)', borderLeft: isRTL ? 'none' : '3px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRight: isRTL ? '3px solid color-mix(in srgb, var(--accent) 30%, transparent)' : 'none', paddingLeft: isRTL ? 14 : 10, paddingRight: isRTL ? 10 : 14, color: 'var(--text-dim)' }}>
                    {descText}
                  </div>
                );
              }

              return (
                <div key={field.id}>
                  <label className="block text-sm font-semibold mb-2 leading-6" style={{ color: 'var(--text)' }}>
                    {labelText}
                    {field.required && <span className="mr-1" style={{ color: '#f87171' }}>*</span>}
                  </label>

                  {field.type === 'text' && (
                    <input
                      type="text"
                      value={answers[field.id] || ''}
                      onChange={e => setAnswer(field.id, e.target.value)}
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-colors"
                      style={{
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)',
                      }}
                      onFocus={e => { e.target.style.borderColor = 'color-mix(in srgb, var(--accent) 40%, transparent)'; }}
                      onBlur={e => { e.target.style.borderColor = 'var(--border)'; }}
                    />
                  )}

                  {field.type === 'radio' && Array.isArray(options) && (
                    <div className="space-y-2">
                      {options.map((opt, i) => {
                        const selected = answers[field.id] === opt;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setAnswer(field.id, opt)}
                            className="w-full text-right px-4 py-3 rounded-xl border text-sm font-medium transition-all"
                            style={{
                              borderColor: selected ? 'var(--accent)' : 'var(--border)',
                              background: selected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-2)',
                              color: selected ? 'var(--accent)' : 'var(--text)',
                              textAlign: isRTL ? 'right' : 'left',
                            }}
                          >
                            <span className="inline-block w-3.5 h-3.5 rounded-full border-2 ml-2 flex-shrink-0 align-middle transition-all"
                              style={{
                                borderColor: selected ? 'var(--accent)' : 'var(--text-faint)',
                                background: selected ? 'var(--accent)' : 'transparent',
                                marginLeft: isRTL ? 0 : 8,
                                marginRight: isRTL ? 8 : 0,
                              }} />
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {field.type === 'checkbox' && Array.isArray(options) && (
                    <div className="space-y-2">
                      {options.map((opt, i) => {
                        const checked = Array.isArray(answers[field.id]) && answers[field.id].includes(opt);
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => toggleCheckbox(field.id, opt)}
                            className="w-full text-right px-4 py-3 rounded-xl border text-sm font-medium transition-all"
                            style={{
                              borderColor: checked ? 'var(--accent)' : 'var(--border)',
                              background: checked ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-2)',
                              color: checked ? 'var(--accent)' : 'var(--text)',
                              textAlign: isRTL ? 'right' : 'left',
                            }}
                          >
                            <span className="inline-block w-3.5 h-3.5 rounded border-2 flex-shrink-0 align-middle transition-all"
                              style={{
                                borderColor: checked ? 'var(--accent)' : 'var(--text-faint)',
                                background: checked ? 'var(--accent)' : 'transparent',
                                marginLeft: isRTL ? 0 : 8,
                                marginRight: isRTL ? 8 : 0,
                              }} />
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {validationErr && (
              <div className="text-sm px-4 py-2.5 rounded-xl" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}>
                {validationErr}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all"
              style={{
                background: submitting ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--accent)',
                color: submitting ? 'rgba(2,31,32,0.5)' : 'var(--bg)',
              }}
            >
              {submitting ? '…' : (lang === 'fa' ? 'ثبت پاسخ' : 'Submit')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Social Share Modal ─────────────────────────────────────────────────────

const PLATFORMS = ['Instagram', 'Telegram', 'WhatsApp', 'Other'];
const PLATFORM_FA = { Instagram: 'اینستاگرام', Telegram: 'تلگرام', WhatsApp: 'واتساپ', Other: 'سایر' };

function isValidUrl(s) {
  return typeof s === 'string' && /^https?:\/\/.{2,}\..{2,}/.test(s.trim());
}

function SocialShareModal({ share, onClose, onComplete, lang }) {
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('');
  const [state, setState] = useState('idle'); // 'idle'|'submitting'|'submitted'|'error'
  const [errorMsg, setErrorMsg] = useState('');
  const isRTL = lang === 'fa';

  async function handleSubmit() {
    if (!isValidUrl(url)) {
      setErrorMsg(isRTL ? 'لینک معتبر نیست. باید با https:// شروع شود.' : 'Invalid URL. Must start with https://');
      return;
    }
    setErrorMsg('');
    setState('submitting');
    try {
      const body = share.isBadge
        ? { badgeId: share.id, link_url: url.trim(), platform: platform || null }
        : { missionId: share.id, link_url: url.trim(), platform: platform || null };
      const res = await fetch('/api/quest/social-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'already_pending') {
          setState('error');
          setErrorMsg(isRTL ? 'لینک قبلی شما هنوز در انتظار بررسی است.' : 'Your previous link is still pending review.');
        } else if (data.error === 'already_approved') {
          setState('error');
          setErrorMsg(isRTL ? 'این ماموریت قبلاً تایید شده.' : 'Already approved.');
        } else {
          setState('error');
          setErrorMsg(data.error || (isRTL ? 'خطا' : 'Error'));
        }
      } else {
        setState('submitted');
        onComplete?.();
      }
    } catch {
      setState('error');
      setErrorMsg(isRTL ? 'خطای شبکه. دوباره امتحان کنید.' : 'Network error. Try again.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) { onClose(); } }}
    >
      <div
        className="w-full max-w-lg rounded-t-3xl p-6 pb-10"
        style={{ background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)', borderBottom: 'none' }}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--border)' }} />

        {state === 'submitted' ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-4">⏳</div>
            <div className="text-base font-bold mb-2" style={{ color: 'var(--accent)' }}>
              {isRTL ? 'لینک شما دریافت شد!' : 'Link received!'}
            </div>
            <div className="text-sm leading-7" style={{ color: 'var(--text-muted)' }}>
              {isRTL
                ? 'لینک شما ثبت شد و در انتظار بررسی ادمین است. در صورت تایید، امتیاز به حساب شما اضافه می‌شود.'
                : 'Your link was submitted and is pending admin review. XP will be awarded upon approval.'}
            </div>
            <button
              onClick={onClose}
              className="mt-5 px-6 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              {isRTL ? 'باشه' : 'OK'}
            </button>
          </div>
        ) : (
          <>
            <div className="text-base font-bold mb-1" style={{ color: 'var(--text)' }}>
              {isRTL ? '📤 اشتراک‌گذاری شبکه اجتماعی' : '📤 Social Share'}
            </div>
            <div className="text-xs mb-5 leading-6" style={{ color: 'var(--text-muted)' }}>
              {isRTL
                ? 'لینک پست/استوری خود را که مرتبط با IranPharma است وارد کنید.'
                : 'Enter the link to your IranPharma-related post or story.'}
            </div>

            <div className="mb-4">
              <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                {isRTL ? 'لینک پست *' : 'Post link *'}
              </label>
              <input
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setErrorMsg(''); }}
                placeholder="https://www.instagram.com/p/..."
                dir="ltr"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  textAlign: 'left',
                }}
              />
            </div>

            <div className="mb-5">
              <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-muted)' }}>
                {isRTL ? 'پلتفرم (اختیاری)' : 'Platform (optional)'}
              </label>
              <div className="flex gap-2 flex-wrap">
                {PLATFORMS.map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(platform === p ? '' : p)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                    style={{
                      background: platform === p ? 'var(--accent)' : 'var(--surface-2)',
                      color: platform === p ? 'var(--bg)' : 'var(--text-muted)',
                      border: `1px solid ${platform === p ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    {isRTL ? PLATFORM_FA[p] : p}
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && (
              <div className="mb-4 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={state === 'submitting'}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all"
              style={{
                background: state === 'submitting' ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'var(--accent)',
                color: state === 'submitting' ? 'rgba(2,31,32,0.5)' : 'var(--bg)',
              }}
            >
              {state === 'submitting' ? '…' : (isRTL ? 'ارسال لینک' : 'Submit link')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main client component ───────────────────────────────────────────────────

export default function QuestClient({ content, title, subtitle, title_en, subtitle_en, isHomeContext = false, appearanceConfig = {} }) {
  const [boothsOpen, setBoothsOpen] = useState(false);
  const [openFeaturedPool, setOpenFeaturedPool] = useState(null);
  const [activeTab, setActiveTab] = useState("missions");
  const [isDark, setIsDark] = useState(true);
  const { lang, isRTL } = useLang();
  const [openQuiz, setOpenQuiz] = useState(null);
  const [openSurvey, setOpenSurvey] = useState(null);
  const [openSocialShare, setOpenSocialShare] = useState(null);

  const [booths, setBooths] = useState([]);
  const [scannedIds, setScannedIds] = useState(new Set());
  const [boothsLoading, setBoothsLoading] = useState(true);
  const [logoBaseUrl, setLogoBaseUrl] = useState('');

  const [questStats, setQuestStats] = useState(null);
  const [liveMissions, setLiveMissions] = useState(null);
  const [liveBadges, setLiveBadges] = useState(null);
  const [liveLeaderboard, setLiveLeaderboard] = useState(null);
  const [currentUserUuid, setCurrentUserUuid] = useState(null);
  const [currentUserRank, setCurrentUserRank] = useState(null);
  const [liveLevels, setLiveLevels] = useState(null);

  // Each flips true once its fetch SETTLES (success or failure) — distinct
  // from the live-data state being null, which also covers "still loading".
  // Without this, the FALLBACK_* constants below render as real content
  // during the loading window instead of only on genuine fetch failure.
  const [statsReady, setStatsReady] = useState(false);
  const [missionsReady, setMissionsReady] = useState(false);
  const [badgesReady, setBadgesReady] = useState(false);
  const [levelsReady, setLevelsReady] = useState(false);

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
      .catch(() => {})
      .finally(() => setStatsReady(true));
  }, []);

  useEffect(() => {
    fetch('/api/quest')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.missions)) setLiveMissions(d.missions); })
      .catch(() => {})
      .finally(() => setMissionsReady(true));
  }, []);

  useEffect(() => {
    fetch('/api/quest/badges')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.badges)) setLiveBadges(d.badges); })
      .catch(() => {})
      .finally(() => setBadgesReady(true));
  }, []);

  useEffect(() => {
    fetch('/api/quest/leaderboard')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.leaderboard)) setLiveLeaderboard(d.leaderboard);
        if (d.currentUser) {
          setCurrentUserUuid(d.currentUser.user_uuid);
          setCurrentUserRank(d.currentUser.rank);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/quest/levels')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.levels) && d.levels.length > 0) setLiveLevels(d.levels); })
      .catch(() => {})
      .finally(() => setLevelsReady(true));
  }, []);

  const c = useMemo(() => ({
    ...(content?.main || {}),
    ...(lang === 'en' ? (content?.main_en || {}) : {}),
  }), [content?.main, content?.main_en, lang]);

  // null = levels fetch hasn't settled yet (loading) — callers must show a
  // skeleton, not FALLBACK_LEVELS, during this window.
  const levelThresholds = useMemo(() => {
    if (!levelsReady) return null;
    const source = liveLevels && liveLevels.length > 0 ? liveLevels : FALLBACK_LEVELS;
    return source.map(l => ({
      name: lang === 'en' ? (l.name_en || l.name_fa) : l.name_fa,
      icon: l.icon_value,
      iconSize: l.icon_size ?? 14,
      min: l.min_xp,
      max: l.max_xp !== null && l.max_xp !== undefined ? l.max_xp : Infinity,
      color: l.color || '#64748b',
    }));
  }, [levelsReady, liveLevels, lang]);

  const levelColors = useMemo(() => levelThresholds?.map(l => l.color) ?? [], [levelThresholds]);

  // Set of company IDs that are in any active featured_booth mission's pool.
  // Used to suppress XP display for these booths in the general booth list.
  const featuredBoothPoolIds = useMemo(() => {
    const ids = new Set();
    if (liveMissions) {
      for (const m of liveMissions) {
        if (m.mission_type === 'featured_booth' && Array.isArray(m.featured_booth_pool_companies)) {
          for (const c of m.featured_booth_pool_companies) {
            ids.add(c.company_id);
          }
        }
      }
    }
    return ids;
  }, [liveMissions]);

  // null = missions fetch hasn't settled yet AND no SSR-provided CMS content
  // exists to show immediately — callers must show a skeleton, not
  // FALLBACK_MISSIONS, during this window.
  const missions = useMemo(() => {
    // Prefer live missions from /api/quest (real DB + real progress)
    if (liveMissions && liveMissions.length > 0) {
      return liveMissions.map(m => ({
        ...m,
        title: lang === 'en' ? (m.title_en || m.title) : m.title,
        description: lang === 'en' ? (m.description_en || m.description) : m.description,
      }));
    }
    // Fall back to static CMS blocks if present (SSR-provided, no flash)
    if (content?.missions?.length > 0) return content.missions;
    if (!missionsReady) return null;
    return FALLBACK_MISSIONS;
  }, [liveMissions, content?.missions, missionsReady, lang]);

  const leaderboard = useMemo(() => {
    // Needs levelThresholds to compute each user's level name — wait for it too.
    if (!levelThresholds) return null;
    if (liveLeaderboard && liveLeaderboard.length > 0) {
      return liveLeaderboard.map((item) => {
        const { current } = getXpProgress(item.total_xp, levelThresholds);
        const name = lang === 'en'
          ? (item.display_name_en || item.display_name_fa)
          : item.display_name_fa;
        return {
          rank:              item.rank,
          user_uuid:         item.user_uuid,
          name:              name || 'شرکت‌کننده',
          company:           '',
          xp:                item.total_xp,
          level:             current.name,
          profile_photo_url: item.profile_photo_url || null,
        };
      });
    }
    // null = fetch not yet complete; [] = fetched, no users yet
    return liveLeaderboard === null ? null : [];
  }, [liveLeaderboard, lang, levelThresholds]);
  // null = badges fetch hasn't settled yet AND no SSR-provided CMS content
  // exists to show immediately — callers must show a skeleton, not
  // FALLBACK_BADGES, during this window.
  const badges = useMemo(() => {
    if (liveBadges && liveBadges.length > 0) {
      return liveBadges.map(b => ({
        ...b,
        name: lang === 'en' ? (b.name_en || b.name_fa) : b.name_fa,
        description: lang === 'en' ? (b.description_en || b.description_fa) : b.description_fa,
      }));
    }
    if (content?.badges?.length > 0) return content.badges;
    if (!badgesReady) return null;
    return FALLBACK_BADGES;
  }, [liveBadges, content?.badges, badgesReady, lang]);

  const tabs = useMemo(() => [
    { id: "missions",    icon: iconOf(c.icon_tab_missions)    || "🎯", iconSize: iconSizeOf(c.icon_tab_missions,    18), text: c.tab_missions    || "مأموریت‌ها" },
    { id: "leaderboard", icon: iconOf(c.icon_tab_leaderboard) || "🏅", iconSize: iconSizeOf(c.icon_tab_leaderboard, 18), text: c.tab_leaderboard || "لیدربورد"   },
    { id: "badges",      icon: iconOf(c.icon_tab_badges)      || "🎖️", iconSize: iconSizeOf(c.icon_tab_badges,      18), text: c.tab_badges      || "بج‌ها"      },
  ], [c]);

  const labels = useMemo(() => ({
    userCardLabel:      c.user_card_label      || "کاربر",
    xpLabel:            c.xp_label             || "امتیاز فعلی",
    xpUnit:             c.xp_unit              || "XP",
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

  // Merge saved appearance config on top of per-theme defaults
  const effectiveAppearance = useMemo(() => {
    const themeKey = isDark ? 'dark' : 'light';
    const defaults = APPEARANCE_DEFAULTS[themeKey];
    const saved = appearanceConfig?.[themeKey] ?? {};
    return { ...defaults, ...saved };
  }, [isDark, appearanceConfig]);

  // Global, theme-independent — read straight off the SSR-provided
  // appearanceConfig prop (page.js), so it's available on first render with
  // no loading window and therefore no circle/no-circle flash.
  const showLevelCircle = appearanceConfig?.show_level_circle !== false;

  const refreshQuest = useCallback(() => {
    // Stats included so XP/level (UserCard's useAnimatedCounter) update in the same
    // pass as missions/badges — this is called right after a quiz/survey/social-share
    // action completes, not just from the 45s poll, so it must carry XP too.
    fetch('/api/quest/stats').then(r => r.json()).then(d => setQuestStats(prev => (prev ? { ...prev, ...d } : d))).catch(() => {});
    fetch('/api/quest').then(r => r.json()).then(d => { if (Array.isArray(d.missions)) setLiveMissions(d.missions); }).catch(() => {});
    fetch('/api/quest/badges').then(r => r.json()).then(d => { if (Array.isArray(d.badges)) setLiveBadges(d.badges); }).catch(() => {});
  }, []);

  // ── Live XP/mission polling (45 s interval) ───────────────────────────────
  // Uses Page Visibility API to pause when tab is hidden and immediately re-fetch
  // when the user returns, so stale data is never shown on tab switch-back.
  // Polls /api/quest/stats (lightweight: 3 DB queries) to detect XP/scan changes;
  // triggers refreshQuest() (missions + badges) whenever something changed.
  useEffect(() => {
    let mounted = true;
    let timerId = null;

    async function pollNow() {
      if (!mounted) return;
      try {
        const r = await fetch('/api/quest/stats');
        if (!r.ok || !mounted) return;
        const data = await r.json();
        if (!mounted) return;
        // Update XP/stats; compare against current to decide if missions need refresh.
        setQuestStats(prev => {
          if (!prev) return data;
          const xpChanged = data.xp !== prev.xp;
          const scansChanged = data.total_scans !== prev.total_scans;
          if (xpChanged || scansChanged) {
            // Defer so we're not calling side effects inside a state setter.
            Promise.resolve().then(() => { if (mounted) refreshQuest(); });
          }
          return { ...prev, ...data };
        });
      } catch {}
    }

    function schedule() {
      timerId = setTimeout(async () => {
        if (!mounted) return;
        await pollNow();
        if (mounted) schedule();
      }, 45_000);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        clearTimeout(timerId);
        timerId = null;
      } else {
        // Immediate refetch so returning users see fresh data right away.
        pollNow();
        schedule();
      }
    }

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted = false;
      clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshQuest]);

  const missionList = useMemo(
    () => (missions ?? []).map((m, i) => (
      <MissionCard
        key={m.id ?? i}
        mission={m}
        xpUnit={labels.xpUnit}
        lang={lang}
        onQuizClick={m.mission_type === 'quiz' ? () => setOpenQuiz({ ...m, isBadge: false }) : undefined}
        onSurveyClick={m.mission_type === 'survey' ? () => setOpenSurvey({ ...m, isBadge: false }) : undefined}
        onSocialShareClick={m.mission_type === 'social_share' ? () => setOpenSocialShare({ ...m, isBadge: false }) : undefined}
        onFeaturedClick={m.mission_type === 'featured_booth' ? () => setOpenFeaturedPool(m) : undefined}
      />
    )),
    [missions, labels.xpUnit, lang]
  );

  const ea = effectiveAppearance;
  const activeBorderColor = ea.active_border_color || 'var(--accent)';

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="min-h-screen"
      style={{
        background: "var(--bg)",
        color: "var(--text)",
        '--quest-title-size':    (ea.mission_title_size    || 14) + 'px',
        '--quest-title-color':    ea.mission_title_color   || 'var(--text)',
        '--quest-subtitle-size': (ea.mission_subtitle_size || 12) + 'px',
        '--quest-subtitle-color': ea.mission_subtitle_color || 'var(--text-dim)',
        '--quest-lb-size':       (ea.leaderboard_size  || 14) + 'px',
        '--quest-lb-color':       ea.leaderboard_color || 'var(--text)',
        '--quest-badge-size':    (ea.badge_title_size   || 14) + 'px',
        '--quest-badge-color':    ea.badge_title_color  || 'var(--text-muted)',
        '--quest-active-border':  activeBorderColor,
        '--quest-active-bg':      hexToRgba(ea.active_border_color, 0.05)  || 'rgba(0,255,179,0.05)',
        '--quest-active-icon-bg': hexToRgba(ea.active_border_color, 0.15) || 'rgba(0,255,179,0.15)',
        '--quest-rotation-size': (ea.rotation_text_size  || 11) + 'px',
        '--quest-rotation-color': ea.rotation_text_color || 'var(--text-dim)',
      }}
    >
      <div className="dark-only fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4 pb-32">

        <PageHeader title={title || c.title || "Booth Quest"} subtitle={subtitle || c.subtitle || ""} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={isHomeContext} />

        {questStats && levelThresholds ? (
          <UserCard
            user={{
              name: lang === 'en' ? (questStats.name_en || questStats.name_fa) : questStats.name_fa,
              xp: questStats.xp,
            }}
            thresholds={levelThresholds}
            levelColors={levelColors}
            labels={labels}
            lang={lang}
            showLevelCircle={showLevelCircle}
          />
        ) : (
          <UserCardSkeleton />
        )}

        <div className="flex justify-center my-8">
          <ScanButton isDark={isDark} label={labels.scanButtonLabel} glowColor={ea.scan_glow_color} />
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
                return [
                  { label: labels.statXpLabel,      value: questStats ? dNum(questStats.xp, lang) : "—",          unit: labels.xpUnit, icon: "⚡", onClick: null,                      highlight: false },
                  { label: labels.statScannedLabel, value: questStats ? dNum(questStats.total_scans, lang) : "—", unit: "غرفه", icon: "📍", onClick: () => setBoothsOpen(true), highlight: true  },
                  { label: labels.statRankLabel,    value: currentUserRank ? dNum(currentUserRank, lang) : "—", unit: "", icon: "🏅", onClick: null, highlight: false },
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
            <div className="space-y-3">
              {missions === null
                ? Array.from({ length: 4 }).map((_, i) => <MissionCardSkeleton key={i} />)
                : missionList}
            </div>
          </>
        )}

        {activeTab === "leaderboard" && (
          levelThresholds ? (
            <LeaderboardTab
              users={leaderboard}
              levelColors={levelColors}
              thresholds={levelThresholds}
              currentUserUuid={currentUserUuid}
              xpUnit={labels.xpUnit}
              lang={lang}
              levels={liveLevels || []}
            />
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl px-4 py-3 border animate-pulse"
                  style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                  <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "var(--border)" }} />
                  <div className="flex-1 h-3 rounded-full" style={{ background: "var(--border)" }} />
                </div>
              ))}
            </div>
          )
        )}

        {activeTab === "badges" && (
          <BadgesTab
            badges={badges}
            onQuizClick={(badge) => setOpenQuiz({ ...badge, isBadge: true })}
            onSurveyClick={(badge) => setOpenSurvey({ ...badge, isBadge: true })}
            onSocialShareClick={(badge) => setOpenSocialShare({ ...badge, isBadge: true })}
            onFeaturedClick={(badge) => setOpenFeaturedPool({ ...badge, isFeaturedBadge: true })}
            lang={lang}
          />
        )}
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
        xpUnit={labels.xpUnit}
        featuredBoothPoolIds={featuredBoothPoolIds}
      />

      <FeaturedBoothPoolSheet
        open={!!openFeaturedPool}
        onClose={() => setOpenFeaturedPool(null)}
        item={openFeaturedPool}
        isRTL={isRTL}
        lang={lang}
        logoBaseUrl={logoBaseUrl}
      />

      {openQuiz && (
        <QuizModal
          quiz={openQuiz}
          lang={lang}
          onClose={() => { setOpenQuiz(null); refreshQuest(); }}
          onComplete={() => refreshQuest()}
        />
      )}

      {openSurvey && (
        <SurveyModal
          survey={openSurvey}
          lang={lang}
          onClose={() => { setOpenSurvey(null); refreshQuest(); }}
          onComplete={() => refreshQuest()}
        />
      )}

      {openSocialShare && (
        <SocialShareModal
          share={openSocialShare}
          lang={lang}
          onClose={() => { setOpenSocialShare(null); refreshQuest(); }}
          onComplete={() => refreshQuest()}
        />
      )}

      <BottomNav />
    </main>
  );
}
