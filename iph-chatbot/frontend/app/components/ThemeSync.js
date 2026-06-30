"use client";

import { useEffect } from "react";

const THEME_COLORS = { dark: "#021f20", light: "#f0faf8" };

function getSystemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.classList.toggle("light", isLight);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isLight ? THEME_COLORS.light : THEME_COLORS.dark);
}

export default function ThemeSync() {
  useEffect(() => {
    applyTheme(localStorage.getItem("iph-theme") || getSystemTheme());

    function onStorage(e) {
      if (e.key !== "iph-theme") return;
      applyTheme(e.newValue || getSystemTheme());
    }
    window.addEventListener("storage", onStorage);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onSystemChange(e) {
      if (localStorage.getItem("iph-theme")) return;
      applyTheme(e.matches ? "dark" : "light");
    }
    mq.addEventListener("change", onSystemChange);

    return () => {
      window.removeEventListener("storage", onStorage);
      mq.removeEventListener("change", onSystemChange);
    };
  }, []);

  return null;
}
