import { ADMIN_SECTIONS } from '@/lib/adminSections';

export const dynamic = 'force-dynamic';

const CSS = `
  .adm-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:28px; padding-bottom:16px; border-bottom:1px solid var(--border); }
  .adm-dot { width:9px; height:9px; border-radius:50%; background:var(--accent); box-shadow:0 0 7px var(--accent); animation:admP 2s infinite; flex-shrink:0; }
  @keyframes admP{0%,100%{opacity:1}50%{opacity:.4}}
  .adm-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
  a.adm-card { display:block; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:18px 16px; text-decoration:none; color:var(--text); transition:border-color .15s; }
  a.adm-card:hover { border-color:var(--accent); }
  .adm-card-icon { font-size:24px; margin-bottom:10px; }
  .adm-card-title { font-size:14px; font-weight:700; margin-bottom:4px; }
  .adm-card-desc { font-size:12px; color:var(--text-dim); line-height:1.6; }
  .adm-logout { background:var(--surface); border:1px solid var(--border); color:var(--text-dim); padding:7px 14px; border-radius:8px; font-family:inherit; font-size:13px; cursor:pointer; text-decoration:none; display:inline-block; }
`;

export default function AdminDashboard() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <header className="adm-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="adm-dot" />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>پنل مدیریت</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>ایران‌فارما</div>
            </div>
          </div>
          <a href="/api/admin-auth/logout" className="adm-logout">خروج</a>
        </header>
        <div className="adm-grid">
          {ADMIN_SECTIONS.map((s) => (
            <a key={s.key} href={s.path} className="adm-card">
              <div className="adm-card-icon">{s.icon}</div>
              <div className="adm-card-title">{s.label}</div>
              <div className="adm-card-desc">{s.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
