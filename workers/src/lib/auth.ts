// Random token generation for session cookies.
//
// Password hashing used to live here. It is gone: BudgetApp is the only identity provider, so
// simtrader stores no passwords (ST-008).

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function generateToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}
