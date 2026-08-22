"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useLang } from "@/lib/useLang";

// Static per-variant fallbacks, shown until an admin uploads that specific
// variant via Settings -> Header. Matches the login page's own default-value
// convention (app/login/page.js's DEFAULT_SETTINGS.logo_path) of falling
// back to a static asset instead of leaving the header blank -- now one
// fallback per variant instead of a single universal one, mirroring the old
// static Logo.jsx's logoKey(isLight, variant) asset set.
const STATIC_FALLBACKS = {
  light_fa: { path: "/logo/logo-fa.png", width: 5310, height: 2134 },
  light_en: { path: "/logo/logo-en.png", width: 5310, height: 2134 },
  dark_fa: { path: "/logo/logo-l-fa.png", width: 4500, height: 1033 },
  dark_en: { path: "/logo/logo-l-en.png", width: 4500, height: 1033 },
};

export default function Logo({ data, className = "" }) {
  const { lang } = useLang();
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

  const variantKey = `${isLight ? "light" : "dark"}_${lang}`;
  // Fall back only within the exact theme+lang requested -- an uploaded
  // logo from a mismatched theme (e.g. a light-optimized wordmark rendered
  // on a dark background) can be illegible, so the theme-correct static
  // asset is a safer default than borrowing another uploaded variant.
  const { path, width, height } = data?.[variantKey] || STATIC_FALLBACKS[variantKey];

  return (
    <Image src={path} alt="" width={width} height={height} className={className} />
  );
}
