"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

function readUserCookie() {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )iph_user=([^;]*)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    queueMicrotask(() => setUser(readUserCookie()));

    // useAuth() is a plain hook -- every call site (AttendeeProvider,
    // ProfileClient, AppHeader, CartProvider, ...) owns its own independent
    // `user` state. A client-side router.push() after login/logout never
    // remounts the root layout (login and profile share it -- no route
    // group boundary), so a call site mounted before the cookie changed
    // would otherwise never re-read it. Same fix as lib/useLang.js's
    // switchLang(): dispatch a synthetic event, every instance listens and
    // resyncs immediately instead of waiting for a full page reload.
    function onAuthChanged() {
      setUser(readUserCookie());
    }
    window.addEventListener("iph-auth-changed", onAuthChanged);
    return () => window.removeEventListener("iph-auth-changed", onAuthChanged);
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    document.cookie = "iph_user=; path=/; max-age=0";
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setUser(null);
    // Sync every OTHER useAuth() instance too (e.g. AttendeeProvider's, if
    // logout was triggered from a different component's hook instance) --
    // without this, those instances keep serving stale logged-in state
    // until a full reload, mirroring the login-direction bug this fixes.
    window.dispatchEvent(new Event("iph-auth-changed"));
    router.push("/login");
  }, [router]);

  return { user, isLoggedIn: !!user, logout };
}
