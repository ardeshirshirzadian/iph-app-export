import "./globals.css";
import ThemeSync from "./components/ThemeSync";
import LangSync from "./components/LangSync";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";
import SessionExpiredToast from "@/components/SessionExpiredToast";
import ApolloClientProvider from "./components/ApolloProvider";
import PageWrapper from "./components/PageWrapper";
import ProfilePhotoGuard from "./components/ProfilePhotoGuard";
import { getActiveFont, getActiveFontEn } from "@/lib/getActiveFont";
import { getThemeColors } from "@/lib/getThemeColors";
import { getThemeMode } from "@/lib/getThemeMode";
import { getAppIdentity } from "@/lib/getAppIdentity";
import { existsSync } from "fs";
import { join } from "path";

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const identity = await getAppIdentity();

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
  return `(function(){try{${modeSnippet}if(light)document.documentElement.classList.add("light");var c=light?"${lightBg}":"${darkBg}";var s=document.createElement("style");s.textContent="body{background-color:"+c+"}";document.head.appendChild(s);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c);var ab=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');if(ab)ab.setAttribute("content",light?"default":"black-translucent");}catch(e){}})();`;
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
    getActiveFont(),
    getActiveFontEn(),
    getThemeColors(),
    getThemeMode(),
  ]);
  const fontStyle = buildFontStyle(activeFont);
  const fontEnStyle = buildFontEnStyle(activeFontEn);
  const isGoogleFont = activeFont.source === 'google';
  const isGoogleFontEn = activeFontEn.source === 'google';
  const themeInitScript = buildThemeInitScript(themeColors.dark.bg, themeColors.light.bg, themeMode);

  return (
    <html lang="fa" dir="rtl">
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
        <ApolloClientProvider><ProfilePhotoGuard /><PageWrapper>{children}</PageWrapper></ApolloClientProvider>
      </body>
    </html>
  );
}
