import { useState } from 'react'
import type { FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { api, Button } from './ui.tsx'
import { Logo, Wordmark, Trail } from './kit.tsx'
import { Spotlight } from './motion/spotlight.tsx'

const field = 'min-h-12 w-full rounded-xl border border-white/15 bg-black/30 px-3.5 text-base placeholder:text-muted/60 transition-colors focus:border-accent'

const FEATURES = [
  ['Tu mando', 'PS4, PS5 o Xbox, por USB o Bluetooth.'],
  ['Sin instalar nada', 'Solo Chrome y una reserva confirmada.'],
  ['Baja latencia', 'Video directo de la consola, sin recomprimir.'],
]

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
    <main className="mx-auto grid min-h-dvh max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-[1.1fr_26rem] lg:gap-16">
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3"><Logo size={40} /><Wordmark className="text-xl" /></div>
        <h1 className="mt-8 font-display text-4xl leading-[1.05] sm:text-6xl">
          Juega en la PS5<br /><span className="neon-text">desde tu navegador</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted">Reserva tu hora, conecta tu mando y entra. La consola de Felipe, en tu pantalla.</p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-3">
          {FEATURES.map(([title, text], i) => (
            <motion.li key={title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07 }}
              className="glass-card rounded-2xl p-4">
              <Spotlight size={180} className="from-blue-500/40 via-violet-500/30 to-transparent" />
              <h2 className="relative text-sm font-semibold">{title}</h2>
              <p className="relative mt-1 text-sm text-muted">{text}</p>
            </motion.li>
          ))}
        </ul>
      </motion.section>

      <motion.section initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.08 }}
        className="glass-card relative rounded-3xl p-6 sm:p-8" aria-label="Acceso">
        <Trail size={120} />
        <div role="tablist" aria-label="Acceso" className="relative grid grid-cols-2 gap-1 rounded-xl bg-black/30 p-1 text-sm">
          {(['login', 'signup'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError('') }}
              className={`press relative min-h-10 rounded-lg ${mode === m ? 'text-fg' : 'text-muted hover:text-fg'}`}>
              {mode === m && <motion.span layoutId="auth-tab" className="absolute inset-0 rounded-lg bg-white/12" />}
              <span className="relative">{m === 'login' ? 'Entrar' : 'Crear cuenta'}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="relative mt-6 flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {mode === 'signup' && (
              <motion.label key="name" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="flex flex-col gap-1.5 overflow-hidden text-sm">Nombre
                <input name="name" required minLength={2} maxLength={40} autoComplete="name" className={field} />
              </motion.label>
            )}
          </AnimatePresence>
          <label className="flex flex-col gap-1.5 text-sm">Correo
            <input name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">Contraseña
            <input name="password" type="password" required minLength={mode === 'signup' ? 10 : 1} maxLength={200}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={mode === 'signup' ? 'pw-help' : undefined} className={field} />
            {mode === 'signup' && <span id="pw-help" className="text-xs text-muted">Mínimo 10 caracteres.</span>}
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button variant="primary" type="submit" disabled={busy} className="min-h-12 text-base">{busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}</Button>
          {mode === 'signup' && <p className="text-xs text-muted">Tu cuenta queda pendiente hasta que Felipe la apruebe.</p>}
        </form>
      </motion.section>
    </main>
  )
}
