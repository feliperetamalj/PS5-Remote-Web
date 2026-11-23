import { useState } from 'react'
import { ActionButton, Badge, Card } from './ui.tsx'

// Umbrales: el video de la PS5 son hasta 15 Mbps continuos; con menos de eso se corta, y conviene tener holgura.
const PING_GOOD = 15, PING_OK = 40
const JITTER_GOOD = 5, JITTER_OK = 15
const DOWN_GOOD = 25, DOWN_OK = 15
const DOWN_MAX_MS = 6000

type Level = 'ok' | 'warn' | 'danger'
type Result = { ping: number; jitter: number; down: number | null; note: string }

const worst = (...l: Level[]): Level => (l.includes('danger') ? 'danger' : l.includes('warn') ? 'warn' : 'ok')
const grade = (v: number, good: number, ok: number, lowerIsBetter = true): Level =>
  (lowerIsBetter ? v <= good : v >= good) ? 'ok' : (lowerIsBetter ? v <= ok : v >= ok) ? 'warn' : 'danger'

async function pingOnce() {
  const t = performance.now()
  const res = await fetch('/api/speedtest/ping', { cache: 'no-store' })
  await res.text()
  if (!res.ok) throw new Error('No se pudo medir el ping')
  return performance.now() - t
}

/** Mbps de bajada, leyendo hasta 16 MB o 6 s. El reloj parte con el primer trozo, para no contar la espera inicial. */
async function download(): Promise<number> {
  const ctl = new AbortController()
  const res = await fetch('/api/speedtest/down', { cache: 'no-store', signal: ctl.signal })
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? 'No se pudo medir la velocidad')
  const reader = res.body.getReader()
  let bytes = 0, start = 0, last = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    last = performance.now()
    if (!start) { start = last; continue } // el primer trozo solo echa a andar el reloj
    bytes += value.length
    if (last - start > DOWN_MAX_MS) { ctl.abort(); break }
  }
  const ms = last - start
  if (ms <= 0 || bytes === 0) throw new Error('La descarga fue demasiado corta para medir')
  return (bytes * 8) / (ms / 1000) / 1e6
}

export function SpeedTest({ approved }: { approved: boolean }) {
  const [step, setStep] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function run() {
    setResult(null)
    setStep('Midiendo ping…')
    await pingOnce() // la primera petición abre la conexión y no cuenta
    const samples: number[] = []
    for (let i = 0; i < 12; i++) samples.push(await pingOnce())
    const sorted = [...samples].sort((a, b) => a - b)
    const ping = sorted[Math.floor(sorted.length / 2)]
    const jitter = samples.slice(1).reduce((sum, v, i) => sum + Math.abs(v - samples[i]), 0) / (samples.length - 1)
    let down: number | null = null, note = ''
    if (approved) {
      setStep('Midiendo velocidad de bajada…')
      try { down = await download() } catch (e) { note = (e as Error).message }
    } else note = 'La velocidad se puede medir cuando tu cuenta esté aprobada.'
    setStep('')
    setResult({ ping, jitter, down, note })
  }

  const levels = result && {
    ping: grade(result.ping, PING_GOOD, PING_OK),
    jitter: grade(result.jitter, JITTER_GOOD, JITTER_OK),
    down: result.down === null ? null : grade(result.down, DOWN_GOOD, DOWN_OK, false),
  }
  const overall = levels && worst(levels.ping, levels.jitter, ...(levels.down ? [levels.down] : []))
  const verdict = overall === 'ok' ? 'Tu conexión está bien para jugar.'
    : overall === 'warn' ? 'Se puede jugar, pero puedes notar retraso o cortes.'
    : 'Tu conexión no alcanza para jugar bien.'

  return (
    <Card title="Prueba tu conexión">
      <p className="mb-4 text-sm text-muted">Mide el ping y la velocidad de bajada contra este servidor. Dura unos segundos.</p>
      <ActionButton variant="primary" run={run}>{result ? 'Medir de nuevo' : 'Medir mi conexión'}</ActionButton>
      {step && <p className="mt-3 text-sm text-muted" role="status">{step}</p>}
      {result && levels && overall && (
        <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4 text-sm" role="status">
          <Row label="Ping" value={`${result.ping.toFixed(0)} ms`} level={levels.ping} hint={`ideal hasta ${PING_GOOD} ms`} />
          <Row label="Variación del ping" value={`${result.jitter.toFixed(1)} ms`} level={levels.jitter} hint={`ideal hasta ${JITTER_GOOD} ms`} />
          {result.down !== null && levels.down && <Row label="Bajada" value={`${result.down.toFixed(0)} Mbps`} level={levels.down} hint={`mínimo ${DOWN_OK}, ideal ${DOWN_GOOD} o más`} />}
          {result.note && <p className="text-xs text-warn">{result.note}</p>}
          <p className={`mt-1 font-medium ${overall === 'ok' ? 'text-ok' : overall === 'warn' ? 'text-warn' : 'text-danger'}`}>{verdict}</p>
          <p className="text-xs text-muted">Es una referencia: el ping exacto del juego se ve en pantalla mientras juegas.</p>
        </div>
      )}
    </Card>
  )
}

function Row({ label, value, level, hint }: { label: string; value: string; level: Level; hint: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-auto">{label} <span className="text-xs text-muted">({hint})</span></span>
      <span className="num font-medium">{value}</span>
      <Badge tone={level}>{level === 'ok' ? 'Bien' : level === 'warn' ? 'Justo' : 'Malo'}</Badge>
    </div>
  )
}
