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

export default function RasayeshBadgeCard({ template, attendee, eventName }) {
  if (!template?.editor) return null;

  const { editor, elements = [] } = template;
  const bgUrl = editor.background
    ? `https://api.rasayesh.com/${editor.background}`
    : undefined;

  return (
    <div
      id="rasayesh-badge-card"
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${editor.width} / ${editor.height}`,
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
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: `${topPct}%`,
                color: el.color || "#000",
                fontSize: `${(el.fontSize || 12) * 0.8}px`,
                fontWeight: el.isBold ? 900 : 400,
                fontStyle: el.isItalic ? "italic" : "normal",
                textDecoration: el.isUnderlined ? "underline" : "none",
                writingMode: isVertical ? "vertical-rl" : "horizontal-tb",
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
          return (
            <div
              key={el.id ?? `qr-${el.left}-${el.top}`}
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                aspectRatio: "1",
                background: "#fff",
                padding: "4%",
                borderRadius: 4,
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
  );
}
