"use client";

import { useState, useEffect } from "react";

function logoSrc(isLight, variant) {
  const base = isLight ? "logo" : "logo-l";
  const suffix = variant === "fa" ? "-fa" : variant === "en" ? "-en" : "";
  return `/logo/${base}${suffix}.png`;
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

  return <img src={logoSrc(isLight, variant)} alt="ایران فارما" className={className} />;
}
