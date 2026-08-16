"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAttendee } from "./AttendeeProvider";

// Paths where the guard must NOT redirect (to avoid infinite loops / blocking access)
function isAllowedPath(pathname) {
  return (
    pathname === "/profile" ||
    pathname === "/profile/edit" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/book/callback") ||
    pathname.startsWith("/cart/callback") ||
    pathname.startsWith("/api/")
  );
}

export default function ProfilePhotoGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const { attendee, loading, isLoggedIn } = useAttendee();

  useEffect(() => {
    if (isAllowedPath(pathname)) return;
    // `loading` stays true until AttendeeProvider has fully resolved login
    // state (and fetched attendee data if logged in) — checking it before
    // isLoggedIn avoids a window where isLoggedIn is already true but the
    // fetch hasn't started, which would otherwise look like "no photo".
    if (loading) return;
    if (!isLoggedIn) return;

    const jpg = attendee?.profile?.jpg;
    const hasPhoto = !!(jpg?.["128"] || jpg?.["256"] || jpg?.["512"]);
    if (!hasPhoto) router.replace("/profile");
  }, [pathname, router, isLoggedIn, loading, attendee]);

  return null;
}
