import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import type { Db } from './db.ts'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>
const SESSION_MS = 14 * 24 * 3_600_000

export type User = { id: number; email: string; name: string; role: 'user' | 'admin'; status: 'pending' | 'approved' | 'blocked' }

export async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(pw, salt, 64)
  return ['scrypt', salt.toString('hex'), hash.toString('hex')].join('$')
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  return timingSafeEqual(await scryptAsync(pw, Buffer.from(salt, 'hex'), expected.length), expected)
}

const sha = (token: string) => createHash('sha256').update(token).digest('hex')

/** Devuelve el token para la cookie; en la base solo queda su hash. */
export function createSession(db: Db, user_id: number, now: number) {
  const token = randomBytes(32).toString('base64url')
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(now)
  db.prepare('INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)').run(sha(token), user_id, now + SESSION_MS)
  return token
}

export function userFromToken(db: Db, token: string | undefined, now: number): User | undefined {
  if (!token) return undefined
  return db.prepare(`SELECT u.id, u.email, u.name, u.role, u.status FROM auth_sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha(token), now) as User | undefined
}

export const dropSession = (db: Db, token: string) => db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha(token))
export const dropUserSessions = (db: Db, user_id: number) => db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user_id)

/** Límite de intentos en memoria. ponytail: se pierde al reiniciar y es por proceso; alcanza para un solo servidor. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>()
  return (key: string, now: number) => {
    if (hits.size > 10_000) hits.clear()
    const h = hits.get(key)
    if (!h || now > h.reset) { hits.set(key, { n: 1, reset: now + windowMs }); return true }
    return ++h.n <= max
  }
}
