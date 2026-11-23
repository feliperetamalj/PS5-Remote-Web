import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from './db.ts'
import { createApp } from './app.ts'
import * as turns from './turn.ts'
import { HOUR, OFFER_MS } from './turn.ts'
import { hashPassword, verifyPassword } from './auth.ts'

const ORIGIN = 'http://localhost:5173'
// Lunes 2026-11-23 15:00 en Santiago (UTC-3), dentro del horario por defecto (10 a 24).
const T0 = Date.UTC(2026, 10, 23, 18, 0, 0)

function setup() {
  const db = openDb(':memory:')
  const clock = { t: T0 + 60_000 }
  const calls: string[] = []
  const { app, sweep } = createApp({
    db, origin: ORIGIN, now: () => clock.t,
    media: async (r) => { calls.push(r.op); return { sdp: 'v=0 oferta del servidor', id: 7, watchers: 1 } },
  })
  const user = (name: string, status = 'approved', role = 'user') =>
    Number(db.prepare('INSERT INTO users(email, name, pass_hash, role, status, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(`${name}@x.cl`, name, 'x', role, status, T0).lastInsertRowid)
  return { db, clock, calls, app, sweep, user }
}

/** Cliente de prueba que guarda la cookie como un navegador. */
function client(app: ReturnType<typeof createApp>['app']) {
  let cookie = ''
  return async (method: string, path: string, body?: unknown, origin = ORIGIN) => {
    const res = await app.request('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, body: (await res.json()) as any }
  }
}

test('scrypt: verifica la correcta y rechaza la incorrecta', async () => {
  const h = await hashPassword('una-clave-larga')
  assert.equal(await verifyPassword('una-clave-larga', h), true)
  assert.equal(await verifyPassword('otra-clave-larga', h), false)
  assert.equal(await verifyPassword('x', 'basura'), false)
})

test('reservas: reglas, lista de espera y una sola confirmada por bloque', () => {
  const { db, user } = setup()
  const [a, b] = [user('ana'), user('beto')]
  const slot = T0 + 2 * HOUR
  assert.throws(() => turns.requestSlot(db, a, slot + 1, T0), /inválido/)
  assert.throws(() => turns.requestSlot(db, a, T0 - 2 * HOUR, T0), /ya pasó/)
  assert.throws(() => turns.requestSlot(db, a, T0 + 30 * 24 * HOUR, T0), /anticipación/)
  assert.throws(() => turns.requestSlot(db, a, T0 + 12 * HOUR, T0), /no está disponible/) // 03:00 en Santiago
  const ra = turns.requestSlot(db, a, slot, T0)
  const rb = turns.requestSlot(db, b, slot, T0 + 1)
  assert.throws(() => turns.requestSlot(db, a, slot, T0), /Ya pediste/)
  turns.requestSlot(db, a, slot + HOUR, T0)
  assert.throws(() => turns.requestSlot(db, a, slot + 2 * HOUR, T0), /Máximo 2 h/)
  turns.decide(db, ra, 'confirmed')
  assert.throws(() => turns.decide(db, rb, 'confirmed'), /ya tiene una reserva confirmada/)
  // Ana cancela: ahora sí se puede confirmar al siguiente de la lista.
  turns.cancelOwn(db, a, ra)
  turns.decide(db, rb, 'confirmed')
  assert.throws(() => turns.cancelOwn(db, a, rb), /no encontrada/) // no puede cancelar la de otro
})

test('turnos: la reserva manda, la extensión no pisa la siguiente', () => {
  const { db, user } = setup()
  const [a, b] = [user('ana'), user('beto')]
  const ra = turns.requestSlot(db, a, T0, T0)
  const rb = turns.requestSlot(db, b, T0 + HOUR, T0)
  assert.equal(turns.currentTurn(db, T0 + 1), null) // pedida pero sin confirmar: nadie juega
  turns.decide(db, ra, 'confirmed')
  turns.decide(db, rb, 'confirmed')
  assert.deepEqual(turns.currentTurn(db, T0 + 1), { booking_id: ra, user_id: a, kind: 'slot', ends_at: T0 + HOUR, state: 'active' })
  turns.extendTurn(db, ra, 15)
  assert.equal(turns.currentTurn(db, T0 + 1)!.ends_at, T0 + HOUR) // tope: la reserva de Beto
  turns.tick(db, T0 + HOUR + 1)
  assert.equal(turns.currentTurn(db, T0 + HOUR + 1)!.user_id, b)
  turns.tick(db, T0 + 2 * HOUR)
  assert.equal(turns.currentTurn(db, T0 + 2 * HOUR), null)
})

test('fila en vivo: oferta de 5 min, pasa el siguiente, y termina al llegar una reserva', () => {
  const { db, user } = setup()
  const [a, b, c] = [user('ana'), user('beto'), user('caro')]
  const qa = turns.joinQueue(db, a, T0)
  const qb = turns.joinQueue(db, b, T0 + 1)
  assert.throws(() => turns.joinQueue(db, a, T0), /Ya estás/)
  turns.tick(db, T0 + 10)
  assert.equal(turns.currentTurn(db, T0 + 10), null) // Felipe aún no aprueba a nadie
  turns.decide(db, qa, 'confirmed')
  turns.decide(db, qb, 'confirmed')
  turns.tick(db, T0 + 10)
  assert.deepEqual(turns.currentTurn(db, T0 + 10), { booking_id: qa, user_id: a, kind: 'queue', ends_at: T0 + 10 + OFFER_MS, state: 'offered' })
  // Ana no aparece: la oferta pasa a Beto.
  const t1 = T0 + 10 + OFFER_MS
  turns.tick(db, t1)
  const offer = turns.currentTurn(db, t1)!
  assert.equal(offer.user_id, b)
  // Caro tiene la hora siguiente confirmada: el turno de Beto termina ahí y no a los 60 min.
  turns.decide(db, turns.requestSlot(db, c, T0 + HOUR, T0), 'confirmed')
  const active = turns.startTurn(db, offer, t1)!
  assert.deepEqual([active.state, active.ends_at], ['active', T0 + HOUR])
  turns.tick(db, T0 + HOUR)
  assert.equal(turns.currentTurn(db, T0 + HOUR)!.user_id, c)
})

test('fila: no se ofrece si falta poco para una reserva', () => {
  const { db, user } = setup()
  const [a, c] = [user('ana'), user('caro')]
  turns.decide(db, turns.requestSlot(db, c, T0 + HOUR, T0), 'confirmed')
  turns.decide(db, turns.joinQueue(db, a, T0), 'confirmed')
  turns.tick(db, T0 + HOUR - 5 * 60_000)
  assert.equal(turns.currentTurn(db, T0 + HOUR - 5 * 60_000), null)
})

test('API: registro pendiente, aprobación, juego y corte al vencer', async () => {
  const { db, clock, calls, app, sweep, user } = setup()
  const ana = client(app)
  const slot = T0 + HOUR

  assert.equal((await ana('POST', '/signup', { email: 'Ana@X.cl', name: 'Ana', password: 'corta' })).status, 400)
  assert.equal((await ana('POST', '/signup', { email: 'ana@x.cl', name: 'Ana', password: 'clave-larga-1' }, 'https://evil.example')).status, 403)
  assert.equal((await ana('POST', '/signup', { email: 'Ana@X.cl', name: 'Ana', password: 'clave-larga-1' })).status, 200)
  assert.equal((await ana('GET', '/state')).body.user.status, 'pending')
  assert.equal((await ana('POST', '/bookings', { start_at: slot })).status, 403) // pendiente no reserva
  assert.equal((await ana('GET', '/admin/overview')).status, 403)

  // El admin (creado fuera de la web) aprueba la cuenta y la reserva.
  const adminId = user('felipe', 'approved', 'admin')
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword('clave-de-admin'), adminId)
  const felipe = client(app)
  assert.equal((await felipe('POST', '/login', { email: 'felipe@x.cl', password: 'mala' })).status, 401)
  assert.equal((await felipe('POST', '/login', { email: 'felipe@x.cl', password: 'clave-de-admin' })).status, 200)
  const overview = (await felipe('GET', '/admin/overview')).body
  const anaId = overview.users.find((u: any) => u.email === 'ana@x.cl').id
  assert.equal((await felipe('POST', `/admin/users/${anaId}`, { status: 'approved' })).status, 200)

  const { body: booking } = await ana('POST', '/bookings', { start_at: slot })
  clock.t = slot + 1000
  assert.equal((await ana('POST', '/play/offer', {})).status, 403) // sin confirmar no juega
  clock.t = T0 + 60_000
  assert.equal((await felipe('POST', `/admin/bookings/${booking.id}`, { status: 'confirmed' })).status, 200)
  const cal = (await ana('GET', '/calendar')).body
  assert.equal(cal.days[0].slots.find((s: any) => s.start_at === slot).mine.status, 'confirmed')

  assert.equal((await ana('POST', '/play/offer', {})).status, 403) // todavía no empieza su hora
  clock.t = slot + 1000
  assert.equal((await felipe('POST', '/play/offer', {})).status, 403) // ni el admin entra en turno ajeno
  const play = await ana('POST', '/play/offer', {})
  assert.deepEqual([play.status, play.body.ends_at], [200, slot + HOUR])
  assert.equal((await felipe('POST', '/play/answer', { sdp: 'v=0 respuesta ajena' })).status, 409) // solo quien juega responde
  assert.equal((await ana('POST', '/play/answer', { sdp: 'basura' })).status, 400)
  assert.equal((await ana('POST', '/play/answer', { sdp: 'v=0 respuesta del navegador' })).status, 200)
  assert.equal((await ana('POST', '/play/stats', { rtt_ms: 10, loss_pct: 0, jitter_ms: 2, decode_ms: 4 })).status, 200)
  assert.equal((await ana('POST', '/play/stats', { rtt_ms: 20, loss_pct: 0, jitter_ms: 2, decode_ms: 4 })).status, 200)
  assert.equal((await felipe('GET', '/admin/overview')).body.turn.live.rtt_ms, 15)

  // Modo espectador: solo cuentas aprobadas, solo mientras alguien juega, y nunca quien juega.
  const beto = client(app)
  assert.equal((await beto('POST', '/signup', { email: 'beto@x.cl', name: 'Beto', password: 'clave-larga-2' })).status, 200)
  assert.equal((await beto('POST', '/watch/offer', {})).status, 403) // pendiente no mira
  assert.equal((await ana('POST', '/watch/offer', {})).status, 409) // la que juega no se mira a sí misma
  assert.deepEqual([(await felipe('GET', '/state')).body.live, (await felipe('GET', '/state')).body.watching], [true, 1])
  const watch = await felipe('POST', '/watch/offer', {})
  assert.deepEqual([watch.status, watch.body.id], [200, 7])
  assert.equal((await ana('POST', '/watch/answer', { id: 7, sdp: 'v=0 respuesta ajena' })).status, 409) // solo quien la pidió
  assert.equal((await felipe('POST', '/watch/answer', { id: 7, sdp: 'v=0 respuesta del espectador' })).status, 200)
  assert.equal((await felipe('POST', '/watch/answer', { id: 7, sdp: 'v=0 repetida' })).status, 409)

  // Vence la hora: el barrido corta el stream.
  clock.t = slot + HOUR + 1
  await sweep()
  assert.deepEqual(calls.filter((c) => c !== 'status'), ['start', 'answer', 'watch', 'watch_answer', 'stop'])
  assert.equal((await felipe('POST', '/watch/offer', {})).status, 409) // terminó la partida: nada que mirar
  assert.equal((await ana('POST', '/play/stats', { rtt_ms: 1 })).status, 409)
  assert.equal((await ana('POST', '/play/offer', {})).status, 403)

  // Bloquear cierra sus sesiones.
  await felipe('POST', `/admin/users/${anaId}`, { status: 'blocked' })
  assert.equal((await ana('GET', '/state')).body.user, null)
})
