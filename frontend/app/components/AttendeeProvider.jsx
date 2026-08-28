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
          // Fire-and-forget: keeps app_users.profile_image (the leaderboard's
          // primary photo source, see leaderboard/route.js's resolvePhotoUrl)
          // fresh even when the photo changed mid-session -- e.g.
          // EditProfileClient's upload flow calls refetch() (this function)
          // but only updates local state, never the server, on its own.
          fetch("/api/auth/sync-profile-photo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile: data.getAttendee.profile }),
          }).catch(() => {});
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
  }, [rasayeshEventId]);

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

  return (
    <AttendeeContext.Provider value={{ attendee, loading, isLoggedIn, refetch: fetchAttendee }}>
      {children}
    </AttendeeContext.Provider>
  );
}

export function useAttendee() {
  return useContext(AttendeeContext);
}
