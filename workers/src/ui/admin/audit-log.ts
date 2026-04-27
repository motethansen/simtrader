import { adminLayout } from './layout'
import { formatDate, paginate } from '../base'

interface AuditEntry {
  id: string
  action: string
  ts: string
  detail: Record<string, unknown> | null
  ipAddress: string | null
  actorEmail: string | null
  targetEmail: string | null
}

export function adminAuditLogPage(opts: {
  entries: AuditEntry[]
  page: number
  total: number
  limit: number
  actionFilter: string
  from: string
  to: string
}): string {
  const rows = opts.entries.map(e => `
    <tr>
      <td style="color:var(--muted);font-size:12px;white-space:nowrap">${formatDate(e.ts)}</td>
      <td style="font-size:13px">${e.actorEmail ? `<a href="/admin/users?q=${encodeURIComponent(e.actorEmail)}">${e.actorEmail}</a>` : '<span style="color:var(--muted)">system</span>'}</td>
      <td><code style="font-size:12px;background:#f1f5f9;padding:.1rem .4rem;border-radius:4px">${e.action}</code></td>
      <td style="font-size:13px">${e.targetEmail ? `<a href="/admin/users?q=${encodeURIComponent(e.targetEmail)}">${e.targetEmail}</a>` : '—'}</td>
      <td style="font-size:12px;color:var(--muted);max-width:240px;overflow:hidden;text-overflow:ellipsis">
        ${e.detail ? `<code>${JSON.stringify(e.detail)}</code>` : '—'}
      </td>
      <td style="font-size:12px;color:var(--muted)">${e.ipAddress ?? '—'}</td>
    </tr>
  `).join('')

  const exportQs = new URLSearchParams({
    ...(opts.from ? { from: opts.from } : {}),
    ...(opts.to ? { to: opts.to } : {}),
  }).toString()

  const content = `
    <div class="page-header">
      <h1 class="page-title">Audit log <span style="font-weight:400;color:var(--muted);font-size:1rem">(${opts.total})</span></h1>
      <a href="/admin/audit/export${exportQs ? '?' + exportQs : ''}" class="btn btn-ghost btn-sm">↓ Export CSV</a>
    </div>

    <form method="GET" class="filter-bar card" style="padding:.75rem">
      <input type="text" name="action" placeholder="Filter action…" value="${opts.actionFilter}" style="width:180px">
      <input type="date" name="from" value="${opts.from}" title="From date">
      <input type="date" name="to" value="${opts.to}" title="To date">
      <button type="submit" class="btn btn-primary btn-sm">Filter</button>
      <a href="/admin/audit" class="btn btn-ghost btn-sm">Clear</a>
    </form>

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th><th>IP</th></tr></thead>
        <tbody>
          ${rows || '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">No entries found</td></tr>'}
        </tbody>
      </table>
    </div>
    ${paginate(opts.page, opts.total, opts.limit, '/admin/audit')}
  `

  return adminLayout({ title: 'Audit log', currentPath: '/admin/audit', email: '', content })
}
