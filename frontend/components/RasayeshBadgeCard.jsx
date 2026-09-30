"use client";

import { QRCodeSVG } from "qrcode.react";
import { relativeLuminance } from "@/lib/getContrastTextColor";

// Rasayesh's eventTemplate JSON exposes only a foreground `color` on a qr
// element (verified against live templates 119 & 127) -- no background,
// margin, or error-correction field.
const DEFAULT_QR_FG = "#000000";

// Confirmed by pixel-sampling Rasayesh's own rendered card (their /card/:uuid
// page, both events): the QR PNG they generate has ZERO opaque white pixels
// -- light modules are fully transparent (alpha 0) and dark modules run
// edge-to-edge with no quiet zone baked in at all. Whatever white/tinted box
// appears to frame the QR on their card is painted into the template's own
// background artwork at the admin-configured position, not added by the QR
// renderer. So the correct default here is transparent, matching exactly --
// our own `editor.background` image (already rendered underneath) supplies
// the same framing Rasayesh's does, at the same el.left/top/width/height.
const DEFAULT_QR_BG = "transparent";

// Used only to evaluate contrast for the console-warning heuristic below --
// never painted. Real light modules render transparent (see above), so
// "what's actually behind them" depends on the background artwork, which we
// can't introspect; white is the conservative worst-case assumption for a
// legibility warning, not a claim about what's rendered.
const CONTRAST_CHECK_BG = "#ffffff";

// WCAG 1.4.11 (non-text contrast) minimum, used as a scannability proxy --
// below this a scanner may struggle to distinguish modules from background.
const MIN_QR_CONTRAST = 3;

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function isValidHexColor(v) {
  return typeof v === "string" && HEX_COLOR_RE.test(v.trim());
}

function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

// Dedupe across re-renders (e.g. toggling the QR modal re-renders the whole
// card) -- warn once per distinct element+color combo, not on every render.
const warnedLowContrastQr = new Set();

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

            const fgColor = isValidHexColor(el.color) ? el.color : DEFAULT_QR_FG;
            const bgColor = isValidHexColor(el.backgroundColor) ? el.backgroundColor : DEFAULT_QR_BG;

            const ratio = contrastRatio(fgColor, CONTRAST_CHECK_BG);
            if (ratio < MIN_QR_CONTRAST) {
              const warnKey = `${el.id}:${fgColor}`;
              if (!warnedLowContrastQr.has(warnKey)) {
                warnedLowContrastQr.add(warnKey);
                console.warn(
                  `[RasayeshBadgeCard] QR element ${el.id}'s color ${fgColor} has only ${ratio.toFixed(2)}:1 ` +
                  `contrast against a white background -- below the ${MIN_QR_CONTRAST}:1 minimum for reliable ` +
                  `scanning. Rendering as configured; fix the color in Rasayesh.`
                );
              }
            }

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
                  cursor: onQRClick ? "pointer" : undefined,
                }}
              >
                {qrValue && (
                  <QRCodeSVG
                    value={qrValue}
                    fgColor={fgColor}
                    bgColor={bgColor}
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
