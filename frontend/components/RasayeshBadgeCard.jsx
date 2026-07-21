"use client";

import { QRCodeSVG } from "qrcode.react";

function resolveContent(content, attendee, eventName) {
  if (!content) return "";
  return content
    .replace(/\{\{FirstNameEn\}\}/g, attendee?.firstname_en || "")
    .replace(/\{\{LastNameEn\}\}/g, attendee?.lastname_en || "")
    .replace(/\{\{FirstNameFa\}\}/g, attendee?.firstname_fa || "")
    .replace(/\{\{LastNameFa\}\}/g, attendee?.lastname_fa || "")
    .replace(/\{\{UUID\}\}/g, attendee?.uuid || "")
    .replace(/\{\{EventName\}\}/g, eventName || "");
}

export default function RasayeshBadgeCard({ template, attendee, eventName, onQRClick }) {
  if (!template?.editor) return null;

  const { editor, elements = [] } = template;
  const bgUrl = editor.background
    ? `https://api.rasayesh.com/${editor.background}`
    : undefined;

  // Outer div uses padding-bottom to establish intrinsic aspect ratio.
  // padding-bottom: X% is always relative to the containing block's WIDTH —
  // universally reliable since CSS 2.1. This avoids the WebKit bug (pre-iOS 15.4)
  // where top/height percentages on absolute children of an aspect-ratio container
  // are resolved against the pre-aspect-ratio height (0) rather than the derived height.
  const paddingPct = `${(editor.height / editor.width) * 100}%`;

  return (
    <div style={{ position: "relative", width: "100%", paddingBottom: paddingPct }}>
      <div
        id="rasayesh-badge-card"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: bgUrl ? `url(${bgUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* Preload background for html2canvas CORS capture */}
        {bgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bgUrl}
            alt=""
            crossOrigin="anonymous"
            style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
            aria-hidden="true"
          />
        )}

        {elements.map((el) => {
          const leftPct = (el.left / editor.width) * 100;
          const topPct = (el.top / editor.height) * 100;

          if (el.type === "text") {
            const resolvedText = resolveContent(el.content, attendee, eventName);
            const isVertical = el.textWritingMode === "sideways-lr";
            return (
              <div
                key={el.id ?? `${el.left}-${el.top}`}
                data-vertical-text={isVertical ? "true" : undefined}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  color: el.color || "#000",
                  fontSize: `${(el.fontSize || 12) * 0.8}px`,
                  fontWeight: el.isBold ? 900 : 400,
                  fontStyle: el.isItalic ? "italic" : "normal",
                  textDecoration: el.isUnderlined ? "underline" : "none",
                  writingMode: isVertical ? "vertical-rl" : "initial",
                  transform: isVertical ? "rotate(180deg)" : "none",
                  whiteSpace: "nowrap",
                  lineHeight: 1.2,
                }}
              >
                {resolvedText}
              </div>
            );
          }

          if (el.type === "qr") {
            const qrValue = resolveContent(el.content, attendee, eventName);
            const widthPct = ((el.width || 20) / editor.width) * 100;
            // Height expressed as % of container height so the QR stays square
            // without relying on aspect-ratio (also buggy on old iOS Safari).
            // Derivation: qr_h_px = qr_w_px = (el.width/editor.width)*container_w
            //   container_h = (editor.height/editor.width)*container_w
            //   → h% = qr_h_px / container_h = el.width / editor.height
            const heightPct = ((el.width || 20) / editor.height) * 100;
            return (
              <div
                key={el.id ?? `qr-${el.left}-${el.top}`}
                onClick={onQRClick}
                style={{
                  position: "absolute",
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  background: "#fff",
                  padding: 4,
                  boxSizing: "border-box",
                  borderRadius: 4,
                  cursor: onQRClick ? "pointer" : undefined,
                }}
              >
                {qrValue && (
                  <QRCodeSVG
                    value={qrValue}
                    style={{ width: "100%", height: "100%", display: "block" }}
                  />
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
