import "./globals.css";
import { unstable_cache } from "next/cache";
import ThemeSync from "./components/ThemeSync";
import LangSync from "./components/LangSync";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";
import SessionExpiredToast from "@/components/SessionExpiredToast";
import ApolloClientProvider from "./components/ApolloProvider";
import AttendeeProvider from "./components/AttendeeProvider";
import CartProvider from "./components/CartProvider";
import PageWrapper from "./components/PageWrapper";
import ProfilePhotoGuard from "./components/ProfilePhotoGuard";
import { getActiveFont, getActiveFontEn } from "@/lib/getActiveFont";
import { getThemeColors } from "@/lib/getThemeColors";
import { getThemeMode } from "@/lib/getThemeMode";
import { getAppIdentity } from "@/lib/getAppIdentity";
import { existsSync } from "fs";
import { join } from "path";

// Layout-scoped cache entries, one per underlying admin setting. Each wraps
// the SAME shared lib/*.js function other call sites already use — the
// functions themselves are never modified, so those other call sites are
// unaffected by this change:
//   - getActiveFont/getActiveFontEn: no other callers in the app.
//   - getThemeColors: also called directly (unwrapped, always-fresh) by
//     app/api/theme.css/route.js, which is intentionally `no-store` already
//     and stays that way — untouched here.
//   - getThemeMode: also called by app/settings/page.js under its own
//     'settings-theme-mode' tag (existing, pre-dates this change). Kept as a
//     SEPARATE 'layout-theme-mode' tag rather than merged, so neither
//     already-shipped call site has to change — the tradeoff is the admin
//     save handler for theme_mode must revalidate both tags (documented in
//     the iph-apn wiring), not just one.
//   - getAppIdentity: also called by app/manifest.js, which has its own
//     independent `force-dynamic` (manifest.js is a metadata file
//     convention, not rendered under this layout's React tree, so it's
//     unaffected by removing force-dynamic here) — left unwrapped/untouched.
// 300s is a safety-net ceiling only; the primary invalidation path is the
// explicit revalidateTag() call from iph-apn's admin save handlers via
// app/api/internal/revalidate/route.js.
const getCachedActiveFont = unstable_cache(
  () => getActiveFont(),
  ["layout-font"],
  { tags: ["layout-font"], revalidate: 300 }
);
const getCachedActiveFontEn = unstable_cache(
  () => getActiveFontEn(),
  ["layout-font-en"],
  { tags: ["layout-font-en"], revalidate: 300 }
);
const getCachedThemeColors = unstable_cache(
  () => getThemeColors(),
  ["layout-theme-colors"],
  { tags: ["layout-theme-colors"], revalidate: 300 }
);
const getCachedThemeMode = unstable_cache(
  () => getThemeMode(),
  ["layout-theme-mode"],
  { tags: ["layout-theme-mode"], revalidate: 300 }
);
const getCachedAppIdentity = unstable_cache(
  () => getAppIdentity(),
  ["layout-app-identity"],
  { tags: ["layout-app-identity"], revalidate: 300 }
);

export async function generateMetadata() {
  const identity = await getCachedAppIdentity();

  const uploadedFavicon = join(process.cwd(), 'public', 'uploads', 'icons', 'favicon.png');
  const faviconHref = existsSync(uploadedFavicon)
    ? '/uploads/icons/favicon.png'
    : '/favicon.ico';

  return {
    title: identity.title,
    description: identity.description,
    appleWebApp: {
      capable: true,
    },
    icons: {
      icon: faviconHref,
    },
  };
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

const LANG_INIT_SCRIPT = `(function(){try{var l=localStorage.getItem("iph-lang")||"fa";if(l==="en"){document.documentElement.dir="ltr";document.documentElement.lang="en";document.documentElement.classList.add("lang-en");}else{document.documentElement.dir="rtl";document.documentElement.lang="fa";}}catch(e){}})();`;

function buildThemeInitScript(darkBg, lightBg, themeMode) {
  let modeSnippet;
  if (themeMode === 'dark') {
    modeSnippet = `var light=false;`;
  } else if (themeMode === 'light') {
    modeSnippet = `var light=true;`;
  } else {
    modeSnippet = `var t=localStorage.getItem("iph-theme");if(!t){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var light=t==="light";`;
  }
  return `(function(){try{${modeSnippet}if(light)document.documentElement.classList.add("light");var c=light?"${lightBg}":"${darkBg}";document.documentElement.style.backgroundColor=c;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c);var ab=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(ab)ab.setAttribute("content",light?"default":"black-translucent");}catch(e){}})();`;
}

function buildFontStyle(activeFont) {
  if (activeFont.source === 'google') {
    return `:root { --active-font-family: "${activeFont.family}"; }`;
  }

  const faces = activeFont.allFiles
    .map(
      (f) =>
        `@font-face { font-family: "${activeFont.family}"; src: url("${f.path}") format("${f.format}"); font-weight: ${f.weight}; font-display: swap; }`
    )
    .join('\n');

  return [
    faces,
    `:root { --active-font-family: "${activeFont.family}"; }`,
    `body { font-weight: ${activeFont.weight}; }`,
  ].join('\n');
}

function buildFontEnStyle(activeFontEn) {
  if (activeFontEn.source === 'google') {
    return `:root { --active-font-en-family: "${activeFontEn.family}"; }`;
  }

  const faces = activeFontEn.allFiles
    .map(
      (f) =>
        `@font-face { font-family: "${activeFontEn.family}"; src: url("${f.path}") format("${f.format}"); font-weight: ${f.weight}; font-display: swap; }`
    )
    .join('\n');

  return [
    faces,
    `:root { --active-font-en-family: "${activeFontEn.family}"; }`,
  ].join('\n');
}

export default async function RootLayout({ children }) {
  const [activeFont, activeFontEn, themeColors, themeMode] = await Promise.all([
    getCachedActiveFont(),
    getCachedActiveFontEn(),
    getCachedThemeColors(),
    getCachedThemeMode(),
  ]);
  const fontStyle = buildFontStyle(activeFont);
  const fontEnStyle = buildFontEnStyle(activeFontEn);
  const isGoogleFont = activeFont.source === 'google';
  const isGoogleFontEn = activeFontEn.source === 'google';
  const themeInitScript = buildThemeInitScript(themeColors.dark.bg, themeColors.light.bg, themeMode);

  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        {/* theme-color must come before the inline scripts so the DOM nodes exist */}
        <meta name="theme-color" content={themeColors.dark.bg} />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: LANG_INIT_SCRIPT }} />
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* apple-touch-icon: pre-baked 180×180 with dark bg so iOS never restyles it */}
        <link rel="apple-touch-icon" href="/uploads/icons/apple-touch-icon.png" />
        {(isGoogleFont || isGoogleFontEn) && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            {isGoogleFont && <link href={activeFont.googleUrl} rel="stylesheet" />}
            {isGoogleFontEn && activeFontEn.googleUrl !== activeFont.googleUrl && (
              <link href={activeFontEn.googleUrl} rel="stylesheet" />
            )}
          </>
        )}
        {/* Dynamic font: @font-face for all weights + --active-font-family variable.
            Changing the font in /apn/appearance takes effect on next page load, no restart. */}
        {/* eslint-disable-next-line react/no-danger */}
        <style dangerouslySetInnerHTML={{ __html: fontStyle }} />
        {/* eslint-disable-next-line react/no-danger */}
        <style dangerouslySetInnerHTML={{ __html: fontEnStyle }} />
        {/* DB-driven theme colors served from /api/theme.css — no-store so changes in
            /apn/appearance take effect on next page load without a rebuild. */}
        <link rel="stylesheet" href="/api/theme.css" />
      </head>
      <body>
        <ThemeSync themeMode={themeMode} />
        <LangSync />
        <ServiceWorkerRegistrar />
        <SessionExpiredToast />
        <ApolloClientProvider><AttendeeProvider><CartProvider><ProfilePhotoGuard /><PageWrapper>{children}</PageWrapper></CartProvider></AttendeeProvider></ApolloClientProvider>
      </body>
    </html>
  );
}
