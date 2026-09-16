"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { gql } from "@apollo/client";
import { getApolloClient, NetworkRetryError } from "@/lib/apolloClient";
import { useAuth } from "@/hooks/useAuth";

// Bounded retry schedule for a NetworkRetryError (a transient network
// failure on the post-refresh retry request -- see apolloClient.js). Not
// used for a confirmed unauthorized/expired-token response, which signOut()
// already handles via its own redirect. 2 retries (3 attempts total),
// delays chosen to ride out a typical few-second mobile network blip
// without leaving the user waiting too long: 2s, then 5s (~7s worst case).
const ATTENDEE_RETRY_DELAYS_MS = [2000, 5000];

// Superset of every field any current consumer (AppHeader photo, ProfilePhotoGuard,
// ProfileCompletionBar, ProfileClient, EditProfileClient) reads from getAttendee.
//
// todayEventPresence(eventId: $eventId) -- eventId must be the CURRENT
// Rasayesh event id (companies_config.event_id, passed down from
// app/layout.js as the rasayeshEventId prop), never hardcoded. Rasayesh's
// schema has todayEventPresence as Boolean! with a required Int! eventId
// arg and getAttendee as nullable -- confirmed via introspection -- so a
// resolver error on a stale/wrong eventId nulls out the ENTIRE getAttendee
// object via standard GraphQL null-propagation, not just this one field.
// That's what caused the intermittent empty profile box before this fix.
const ATTENDEE_QUERY = gql`
  query GetAttendee($eventId: Int!) {
    getAttendee {
      id
      firstname_fa
      lastname_fa
      firstname_en
      lastname_en
      job_title_fa
      job_title_en
      national_code
      email
      phone
      mobile
      country_id
      state_id
      address_fa
      address_en
      postal_code
      latitude
      longitude
      profile
      occupation_id
      education_level_id
      field_of_activities { id title_fa title_en }
      todayEventPresence(eventId: $eventId)
    }
  }
`;

const AttendeeContext = createContext({
  attendee: null,
  loading: true,
  isLoggedIn: false,
  refetch: async () => {},
});

// Fire-and-forget: keeps app_users.profile_image (the leaderboard's primary
// photo source, see leaderboard/route.js's resolvePhotoUrl) fresh, and
// awards the profile_photo quest mission/badge the moment a photo is
// confirmed present (see grantProfilePhotoMissionXp in
// app/api/auth/sync-profile-photo/route.js — idempotent, no-op if already
// granted or if no active profile_photo mission/badge exists yet).
// Extracted to a plain module-level function (no component state captured)
// so both fetchAttendee's initial call and the visibilitychange re-check
// below share one implementation.
function syncProfilePhoto(profile) {
  return fetch("/api/auth/sync-profile-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  }).catch(() => {});
}

// Fire-and-forget: keeps app_users.firstname_fa/lastname_fa/firstname_en/
// lastname_en (leaderboard's name source, see leaderboard/route.js) and the
// iph_user cookie's name fields (Quest name box's source, via
// api/quest/stats/route.js) in sync with whatever Rasayesh currently
// returns for this attendee -- not just after an explicit /profile/edit
// save (EditProfileClient's saveInfo() already calls this same endpoint for
// that case, see 2026-09-14), but on every session-start fetch too, so a
// name changed on Rasayesh's own side entirely outside our app (confirmed
// real case: a user whose local app_users row was captured at their one and
// only login and never touched again) self-corrects the next time this user
// opens the app. Reuses data already just fetched -- no extra Rasayesh call.
function syncProfileInfo(attendee) {
  return fetch("/api/auth/sync-profile-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstnameFa: attendee.firstname_fa,
      lastnameFa: attendee.lastname_fa,
      firstnameEn: attendee.firstname_en,
      lastnameEn: attendee.lastname_en,
    }),
  }).catch(() => {});
}

// Floor between profile-photo re-checks, so rapid tab-switching can't
// fire this repeatedly. The endpoint is idempotent either way (ON CONFLICT
// DO NOTHING for the XP grant) -- this is purely to avoid pointless network
// chatter, not a correctness requirement.
const PROFILE_PHOTO_RECHECK_MIN_INTERVAL_MS = 60_000;

// Fire-and-forget: the only point a pending referral redemption (as referee)
// can be re-checked without persisting an access/refresh token server-side --
// this call rides the fresh token localStorage already holds at the exact
// moment fetchAttendee() itself just used it, since tokens are never durable
// server-side. No-op (server-side) if this user has no pending redemption.
function recheckPendingReferral(uuid) {
  if (!uuid || typeof window === "undefined") return;
  const accessToken = localStorage.getItem("access_token");
  if (!accessToken) return;
  return fetch("/api/quest/referral/recheck-pending", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken, uuid }),
  }).catch(() => {});
}

export default function AttendeeProvider({ children, rasayeshEventId }) {
  const { user, isLoggedIn } = useAuth();
  // useAuth() resolves the iph_user cookie via queueMicrotask, so `user` is
  // `null` both before it resolves AND when genuinely logged out — those two
  // states are indistinguishable from `user` alone. Track resolution
  // explicitly so `loading` never has a false "not logged in" window before
  // we actually know that.
  const [authChecked, setAuthChecked] = useState(false);
  const [attendee, setAttendee] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchedForUser = useRef(null);
  // Timestamp of the last sync-profile-photo call (initial fetch or
  // visibilitychange re-check below) — see PROFILE_PHOTO_RECHECK_MIN_INTERVAL_MS.
  const lastProfilePhotoSyncRef = useRef(0);

  useEffect(() => {
    queueMicrotask(() => setAuthChecked(true));
  }, []);

  const fetchAttendee = useCallback(async () => {
    const client = getApolloClient();
    if (!client) { setLoading(false); return; }
    setLoading(true);
    // `errorPolicy: 'all'` (set on this client) means client.query() resolves
    // normally even on error -- it never rejects for either a confirmed
    // unauthorized response or a NetworkRetryError, both land in `error`.
    // `loading` intentionally stays true across the whole retry sequence --
    // set false exactly once, after the loop, so the UI doesn't flicker
    // between attempts.
    for (let attempt = 0; attempt <= ATTENDEE_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const { data, error } = await client.query({
          query: ATTENDEE_QUERY,
          variables: { eventId: rasayeshEventId },
          fetchPolicy: "network-only",
        });
        if (data?.getAttendee) {
          setAttendee(data.getAttendee);
          // Also keeps app_users.profile_image fresh when the photo changed
          // mid-session -- e.g. EditProfileClient's upload flow calls
          // refetch() (this function) but only updates local state, never
          // the server, on its own.
          syncProfilePhoto(data.getAttendee.profile);
          syncProfileInfo(data.getAttendee);
          recheckPendingReferral(user?.uuid);
          lastProfilePhotoSyncRef.current = Date.now();
          break;
        }
        // Not a NetworkRetryError (e.g. confirmed auth failure, already
        // handled by signOut()'s own redirect) or retries exhausted --
        // leave previous attendee state as-is, matching prior behavior.
        if (!(error instanceof NetworkRetryError) || attempt === ATTENDEE_RETRY_DELAYS_MS.length) break;
      } catch {
        // leave previous attendee state as-is on an unexpected throw
        break;
      }
      await new Promise((r) => setTimeout(r, ATTENDEE_RETRY_DELAYS_MS[attempt]));
    }
    setLoading(false);
  }, [rasayeshEventId, user]);

  useEffect(() => {
    if (!authChecked) return; // still resolving the iph_user cookie

    if (!isLoggedIn || !user?.id) {
      setAttendee(null);
      setLoading(false);
      fetchedForUser.current = null;
      return;
    }
    // rasayeshEventId comes from layout.js (server-resolved companies_config,
    // always present in practice) -- guard anyway since todayEventPresence's
    // eventId arg is non-null: sending eventId: null/undefined would itself
    // be a GraphQL variable-coercion error, worse than just waiting one tick.
    if (rasayeshEventId == null) return;
    // Fetch once per login session — a remount (e.g. route change) with the
    // same logged-in user must not re-trigger the network request.
    if (fetchedForUser.current === user.id) return;
    fetchedForUser.current = user.id;
    fetchAttendee();
  }, [authChecked, isLoggedIn, user?.id, rasayeshEventId, fetchAttendee]);

  // Re-check the profile-photo mission/badge grant on tab refocus, without
  // re-running the rest of fetchAttendee (a live Rasayesh GraphQL call --
  // this re-check should stay purely local/cheap, see sync-profile-photo's
  // own ~0.1-0.2s measured cost). Deliberately isolated from the
  // fetchedForUser-gated effect above: fetchedForUser continues to gate the
  // full attendee fetch to once per login session exactly as before; this
  // effect only ever re-fires the lightweight sync call, using the
  // already-fetched attendee.profile already sitting in state. Needed
  // because grantProfilePhotoMissionXp() checks for an active profile_photo
  // mission live on every call — a session that started before an admin
  // created that mission never rechecks until something re-fires this sync,
  // which fetchedForUser's once-per-session gate otherwise prevents (see
  // 2026-09-12 leaderboard-visibility investigation).
  useEffect(() => {
    if (!isLoggedIn || !attendee?.profile) return;

    function onVisibilityChange() {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastProfilePhotoSyncRef.current < PROFILE_PHOTO_RECHECK_MIN_INTERVAL_MS) return;
      lastProfilePhotoSyncRef.current = now;
      syncProfilePhoto(attendee.profile);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isLoggedIn, attendee]);

  return (
    <AttendeeContext.Provider value={{ attendee, loading, isLoggedIn, refetch: fetchAttendee }}>
      {children}
    </AttendeeContext.Provider>
  );
}

export function useAttendee() {
  return useContext(AttendeeContext);
}
