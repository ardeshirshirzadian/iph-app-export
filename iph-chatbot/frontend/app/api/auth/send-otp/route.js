// In-memory rate limit: mobile -> [timestamp, ...]
const otpRateLimit = new Map();
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 3;

function isRateLimited(mobile) {
  const now = Date.now();
  const recent = (otpRateLimit.get(mobile) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) return true;
  otpRateLimit.set(mobile, [...recent, now]);
  return false;
}

export async function POST(request) {
  let mobile;
  try {
    ({ mobile } = await request.json());
  } catch {
    return Response.json({ success: false, message: 'درخواست نامعتبر' }, { status: 400 });
  }

  if (!mobile || !/^09\d{9}$/.test(mobile)) {
    return Response.json({ success: false, message: 'شماره موبایل نامعتبر است' }, { status: 400 });
  }

  if (isRateLimited(mobile)) {
    return Response.json(
      { success: false, message: 'تعداد درخواست‌ها بیش از حد مجاز است. ۱۰ دقیقه دیگر تلاش کنید.' },
      { status: 429 }
    );
  }

  try {
    const res = await fetch('https://api.rasayesh.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation AttendeeLogin($mobile: String!) {
          attendeeLogin(mobile: $mobile)
        }`,
        variables: { mobile },
      }),
    });

    const { data, errors } = await res.json();

    if (errors?.length) {
      return Response.json({ success: false, message: 'خطا در ارسال کد تأیید' }, { status: 502 });
    }

    const result = data?.attendeeLogin;
    const ok = result?.status && result.status !== 'fail' && result.status !== 'error';

    return Response.json({
      success: !!ok,
      message: ok ? 'کد تأیید ارسال شد' : (result?.message || 'خطا در ارسال کد'),
    });
  } catch {
    return Response.json({ success: false, message: 'خطا در ارتباط با سرور' }, { status: 502 });
  }
}
