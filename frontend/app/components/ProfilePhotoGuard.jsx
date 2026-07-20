"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";

const LS_PHOTO_OK = "iph_photo_ok";

const PROFILE_PHOTO_QUERY = gql`
  query GetAttendeePhotoGuard { getAttendee { profile } }
`;

function readUserCookie() {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )iph_user=([^;]*)/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
}

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
  const checkingRef = useRef(false);

  useEffect(() => {
    if (isAllowedPath(pathname)) return;

    const user = readUserCookie();
    if (!user) return;

    // Session-level cache: avoid querying GraphQL on every navigation
    if (typeof localStorage !== "undefined" && localStorage.getItem(LS_PHOTO_OK)) return;

    if (checkingRef.current) return;
    checkingRef.current = true;

    const client = getApolloClient();
    if (!client) { checkingRef.current = false; return; }

    client
      .query({ query: PROFILE_PHOTO_QUERY, fetchPolicy: "cache-first" })
      .then(({ data }) => {
        const jpg = data?.getAttendee?.profile?.jpg;
        const hasPhoto = !!(jpg?.["128"] || jpg?.["256"] || jpg?.["512"]);
        if (hasPhoto) {
          localStorage.setItem(LS_PHOTO_OK, "1");
        } else {
          router.replace("/profile");
        }
      })
      .catch(() => {})
      .finally(() => { checkingRef.current = false; });
  }, [pathname, router]);

  return null;
}
