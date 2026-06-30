const otpRateLimit = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 3;

function isRateLimited(key) {
  const now = Date.now();
  const recent = (otpRateLimit.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) return true;
  otpRateLimit.set(key, [...recent, now]);
  return false;
}

export async function POST(request) {
  let email;
  try {
    ({ email } = await request.json());
  } catch {
    return Response.json({ success: false, message: 'Invalid request' }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ success: false, message: 'Invalid email address' }, { status: 400 });
  }

  if (isRateLimited(email.toLowerCase())) {
    return Response.json(
      { success: false, message: 'Too many requests. Please try again in 10 minutes.' },
      { status: 429 }
    );
  }

  try {
    const res = await fetch('https://api.rasayesh.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation AttendeeLogin($email: String!) {
          attendeeLogin(email: $email)
        }`,
        variables: { email },
      }),
    });

    const { data, errors } = await res.json();

    if (errors?.length) {
      return Response.json({ success: false, message: 'Failed to send verification code' }, { status: 502 });
    }

    const result = data?.attendeeLogin;
    const ok = result?.status && result.status !== 'fail' && result.status !== 'error';

    return Response.json({
      success: !!ok,
      message: ok ? 'Verification code sent' : (result?.message || 'Failed to send code'),
    });
  } catch {
    return Response.json({ success: false, message: 'Server connection error' }, { status: 502 });
  }
}
