export async function handleApiResponse(response, router, currentPath) {
  if (response.status === 401) {
    const data = await response.json();
    if (data.error === 'session_expired') {
      window.dispatchEvent(new CustomEvent('session-expired', {
        detail: { redirectTo: currentPath },
      }));
      return { sessionExpired: true };
    }
    if (data.error === 'not_logged_in') {
      router.push('/login?from=' + encodeURIComponent(currentPath));
      return { notLoggedIn: true };
    }
    // Unknown 401 — treat as session expired
    window.dispatchEvent(new CustomEvent('session-expired', {
      detail: { redirectTo: currentPath },
    }));
    return { sessionExpired: true };
  }
  return { data: await response.json() };
}
