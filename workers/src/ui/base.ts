// Shared HTML/CSS utilities used by all pages.

export const css = `
:root {
  --bg: #f8fafc; --card: #fff; --border: #e2e8f0;
  --text: #1e293b; --muted: #64748b;
  --primary: #4f46e5; --primary-hover: #4338ca;
  --danger: #dc2626; --danger-hover: #b91c1c;
  --success: #16a34a; --warning: #d97706;
  --radius: 8px; --shadow: 0 1px 3px rgba(0,0,0,.08);
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px;
       line-height: 1.6; color: var(--text); background: var(--bg); }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
.btn { display: inline-flex; align-items: center; gap: .4rem; padding: .45rem 1rem;
       border-radius: var(--radius); border: none; cursor: pointer; font-size: 13px;
       font-weight: 500; transition: background .15s; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-hover); }
.btn-danger  { background: var(--danger);  color: #fff; }
.btn-danger:hover  { background: var(--danger-hover); }
.btn-ghost   { background: transparent; color: var(--text); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--border); }
.btn-sm { padding: .3rem .7rem; font-size: 12px; }
.card { background: var(--card); border: 1px solid var(--border);
        border-radius: var(--radius); box-shadow: var(--shadow); padding: 1.5rem; }
.badge { display: inline-block; padding: .15rem .5rem; border-radius: 999px;
         font-size: 11px; font-weight: 600; }
.badge-green  { background: #dcfce7; color: #15803d; }
.badge-red    { background: #fee2e2; color: #b91c1c; }
.badge-yellow { background: #fef9c3; color: #854d0e; }
.badge-blue   { background: #dbeafe; color: #1d4ed8; }
.badge-gray   { background: #f1f5f9; color: #475569; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: .6rem .75rem; font-size: 11px; font-weight: 600;
     text-transform: uppercase; letter-spacing: .05em; color: var(--muted);
     border-bottom: 1px solid var(--border); }
td { padding: .65rem .75rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f8fafc; }
.form-group { margin-bottom: 1rem; }
label { display: block; font-weight: 500; font-size: 13px; margin-bottom: .35rem; }
input[type=email], input[type=password], input[type=text], input[type=search], select {
  width: 100%; padding: .55rem .75rem; border: 1px solid var(--border);
  border-radius: var(--radius); font-size: 14px; outline: none;
  transition: border-color .15s; }
input:focus, select:focus { border-color: var(--primary); }
.alert { padding: .75rem 1rem; border-radius: var(--radius); margin-bottom: 1rem; font-size: 13px; }
.alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.page-header { display: flex; align-items: center; justify-content: space-between;
               margin-bottom: 1.5rem; }
.page-title { font-size: 1.25rem; font-weight: 700; }
.pagination { display: flex; gap: .5rem; align-items: center; margin-top: 1rem; }
.pagination a, .pagination span { padding: .35rem .7rem; border: 1px solid var(--border);
  border-radius: var(--radius); font-size: 12px; }
.pagination a:hover { background: var(--border); }
.pagination .current { background: var(--primary); color: #fff; border-color: var(--primary); }
dialog { border: none; border-radius: var(--radius); box-shadow: 0 8px 32px rgba(0,0,0,.18);
         padding: 2rem; max-width: 440px; width: 100%; }
dialog::backdrop { background: rgba(0,0,0,.4); }
.modal-title { font-size: 1rem; font-weight: 700; margin-bottom: .75rem; }
.modal-actions { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1.5rem; }
.toast-container { position: fixed; bottom: 1.5rem; right: 1.5rem; display: flex;
                   flex-direction: column; gap: .5rem; z-index: 100; }
.toast { padding: .65rem 1rem; border-radius: var(--radius); font-size: 13px; font-weight: 500;
         color: #fff; opacity: 0; transform: translateY(8px);
         transition: opacity .25s, transform .25s; }
.toast.show { opacity: 1; transform: translateY(0); }
.toast-success { background: var(--success); }
.toast-error   { background: var(--danger); }
`

export const toastScript = `
const _toastEl = document.getElementById('toast-container')
function toast(msg, type='success') {
  const el = document.createElement('div')
  el.className = 'toast toast-' + type
  el.textContent = msg
  _toastEl.appendChild(el)
  requestAnimationFrame(() => { el.classList.add('show') })
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 300)
  }, 3000)
}

async function adminAction(url, body={}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return true
  const j = await res.json().catch(() => ({}))
  toast(j.error ?? 'Something went wrong', 'error')
  return false
}
`

export function paginate(page: number, total: number, limit: number, baseUrl: string): string {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return ''
  const pages: string[] = []
  for (let p = 1; p <= totalPages; p++) {
    if (p === page) {
      pages.push(`<span class="current">${p}</span>`)
    } else {
      pages.push(`<a href="${baseUrl}?page=${p}">${p}</a>`)
    }
  }
  return `<div class="pagination">${pages.join('')}</div>`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function statusBadge(status: string): string {
  const map: Record<string, string> = {
    active: 'badge-green', suspended: 'badge-red',
    pending: 'badge-yellow', deleted: 'badge-gray',
  }
  return `<span class="badge ${map[status] ?? 'badge-gray'}">${status}</span>`
}

export function roleBadge(role: string): string {
  return `<span class="badge ${role === 'admin' ? 'badge-blue' : 'badge-gray'}">${role}</span>`
}
