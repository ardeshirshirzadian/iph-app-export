// Admin panel layout — overrides theme vars with the admin dark theme
// and suppresses user-app decorative chrome (bottom nav, etc.).
// Root layout still provides <html>/<body> and loads fonts/theme.css.

const ADMIN_STYLE = `
  /* Force admin dark theme regardless of user's theme preference */
  :root, html.light {
    --bg: #0f1117 !important;
    --surface: #181c27 !important;
    --surface-2: #1e2330 !important;
    --border: #252a38 !important;
    --accent: #3b82f6 !important;
    --text: #e2e8f0 !important;
    --text-muted: #64748b !important;
    --text-dim: #94a3b8 !important;
    --surface-input: #0f1117 !important;
    /* Reset button vars to admin palette */
    --btn-primary-bg: #3b82f6 !important;
    --btn-primary-text: #ffffff !important;
    --btn-primary-border: transparent !important;
  }
  body { padding: 20px 16px 48px !important; }
`;

export default function AdminLayout({ children }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ADMIN_STYLE }} />
      {children}
    </>
  );
}
