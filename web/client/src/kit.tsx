// Piezas de marca y de movimiento, armadas sobre los componentes copiados de motion-primitives.
import type { ReactNode } from 'react'
import { SlidingNumber } from './motion/sliding-number.tsx'
import { GlowEffect } from './motion/glow-effect.tsx'
import { BorderTrail } from './motion/border-trail.tsx'

export const NEON = ['#3b82f6', '#8b5cf6', '#d946ef', '#3b82f6']

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" /><stop offset="0.6" stopColor="#8b5cf6" /><stop offset="1" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
      <path d="M12 10.2v11.6a1 1 0 0 0 1.5.86l9.6-5.8a1 1 0 0 0 0-1.72l-9.6-5.8a1 1 0 0 0-1.5.86z" fill="#fff" />
      <path d="M6.5 11.5a9 9 0 0 0 0 9M25.5 11.5a9 9 0 0 1 0 9" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export const Wordmark = ({ className = '' }: { className?: string }) => (
  <span className={`font-display tracking-wide ${className}`}>PS5 <span className="neon-text">Remote</span></span>
)

/** Cuenta regresiva mm:ss con dígitos que se deslizan. El texto accesible va aparte, sin animación. */
export function Countdown({ ms, className = '' }: { ms: number; className?: string }) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return (
    <span className={`inline-flex items-center ${className}`} role="timer" aria-label={`Quedan ${Math.floor(s / 60)} minutos y ${s % 60} segundos`}>
      <span aria-hidden className="inline-flex items-center">
        <SlidingNumber value={Math.floor(s / 60)} /><span>:</span><SlidingNumber value={s % 60} padStart />
      </span>
      <span className="sr-only">{text}</span>
    </span>
  )
}

/** Llamado a la acción principal, con halo de color que rota detrás. */
export function GlowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      <GlowEffect colors={NEON} mode="rotate" blur="strong" duration={6} className="rounded-2xl opacity-80 motion-reduce:hidden" />
      <a href={href} className="press neon-fill relative inline-flex min-h-12 items-center rounded-2xl px-7 text-base font-semibold text-on-accent">{children}</a>
    </span>
  )
}

/** Trazo de luz que recorre el borde del contenedor (que debe ser `relative`). */
export const Trail = ({ size = 90 }: { size?: number }) => (
  <BorderTrail size={size} className="bg-linear-to-l from-blue-400 via-violet-400 to-fuchsia-400 motion-reduce:hidden" transition={{ repeat: Infinity, duration: 6, ease: 'linear' }} />
)
