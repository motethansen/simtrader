import { css } from './base'
import { esc } from './portfolios'

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

export interface DashboardPortfolio {
  id: string
  name: string
  baseCurrency: string
  holdingCount: number
}

// Nothing on this page links to a route that does not exist. It used to offer *Connect Saxo*,
// *New portfolio* and *Run simulation*, and all three were 404s — which nobody noticed while
// BudgetApp had no way in. Once *Launch simtrader* shipped (BA-165, live 2026-09-25) they were the
// first thing a member would click. Portfolios are real now; the other two say what they are
// waiting for instead of pretending to be ready.
export function dashboardPage(opts: {
  email: string
  token: TokenStatus
  portfolios?: DashboardPortfolio[]
}): string {
  const tokenCard = opts.token.active
    ? `<p class="token-active">✓ Active</p>
       <p style="color:var(--muted);font-size:12px;margin-top:.25rem">Expires ${new Date(opts.token.expiresAt!).toLocaleString()}</p>`
    : `<p class="token-expired">Not connected</p>
       <p style="color:var(--muted);font-size:12px;margin-top:.25rem">
         Connecting a Saxo account needs the encrypted token vault (W2), which is not built yet.
         Your token would have to be decrypted somewhere it can be kept safe, and that tier does
         not exist — so there is deliberately nothing here to submit.
       </p>`

  const portfolios = opts.portfolios ?? []
  const portfolioList =
    portfolios.length === 0
      ? `<div class="empty-state">
           <div class="icon">📁</div>
           <p>No portfolios yet.</p>
           <a href="/portfolios/new" class="btn btn-primary btn-sm" style="margin-top:.75rem">Create one</a>
         </div>`
      : `<table>
           <thead><tr><th>Name</th><th>Currency</th><th style="text-align:right">Holdings</th></tr></thead>
           <tbody>${portfolios
             .map(
               (p) => `<tr>
                 <td><a href="/portfolios/${esc(p.id)}">${esc(p.name)}</a></td>
                 <td>${esc(p.baseCurrency)}</td>
                 <td style="text-align:right">${esc(p.holdingCount)}</td>
               </tr>`,
             )
             .join('')}</tbody>
         </table>`

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
        <div style="display:flex;flex-direction:column;gap:.5rem;align-items:flex-start">
          <a href="/portfolios/new" class="btn btn-primary btn-sm">+ New portfolio</a>
          <a href="/portfolios" class="btn btn-ghost btn-sm">All portfolios</a>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
        <div style="font-weight:700">Portfolios</div>
        ${portfolios.length > 0 ? `<a href="/portfolios" style="font-size:12px">View all</a>` : ''}
      </div>
      ${portfolioList}
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:.75rem">Simulations</div>
      <div class="empty-state">
        <div class="icon">📊</div>
        <p>Simulations arrive with W5.</p>
        <p style="font-size:12px">They need the backtester to run against real market data (M1) before a
           result here would mean anything.</p>
      </div>
    </div>
  `)
}
