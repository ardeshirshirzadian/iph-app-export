// Extracted from QuestClient.js (was a module-local function) so
// components/ReferralShareCanvas.jsx can reuse the exact same placeholder
// for a missing profile photo instead of drawing its own -- same visual in
// the leaderboard and in a generated share image.
export default function AvatarPlaceholder({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ borderRadius: '50%', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }}>
      <circle cx="16" cy="13" r="5" fill="rgba(255,255,255,0.25)" />
      <path d="M6 27c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
