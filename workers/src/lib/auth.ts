// Password hashing via Web Crypto PBKDF2 (hardware-accelerated in Workers, no CPU-time cost).
// Format: `pbkdf2:<salt_hex>:<hash_hex>` — compatible with the Python CLI seed-admin command.

const ITERATIONS = 600_000
const SALT_BYTES = 16
const KEY_BITS = 256

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return out
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key, KEY_BITS
  )
  return `pbkdf2:${toHex(salt)}:${toHex(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false
  const salt = fromHex(parts[1]!)
  const expectedHash = fromHex(parts[2]!)

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key, KEY_BITS
  )
  const actualHash = new Uint8Array(bits)

  // Constant-time comparison
  if (actualHash.length !== expectedHash.length) return false
  let diff = 0
  for (let i = 0; i < actualHash.length; i++) diff |= actualHash[i]! ^ expectedHash[i]!
  return diff === 0
}

export function generateToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}
