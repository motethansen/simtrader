import { css } from './base'

const authLayout = (title: string, content: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — SimTrader</title>
  <style>
    ${css}
    .auth-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .auth-box { width: 100%; max-width: 400px; }
    .auth-logo { font-size: 1.4rem; font-weight: 800; color: var(--primary); margin-bottom: 2rem; }
    .auth-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 1.5rem; }
    .auth-footer { margin-top: 1.25rem; font-size: 13px; color: var(--muted); text-align: center; }
    form button[type=submit] { width: 100%; margin-top: .5rem; justify-content: center; padding: .65rem; }
  </style>
</head>
<body>
  <div class="auth-wrap">
    <div class="auth-box">
      <div class="auth-logo">📈 SimTrader</div>
      ${content}
    </div>
  </div>
</body>
</html>`

export function loginPage(opts: { error: string | null; redirectTo: string | null }): string {
  return authLayout('Log in', `
    <h1 class="auth-title">Log in to your account</h1>
    ${opts.error ? `<div class="alert alert-error">${opts.error}</div>` : ''}
    <form method="POST" action="/auth/login" class="card">
      ${opts.redirectTo ? `<input type="hidden" name="next" value="${opts.redirectTo}">` : ''}
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email">
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-primary">Log in</button>
    </form>
    <p class="auth-footer">Don't have an account? <a href="/auth/signup">Sign up</a></p>
  `)
}

export function signupPage(opts: { error: string | null }): string {
  return authLayout('Sign up', `
    <h1 class="auth-title">Create an account</h1>
    ${opts.error ? `<div class="alert alert-error">${opts.error}</div>` : ''}
    <form method="POST" action="/auth/signup" class="card">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email">
      </div>
      <div class="form-group">
        <label for="password">Password <span style="color:var(--muted);font-weight:400">(min 12 chars)</span></label>
        <input type="password" id="password" name="password" required minlength="12" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label for="confirm">Confirm password</label>
        <input type="password" id="confirm" name="confirm" required minlength="12" autocomplete="new-password">
      </div>
      <button type="submit" class="btn btn-primary">Create account</button>
    </form>
    <p class="auth-footer">Already have an account? <a href="/auth/login">Log in</a></p>
  `)
}
