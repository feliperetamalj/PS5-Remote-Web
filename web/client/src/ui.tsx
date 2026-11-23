import { useEffect, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'No se pudo conectar con el servidor')
  return data
}

/** Consulta periódica; `reload` fuerza una lectura inmediata después de una acción. */
export function usePoll<T>(path: string, ms: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const reload = () => api<T>('GET', path).then((d) => { setData(d); setError('') }, (e) => setError(e.message))
  useEffect(() => {
    reload()
    const t = setInterval(() => { if (!document.hidden) reload() }, ms)
    return () => clearInterval(t)
  }, [path, ms])
  return { data, error, reload }
}

/** Reloj que avanza cada segundo, corregido con la hora del servidor. */
export function useNow(serverNow?: number) {
  const [offset, setOffset] = useState(0)
  const [, force] = useState(0)
  useEffect(() => { if (serverNow) setOffset(serverNow - Date.now()) }, [serverNow])
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  return Date.now() + offset
}

export const TZ = 'America/Santiago'
const dayFmt = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const timeFmt = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const fmtDay = (t: number) => dayFmt.format(t)
export const fmtTime = (t: number) => timeFmt.format(t)
export const fmtSlot = (t: number) => `${fmtDay(t)} · ${fmtTime(t)}–${fmtTime(t + 3_600_000)}`
export function fmtLeft(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Variant = 'primary' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'neon-fill text-on-accent font-semibold',
  ghost: 'border border-white/15 bg-white/5 text-fg hover:bg-white/10',
  danger: 'border border-danger/50 text-danger hover:bg-danger/10',
}
export function Button({ variant = 'ghost', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={`press min-h-11 rounded-xl px-4 text-sm ${VARIANT[variant]} ${className}`} />
}

/** Ejecuta una acción, deshabilita el botón mientras corre y muestra el error junto a él. */
export function ActionButton({ run, children, ...p }: Omit<Parameters<typeof Button>[0], 'onClick'> & { run: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button {...p} disabled={busy || p.disabled} aria-busy={busy}
        onClick={() => { setBusy(true); setError(''); run().catch((e) => setError(e.message)).finally(() => setBusy(false)) }}>
        {children}
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  )
}

export function Card({ title, aside, children, className = '' }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass-card relative min-w-0 rounded-2xl p-5 ${className}`}>
      {(title || aside) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  )
}

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'muted'
const TONE: Record<Tone, string> = {
  ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', danger: 'bg-danger/15 text-danger',
  accent: 'bg-accent/15 text-accent', muted: 'bg-raised text-muted',
}
export const Badge = ({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) =>
  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>

export const Stat = ({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'danger' }) => (
  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
    <div className="text-xs text-muted">{label}</div>
    <div className={`num text-xl font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''}`}>{value}</div>
  </div>
)

export const Empty = ({ children }: { children: ReactNode }) => <p className="py-2 text-sm text-muted">{children}</p>
