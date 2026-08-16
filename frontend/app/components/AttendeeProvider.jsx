"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import { useAuth } from "@/hooks/useAuth";

// Superset of every field any current consumer (AppHeader photo, ProfilePhotoGuard,
// ProfileCompletionBar, ProfileClient, EditProfileClient) reads from getAttendee.
const ATTENDEE_QUERY = gql`
  query GetAttendee {
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
      todayEventPresence(eventId: 18)
    }
  }
`;

const AttendeeContext = createContext({
  attendee: null,
  loading: true,
  isLoggedIn: false,
  refetch: async () => {},
});

export default function AttendeeProvider({ children }) {
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
    try {
      const { data } = await client.query({ query: ATTENDEE_QUERY, fetchPolicy: "network-only" });
      if (data?.getAttendee) setAttendee(data.getAttendee);
    } catch {
      // leave previous attendee state as-is on transient failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return; // still resolving the iph_user cookie

    if (!isLoggedIn || !user?.id) {
      setAttendee(null);
      setLoading(false);
      fetchedForUser.current = null;
      return;
    }
    // Fetch once per login session — a remount (e.g. route change) with the
    // same logged-in user must not re-trigger the network request.
    if (fetchedForUser.current === user.id) return;
    fetchedForUser.current = user.id;
    fetchAttendee();
  }, [authChecked, isLoggedIn, user?.id, fetchAttendee]);

  return (
    <AttendeeContext.Provider value={{ attendee, loading, isLoggedIn, refetch: fetchAttendee }}>
      {children}
    </AttendeeContext.Provider>
  );
}

export function useAttendee() {
  return useContext(AttendeeContext);
}
