// Uso: npm run admin:create -- correo "Nombre"   |   npm run user:reset-password -- correo
// La contraseña se pide por teclado (o por PS5_PASSWORD) para que no quede en el historial del shell.
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import { loadConfig, openDb } from './db.ts'
import { hashPassword, dropUserSessions } from './auth.ts'

const [cmd, emailArg, name = 'Admin'] = process.argv.slice(2)
const email = emailArg?.trim().toLowerCase()
if (!email || (cmd !== 'admin:create' && cmd !== 'user:reset-password')) {
  console.error('Uso: cli.ts admin:create <correo> [nombre] | user:reset-password <correo>')
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const password = process.env.PS5_PASSWORD ?? (await rl.question('Contraseña (mínimo 10 caracteres): '))
rl.close()
if (password.length < 10) { console.error('Contraseña demasiado corta'); process.exit(1) }

const db = openDb(join(loadConfig().data_dir, 'app.db'))
const hash = await hashPassword(password)
if (cmd === 'admin:create') {
  db.prepare(`INSERT INTO users(email, name, pass_hash, role, status, created_at) VALUES(?, ?, ?, 'admin', 'approved', ?)
              ON CONFLICT(email) DO UPDATE SET pass_hash = excluded.pass_hash, role = 'admin', status = 'approved'`)
    .run(email, name, hash, Date.now())
  console.log(`Admin listo: ${email}`)
} else {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined
  if (!user) { console.error('No existe ese correo'); process.exit(1) }
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hash, user.id)
  dropUserSessions(db, user.id)
  console.log(`Contraseña cambiada: ${email}`)
}
