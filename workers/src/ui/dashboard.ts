import { css } from './base'

const userLayout = (email: string, content: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard — SimTrader</title>
  <style>
    ${css}
    .topnav { background: var(--card); border-bottom: 1px solid var(--border);
              padding: 0 2rem; height: 56px; display: flex; align-items: center;
              justify-content: space-between; position: sticky; top: 0; z-index: 10; }
    .topnav-brand { font-weight: 800; font-size: 1.1rem; color: var(--primary); }
    .topnav-right { display: flex; align-items: center; gap: 1rem; font-size: 13px; color: var(--muted); }
    .main { max-width: 1100px; margin: 0 auto; padding: 2rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .empty-state { text-align: center; padding: 3rem 1rem; color: var(--muted); }
    .empty-state .icon { font-size: 2.5rem; margin-bottom: .75rem; }
    .token-active { display: flex; align-items: center; gap: .5rem; color: var(--success); font-weight: 600; }
    .token-expired { color: var(--danger); font-weight: 600; }
  </style>
</head>
<body>
  <nav class="topnav">
    <span class="topnav-brand">📈 SimTrader</span>
    <div class="topnav-right">
      <span>${email}</span>
      <form method="POST" action="/auth/logout" style="display:inline">
        <button type="submit" class="btn btn-ghost btn-sm">Log out</button>
      </form>
    </div>
  </nav>
  <main class="main">${content}</main>
</body>
</html>`

interface TokenStatus {
  active: boolean
  expiresAt: string | null
}

export function dashboardPage(opts: { email: string; token: TokenStatus }): string {
  const tokenCard = opts.token.active
    ? `<p class="token-active">✓ Active</p>
       <p style="color:var(--muted);font-size:12px;margin-top:.25rem">Expires ${new Date(opts.token.expiresAt!).toLocaleString()}</p>
       <div style="margin-top:1rem;display:flex;gap:.5rem">
         <a href="/saxo/token" class="btn btn-ghost btn-sm">Update token</a>
       </div>`
    : `<p class="token-expired">No active token</p>
       <p style="color:var(--muted);font-size:12px;margin-top:.25rem">Submit your Saxo 24h dev token to connect your account.</p>
       <div style="margin-top:1rem">
         <a href="/saxo/token" class="btn btn-primary btn-sm">Connect Saxo</a>
       </div>`

  return userLayout(opts.email, `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
    </div>

    <div class="grid-2">
      <div class="card">
        <div style="font-weight:700;margin-bottom:.75rem">Saxo connection</div>
        ${tokenCard}
      </div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:.75rem">Quick actions</div>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          <a href="/portfolios/new" class="btn btn-ghost btn-sm">+ New portfolio</a>
          <a href="/simulations/new" class="btn btn-ghost btn-sm">+ Run simulation</a>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div style="font-weight:700;margin-bottom:.75rem">Portfolios</div>
      <div class="empty-state">
        <div class="icon">📁</div>
        <p>No portfolios yet.</p>
        <a href="/portfolios/new" class="btn btn-primary btn-sm" style="margin-top:.75rem">Upload portfolio</a>
      </div>
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:.75rem">Recent simulations</div>
      <div class="empty-state">
        <div class="icon">📊</div>
        <p>No simulations run yet.</p>
      </div>
    </div>
  `)
}
