// Cliente del proceso media/ (C++). Una petición JSON por línea sobre el socket unix, una respuesta por línea.
import { connect } from 'node:net'

export type MediaRequest =
  | { op: 'start'; expires_at: number } // responde con la oferta SDP del servidor
  | { op: 'answer'; sdp: string }
  | { op: 'watch' } // espectador: responde con una oferta SDP y el id de su conexión
  | { op: 'watch_answer'; id: number; sdp: string }
  | { op: 'stop' }
  | { op: 'extend'; expires_at: number }
  | { op: 'status' }
  | { op: 'wake' }
  | { op: 'button'; button: 'PS' }
export type Media = (req: MediaRequest) => Promise<Record<string, unknown>>

export function mediaClient(socketPath: string): Media {
  return (req) => new Promise((resolve, reject) => {
    const sock = connect(socketPath)
    let buf = ''
    const fail = (msg: string) => { sock.destroy(); reject(new Error(msg)) }
    sock.setTimeout(25_000, () => fail('El servidor de streaming no respondió a tiempo'))
    sock.on('error', () => fail('El servidor de streaming no está corriendo'))
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'))
    sock.on('data', (d) => {
      buf += d
      if (buf.length > 256_000) return fail('Respuesta de streaming demasiado grande')
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      sock.destroy()
      try {
        const res = JSON.parse(buf.slice(0, nl))
        if (res.error) reject(new Error(String(res.error)))
        else resolve(res)
      } catch { reject(new Error('Respuesta de streaming inválida')) }
    })
  })
}
