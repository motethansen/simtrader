import { adminLayout } from './layout'
import { formatDate } from '../base'

interface Stats {
  totalUsers: number
  activeUsers: number
  suspendedUsers: number
  activeToday: number
  activeTokens: number
  expiringsSoon: number
}

interface RecentAuditEntry {
  id: string
  action: string
  ts: string
  actorEmail: string | null
  targetEmail: string | null
}

export function adminDashboardPage(opts: {
  adminEmail: string
  stats: Stats
  recentAudit: RecentAuditEntry[]
}): string {
  const { stats, recentAudit } = opts

  const kpis = `
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Total users</div>
        <div class="kpi-value">${stats.totalUsers}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Active (7d)</div>
        <div class="kpi-value">${stats.activeToday}</div>
      </div>
      <div class="kpi ${stats.suspendedUsers > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Suspended</div>
        <div class="kpi-value">${stats.suspendedUsers}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Active Saxo tokens</div>
        <div class="kpi-value">${stats.activeTokens}</div>
      </div>
      <div class="kpi ${stats.expiringsSoon > 0 ? 'kpi-warn' : ''}">
        <div class="kpi-label">Expiring &lt;1h</div>
        <div class="kpi-value">${stats.expiringsSoon}</div>
        <div class="kpi-sub">tokens expiring soon</div>
      </div>
    </div>
  `

  const auditRows = recentAudit.map(e => `
    <tr>
      <td style="color:var(--muted);font-size:12px">${formatDate(e.ts)}</td>
      <td>${e.actorEmail ? `<a href="/admin/users?q=${encodeURIComponent(e.actorEmail)}">${e.actorEmail}</a>` : '<span style="color:var(--muted)">system</span>'}</td>
      <td><code style="font-size:12px;background:#f1f5f9;padding:.1rem .4rem;border-radius:4px">${e.action}</code></td>
      <td>${e.targetEmail ? `<a href="/admin/users?q=${encodeURIComponent(e.targetEmail)}">${e.targetEmail}</a>` : '—'}</td>
    </tr>
  `).join('')

  const content = `
    <div class="page-header">
      <h1 class="page-title">Dashboard</h1>
    </div>
    ${kpis}
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <strong>Recent activity</strong>
        <a href="/admin/audit" style="font-size:13px">View all →</a>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>${auditRows || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No activity yet</td></tr>'}</tbody>
      </table>
    </div>
  `

  return adminLayout({ title: 'Dashboard', currentPath: '/admin', email: opts.adminEmail, content })
}
