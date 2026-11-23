import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import './styles.css'
import { api, usePoll, Button } from './ui.tsx'
import { Auth } from './Auth.tsx'
import { Home } from './Home.tsx'
import { Play } from './Play.tsx'
import { Admin } from './Admin.tsx'

export type AppState = {
  now: number
  user: { id: number; email: string; name: string; role: 'user' | 'admin'; status: 'pending' | 'approved' | 'blocked' } | null
  turn: { mine: boolean; state: 'active' | 'offered'; kind: 'slot' | 'queue'; ends_at: number } | null
  queue: { length: number; mine: { id: number; status: 'requested' | 'confirmed'; position: number } | null }
}

function useHash() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

function App() {
  const { data: state, error, reload } = usePoll<AppState>('/state', 8000)
  const hash = useHash()
  if (!state) return <p className="p-8 text-center text-muted" role="status">{error || 'Cargando…'}</p>
  if (!state.user) return <Auth onDone={reload} />

  const user = state.user
  const view = hash === '#jugar' ? 'play' : hash === '#admin' && user.role === 'admin' ? 'admin' : 'home'
  if (view === 'play') return <Play state={state} reload={reload} />

  return (
    <>
      <header className="glass sticky top-0 z-10">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <a href="#" className="mr-auto text-lg font-semibold tracking-tight">PS5 <span className="text-accent">Remote</span></a>
          {user.role === 'admin' && (
            <nav aria-label="Secciones" className="flex gap-1 rounded-xl bg-raised p-1 text-sm">
              {[['#', 'Reservas', 'home'], ['#admin', 'Admin', 'admin']].map(([href, label, v]) => (
                <a key={v} href={href} aria-current={view === v ? 'page' : undefined}
                  className={`press rounded-lg px-3 py-1.5 ${view === v ? 'bg-surface text-fg' : 'text-muted hover:text-fg'}`}>{label}</a>
              ))}
            </nav>
          )}
          <span className="hidden text-sm text-muted sm:inline">{user.name}</span>
          <Button onClick={() => api('POST', '/logout').then(() => { location.hash = ''; reload() })}>Salir</Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            {view === 'admin' ? <Admin /> : <Home state={state} reload={reload} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-muted">
        Uso privado entre amigos · Software libre (AGPL-3.0)
      </footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Resortes sin rebote por defecto; con "reducir movimiento" quedan solo los fundidos. */}
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', bounce: 0, duration: 0.35 }}>
      <App />
    </MotionConfig>
  </StrictMode>,
)
