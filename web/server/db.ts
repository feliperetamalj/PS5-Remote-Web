import { DatabaseSync } from 'node:sqlite'
import { readFileSync, statSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export type Config = { public_origin: string; port: number; data_dir: string; media_socket: string }

const expand = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : resolve(p))

export function loadConfig(path = process.env.PS5_CONFIG ?? join(homedir(), '.config/ps5-stream/config.json')): Config {
  // El archivo también guarda las claves de la PS5: si otros pueden leerlo, no arrancamos.
  if (statSync(path).mode & 0o077) throw new Error(`${path} debe tener permisos 600 (chmod 600 ${path})`)
  const c = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof c.public_origin !== 'string' || !/^https?:\/\/[^/\s]+$/.test(c.public_origin))
    throw new Error('config.public_origin debe ser un origen, por ejemplo https://ps5.tudominio.cl')
  const data_dir = expand(c.data_dir ?? '~/.local/share/ps5-stream')
  mkdirSync(data_dir, { recursive: true, mode: 0o700 })
  return {
    public_origin: c.public_origin,
    port: Number(c.port ?? 8080),
    data_dir,
    media_socket: expand(c.media_socket ?? join(data_dir, 'media.sock')),
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','blocked')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
-- kind='slot': reserva de una hora (start_at = inicio de la hora, ms UTC).
-- kind='queue': entrada a la fila en vivo (start_at NULL).
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('slot','queue')),
  start_at INTEGER,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK(status IN ('requested','confirmed','rejected','cancelled','done')),
  created_at INTEGER NOT NULL,
  offered_at INTEGER,
  started_at INTEGER,
  extra_min INTEGER NOT NULL DEFAULT 0,
  CHECK ((kind = 'slot') = (start_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_confirmed_per_slot
  ON bookings(start_at) WHERE kind = 'slot' AND status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS one_request_per_user_slot
  ON bookings(user_id, start_at) WHERE kind = 'slot' AND status IN ('requested','confirmed');
CREATE UNIQUE INDEX IF NOT EXISTS one_queue_entry_per_user
  ON bookings(user_id) WHERE kind = 'queue' AND status IN ('requested','confirmed');
CREATE INDEX IF NOT EXISTS bookings_by_start ON bookings(kind, status, start_at);
CREATE TABLE IF NOT EXISTS play_sessions(
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT,
  samples INTEGER NOT NULL DEFAULT 0,
  rtt_ms REAL, loss_pct REAL, jitter_ms REAL, decode_ms REAL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export function openDb(file: string) {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;')
  db.exec(SCHEMA)
  return db
}

export type Db = DatabaseSync
