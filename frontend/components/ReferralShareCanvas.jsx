'use client';

// Pure referral-share-image renderer -- ported (copied, not imported) from
// iph-apn's components/ReferralShareCanvas.jsx, which the admin editor's
// live preview uses. Two repos, no shared import path, so keeping both
// copies structurally identical by hand is the actual mechanism here, not
// real code sharing. See that file's own header comment for why this is a
// simpler sibling to PlaqueCanvas.jsx rather than an extension of it.
//
// Unlike the admin copy, `resolve`/`resolveImage` here are always supplied
// by the caller with the real logged-in user's own data (see QuestClient.js's
// ReferralModal) -- the defaults below only exist as a safety fallback, they
// are never the normal path in this file.

import AvatarPlaceholder from '@/components/AvatarPlaceholder';
import { STATIC_FIELD } from '@/lib/referralShareFields';

function defaultResolve(field, el) {
  return field === STATIC_FIELD ? (el?.text || '') : '';
}
function defaultResolveImage() {
  return null;
}

export default function ReferralShareCanvas({
  template,
  scale = 3,
  resolve = defaultResolve,
  resolveImage = defaultResolveImage,
  className,
  style,
}) {
  const editor = template?.editor || { width: 100, height: 100, background: null };
  const elements = Array.isArray(template?.elements) ? template.elements : [];

  const wPx = editor.width * scale;
  const hPx = editor.height * scale;
  const bg = editor.background || null;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: wPx,
        height: hPx,
        background: '#ffffff',
        backgroundImage: bg ? `url(${bg})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        overflow: 'hidden',
        ...style,
      }}
    >
      {elements.map((el) => {
        const box = {
          position: 'absolute',
          left: el.left * scale,
          top: el.top * scale,
          width: el.width * scale,
          height: el.height * scale,
          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
          transformOrigin: 'center center',
        };

        if (el.type === 'image') {
          const src = resolveImage(el);
          const isCircle = el.shape === 'circle';
          return (
            <div key={el.id} style={{ ...box, overflow: 'hidden', borderRadius: isCircle ? '50%' : 0 }}>
              {src ? (
                // crossOrigin="anonymous" + the caller's html2canvas
                // useCORS:true is the same combination already proven for
                // Rasayesh-hosted images elsewhere in this app
                // (RasayeshBadgeCard.jsx's background preload,
                // BadgeClient.jsx's downloadCard()) -- verified live for a
                // profile photo specifically as part of this feature's own
                // implementation (see the CORS check reported alongside
                // this diff).
                <img
                  src={src}
                  alt=""
                  crossOrigin="anonymous"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <AvatarPlaceholder size={Math.min(el.width, el.height) * scale} />
              )}
            </div>
          );
        }

        if (el.type === 'text') {
          const text = resolve(el.field, el);
          const fontWeight = el.fontWeight ?? (el.bold ? 800 : 400);
          const jc = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
          return (
            <div
              key={el.id}
              style={{
                ...box,
                display: 'flex',
                alignItems: 'center',
                justifyContent: jc,
                fontFamily: el.fontFamily ? `"${el.fontFamily}", sans-serif` : undefined,
                fontSize: (el.fontSize || 6) * scale,
                fontWeight,
                fontStyle: el.italic ? 'italic' : 'normal',
                textDecoration: el.underline ? 'underline' : 'none',
                color: el.color || '#111111',
                lineHeight: el.lineHeight || 1.2,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {text}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}
