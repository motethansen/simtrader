import { adminLayout } from './layout'
import { formatDate, statusBadge, roleBadge, paginate } from '../base'

interface UserRow {
  id: string
  email: string
  role: string
  status: string
  createdAt: string
  lastLoginAt: string | null
  hasToken: boolean
}

export function adminUsersPage(opts: {
  users: UserRow[]
  page: number
  total: number
  limit: number
  search: string
  roleFilter: string
  statusFilter: string
}): string {
  const qs = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({
      ...(opts.search ? { q: opts.search } : {}),
      ...(opts.roleFilter ? { role: opts.roleFilter } : {}),
      ...(opts.statusFilter ? { status: opts.statusFilter } : {}),
      ...extra,
    })
    return p.toString() ? `?${p}` : ''
  }

  const rows = opts.users.map(u => `
    <tr>
      <td><a href="/admin/users/${u.id}">${u.email}</a></td>
      <td>${roleBadge(u.role)}</td>
      <td>${statusBadge(u.status)}</td>
      <td>${u.hasToken ? '<span class="badge badge-green">active</span>' : '<span class="badge badge-gray">none</span>'}</td>
      <td style="color:var(--muted);font-size:12px">${formatDate(u.createdAt)}</td>
      <td style="color:var(--muted);font-size:12px">${formatDate(u.lastLoginAt)}</td>
      <td>
        <div style="display:flex;gap:.35rem">
          <a href="/admin/users/${u.id}" class="btn btn-ghost btn-sm">View</a>
          ${u.status === 'active'
            ? `<button class="btn btn-danger btn-sm" onclick="confirmSuspend('${u.id}','${u.email}')">Suspend</button>`
            : u.status === 'suspended'
              ? `<button class="btn btn-ghost btn-sm" onclick="doUnsuspend('${u.id}')">Unsuspend</button>`
              : ''}
        </div>
      </td>
    </tr>
  `).join('')

  const content = `
    <div class="page-header">
      <h1 class="page-title">Users <span style="font-weight:400;color:var(--muted);font-size:1rem">(${opts.total})</span></h1>
    </div>

    <form method="GET" class="filter-bar card" style="padding:.75rem">
      <input type="search" name="q" placeholder="Search email…" value="${opts.search}" style="width:220px">
      <select name="role">
        <option value="">All roles</option>
        <option value="user" ${opts.roleFilter === 'user' ? 'selected' : ''}>User</option>
        <option value="admin" ${opts.roleFilter === 'admin' ? 'selected' : ''}>Admin</option>
      </select>
      <select name="status">
        <option value="">All statuses</option>
        <option value="active" ${opts.statusFilter === 'active' ? 'selected' : ''}>Active</option>
        <option value="suspended" ${opts.statusFilter === 'suspended' ? 'selected' : ''}>Suspended</option>
        <option value="pending" ${opts.statusFilter === 'pending' ? 'selected' : ''}>Pending</option>
      </select>
      <button type="submit" class="btn btn-primary btn-sm">Filter</button>
      <a href="/admin/users" class="btn btn-ghost btn-sm">Clear</a>
    </form>

    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Saxo token</th><th>Created</th><th>Last login</th><th>Actions</th></tr></thead>
        <tbody>
          ${rows || '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--muted)">No users found</td></tr>'}
        </tbody>
      </table>
    </div>
    ${paginate(opts.page, opts.total, opts.limit, '/admin/users' + qs())}

    <!-- Suspend confirmation dialog -->
    <dialog id="suspend-dialog">
      <p class="modal-title">Suspend user?</p>
      <p id="suspend-desc" style="color:var(--muted);font-size:13px"></p>
      <p style="color:var(--muted);font-size:12px;margin-top:.5rem">Their active sessions will be invalidated immediately.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="document.getElementById('suspend-dialog').close()">Cancel</button>
        <button class="btn btn-danger" id="suspend-confirm-btn">Suspend</button>
      </div>
    </dialog>

    <script>
      let _suspendId = null
      function confirmSuspend(id, email) {
        _suspendId = id
        document.getElementById('suspend-desc').textContent = 'Suspending: ' + email
        document.getElementById('suspend-dialog').showModal()
      }
      document.getElementById('suspend-confirm-btn').onclick = async () => {
        document.getElementById('suspend-dialog').close()
        const ok = await adminAction('/admin/users/' + _suspendId + '/suspend')
        if (ok) { toast('User suspended'); setTimeout(() => location.reload(), 800) }
      }
      async function doUnsuspend(id) {
        const ok = await adminAction('/admin/users/' + id + '/unsuspend')
        if (ok) { toast('User unsuspended'); setTimeout(() => location.reload(), 800) }
      }
    </script>
  `

  return adminLayout({ title: 'Users', currentPath: '/admin/users', email: '', content })
}

interface DetailUser {
  id: string
  email: string
  role: string
  status: string
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
}

interface AuditEntry {
  id: string
  action: string
  ts: string
  actorEmail: string | null
  detail: Record<string, unknown> | null
}

interface TokenInfo {
  expiresAt: string
  createdAt: string
}

export function adminUserDetailPage(opts: {
  user: DetailUser
  auditTrail: AuditEntry[]
  token: TokenInfo | null
}): string {
  const { user, auditTrail, token } = opts
  const isActive = token && new Date(token.expiresAt) > new Date()

  const tokenSection = token
    ? `<div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <span class="badge ${isActive ? 'badge-green' : 'badge-red'}">${isActive ? 'Active' : 'Expired'}</span>
        <span style="font-size:12px;color:var(--muted)">Expires ${formatDate(token.expiresAt)}</span>
        ${isActive ? `<button class="btn btn-danger btn-sm" onclick="forceExpire()">Force expire</button>` : ''}
      </div>`
    : `<span style="color:var(--muted)">No token on file</span>`

  const auditRows = auditTrail.map(e => `
    <tr>
      <td style="color:var(--muted);font-size:12px">${formatDate(e.ts)}</td>
      <td>${e.actorEmail ?? '<span style="color:var(--muted)">system</span>'}</td>
      <td><code style="font-size:12px;background:#f1f5f9;padding:.1rem .4rem;border-radius:4px">${e.action}</code></td>
      <td style="font-size:12px;color:var(--muted)">${e.detail ? JSON.stringify(e.detail) : '—'}</td>
    </tr>
  `).join('')

  const actions = user.status === 'active'
    ? `<button class="btn btn-danger" onclick="confirmSuspend()">Suspend user</button>`
    : user.status === 'suspended'
      ? `<button class="btn btn-ghost" onclick="doUnsuspend()">Unsuspend user</button>`
      : ''

  const content = `
    <div class="page-header">
      <div>
        <a href="/admin/users" style="font-size:13px;color:var(--muted)">← Users</a>
        <h1 class="page-title" style="margin-top:.25rem">${user.email}</h1>
      </div>
      <div style="display:flex;gap:.5rem">
        ${actions}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
      <div class="card">
        <strong style="display:block;margin-bottom:.75rem">Profile</strong>
        <table style="font-size:13px">
          <tr><td style="color:var(--muted);padding:.35rem 0">ID</td><td style="font-family:monospace;font-size:11px">${user.id}</td></tr>
          <tr><td style="color:var(--muted);padding:.35rem 0">Role</td><td>${roleBadge(user.role)}</td></tr>
          <tr><td style="color:var(--muted);padding:.35rem 0">Status</td><td>${statusBadge(user.status)}</td></tr>
          <tr><td style="color:var(--muted);padding:.35rem 0">Email verified</td><td>${user.emailVerified ? '✓ Yes' : 'No'}</td></tr>
          <tr><td style="color:var(--muted);padding:.35rem 0">Created</td><td>${formatDate(user.createdAt)}</td></tr>
          <tr><td style="color:var(--muted);padding:.35rem 0">Last login</td><td>${formatDate(user.lastLoginAt)}</td></tr>
        </table>
        <div style="margin-top:1rem;border-top:1px solid var(--border);padding-top:1rem">
          <strong style="font-size:12px;display:block;margin-bottom:.5rem">Change role</strong>
          <div style="display:flex;gap:.5rem">
            <select id="role-select" style="width:auto">
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
            <button class="btn btn-ghost btn-sm" onclick="changeRole()">Save</button>
          </div>
        </div>
      </div>

      <div class="card">
        <strong style="display:block;margin-bottom:.75rem">Saxo token</strong>
        ${tokenSection}
        <div style="margin-top:1.5rem">
          <strong style="font-size:12px;display:block;margin-bottom:.5rem">Danger zone</strong>
          <button class="btn btn-danger btn-sm" onclick="confirmDelete()">Delete account</button>
        </div>
      </div>
    </div>

    <div class="card">
      <strong style="display:block;margin-bottom:.75rem">Audit trail (last 50)</strong>
      <table>
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>${auditRows || '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1.5rem">No audit entries</td></tr>'}</tbody>
      </table>
    </div>

    <dialog id="delete-dialog">
      <p class="modal-title" style="color:var(--danger)">Delete account?</p>
      <p style="color:var(--muted);font-size:13px">
        This soft-deletes the account and anonymises the email. The audit trail is preserved.
        This cannot be undone easily.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="document.getElementById('delete-dialog').close()">Cancel</button>
        <button class="btn btn-danger" id="delete-confirm-btn">Delete</button>
      </div>
    </dialog>

    <script>
      const userId = '${user.id}'
      async function confirmSuspend() {
        if (!confirm('Suspend this user? Their sessions will be invalidated.')) return
        const ok = await adminAction('/admin/users/' + userId + '/suspend')
        if (ok) { toast('Suspended'); setTimeout(() => location.reload(), 800) }
      }
      async function doUnsuspend() {
        const ok = await adminAction('/admin/users/' + userId + '/unsuspend')
        if (ok) { toast('Unsuspended'); setTimeout(() => location.reload(), 800) }
      }
      async function changeRole() {
        const role = document.getElementById('role-select').value
        const ok = await adminAction('/admin/users/' + userId + '/role', { role })
        if (ok) { toast('Role updated'); setTimeout(() => location.reload(), 800) }
      }
      async function forceExpire() {
        if (!confirm('Force-expire this token?')) return
        const ok = await adminAction('/admin/users/' + userId + '/token/expire')
        if (ok) { toast('Token expired'); setTimeout(() => location.reload(), 800) }
      }
      function confirmDelete() {
        document.getElementById('delete-dialog').showModal()
      }
      document.getElementById('delete-confirm-btn').onclick = async () => {
        document.getElementById('delete-dialog').close()
        const ok = await adminAction('/admin/users/' + userId + '/delete', { confirm: true })
        if (ok) { toast('Account deleted'); setTimeout(() => location.href = '/admin/users', 1000) }
      }
    </script>
  `

  return adminLayout({ title: user.email, currentPath: '/admin/users', email: '', content })
}
