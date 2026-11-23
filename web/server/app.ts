import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Db } from './db.ts'
import type { Media } from './media.ts'
import * as auth from './auth.ts'
import * as turns from './turn.ts'
import { HOUR, RuleError } from './turn.ts'

type Env = { Variables: { user: auth.User } }
type Live = { session_id: number; user_id: number; booking_id: number }

class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 429 | 503
  constructor(status: HttpError['status'], message: string) { super(message); this.status = status }
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/
// Hash de relleno para que el login tarde lo mismo exista o no el correo.
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '0'.repeat(128)

export function createApp(opts: { db: Db; origin: string; media: Media; now?: () => number }) {
  const { db, origin, media } = opts
  const now = opts.now ?? Date.now
  const secure = origin.startsWith('https://')
  const COOKIE = secure ? '__Host-sid' : 'sid'
  const loginLimit = auth.rateLimiter(8, 15 * 60_000)
  const globalLimit = auth.rateLimiter(200, 15 * 60_000)
  const signupLimit = auth.rateLimiter(20, 3_600_000)
  let live: Live | null = null
  let stopPending = false // un stop que falló se reintenta en cada barrido
  let offerLock: Promise<unknown> = Promise.resolve() // una sola conexión armándose a la vez
  const watchLimit = auth.rateLimiter(20, 5 * 60_000)
  const watchOwner = new Map<number, number>() // id de conexión de espectador → usuario que la pidió

  const q = <T>(sql: string, ...a: (string | number | null)[]) => db.prepare(sql).all(...a) as T[]
  const str = (v: unknown, min: number, max: number, what: string) => {
    if (typeof v !== 'string' || v.length < min || v.length > max) throw new HttpError(400, `${what} inválido`)
    return v
  }
  const id = (c: Context) => {
    const n = Number(c.req.param('id'))
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Id inválido')
    return n
  }
  const json = async (c: Context) => {
    const b = await c.req.json().catch(() => null)
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Cuerpo inválido')
    return b as Record<string, unknown>
  }

  async function closeLive(reason: string) {
    if (!live) return
    db.prepare('UPDATE play_sessions SET ended_at = ?, end_reason = ? WHERE id = ?').run(now(), reason, live.session_id)
    live = null
    watchOwner.clear() // media cierra a los espectadores junto con la partida
    stopPending = true
    await stopMedia()
  }

  // media también corta sola por expires_at; esto cubre cortes anticipados (admin, bloqueo, reinicio de web).
  async function stopMedia() {
    if (!stopPending) return
    try { await media({ op: 'stop' }); stopPending = false } catch { /* se reintenta en el próximo barrido */ }
  }

  /** Al arrancar: nadie puede seguir jugando con un turno que este proceso ya no vigila. */
  async function recover() {
    db.prepare("UPDATE play_sessions SET ended_at = ?, end_reason = 'restart' WHERE ended_at IS NULL").run(now())
    stopPending = true
    await stopMedia()
  }

  /** Mantenimiento periódico: avanza la fila y corta el stream si el turno ya no es de quien juega. */
  async function sweep() {
    turns.tick(db, now())
    const t = turns.currentTurn(db, now())
    if (live && (t?.booking_id !== live.booking_id || t.user_id !== live.user_id)) await closeLive('expired')
    else await stopMedia()
    return t
  }

  const app = new Hono<Env>()

  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status)
    if (e instanceof RuleError) return c.json({ error: e.message }, 400)
    console.error(e)
    return c.json({ error: 'Error interno' }, 500)
  })

  app.use('*', async (c, next) => {
    await next()
    c.header('Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'")
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    if (secure) c.header('Strict-Transport-Security', 'max-age=31536000')
  })

  const api = new Hono<Env>()
  api.use('*', bodyLimit({ maxSize: 64 * 1024 }))
  api.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    // CSRF: además de SameSite=Strict, todo lo que modifica exige el Origin propio.
    if (c.req.method !== 'GET' && c.req.header('Origin') !== origin) throw new HttpError(403, 'Origen no permitido')
    const u = auth.userFromToken(db, getCookie(c, COOKIE), now())
    if (u) c.set('user', u)
    await next()
  })

  const needUser = (c: Context<Env>) => {
    const u = c.get('user')
    if (!u) throw new HttpError(401, 'Inicia sesión')
    if (u.status === 'blocked') throw new HttpError(403, 'Cuenta bloqueada')
    return u
  }
  const needApproved = (c: Context<Env>) => {
    const u = needUser(c)
    if (u.status !== 'approved') throw new HttpError(403, 'Tu cuenta aún no está aprobada')
    return u
  }
  const needAdmin = (c: Context<Env>) => {
    const u = needUser(c)
    if (u.role !== 'admin') throw new HttpError(403, 'Solo admin')
    return u
  }
  const startSession = (c: Context, user_id: number) =>
    setCookie(c, COOKIE, auth.createSession(db, user_id, now()), { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: 14 * 86400 })

  api.get('/health', (c) => c.json({ ok: true }))

  // ── Cuentas ────────────────────────────────────────────────────────────────
  api.post('/signup', async (c) => {
    const b = await json(c)
    if (!signupLimit('all', now())) throw new HttpError(429, 'Demasiados registros. Intenta más tarde.')
    const email = str(b.email, 5, 254, 'Correo').trim().toLowerCase()
    if (!EMAIL.test(email)) throw new HttpError(400, 'Correo inválido')
    const name = str(b.name, 2, 40, 'Nombre').replace(/[\p{C}<>]/gu, '').trim()
    if (name.length < 2) throw new HttpError(400, 'Nombre inválido')
    const password = str(b.password, 10, 200, 'Contraseña (mínimo 10 caracteres)')
    const hash = await auth.hashPassword(password)
    let user_id: number
    try {
      user_id = Number(db.prepare('INSERT INTO users(email, name, pass_hash, created_at) VALUES(?, ?, ?, ?)').run(email, name, hash, now()).lastInsertRowid)
    } catch { throw new HttpError(409, 'Ese correo ya tiene una cuenta') }
    startSession(c, user_id)
    return c.json({ ok: true })
  })

  api.post('/login', async (c) => {
    const b = await json(c)
    const email = str(b.email, 1, 254, 'Correo').trim().toLowerCase()
    const password = str(b.password, 1, 200, 'Contraseña')
    if (!globalLimit('login', now()) || !loginLimit(email, now())) throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos.')
    const row = db.prepare('SELECT id, pass_hash, status FROM users WHERE email = ?').get(email) as { id: number; pass_hash: string; status: string } | undefined
    const ok = await auth.verifyPassword(password, row?.pass_hash ?? DUMMY_HASH)
    if (!row || !ok) throw new HttpError(401, 'Correo o contraseña incorrectos')
    if (row.status === 'blocked') throw new HttpError(403, 'Cuenta bloqueada')
    startSession(c, row.id)
    return c.json({ ok: true })
  })

  api.post('/logout', (c) => {
    const token = getCookie(c, COOKIE)
    if (token) auth.dropSession(db, token)
    deleteCookie(c, COOKIE, { path: '/', secure })
    return c.json({ ok: true })
  })

  // ── Estado (lo consulta la página cada pocos segundos) ─────────────────────
  api.get('/state', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ user: null })
    const t = await sweep()
    const queue = q<{ id: number; user_id: number; status: string; name: string }>(
      "SELECT b.id, b.user_id, b.status, u.name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.kind = 'queue' AND b.status IN ('requested','confirmed') AND b.started_at IS NULL ORDER BY b.created_at, b.id")
    const approved = queue.filter((e) => e.status === 'confirmed')
    const mine = queue.find((e) => e.user_id === user.id)
    // Hay algo que mirar solo mientras alguien está conectado a la consola.
    // Si media es una versión sin modo espectador, su estado no trae "watchers" y el botón de mirar no se ofrece.
    const st = live ? await media({ op: 'status' }).catch(() => ({} as Record<string, unknown>)) : {} as Record<string, unknown>
    const names = user.status === 'approved' // los nombres solo los ven las cuentas aprobadas
    return c.json({
      now: now(),
      user,
      turn: t && { mine: t.user_id === user.id, state: t.state, kind: t.kind, ends_at: t.ends_at },
      live: !!live && st.watchers !== undefined,
      watching: Number(st.watchers ?? 0),
      queue: {
        length: approved.length,
        // Quiénes están en la fila, en orden: primero los aprobados (con su puesto) y después los que esperan aprobación.
        people: names ? [...approved, ...queue.filter((e) => e.status !== 'confirmed')].map((e) => ({ name: e.name, status: e.status, me: e.user_id === user.id })) : [],
        mine: mine ? { id: mine.id, status: mine.status, position: approved.findIndex((e) => e.id === mine.id) + 1 } : null,
      },
    })
  })

  // ── Reservas ───────────────────────────────────────────────────────────────
  api.get('/calendar', (c) => {
    const user = needUser(c)
    const t = now()
    turns.tick(db, t)
    const s = turns.getSettings(db)
    const first = Math.floor(t / HOUR) * HOUR
    const last = first + s.horizon_days * 24 * HOUR
    const rows = q<{ id: number; user_id: number; start_at: number; status: string; name: string }>(
      "SELECT b.id, b.user_id, b.start_at, b.status, u.name FROM bookings b JOIN users u ON u.id = b.user_id WHERE b.kind = 'slot' AND b.status IN ('requested','confirmed') AND b.start_at BETWEEN ? AND ? ORDER BY b.created_at, b.id", first, last)
    const names = user.status === 'approved' // los nombres solo los ven las cuentas aprobadas
    const days: { date: string; slots: object[] }[] = []
    for (let at = first; at <= last; at += HOUR) {
      if (!turns.isOpen(s, at)) continue
      const { date, hour } = turns.santiago(at)
      const here = rows.filter((r) => r.start_at === at)
      const waiting = here.filter((r) => r.status === 'requested')
      const mine = here.find((r) => r.user_id === user.id)
      if (days.at(-1)?.date !== date) days.push({ date, slots: [] })
      days.at(-1)!.slots.push({
        start_at: at, hour,
        taken: here.some((r) => r.status === 'confirmed'),
        by: names ? here.find((r) => r.status === 'confirmed')?.name ?? null : null, // quién tiene la reserva confirmada
        waiting: waiting.length,
        waiting_names: names ? waiting.map((r) => r.name) : [],
        mine: mine ? { id: mine.id, status: mine.status, position: waiting.findIndex((r) => r.id === mine.id) + 1 } : null,
      })
    }
    return c.json({ days, rules: s })
  })

  api.post('/bookings', async (c) => {
    const user = needApproved(c)
    const b = await json(c)
    return c.json({ id: turns.requestSlot(db, user.id, Number(b.start_at), now()) })
  })

  api.post('/queue', (c) => c.json({ id: turns.joinQueue(db, needApproved(c).id, now()) }))

  api.delete('/bookings/:id', async (c) => {
    turns.cancelOwn(db, needUser(c).id, id(c))
    await sweep()
    return c.json({ ok: true })
  })

  // ── Jugar ──────────────────────────────────────────────────────────────────
  api.post('/play/offer', (c) => {
    // En serie: dos ofertas a la vez dejarían una sesión huérfana y dos conexiones peleando por la consola.
    const run = offerLock.then(() => offer(c), () => offer(c))
    offerLock = run.catch(() => {})
    return run
  })

  async function offer(c: Context<Env>) {
    // Señalización en dos pasos: el servidor de streaming ofrece (él define los códecs) y el navegador responde.
    const user = needApproved(c)
    let t = await sweep()
    if (!t || t.user_id !== user.id) throw new HttpError(403, 'No es tu turno')
    await closeLive('reconnect') // una sola conexión: la nueva reemplaza a la anterior
    t = turns.startTurn(db, t, now())
    // El stop anterior es asíncrono: el turno pudo vencer o cambiar de dueño mientras tanto.
    if (!t || t.user_id !== user.id) throw new HttpError(403, 'No es tu turno')
    let offer: Record<string, unknown>
    try { offer = await media({ op: 'start', expires_at: t.ends_at }) }
    catch (e) { throw new HttpError(503, (e as Error).message) }
    const session_id = Number(db.prepare('INSERT INTO play_sessions(booking_id, user_id, started_at) VALUES(?, ?, ?)').run(t.booking_id, user.id, now()).lastInsertRowid)
    live = { session_id, user_id: user.id, booking_id: t.booking_id }
    return c.json({ sdp: String(offer.sdp), ends_at: t.ends_at })
  }

  api.post('/play/answer', async (c) => {
    const user = needUser(c)
    if (live?.user_id !== user.id) throw new HttpError(409, 'Sin sesión activa')
    const sdp = str((await json(c)).sdp, 10, 20_000, 'SDP')
    if (!sdp.startsWith('v=0')) throw new HttpError(400, 'SDP inválido')
    try { await media({ op: 'answer', sdp }) }
    catch (e) { throw new HttpError(503, (e as Error).message) }
    return c.json({ ok: true })
  })

  api.post('/play/stats', async (c) => {
    const user = needUser(c)
    if (live?.user_id !== user.id) throw new HttpError(409, 'Sin sesión activa')
    const b = await json(c)
    const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0)
    // Promedio acumulado: nuevo = (viejo * n + x) / (n + 1)
    db.prepare(`UPDATE play_sessions SET
        rtt_ms = (COALESCE(rtt_ms, 0) * samples + ?) / (samples + 1),
        loss_pct = (COALESCE(loss_pct, 0) * samples + ?) / (samples + 1),
        jitter_ms = (COALESCE(jitter_ms, 0) * samples + ?) / (samples + 1),
        decode_ms = (COALESCE(decode_ms, 0) * samples + ?) / (samples + 1),
        samples = samples + 1 WHERE id = ?`)
      .run(num(b.rtt_ms, 5000), num(b.loss_pct, 100), num(b.jitter_ms, 5000), num(b.decode_ms, 5000), live.session_id)
    return c.json({ ok: true })
  })

  api.post('/play/leave', async (c) => {
    if (live?.user_id === needUser(c).id) await closeLive('left')
    return c.json({ ok: true })
  })

  // ── Mirar (modo espectador) ────────────────────────────────────────────────
  // Solo recepción: media no les crea canal de mando, así que no pueden enviar ningún input.
  // No toca el turno ni la conexión de quien juega.
  api.post('/watch/offer', async (c) => {
    const user = needApproved(c)
    await sweep()
    if (!live) throw new HttpError(409, 'Nadie está jugando ahora')
    if (live.user_id === user.id) throw new HttpError(409, 'Tú estás jugando')
    if (!watchLimit(String(user.id), now())) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.')
    let offer: Record<string, unknown>
    try { offer = await media({ op: 'watch' }) }
    catch (e) { throw new HttpError(503, (e as Error).message) }
    const watchId = Number(offer.id)
    watchOwner.set(watchId, user.id)
    return c.json({ sdp: String(offer.sdp), id: watchId })
  })

  api.post('/watch/answer', async (c) => {
    const user = needApproved(c)
    const b = await json(c)
    const watchId = Number(b.id)
    if (!live || watchOwner.get(watchId) !== user.id) throw new HttpError(409, 'Sin conexión para mirar')
    const sdp = str(b.sdp, 10, 20_000, 'SDP')
    if (!sdp.startsWith('v=0')) throw new HttpError(400, 'SDP inválido')
    watchOwner.delete(watchId) // una respuesta por conexión
    try { await media({ op: 'watch_answer', id: watchId, sdp }) }
    catch (e) { throw new HttpError(503, (e as Error).message) }
    return c.json({ ok: true })
  })

  // ── Admin ──────────────────────────────────────────────────────────────────
  api.get('/admin/overview', async (c) => {
    needAdmin(c)
    const t = await sweep()
    const since = now() - 14 * 24 * HOUR
    return c.json({
      now: now(),
      users: q(`SELECT u.id, u.email, u.name, u.role, u.status, u.created_at,
                  COALESCE((SELECT SUM(COALESCE(ended_at, ?) - started_at) FROM play_sessions p WHERE p.user_id = u.id), 0) AS played_ms
                FROM users u ORDER BY u.status = 'pending' DESC, u.created_at DESC`, now()),
      bookings: q(`SELECT b.id, b.user_id, u.name, b.kind, b.start_at, b.status, b.created_at, b.offered_at, b.started_at
                   FROM bookings b JOIN users u ON u.id = b.user_id
                   WHERE b.status IN ('requested','confirmed') ORDER BY b.start_at IS NULL, b.start_at, b.created_at, b.id`),
      turn: t && {
        ...t,
        name: (db.prepare('SELECT name FROM users WHERE id = ?').get(t.user_id) as { name: string }).name,
        live: live && db.prepare('SELECT started_at, rtt_ms, loss_pct, jitter_ms, decode_ms FROM play_sessions WHERE id = ?').get(live.session_id),
      },
      media: await media({ op: 'status' }).catch((e: Error) => ({ error: e.message })),
      sessions: q(`SELECT p.id, u.name, p.started_at, p.ended_at, p.end_reason, p.rtt_ms, p.loss_pct, p.jitter_ms, p.decode_ms
                   FROM play_sessions p JOIN users u ON u.id = p.user_id WHERE p.started_at > ? ORDER BY p.started_at DESC LIMIT 200`, since),
      rules: turns.getSettings(db),
    })
  })

  api.post('/admin/users/:id', async (c) => {
    const admin = needAdmin(c)
    const target = id(c)
    const status = (await json(c)).status
    if (status !== 'approved' && status !== 'blocked' && status !== 'pending') throw new HttpError(400, 'Estado inválido')
    if (target === admin.id) throw new HttpError(400, 'No puedes cambiar tu propia cuenta')
    if (!db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, target).changes) throw new HttpError(404, 'Usuario no encontrado')
    if (status !== 'approved') { // bloquear o devolver a pendiente: pierde reservas y turno en curso
      if (status === 'blocked') auth.dropUserSessions(db, target)
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE user_id = ? AND status IN ('requested','confirmed')").run(target)
      await sweep()
    }
    return c.json({ ok: true })
  })

  api.post('/admin/bookings/:id', async (c) => {
    needAdmin(c)
    const status = (await json(c)).status
    if (status !== 'confirmed' && status !== 'rejected' && status !== 'cancelled') throw new HttpError(400, 'Estado inválido')
    turns.decide(db, id(c), status)
    await sweep()
    return c.json({ ok: true })
  })

  api.post('/admin/turn', async (c) => {
    needAdmin(c)
    const action = (await json(c)).action
    const call = (req: Parameters<Media>[0]) => media(req).catch((e: Error) => { throw new HttpError(503, e.message) })
    if (action === 'wake') { await call({ op: 'wake' }); return c.json({ ok: true }) }
    const t = await sweep()
    if (!t) throw new HttpError(409, 'No hay turno en curso')
    if (action === 'cut') {
      turns.endTurn(db, t.booking_id)
      await sweep()
    } else if (action === 'extend') {
      turns.extendTurn(db, t.booking_id, 15)
      const next = turns.currentTurn(db, now())
      if (live && next) await media({ op: 'extend', expires_at: next.ends_at }).catch(() => {})
    } else if (action === 'ps') {
      await call({ op: 'button', button: 'PS' })
    } else throw new HttpError(400, 'Acción inválida')
    return c.json({ ok: true })
  })

  api.put('/admin/settings', async (c) => {
    needAdmin(c)
    turns.setSettings(db, (await json(c)) as unknown as turns.Settings)
    return c.json({ ok: true })
  })

  api.all('*', () => { throw new HttpError(404, 'No existe') })
  app.route('/api', api)
  return { app, sweep, recover }
}
