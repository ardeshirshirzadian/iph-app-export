"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

// Intrinsic pixel dimensions of the fixed logo assets in public/logo/ — a
// small, known-at-build-time set (not admin-uploaded), so next/image can
// safely serve resized/modern-format variants instead of the full-size PNGs
// (up to 5310x2134) at their actual ~32px display height.
const LOGO_DIMENSIONS = {
  "logo":      { width: 2134, height: 2134 },
  "logo-fa":   { width: 5310, height: 2134 },
  "logo-en":   { width: 5310, height: 2134 },
  "logo-l":    { width: 2142, height: 2200 },
  "logo-l-fa": { width: 4500, height: 1033 },
  "logo-l-en": { width: 4500, height: 1033 },
};

function logoKey(isLight, variant) {
  const base = isLight ? "logo" : "logo-l";
  const suffix = variant === "fa" ? "-fa" : variant === "en" ? "-en" : "";
  return `${base}${suffix}`;
}

export default function Logo({ variant = "default", className = "" }) {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));

    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const key = logoKey(isLight, variant);
  const { width, height } = LOGO_DIMENSIONS[key];

  return (
    <Image
      src={`/logo/${key}.png`}
      alt="ایران فارما"
      width={width}
      height={height}
      className={className}
    />
  );
}
