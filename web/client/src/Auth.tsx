import { useState } from 'react'
import type { FormEvent } from 'react'
import { motion } from 'motion/react'
import { api, Button } from './ui.tsx'

const field = 'min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-base placeholder:text-muted/60'

export function Auth({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = Object.fromEntries(new FormData(e.currentTarget))
    setBusy(true); setError('')
    try { await api('POST', mode === 'login' ? '/login' : '/signup', f); onDone() }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-semibold">PS5 <span className="text-accent">Remote</span></h1>
        <p className="mt-2 text-muted">Juega en la PS5 de Felipe desde Chrome, con tu propio mando.</p>

        <div role="tablist" aria-label="Acceso" className="mt-8 grid grid-cols-2 gap-1 rounded-xl bg-surface p-1 text-sm">
          {(['login', 'signup'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError('') }}
              className={`press min-h-10 rounded-lg ${mode === m ? 'bg-raised text-fg' : 'text-muted'}`}>
              {m === 'login' ? 'Entrar' : 'Crear cuenta'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          {mode === 'signup' && (
            <label className="flex flex-col gap-1.5 text-sm">Nombre
              <input name="name" required minLength={2} maxLength={40} autoComplete="name" className={field} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm">Correo
            <input name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">Contraseña
            <input name="password" type="password" required minLength={mode === 'signup' ? 10 : 1} maxLength={200}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode === 'signup' ? 'pw-help' : undefined} className={field} />
            {mode === 'signup' && <span id="pw-help" className="text-xs text-muted">Mínimo 10 caracteres.</span>}
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}</Button>
          {mode === 'signup' && <p className="text-xs text-muted">Tu cuenta queda pendiente hasta que Felipe la apruebe.</p>}
        </form>
      </motion.div>
    </main>
  )
}
