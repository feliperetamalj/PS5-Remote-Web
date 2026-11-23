import { useState } from 'react'
import { api, usePoll, useNow, fmtSlot, fmtDay, fmtTime, fmtLeft, ActionButton, Badge, Card, Empty, Stat } from './ui.tsx'

type U = { id: number; email: string; name: string; role: string; status: 'pending' | 'approved' | 'blocked'; created_at: number; played_ms: number }
type B = { id: number; user_id: number; name: string; kind: 'slot' | 'queue'; start_at: number | null; status: 'requested' | 'confirmed'; created_at: number; offered_at: number | null; started_at: number | null }
type S = { id: number; name: string; started_at: number; ended_at: number | null; end_reason: string | null; rtt_ms: number | null; loss_pct: number | null; jitter_ms: number | null; decode_ms: number | null }
type Rules = { open_hours: [number, number][]; max_hours_per_day: number; horizon_days: number }
type Overview = {
  now: number; users: U[]; bookings: B[]; sessions: S[]; rules: Rules
  turn: { booking_id: number; name: string; kind: string; state: string; ends_at: number; live: { started_at: number; rtt_ms: number | null; loss_pct: number | null; jitter_ms: number | null; decode_ms: number | null } | null } | null
  media: { error?: string; ps5?: string }
}

const ms = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)} ms`)
const hours = (t: number) => `${(t / 3_600_000).toFixed(1)} h`
const END: Record<string, string> = { expired: 'Venció el turno', left: 'Salió', reconnect: 'Reconectó' }
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

export function Admin() {
  const { data, error, reload } = usePoll<Overview>('/admin/overview', 5000)
  const now = useNow(data?.now)
  if (!data) return <Empty>{error || 'Cargando…'}</Empty>
  const post = (path: string, body: unknown) => () => api('POST', path, body).then(reload)

  const pending = data.users.filter((u) => u.status === 'pending')
  const slots = data.bookings.filter((b) => b.kind === 'slot')
  const requests = slots.filter((b) => b.status === 'requested')
  const confirmed = slots.filter((b) => b.status === 'confirmed' && b.id !== data.turn?.booking_id)
  const queue = data.bookings.filter((b) => b.kind === 'queue' && !b.started_at)
  const done = data.sessions.filter((s) => s.ended_at)
  const avg = (k: 'rtt_ms' | 'loss_pct' | 'jitter_ms' | 'decode_ms') => {
    const xs = done.map((s) => s[k]).filter((x): x is number => x != null)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  }
  const loss = avg('loss_pct')

  return (
    <div className="flex flex-col gap-5">
      <Card title="Sesión en curso" aside={data.media.error ? <Badge tone="danger">Streaming caído</Badge> : <Badge tone="ok">Streaming listo</Badge>}>
        {data.media.error && <p className="mb-3 text-sm text-danger">{data.media.error}</p>}
        {data.turn ? (
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-lg font-semibold">{data.turn.name}</span>
              <Badge tone={data.turn.live ? 'ok' : 'warn'}>{data.turn.live ? 'Jugando' : data.turn.state === 'offered' ? 'Tiene el turno, aún no entra' : 'En su hora, sin conectar'}</Badge>
              <span className="num text-sm text-muted">Quedan {fmtLeft(data.turn.ends_at - now)}</span>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Ping" value={ms(data.turn.live?.rtt_ms)} tone={(data.turn.live?.rtt_ms ?? 0) > 15 ? 'warn' : undefined} />
              <Stat label="Colchón" value={ms(data.turn.live?.jitter_ms)} />
              <Stat label="Decodificación" value={ms(data.turn.live?.decode_ms)} />
              <Stat label="Pérdida" value={data.turn.live?.loss_pct == null ? '—' : `${data.turn.live.loss_pct.toFixed(2)} %`} tone={(data.turn.live?.loss_pct ?? 0) > 1 ? 'danger' : undefined} />
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton variant="danger" run={post('/admin/turn', { action: 'cut' })}>Cortar turno</ActionButton>
              <ActionButton run={post('/admin/turn', { action: 'extend' })}>+15 min</ActionButton>
              <ActionButton run={post('/admin/turn', { action: 'ps' })}>Enviar botón PS</ActionButton>
              <ActionButton run={post('/admin/turn', { action: 'wake' })}>Despertar PS5</ActionButton>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-sm text-muted">Nadie tiene el turno ahora.</p>
            <ActionButton run={post('/admin/turn', { action: 'wake' })}>Despertar PS5</ActionButton>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Cuentas por aprobar" aside={<Badge tone={pending.length ? 'warn' : 'muted'}>{pending.length}</Badge>}>
          {pending.length === 0 ? <Empty>No hay cuentas pendientes.</Empty> : (
            <ul className="flex flex-col gap-2">
              {pending.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-raised px-3 py-2">
                  <span className="mr-auto min-w-0">
                    <span className="block font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-muted">{u.email} · {fmtDay(u.created_at)}</span>
                  </span>
                  <ActionButton variant="primary" run={post(`/admin/users/${u.id}`, { status: 'approved' })}>Aprobar</ActionButton>
                  <ActionButton variant="danger" run={post(`/admin/users/${u.id}`, { status: 'blocked' })}>Bloquear</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Reservas por confirmar" aside={<Badge tone={requests.length ? 'warn' : 'muted'}>{requests.length}</Badge>}>
          {requests.length === 0 ? <Empty>No hay solicitudes.</Empty> : (
            <ul className="flex flex-col gap-2">
              {requests.map((b) => {
                const same = requests.filter((r) => r.start_at === b.start_at)
                const taken = slots.find((r) => r.start_at === b.start_at && r.status === 'confirmed')
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-raised px-3 py-2">
                    <span className="mr-auto min-w-0">
                      <span className="block font-medium">{b.name}</span>
                      <span className="block text-xs capitalize text-muted">{fmtSlot(b.start_at!)}</span>
                    </span>
                    {taken ? <Badge>En espera #{same.indexOf(b) + 1} · lo tiene {taken.name}</Badge> : same.length > 1 && <Badge>#{same.indexOf(b) + 1} de {same.length}</Badge>}
                    <ActionButton variant="primary" disabled={!!taken} run={post(`/admin/bookings/${b.id}`, { status: 'confirmed' })}>Confirmar</ActionButton>
                    <ActionButton variant="danger" run={post(`/admin/bookings/${b.id}`, { status: 'rejected' })}>Rechazar</ActionButton>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Fila en vivo" aside={<Badge>{queue.length}</Badge>}>
          {queue.length === 0 ? <Empty>La fila está vacía.</Empty> : (
            <ol className="flex flex-col gap-2">
              {queue.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-raised px-3 py-2">
                  <span className="mr-auto font-medium">{b.name}</span>
                  {b.status === 'confirmed'
                    ? <Badge tone="ok">{b.offered_at ? 'Tiene el turno' : 'En fila'}</Badge>
                    : <ActionButton variant="primary" run={post(`/admin/bookings/${b.id}`, { status: 'confirmed' })}>Dejar entrar</ActionButton>}
                  <ActionButton variant="danger" run={post(`/admin/bookings/${b.id}`, { status: b.status === 'confirmed' ? 'cancelled' : 'rejected' })}>Sacar</ActionButton>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Próximas reservas confirmadas" aside={<Badge>{confirmed.length}</Badge>}>
          {confirmed.length === 0 ? <Empty>No hay reservas confirmadas.</Empty> : (
            <ul className="flex flex-col gap-2">
              {confirmed.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-raised px-3 py-2">
                  <span className="mr-auto min-w-0">
                    <span className="block font-medium">{b.name}</span>
                    <span className="block text-xs capitalize text-muted">{fmtSlot(b.start_at!)}</span>
                  </span>
                  <ActionButton variant="danger" run={post(`/admin/bookings/${b.id}`, { status: 'cancelled' })}>Cancelar</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Últimos 14 días">
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Sesiones" value={done.length} />
          <Stat label="Horas jugadas" value={hours(done.reduce((a, s) => a + (s.ended_at! - s.started_at), 0))} />
          <Stat label="Ping promedio" value={ms(avg('rtt_ms'))} tone={(avg('rtt_ms') ?? 0) > 15 ? 'warn' : undefined} />
          <Stat label="Decodificación" value={ms(avg('decode_ms'))} />
          <Stat label="Pérdida promedio" value={loss == null ? '—' : `${loss.toFixed(2)} %`} tone={(loss ?? 0) > 1 ? 'danger' : undefined} />
        </div>
        <DailyChart sessions={done} now={now} />
        <h3 className="mb-2 mt-6 text-sm font-semibold">Sesiones recientes</h3>
        {done.length === 0 ? <Empty>Todavía no hay sesiones.</Empty> : (
          <div className="overflow-x-auto">
            <table className="num w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr><th className="py-2 font-medium">Jugador</th><th className="font-medium">Inicio</th><th className="font-medium">Duración</th><th className="font-medium">Ping</th><th className="font-medium">Pérdida</th><th className="font-medium">Fin</th></tr>
              </thead>
              <tbody>
                {done.slice(0, 15).map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-2">{s.name}</td>
                    <td className="capitalize">{fmtDay(s.started_at)} {fmtTime(s.started_at)}</td>
                    <td>{Math.round((s.ended_at! - s.started_at) / 60_000)} min</td>
                    <td>{ms(s.rtt_ms)}</td>
                    <td>{s.loss_pct == null ? '—' : `${s.loss_pct.toFixed(2)} %`}</td>
                    <td className="text-muted">{END[s.end_reason ?? ''] ?? s.end_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card title="Usuarios">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-2 font-medium">Nombre</th><th className="font-medium">Estado</th><th className="font-medium">Jugado</th><th /></tr></thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="py-2"><span className="block">{u.name}</span><span className="block text-xs text-muted">{u.email}</span></td>
                    <td>{u.role === 'admin' ? <Badge tone="accent">Admin</Badge> : <Badge tone={u.status === 'approved' ? 'ok' : u.status === 'pending' ? 'warn' : 'danger'}>{{ approved: 'Aprobado', pending: 'Pendiente', blocked: 'Bloqueado' }[u.status]}</Badge>}</td>
                    <td className="num">{hours(u.played_ms)}</td>
                    <td className="py-1 text-right">
                      {u.role !== 'admin' && (u.status === 'approved'
                        ? <ActionButton variant="danger" run={post(`/admin/users/${u.id}`, { status: 'blocked' })}>Bloquear</ActionButton>
                        : <ActionButton run={post(`/admin/users/${u.id}`, { status: 'approved' })}>{u.status === 'blocked' ? 'Desbloquear' : 'Aprobar'}</ActionButton>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <RulesForm rules={data.rules} reload={reload} />
      </div>
    </div>
  )
}

/** Minutos jugados por día. Barras en HTML: sin librería de gráficos para un solo gráfico. */
function DailyChart({ sessions, now }: { sessions: S[]; now: number }) {
  const days = Array.from({ length: 14 }, (_, i) => now - (13 - i) * 86_400_000)
  const mins = days.map((d) => Math.round(sessions.filter((s) => fmtDay(s.started_at) === fmtDay(d)).reduce((a, s) => a + (s.ended_at! - s.started_at), 0) / 60_000))
  const max = Math.max(...mins, 60)
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-semibold">Minutos jugados por día</figcaption>
      <ol className="flex h-32 items-end gap-1.5" aria-label="Minutos jugados por día, últimos 14 días">
        {days.map((d, i) => (
          <li key={d} className="group relative flex h-full flex-1 flex-col justify-end" title={`${fmtDay(d)}: ${mins[i]} min`}>
            <span className="sr-only">{fmtDay(d)}: {mins[i]} minutos</span>
            {mins[i] > 0 && <span aria-hidden className="num mb-1 text-center text-[0.65rem] text-muted">{mins[i]}</span>}
            <span aria-hidden className={`rounded-t-md ${mins[i] ? 'bg-accent' : 'bg-line'}`} style={{ height: `${Math.max((mins[i] / max) * 100, 2)}%` }} />
          </li>
        ))}
      </ol>
      <div aria-hidden className="mt-1 flex justify-between text-xs capitalize text-muted"><span>{fmtDay(days[0])}</span><span>Hoy</span></div>
    </figure>
  )
}

function RulesForm({ rules, reload }: { rules: Rules; reload: () => unknown }) {
  const [r, setR] = useState(rules)
  const num = 'min-h-10 w-16 rounded-lg border border-line bg-bg px-2 text-center num'
  const setHour = (day: number, i: 0 | 1, v: number) =>
    setR({ ...r, open_hours: r.open_hours.map((h, d) => (d === day ? (i === 0 ? [v, h[1]] : [h[0], v]) : h)) as [number, number][] })
  return (
    <Card title="Horarios y reglas">
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-2 text-xs text-muted">Horas en que se puede reservar (hora de Santiago, de 0 a 24). Mismo valor en ambos = cerrado.</legend>
        {DAYS.map((name, d) => (
          <div key={name} className="flex items-center gap-2">
            <span className="mr-auto">{name}</span>
            <input type="number" min={0} max={24} value={r.open_hours[d][0]} aria-label={`${name}, desde`} className={num} onChange={(e) => setHour(d, 0, Number(e.target.value))} />
            <span className="text-muted">a</span>
            <input type="number" min={0} max={24} value={r.open_hours[d][1]} aria-label={`${name}, hasta`} className={num} onChange={(e) => setHour(d, 1, Number(e.target.value))} />
          </div>
        ))}
      </fieldset>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2"><span className="mr-auto">Máximo de horas por día y persona</span>
          <input type="number" min={1} max={24} value={r.max_hours_per_day} className={num} onChange={(e) => setR({ ...r, max_hours_per_day: Number(e.target.value) })} /></label>
        <label className="flex items-center gap-2"><span className="mr-auto">Días de anticipación</span>
          <input type="number" min={1} max={30} value={r.horizon_days} className={num} onChange={(e) => setR({ ...r, horizon_days: Number(e.target.value) })} /></label>
      </div>
      <div className="mt-4"><ActionButton variant="primary" run={() => api('PUT', '/admin/settings', r).then(reload)}>Guardar</ActionButton></div>
    </Card>
  )
}
