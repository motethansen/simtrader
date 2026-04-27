import { css, toastScript } from '../base'

export const adminCss = `
  ${css}
  body { display: flex; min-height: 100vh; }
  .sidebar { width: 220px; min-height: 100vh; background: #1e293b; color: #94a3b8;
             display: flex; flex-direction: column; flex-shrink: 0; position: fixed; top: 0; left: 0; bottom: 0; }
  .sidebar-brand { padding: 1.25rem 1.5rem; font-size: 1rem; font-weight: 800; color: #fff;
                   border-bottom: 1px solid #334155; display: flex; align-items: center; gap: .5rem; }
  .sidebar-section { padding: .75rem .75rem .25rem; font-size: 10px; font-weight: 700;
                     text-transform: uppercase; letter-spacing: .08em; color: #475569; }
  .sidebar-link { display: flex; align-items: center; gap: .6rem; padding: .55rem .75rem;
                  border-radius: 6px; margin: .1rem .5rem; font-size: 13px; color: #94a3b8;
                  text-decoration: none; transition: background .15s, color .15s; }
  .sidebar-link:hover { background: #334155; color: #e2e8f0; text-decoration: none; }
  .sidebar-link.active { background: #4f46e5; color: #fff; }
  .sidebar-footer { margin-top: auto; padding: 1rem; border-top: 1px solid #334155; font-size: 12px; }
  .sidebar-footer .email { color: #e2e8f0; font-weight: 500; margin-bottom: .25rem; }
  .sidebar-footer form button { color: #94a3b8; background: none; border: none; cursor: pointer;
                                font-size: 12px; padding: 0; }
  .sidebar-footer form button:hover { color: #e2e8f0; }
  .content { margin-left: 220px; flex: 1; padding: 2rem; max-width: 1100px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .kpi { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
         padding: 1.25rem; }
  .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .kpi-value { font-size: 2rem; font-weight: 800; color: var(--text); margin: .25rem 0; }
  .kpi-sub { font-size: 12px; color: var(--muted); }
  .kpi-warn .kpi-value { color: var(--warning); }
  .kpi-danger .kpi-value { color: var(--danger); }
  .filter-bar { display: flex; gap: .5rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
  .filter-bar input, .filter-bar select { width: auto; }
`

interface SidebarOpts {
  currentPath: string
  email: string
}

function sidebar({ currentPath, email }: SidebarOpts): string {
  const link = (href: string, icon: string, label: string) =>
    `<a href="${href}" class="sidebar-link${currentPath.startsWith(href) ? ' active' : ''}">${icon} ${label}</a>`

  return `
    <aside class="sidebar">
      <div class="sidebar-brand">⚡ Admin</div>
      <div style="padding:.5rem 0">
        <div class="sidebar-section">Overview</div>
        ${link('/admin', '📊', 'Dashboard')}
        <div class="sidebar-section">Users</div>
        ${link('/admin/users', '👥', 'All users')}
        <div class="sidebar-section">System</div>
        ${link('/admin/audit', '📋', 'Audit log')}
        ${link('/admin/system', '🖥️', 'System health')}
      </div>
      <div class="sidebar-footer">
        <div class="email">${email}</div>
        <form method="POST" action="/auth/logout">
          <button type="submit">Log out</button>
        </form>
      </div>
    </aside>
  `
}

export function adminLayout(opts: {
  title: string
  currentPath: string
  email: string
  content: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title} — SimTrader Admin</title>
  <style>${adminCss}</style>
</head>
<body>
  ${sidebar({ currentPath: opts.currentPath, email: opts.email })}
  <main class="content">
    ${opts.content}
  </main>
  <div class="toast-container" id="toast-container"></div>
  <script>${toastScript}</script>
</body>
</html>`
}
