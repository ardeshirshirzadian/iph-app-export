import { gql } from "@apollo/client";
import { getApolloClient } from "./apolloClient";

// Superset of what any consumer needs (LoginForm only reads occupations +
// fieldOfActivities; EditProfileClient/ProfileUpdateClient also read
// educationLevels). Not user-specific — safe to share across the whole
// session regardless of login state.
const FORM_OPTIONS_QUERY = gql`
  {
    occupations(industryId: 1) { id title_fa title_en }
    fieldOfActivities(industryId: 1) { id title_fa title_en }
    educationLevels { id title_fa title_en }
  }
`;

// Module-level promise cache: fetched once on first call, reused by every
// caller for the rest of the browser session (mirrors AppHeader.js's
// _headerCache and publicRasayeshClient.js's eventInfoCache patterns).
let cachedPromise = null;

export function getFormOptions() {
  if (!cachedPromise) {
    const client = getApolloClient();
    if (!client) {
      return Promise.resolve({ occupations: [], fieldOfActivities: [], educationLevels: [] });
    }
    cachedPromise = client
      .query({ query: FORM_OPTIONS_QUERY })
      .then(({ data }) => ({
        occupations: data?.occupations ?? [],
        fieldOfActivities: data?.fieldOfActivities ?? [],
        educationLevels: data?.educationLevels ?? [],
      }))
      .catch((err) => {
        // Allow a later call to retry instead of caching a permanent failure.
        cachedPromise = null;
        throw err;
      });
  }
  return cachedPromise;
}
