// Portfolio pages — W3 / ST-015. Server-rendered HTML, same shell as the dashboard.
//
// Every number a member typed is echoed back through `esc`. A symbol like `<script>` never reaches
// the database (the parser refuses it), but a portfolio *name* is free text, and a page that shows
// a name is a page that can be made to run someone else's script if it does not escape.

import { css } from './base'

export interface PortfolioRow {
  id: string
  name: string
  baseCurrency: string
  startingCash: string
  createdAt: string
  holdingCount?: number
}

export interface HoldingRow {
  id: string
  symbol: string
  mic: string
  units: string
  avgCost: string
  currency: string
}

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const layout = (title: string, content: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} — SimTrader</title>
  <style>
    ${css}
    .topnav { background: var(--card); border-bottom: 1px solid var(--border);
              padding: 0 2rem; height: 56px; display: flex; align-items: center;
              justify-content: space-between; position: sticky; top: 0; z-index: 10; }
    .topnav-brand { font-weight: 800; font-size: 1.1rem; color: var(--primary); }
    .main { max-width: 1100px; margin: 0 auto; padding: 2rem; }
    .empty-state { text-align: center; padding: 3rem 1rem; color: var(--muted); }
    .empty-state .icon { font-size: 2.5rem; margin-bottom: .75rem; }
    .row-inline { display: flex; gap: .5rem; align-items: flex-end; flex-wrap: wrap; }
    .row-inline .form-group { margin-bottom: 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .hint { color: var(--muted); font-size: 12px; }
    .errors { margin: .5rem 0 0; padding-left: 1.25rem; }
    .errors li { margin-bottom: .2rem; }
    input[type=file] { font-size: 13px; }
  </style>
</head>
<body>
  <nav class="topnav">
    <a class="topnav-brand" href="/dashboard">📈 SimTrader</a>
    <div><a href="/dashboard" class="btn btn-ghost btn-sm">Dashboard</a></div>
  </nav>
  <main class="main">${content}</main>
</body>
</html>`

const alert = (messages: string[]) =>
  messages.length === 0
    ? ''
    : `<div class="alert alert-error">${messages.map((m) => `<div>${esc(m)}</div>`).join('')}</div>`

const notice = (message: string | null) =>
  message
    ? `<div class="alert" style="background:#dcfce7;color:#15803d;border:1px solid #86efac">${esc(message)}</div>`
    : ''

// ---------------------------------------------------------------- list

export function portfoliosPage(opts: { portfolios: PortfolioRow[] }): string {
  const rows = opts.portfolios
    .map(
      (p) => `<tr>
        <td><a href="/portfolios/${esc(p.id)}">${esc(p.name)}</a></td>
        <td>${esc(p.baseCurrency)}</td>
        <td class="num">${esc(p.startingCash)}</td>
        <td class="num">${esc(p.holdingCount ?? 0)}</td>
        <td class="hint">${esc(new Date(p.createdAt).toLocaleDateString())}</td>
      </tr>`,
    )
    .join('')

  return layout(
    'Portfolios',
    `<div class="page-header">
       <h1 class="page-title">Portfolios</h1>
       <a href="/portfolios/new" class="btn btn-primary btn-sm">+ New portfolio</a>
     </div>
     <div class="card">
       ${
         opts.portfolios.length === 0
           ? `<div class="empty-state">
                <div class="icon">📁</div>
                <p>No portfolios yet.</p>
                <a href="/portfolios/new" class="btn btn-primary btn-sm" style="margin-top:.75rem">Create one</a>
              </div>`
           : `<table>
                <thead><tr><th>Name</th><th>Currency</th><th class="num">Starting cash</th><th class="num">Holdings</th><th>Created</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`
       }
     </div>`,
  )
}

// ---------------------------------------------------------------- create form

export function portfolioFormPage(opts: {
  errors?: string[]
  values?: { name: string; baseCurrency: string; startingCash: string }
}): string {
  const v = opts.values ?? { name: '', baseCurrency: 'USD', startingCash: '0' }
  return layout(
    'New portfolio',
    `<div class="page-header"><h1 class="page-title">New portfolio</h1></div>
     <div class="card" style="max-width:520px">
       ${alert(opts.errors ?? [])}
       <form method="POST" action="/portfolios">
         <div class="form-group">
           <label for="name">Name</label>
           <input id="name" name="name" type="text" value="${esc(v.name)}" maxlength="80" required autofocus>
         </div>
         <div class="form-group">
           <label for="base_currency">Base currency</label>
           <input id="base_currency" name="base_currency" type="text" value="${esc(v.baseCurrency)}" maxlength="3" required>
           <p class="hint">Three-letter code. Holdings keep their own currency; this is what totals are reported in.</p>
         </div>
         <div class="form-group">
           <label for="starting_cash">Starting cash</label>
           <input id="starting_cash" name="starting_cash" type="text" value="${esc(v.startingCash)}" inputmode="decimal">
           <p class="hint">Plain decimal, e.g. 10000.00.</p>
         </div>
         <div style="display:flex;gap:.5rem">
           <button type="submit" class="btn btn-primary">Create</button>
           <a href="/portfolios" class="btn btn-ghost">Cancel</a>
         </div>
       </form>
     </div>`,
  )
}

// ---------------------------------------------------------------- one portfolio

export function portfolioPage(opts: {
  portfolio: PortfolioRow
  holdings: HoldingRow[]
  errors?: string[]
  csvErrors?: { line: number; message: string }[]
  notice?: string | null
}): string {
  const p = opts.portfolio

  const holdingRows = opts.holdings
    .map(
      (h) => `<tr>
        <td><strong>${esc(h.symbol)}</strong> <span class="hint">${esc(h.mic)}</span></td>
        <td>${esc(h.currency)}</td>
        <td colspan="3">
          <form method="POST" action="/portfolios/${esc(p.id)}/holdings/${esc(h.id)}/update" class="row-inline">
            <div class="form-group" style="width:120px">
              <input name="units" type="text" value="${esc(h.units)}" inputmode="decimal" aria-label="Units for ${esc(h.symbol)}">
            </div>
            <div class="form-group" style="width:140px">
              <input name="avg_cost" type="text" value="${esc(h.avgCost)}" inputmode="decimal" aria-label="Average cost for ${esc(h.symbol)}">
            </div>
            <button type="submit" class="btn btn-ghost btn-sm">Save</button>
          </form>
        </td>
        <td>
          <form method="POST" action="/portfolios/${esc(p.id)}/holdings/${esc(h.id)}/delete"
                onsubmit="return confirm('Remove ${esc(h.symbol)} from this portfolio?')">
            <button type="submit" class="btn btn-danger btn-sm">Remove</button>
          </form>
        </td>
      </tr>`,
    )
    .join('')

  const csvErrorList =
    opts.csvErrors && opts.csvErrors.length > 0
      ? `<div class="alert alert-error">
           <ul class="errors">
             ${opts.csvErrors
               .slice(0, 50)
               .map((e) => `<li>Line ${esc(e.line)}: ${esc(e.message)}</li>`)
               .join('')}
           </ul>
           ${opts.csvErrors.length > 50 ? `<div class="hint">…and ${opts.csvErrors.length - 50} more.</div>` : ''}
         </div>`
      : ''

  return layout(
    p.name,
    `<div class="page-header">
       <div>
         <h1 class="page-title">${esc(p.name)}</h1>
         <p class="hint">${esc(p.baseCurrency)} · starting cash ${esc(p.startingCash)}</p>
       </div>
       <form method="POST" action="/portfolios/${esc(p.id)}/delete"
             onsubmit="return confirm('Delete ${esc(p.name)} and all its holdings? This cannot be undone.')">
         <button type="submit" class="btn btn-danger btn-sm">Delete portfolio</button>
       </form>
     </div>

     ${notice(opts.notice ?? null)}
     ${alert(opts.errors ?? [])}
     ${csvErrorList}

     <div class="card" style="margin-bottom:1rem">
       <div style="font-weight:700;margin-bottom:.75rem">Holdings</div>
       ${
         opts.holdings.length === 0
           ? `<div class="empty-state"><div class="icon">📄</div><p>No holdings yet. Upload a CSV or add one below.</p></div>`
           : `<table>
                <thead><tr><th>Instrument</th><th>Currency</th><th colspan="3">Units · average cost</th><th></th></tr></thead>
                <tbody>${holdingRows}</tbody>
              </table>`
       }
     </div>

     <div class="card" style="margin-bottom:1rem">
       <div style="font-weight:700;margin-bottom:.75rem">Add a holding</div>
       <form method="POST" action="/portfolios/${esc(p.id)}/holdings" class="row-inline">
         <div class="form-group" style="width:140px">
           <label for="symbol">Symbol</label>
           <input id="symbol" name="symbol" type="text" placeholder="AAPL" required>
         </div>
         <div class="form-group" style="width:110px">
           <label for="mic">Exchange</label>
           <input id="mic" name="mic" type="text" placeholder="XNAS" maxlength="4" required>
         </div>
         <div class="form-group" style="width:120px">
           <label for="units">Units</label>
           <input id="units" name="units" type="text" inputmode="decimal" placeholder="10" required>
         </div>
         <div class="form-group" style="width:140px">
           <label for="avg_cost">Average cost</label>
           <input id="avg_cost" name="avg_cost" type="text" inputmode="decimal" placeholder="182.50" required>
         </div>
         <div class="form-group" style="width:100px">
           <label for="currency">Currency</label>
           <input id="currency" name="currency" type="text" value="${esc(p.baseCurrency)}" maxlength="3" required>
         </div>
         <button type="submit" class="btn btn-primary">Add</button>
       </form>
       <p class="hint" style="margin-top:.5rem">An instrument already in the portfolio is updated, not duplicated.</p>
     </div>

     <div class="card">
       <div style="font-weight:700;margin-bottom:.75rem">Import from CSV</div>
       <form method="POST" action="/portfolios/${esc(p.id)}/holdings/upload" enctype="multipart/form-data" class="row-inline">
         <div class="form-group"><input name="file" type="file" accept=".csv,text/csv" required></div>
         <button type="submit" class="btn btn-primary">Upload</button>
         <a href="/portfolios/template.csv" class="btn btn-ghost">Download template</a>
       </form>
       <p class="hint" style="margin-top:.5rem">
         Columns: <code>symbol,mic,units,avg_cost,currency</code>. Nothing is imported unless every
         row is valid, and a re-upload updates the holdings it names.
       </p>
     </div>`,
  )
}
