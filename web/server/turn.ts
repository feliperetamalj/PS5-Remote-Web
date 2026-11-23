// Reservas, fila en vivo y turnos. Toda la lógica de "quién puede jugar ahora" vive aquí.
import type { Db } from './db.ts'

export const HOUR = 3_600_000
export const OFFER_MS = 5 * 60_000 // tiempo que tiene el primero de la fila para apretar "Jugar"
export const MIN_QUEUE_TURN_MS = 10 * 60_000 // no se ofrece la fila si falta menos que esto para una reserva

export type Booking = {
  id: number; user_id: number; kind: 'slot' | 'queue'; start_at: number | null
  status: 'requested' | 'confirmed' | 'rejected' | 'cancelled' | 'done'
  created_at: number; offered_at: number | null; started_at: number | null; extra_min: number
}
export type Turn = { booking_id: number; user_id: number; kind: 'slot' | 'queue'; ends_at: number; state: 'active' | 'offered' }
export type Settings = { open_hours: [number, number][]; max_hours_per_day: number; horizon_days: number }

export class RuleError extends Error {}

const DEFAULTS: Settings = {
  open_hours: Array.from({ length: 7 }, () => [10, 24] as [number, number]), // índice 0 = domingo
  max_hours_per_day: 2,
  horizon_days: 7,
}

export function getSettings(db: Db): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'rules'").get() as { value: string } | undefined
  return row ? { ...DEFAULTS, ...JSON.parse(row.value) } : DEFAULTS
}

export function setSettings(db: Db, s: Settings) {
  const int = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi
  if (!Array.isArray(s.open_hours) || s.open_hours.length !== 7 ||
      !s.open_hours.every((d) => Array.isArray(d) && d.length === 2 && int(d[0], 0, 24) && int(d[1], 0, 24) && d[0] <= d[1]) ||
      !int(s.max_hours_per_day, 1, 24) || !int(s.horizon_days, 1, 30))
    throw new RuleError('Configuración inválida')
  const value = JSON.stringify({ open_hours: s.open_hours, max_hours_per_day: s.max_hours_per_day, horizon_days: s.horizon_days })
  db.prepare("INSERT INTO settings(key, value) VALUES('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value)
}

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
})
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Fecha, hora y día de la semana en Santiago (los horarios se definen en hora local). */
export function santiago(t: number) {
  const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: WEEKDAYS.indexOf(p.weekday) }
}

export function isOpen(s: Settings, start_at: number) {
  const { hour, weekday } = santiago(start_at)
  const [from, to] = s.open_hours[weekday]
  return hour >= from && hour < to
}

const one = <T>(db: Db, sql: string, ...args: (number | string | null)[]) => db.prepare(sql).get(...args) as T | undefined

export function requestSlot(db: Db, user_id: number, start_at: number, now: number): number {
  const s = getSettings(db)
  if (!Number.isInteger(start_at) || start_at % HOUR !== 0) throw new RuleError('Bloque inválido')
  if (start_at + HOUR <= now) throw new RuleError('Ese bloque ya pasó')
  if (start_at > now + s.horizon_days * 24 * HOUR) throw new RuleError(`Solo se puede reservar con ${s.horizon_days} días de anticipación`)
  if (!isOpen(s, start_at)) throw new RuleError('La consola no está disponible a esa hora')
  // Límite diario: cuenta lo pedido, confirmado y jugado ese día (hora de Santiago).
  const day = santiago(start_at).date
  const mine = db.prepare("SELECT start_at FROM bookings WHERE user_id = ? AND kind = 'slot' AND status IN ('requested','confirmed','done') AND start_at BETWEEN ? AND ?")
    .all(user_id, start_at - 24 * HOUR, start_at + 24 * HOUR) as { start_at: number }[]
  if (mine.some((b) => b.start_at === start_at)) throw new RuleError('Ya pediste ese bloque')
  if (mine.filter((b) => santiago(b.start_at).date === day).length >= s.max_hours_per_day)
    throw new RuleError(`Máximo ${s.max_hours_per_day} h por día`)
  return Number(db.prepare("INSERT INTO bookings(user_id, kind, start_at, created_at) VALUES(?, 'slot', ?, ?)").run(user_id, start_at, now).lastInsertRowid)
}

export function joinQueue(db: Db, user_id: number, now: number): number {
  if (one(db, "SELECT 1 FROM bookings WHERE user_id = ? AND kind = 'queue' AND status IN ('requested','confirmed')", user_id))
    throw new RuleError('Ya estás en la fila')
  return Number(db.prepare("INSERT INTO bookings(user_id, kind, created_at) VALUES(?, 'queue', ?)").run(user_id, now).lastInsertRowid)
}

/** El dueño cancela su reserva o sale de la fila. */
export function cancelOwn(db: Db, user_id: number, id: number) {
  const r = db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status IN ('requested','confirmed')").run(id, user_id)
  if (!r.changes) throw new RuleError('Reserva no encontrada')
}

/** Felipe confirma, rechaza o cancela. El índice único impide dos confirmadas en el mismo bloque. */
export function decide(db: Db, id: number, status: 'confirmed' | 'rejected' | 'cancelled') {
  const from = status === 'cancelled' ? "('requested','confirmed')" : "('requested')"
  try {
    const r = db.prepare(`UPDATE bookings SET status = ? WHERE id = ? AND status IN ${from}`).run(status, id)
    if (!r.changes) throw new RuleError('La reserva ya no está en ese estado')
  } catch (e) {
    if (e instanceof RuleError) throw e
    throw new RuleError('Ese bloque ya tiene una reserva confirmada')
  }
}

const slotEnd = (b: Booking) => b.start_at! + HOUR + b.extra_min * 60_000

function nextSlotStart(db: Db, after: number): number {
  const r = one<{ t: number | null }>(db, "SELECT MIN(start_at) AS t FROM bookings WHERE kind = 'slot' AND status = 'confirmed' AND start_at > ?", after)
  return r?.t ?? Infinity
}

function slotTurn(db: Db, now: number): Turn | null {
  const b = one<Booking>(db, "SELECT * FROM bookings WHERE kind = 'slot' AND status = 'confirmed' AND start_at <= ? ORDER BY start_at DESC LIMIT 1", now)
  if (!b) return null
  const ends_at = Math.min(slotEnd(b), nextSlotStart(db, b.start_at!)) // una extensión nunca pisa la reserva siguiente
  return now < ends_at ? { booking_id: b.id, user_id: b.user_id, kind: 'slot', ends_at, state: 'active' } : null
}

const queueEnd = (db: Db, b: Booking) => Math.min(b.started_at! + HOUR + b.extra_min * 60_000, nextSlotStart(db, b.started_at!))

/**
 * Mantenimiento idempotente; se llama antes de cada lectura y cada pocos segundos.
 * Cierra turnos vencidos y hace avanzar la fila.
 */
export function tick(db: Db, now: number) {
  db.prepare("UPDATE bookings SET status = 'done' WHERE kind = 'slot' AND status = 'confirmed' AND start_at + ? + extra_min * 60000 <= ?").run(HOUR, now)
  db.prepare("UPDATE bookings SET status = 'rejected' WHERE kind = 'slot' AND status = 'requested' AND start_at + ? <= ?").run(HOUR, now)

  const active = one<Booking>(db, "SELECT * FROM bookings WHERE kind = 'queue' AND status = 'confirmed' AND started_at IS NOT NULL")
  if (active && now >= queueEnd(db, active)) db.prepare("UPDATE bookings SET status = 'done' WHERE id = ?").run(active.id)
  else if (active) return

  if (slotTurn(db, now)) {
    // Mientras juega una reserva, nadie de la fila tiene oferta corriendo.
    db.exec("UPDATE bookings SET offered_at = NULL WHERE kind = 'queue' AND status = 'confirmed' AND started_at IS NULL")
    return
  }
  if (nextSlotStart(db, now) - now < MIN_QUEUE_TURN_MS) return
  for (;;) {
    const head = one<Booking>(db, "SELECT * FROM bookings WHERE kind = 'queue' AND status = 'confirmed' ORDER BY created_at, id LIMIT 1")
    if (!head) return
    if (head.offered_at === null) { db.prepare('UPDATE bookings SET offered_at = ? WHERE id = ?').run(now, head.id); return }
    if (now < head.offered_at + OFFER_MS) return
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(head.id) // no apareció: pasa el siguiente
  }
}

/** Quién puede jugar en este instante. Llama a tick() antes. */
export function currentTurn(db: Db, now: number): Turn | null {
  const slot = slotTurn(db, now)
  if (slot) return slot
  const q = one<Booking>(db, "SELECT * FROM bookings WHERE kind = 'queue' AND status = 'confirmed' AND (started_at IS NOT NULL OR offered_at IS NOT NULL) ORDER BY started_at IS NULL, created_at, id LIMIT 1")
  if (!q) return null
  if (q.started_at !== null) {
    const ends_at = queueEnd(db, q)
    return now < ends_at ? { booking_id: q.id, user_id: q.user_id, kind: 'queue', ends_at, state: 'active' } : null
  }
  const ends_at = q.offered_at! + OFFER_MS
  return now < ends_at ? { booking_id: q.id, user_id: q.user_id, kind: 'queue', ends_at, state: 'offered' } : null
}

/** El jugador entra: fija el inicio del turno (para la fila, desde aquí corren los 60 min). */
export function startTurn(db: Db, turn: Turn, now: number): Turn {
  db.prepare('UPDATE bookings SET started_at = COALESCE(started_at, ?) WHERE id = ?').run(now, turn.booking_id)
  return currentTurn(db, now)!
}

export function extendTurn(db: Db, booking_id: number, minutes: number) {
  db.prepare('UPDATE bookings SET extra_min = extra_min + ? WHERE id = ?').run(minutes, booking_id)
}

/** Felipe corta el turno en curso. */
export function endTurn(db: Db, booking_id: number) {
  db.prepare("UPDATE bookings SET status = 'done' WHERE id = ? AND status = 'confirmed'").run(booking_id)
}
