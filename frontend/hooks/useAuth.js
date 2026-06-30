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
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // Clear readable cookie client-side immediately
    document.cookie = "iph_user=; path=/; max-age=0";
    setUser(null);
    router.push("/login");
  }, [router]);

  return { user, isLoggedIn: !!user, logout };
}
