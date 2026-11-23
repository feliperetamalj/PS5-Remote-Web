import { useEffect, useRef, useState } from 'react'
import type { AppState } from './main.tsx'
import { api, Button, Badge } from './ui.tsx'
import { TextShimmer } from './motion/text-shimmer.tsx'
import { Logo } from './kit.tsx'

type Phase = 'idle' | 'connecting' | 'live' | 'ended'

/** Modo espectador: el mismo video y audio que recibe quien juega, sin mando. No afecta su partida. */
export function Watch({ state }: { state: AppState }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [sound, setSound] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)

  const canWatch = state.live && !state.turn?.mine && state.user?.status === 'approved'

  function stop(msg: string) {
    const pc = pcRef.current
    if (!pc) return
    pcRef.current = null
    pc.close()
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setMessage(msg); setPhase('ended')
  }

  async function connect() {
    if (pcRef.current) return
    setPhase('connecting'); setMessage('')
    const pc = new RTCPeerConnection()
    pcRef.current = pc
    try {
      pc.ontrack = (e) => {
        // Aquí no se anula el colchón del navegador: para mirar importa más la fluidez que la latencia.
        const el = e.track.kind === 'video' ? video.current : audio.current
        if (el) { el.srcObject = new MediaStream([e.track]); el.play().catch(() => {}) }
      }
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return
        if (pc.connectionState === 'connected') setPhase('live')
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') stop('Se cortó la transmisión.')
      }
      const offer = await api<{ sdp: string; id: number }>('POST', '/watch/offer', {})
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp })
      await pc.setLocalDescription(await pc.createAnswer())
      await new Promise<void>((done) => {
        if (pc.iceGatheringState === 'complete') return done()
        pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done()
        setTimeout(done, 2000)
      })
      await api('POST', '/watch/answer', { id: offer.id, sdp: pc.localDescription!.sdp })
    } catch (e) {
      stop((e as Error).message)
    }
  }

  // Entra solo al abrir la página si hay partida; el video parte en silencio, así que no necesita un clic.
  useEffect(() => { if (canWatch && phase === 'idle') connect() }, [canWatch, phase])
  useEffect(() => { if (phase === 'live' && !state.live) stop('La partida terminó.') }, [phase, state.live])
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => { document.removeEventListener('fullscreenchange', onFs); pcRef.current?.close(); pcRef.current = null }
  }, [])
  useEffect(() => { if (audio.current) audio.current.muted = !sound }, [sound])

  const on = phase === 'live' || phase === 'connecting'
  return (
    <div ref={stage} className={`relative flex min-h-dvh flex-col ${on ? 'bg-black' : ''}`}>
      <video ref={video} muted autoPlay playsInline aria-label="Partida en vivo en la PS5" className={`h-dvh w-full object-contain ${on ? '' : 'hidden'}`} />
      <audio ref={audio} autoPlay muted />

      {on && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3">
          <Badge tone="danger">En vivo</Badge>
          {phase === 'connecting' && <TextShimmer as="span" duration={1.2} className="rounded-lg bg-black/60 px-2.5 py-1 text-sm [--base-color:#a3a8c9] [--base-gradient-color:#ffffff]">Conectando…</TextShimmer>}
          {state.watching > 0 && <span className="num rounded-lg bg-black/60 px-2.5 py-1 text-sm" role="status">{state.watching === 1 ? '1 persona mirando' : `${state.watching} personas mirando`}</span>}
          {!fullscreen && (
            <span className="pointer-events-auto ml-auto flex gap-2">
              <Button onClick={() => setSound((s) => !s)} aria-pressed={sound}>{sound ? 'Silenciar' : 'Activar sonido'}</Button>
              <Button onClick={() => stage.current?.requestFullscreen().catch(() => {})}>Pantalla completa</Button>
              <Button variant="danger" onClick={() => { stop(''); location.hash = '' }}>Salir</Button>
            </span>
          )}
        </div>
      )}

      {!on && (
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
          <div className="glass-card flex flex-col gap-5 rounded-3xl p-6 sm:p-8">
            <Logo size={40} />
            <h1 className="font-display text-2xl">Ver en vivo</h1>
            {message && <p role="alert" className="text-sm text-warn">{message}</p>}
            {canWatch
              ? <Button variant="primary" className="min-h-12 text-base" onClick={connect}>{phase === 'ended' ? 'Volver a mirar' : 'Mirar la partida'}</Button>
              : <p className="text-sm text-muted">{state.turn?.mine ? 'Es tu turno: no puedes mirar y jugar a la vez.' : state.user?.status !== 'approved' ? 'Podrás mirar cuando Felipe apruebe tu cuenta.' : 'Ahora nadie está jugando. Esta página se actualiza sola.'}</p>}
            <a href="#" className="text-sm text-accent underline-offset-4 hover:underline">Volver a reservas</a>
          </div>
        </main>
      )}
    </div>
  )
}
