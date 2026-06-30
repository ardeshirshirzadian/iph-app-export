'use client';

const CSS = `
  @keyframes _admPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  ._adm-dot { animation: _admPulse 2s infinite; }
  ._adm-back:hover { border-color: var(--accent) !important; color: var(--accent) !important; }
`;

export default function AdminPageHeader({ title, subtitle, backHref = '/apn', actions }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 28,
        paddingBottom: 18,
        borderBottom: '1px solid var(--border)',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            className="_adm-dot"
            style={{
              width: 9,
              height: 9,
              flexShrink: 0,
              borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 7px var(--accent)',
            }}
          />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {actions}
          <a
            href={backHref}
            className="_adm-back"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
              padding: '7px 14px',
              borderRadius: 8,
              textDecoration: 'none',
              fontFamily: 'inherit',
              fontSize: 13,
              whiteSpace: 'nowrap',
              display: 'inline-block',
              transition: 'all 0.15s',
            }}
          >
            ← بازگشت
          </a>
        </div>
      </header>
    </>
  );
}
