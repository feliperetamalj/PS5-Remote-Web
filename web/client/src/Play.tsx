import { useEffect, useRef, useState } from 'react'
import type { AppState } from './main.tsx'
import { api, useNow, fmtLeft, Button, Badge } from './ui.tsx'
import { TextShimmer } from './motion/text-shimmer.tsx'
import { Logo } from './kit.tsx'
import { readPad, encodePad, samePad, NEUTRAL } from '../../shared/pad.ts'

type Stats = { rtt: number; buffer: number; decode: number; fps: number; dropped: number; lost: number; lossPct: number; kbps: number }
type Phase = 'idle' | 'connecting' | 'live' | 'ended'

const PAD_HZ_MS = 4 // ~250 Hz; requestAnimationFrame daría solo 60
const HEARTBEAT_MS = 50
const PING_WARN_MS = 15

function pickPad(): Gamepad | null {
  const pads = navigator.getGamepads().filter((g): g is Gamepad => !!g && g.connected)
  return pads.find((g) => g.mapping === 'standard') ?? pads[0] ?? null
}

export function Play({ state, reload }: { state: AppState; reload: () => void }) {
  const now = useNow(state.now) // también vuelve a dibujar cada segundo: así aparece el mando al conectarlo
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [showStats, setShowStats] = useState(true)
  const [deadzone, setDeadzone] = useState(() => Number(localStorage.getItem('deadzone') ?? 0.08))
  const [fullscreen, setFullscreen] = useState(false)
  const deadzoneRef = useRef(deadzone)
  deadzoneRef.current = deadzone
  const stage = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const session = useRef<{ pc: RTCPeerConnection; timers: number[] } | null>(null)

  const myTurn = !!state.turn?.mine
  const left = state.turn ? state.turn.ends_at - now : 0
  const pad = pickPad()

  function stop(msg: string) {
    const s = session.current
    if (!s) return
    session.current = null
    s.timers.forEach(clearInterval)
    s.pc.close()
    api('POST', '/play/leave').catch(() => {})
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setStats(null); setMessage(msg); setPhase('ended'); reload()
  }

  async function connect() {
    setPhase('connecting'); setMessage('')
    const pc = new RTCPeerConnection()
    const timers: number[] = []
    session.current = { pc, timers }
    try {
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })
      // Sin orden ni reintentos: un estado viejo del mando no sirve, llega el siguiente en 4 ms.
      const dc = pc.createDataChannel('pad', { ordered: false, maxRetransmits: 0 })
      dc.binaryType = 'arraybuffer'

      pc.ontrack = (e) => {
        // Sin colchón: preferimos un cuadro perdido a un cuadro tarde.
        const r = e.receiver as RTCRtpReceiver & { jitterBufferTarget?: number; playoutDelayHint?: number }
        r.jitterBufferTarget = 0
        r.playoutDelayHint = 0
        // Video y audio en MediaStreams separados: el navegador no retrasa el video para sincronizar labios.
        const el = e.track.kind === 'video' ? video.current : audio.current
        if (el) { el.srcObject = new MediaStream([e.track]); el.play().catch(() => {}) }
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setPhase('live')
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') stop('Se perdió la conexión con la consola.')
      }

      await pc.setLocalDescription(await pc.createOffer())
      // Señalización en un solo POST: se espera a tener los candidatos ICE (máx. 2 s).
      await new Promise<void>((done) => {
        if (pc.iceGatheringState === 'complete') return done()
        pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done()
        setTimeout(done, 2000)
      })
      const answer = await api<{ sdp: string }>('POST', '/play/offer', { sdp: pc.localDescription!.sdp })
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })

      // Mando: se lee a ~250 Hz y se envía al cambiar, más un latido cada 50 ms.
      let seq = 0, last = NEUTRAL, sentAt = 0
      timers.push(window.setInterval(() => {
        if (dc.readyState !== 'open') return
        const gp = pickPad()
        const s = gp && document.hasFocus() ? readPad(gp, deadzoneRef.current) : NEUTRAL
        const t = performance.now()
        if (!samePad(s, last) || t - sentAt >= HEARTBEAT_MS) { dc.send(encodePad(seq++, s)); last = s; sentAt = t }
      }, PAD_HZ_MS))

      let prev: any = null, n = 0
      timers.push(window.setInterval(async () => {
        let rtt = 0, v: any = null
        ;(await pc.getStats()).forEach((s: any) => {
          if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime != null) rtt = s.currentRoundTripTime * 1000
          if (s.type === 'inbound-rtp' && s.kind === 'video') v = s
        })
        if (!v) return
        const d = (k: string) => (prev ? v[k] - prev[k] : 0) || 0
        const lost = d('packetsLost'), recv = d('packetsReceived')
        const next: Stats = {
          rtt,
          buffer: d('jitterBufferEmittedCount') ? (d('jitterBufferDelay') / d('jitterBufferEmittedCount')) * 1000 : 0,
          decode: d('framesDecoded') ? (d('totalDecodeTime') / d('framesDecoded')) * 1000 : 0,
          fps: v.framesPerSecond ?? 0,
          dropped: v.framesDropped ?? 0,
          lost: v.packetsLost ?? 0,
          lossPct: lost + recv > 0 ? (Math.max(lost, 0) / (lost + recv)) * 100 : 0,
          kbps: prev ? (d('bytesReceived') * 8) / (v.timestamp - prev.timestamp) : 0,
        }
        prev = v
        setStats(next)
        if (++n % 5 === 0) api('POST', '/play/stats', { rtt_ms: next.rtt, loss_pct: next.lossPct, jitter_ms: next.buffer, decode_ms: next.decode }).catch(() => {})
      }, 1000))
    } catch (e) {
      stop((e as Error).message)
      setPhase("idle")
    }
  }

  // El servidor corta al vencer el turno; aquí solo se refleja.
  useEffect(() => { if (phase === 'live' && !myTurn) stop('Terminó tu turno. ¡Gracias por jugar!') }, [phase, myTurn])
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    const onHide = () => { if (session.current) navigator.sendBeacon('/api/play/leave') }
    document.addEventListener('fullscreenchange', onFs)
    addEventListener('pagehide', onHide)
    return () => { document.removeEventListener('fullscreenchange', onFs); removeEventListener('pagehide', onHide); stop('') }
  }, [])

  async function goFullscreen() {
    await stage.current?.requestFullscreen().catch(() => {})
    stage.current?.requestPointerLock?.()
  }

  const live = phase === 'live' || phase === 'connecting'
  return (
    <div ref={stage} className={`relative flex min-h-dvh flex-col ${live ? 'bg-black' : ''}`}>
      <video ref={video} muted autoPlay playsInline aria-label="Video de la PS5" className={`h-dvh w-full object-contain ${live ? '' : 'hidden'}`} />
      <audio ref={audio} autoPlay />

      {live && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3">
          <span className={`num rounded-lg bg-black/60 px-2.5 py-1 text-sm font-semibold ${left < 60_000 ? 'text-danger' : left < 5 * 60_000 ? 'text-warn' : 'text-fg'}`}
            role="timer" aria-label="Tiempo restante">{fmtLeft(left)}</span>
          {phase === 'connecting' && <TextShimmer as="span" duration={1.2} className="rounded-lg bg-black/60 px-2.5 py-1 text-sm [--base-color:#a3a8c9] [--base-gradient-color:#ffffff]">Conectando con la PS5…</TextShimmer>}
          {!pad && <Badge tone="warn">Sin mando: conéctalo y aprieta un botón</Badge>}
          {stats && stats.rtt > PING_WARN_MS && <Badge tone="warn">Ping alto: {stats.rtt.toFixed(0)} ms</Badge>}
          {!fullscreen && (
            <span className="pointer-events-auto ml-auto flex gap-2">
              <Button onClick={() => setShowStats((s) => !s)} aria-pressed={showStats}>Estadísticas</Button>
              <Button onClick={goFullscreen}>Pantalla completa</Button>
              <Button variant="danger" onClick={() => stop('Saliste del juego. Puedes volver mientras dure tu turno.')}>Salir</Button>
            </span>
          )}
        </div>
      )}

      {live && showStats && stats && (
        <dl className="num pointer-events-none absolute bottom-3 left-3 grid grid-cols-[auto_auto] gap-x-4 rounded-lg bg-black/60 px-3 py-2 text-xs">
          {([
            ['Ping (ida y vuelta)', `${stats.rtt.toFixed(1)} ms`],
            ['Colchón del navegador', `${stats.buffer.toFixed(1)} ms`],
            ['Decodificación', `${stats.decode.toFixed(1)} ms`],
            ['Cuadros por segundo', stats.fps.toFixed(0)],
            ['Cuadros descartados', stats.dropped],
            ['Paquetes perdidos', `${stats.lost} (${stats.lossPct.toFixed(1)} %)`],
            ['Bitrate', `${(stats.kbps / 1000).toFixed(1)} Mbps`],
          ] as const).map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>
          ))}
        </dl>
      )}

      {!live && (
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
         <div className="glass-card flex flex-col gap-5 rounded-3xl p-6 sm:p-8">
          <Logo size={40} />
          <h1 className="font-display text-2xl">{phase === 'ended' ? 'Sesión terminada' : 'Listo para jugar'}</h1>
          {message && <p role="alert" className="text-sm text-warn">{message}</p>}
          {myTurn ? (
            <>
              <p className="num text-sm text-muted">Te quedan {fmtLeft(left)} de turno.</p>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
                {pad
                  ? <><Badge tone="ok">Mando detectado</Badge><p className="mt-2 break-words text-muted">{pad.id}</p></>
                  : <><Badge tone="warn">Sin mando</Badge><p className="mt-2 text-muted">Conecta tu mando (USB o Bluetooth) y aprieta cualquier botón para que Chrome lo vea.</p></>}
              </div>
              <label className="flex flex-col gap-2 text-sm">
                <span>Zona muerta de los sticks: <span className="num">{Math.round(deadzone * 100)} %</span></span>
                <input type="range" min={0} max={0.3} step={0.01} value={deadzone} className="accent-accent"
                  onChange={(e) => { const v = Number(e.target.value); setDeadzone(v); localStorage.setItem('deadzone', String(v)) }} />
                <span className="text-xs text-muted">Súbela si el personaje o la cámara se mueven solos.</span>
              </label>
              <Button variant="primary" className="min-h-12 text-base" onClick={connect}>{phase === 'ended' ? 'Volver a conectar' : 'Conectar a la PS5'}</Button>
            </>
          ) : <p className="text-sm text-muted">Ahora no es tu turno.</p>}
          <a href="#" className="text-sm text-accent underline-offset-4 hover:underline">Volver a reservas</a>
         </div>
        </main>
      )}
    </div>
  )
}
