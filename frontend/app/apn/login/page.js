export const dynamic = 'force-dynamic';

const CSS = `
  body { display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:32px 28px; width:100%; max-width:380px; }
  .logo { display:flex; align-items:center; gap:10px; margin-bottom:28px; }
  .dot { width:10px; height:10px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); animation:pulse 2s infinite; }
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .login-label { display:block; font-size:13px; color:var(--text-dim); margin-bottom:6px; }
  .login-input { display:block; width:100%; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:10px 14px; font-size:14px; color:var(--text); font-family:inherit; outline:none; transition:border-color .15s; direction:ltr; box-sizing:border-box; }
  .login-input:focus { border-color:var(--accent); }
  .field { margin-bottom:16px; }
  .login-btn { display:block; width:100%; background:var(--accent); color:#fff; border:none; border-radius:10px; padding:12px; font-size:15px; font-weight:700; cursor:pointer; font-family:inherit; transition:opacity .15s; margin-top:20px; }
  .login-btn:hover { opacity:.9; }
  .err { color:#ef4444; font-size:13px; margin-top:12px; text-align:center; }
`;

export default function AdminLoginPage({ searchParams }) {
  const error = searchParams?.error || '';
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="card">
        <div className="logo">
          <div className="dot" />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>پنل مدیریت</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>ایران‌فارما</div>
          </div>
        </div>
        <form method="POST" action="/api/admin-auth/login">
          <div className="field">
            <label className="login-label" htmlFor="u">نام کاربری</label>
            <input id="u" className="login-input" name="username" type="text" autoComplete="username" required />
          </div>
          <div className="field">
            <label className="login-label" htmlFor="p">رمز عبور</label>
            <input id="p" className="login-input" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button type="submit" className="login-btn">ورود</button>
          {error && <p className="err">{decodeURIComponent(error)}</p>}
        </form>
      </div>
    </>
  );
}
