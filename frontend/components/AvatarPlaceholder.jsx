// Extracted from QuestClient.js (was a module-local function) so
// components/ReferralShareCanvas.jsx can reuse the exact same placeholder
// for a missing profile photo instead of drawing its own -- same visual in
// the leaderboard and in a generated share image.
//
// Uses theme CSS vars (not hardcoded white) so it stays visible against
// --surface in both dark and light theme, for every event -- a hardcoded
// white-on-white was invisible in light theme. See project notes 2026-09-30.
export default function AvatarPlaceholder({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ borderRadius: '50%', background: 'var(--border)', flexShrink: 0 }}>
      <circle cx="16" cy="13" r="5" fill="var(--text-dim)" />
      <path d="M6 27c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
