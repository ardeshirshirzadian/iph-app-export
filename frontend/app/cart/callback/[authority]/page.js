import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function CartCallbackAuthorityPage({ params, searchParams }) {
  const { authority } = await params;
  const sp = await searchParams;
  const status = sp?.Status ?? sp?.status ?? '';
  const isOk = status === 'OK';

  return (
    <main
      dir="rtl"
      lang="fa"
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "var(--bg)" }}
    >
      <div className="dark-only fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div
        className="relative max-w-sm w-full rounded-3xl p-8 text-center backdrop-blur-xl"
        style={{
          background: "var(--surface)",
          border: `1px solid ${isOk ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "rgba(239,68,68,0.3)"}`,
        }}
      >
        <div className="text-5xl mb-4">{isOk ? '🎉' : '❌'}</div>
        <h1
          className="text-xl font-black mb-2 leading-8"
          style={{ color: isOk ? "var(--accent)" : "#ef4444" }}
        >
          {isOk ? 'پرداخت با موفقیت انجام شد 🎉' : 'پرداخت انجام نشد'}
        </h1>
        <p className="text-sm leading-7 mb-6" style={{ color: "var(--text-muted)" }}>
          {isOk
            ? 'سفارش شما ثبت شد. می‌توانید از پنل کاربری رسایش پیگیری کنید.'
            : 'پرداخت انجام نشد یا لغو شد. می‌توانید مجدداً تلاش کنید.'}
        </p>
        <div className="flex flex-col gap-3">
          <Link
            href="/"
            className="inline-block px-6 py-2.5 rounded-xl font-bold text-sm"
            style={{ background: "var(--accent)", color: "var(--btn-primary-text)" }}
          >
            بازگشت به صفحه اصلی
          </Link>
          {!isOk && (
            <Link
              href="/cart"
              className="inline-block px-6 py-2.5 rounded-xl font-medium text-sm"
              style={{ border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)" }}
            >
              بازگشت به سبد خرید
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
