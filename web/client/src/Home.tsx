import { useState } from 'react'
import { motion } from 'motion/react'
import type { AppState } from './main.tsx'
import { api, usePoll, useNow, fmtDay, fmtLeft, ActionButton, Badge, Card, Empty } from './ui.tsx'

type Slot = { start_at: number; hour: number; taken: boolean; waiting: number; mine: { id: number; status: 'requested' | 'confirmed'; position: number } | null }
type Calendar = { days: { date: string; slots: Slot[] }[]; rules: { max_hours_per_day: number; horizon_days: number } }

export function Home({ state, reload }: { state: AppState; reload: () => void }) {
  const user = state.user!
  const now = useNow(state.now)
  const cal = usePoll<Calendar>('/calendar', 30_000)
  const [day, setDay] = useState(0)
  const refresh = () => Promise.all([reload(), cal.reload()])
  const approved = user.status === 'approved'
  const { turn, queue } = state

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {!approved && (
        <Card>
          <div className="flex items-start gap-3">
            <Badge tone="warn">Pendiente</Badge>
            <p className="text-sm text-muted">Tu cuenta está creada. Podrás reservar cuando Felipe la apruebe; esta página se actualiza sola.</p>
          </div>
        </Card>
      )}

      {turn?.mine && (
        <motion.section initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
          className="flex flex-wrap items-center gap-4 rounded-2xl border border-accent/40 bg-accent/10 p-5">
          <div className="mr-auto">
            <h2 className="text-xl font-semibold">Es tu turno</h2>
            <p className="num text-sm text-muted" aria-live="off">
              {turn.state === 'offered' ? `Tienes ${fmtLeft(turn.ends_at - now)} para entrar o pasa el siguiente.` : `Te quedan ${fmtLeft(turn.ends_at - now)}.`}
            </p>
          </div>
          <a href="#jugar" className="press inline-flex min-h-12 items-center rounded-xl bg-accent px-6 font-semibold text-on-accent hover:brightness-110">Jugar ahora</a>
        </motion.section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card title="Reservar una hora" aside={cal.data && <span className="text-xs text-muted">Máx. {cal.data.rules.max_hours_per_day} h por día · hora de Santiago</span>}>
          {!cal.data ? <Empty>{cal.error || 'Cargando horarios…'}</Empty> : (
            <>
              <div role="tablist" aria-label="Día" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
                {cal.data.days.map((d, i) => (
                  <button key={d.date} role="tab" aria-selected={i === day} onClick={() => setDay(i)}
                    className={`press min-h-11 shrink-0 rounded-xl px-3 text-sm capitalize ${i === day ? 'bg-accent text-on-accent font-semibold' : 'bg-raised text-muted hover:text-fg'}`}>
                    {i === 0 ? 'Hoy' : fmtDay(d.slots[0].start_at)}
                  </button>
                ))}
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {(cal.data.days[day] ?? cal.data.days[0])?.slots.map((s) => (
                  <SlotRow key={s.start_at} slot={s} canBook={approved} refresh={refresh} />
                ))}
              </ul>
              {cal.data.days.length === 0 && <Empty>No hay horarios abiertos por ahora.</Empty>}
              <p className="mt-4 text-xs text-muted">Felipe confirma cada reserva. Si el bloque ya está tomado, quedas en su lista de espera.</p>
            </>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Consola ahora">
            <p className="text-sm">
              {turn ? (turn.mine ? 'La tienes tú.' : <>Ocupada. Se libera en <span className="num font-medium">{fmtLeft(turn.ends_at - now)}</span>.</>) : 'Libre.'}
            </p>
          </Card>

          <Card title="Fila en vivo" aside={<Badge>{queue.length} en fila</Badge>}>
            <p className="mb-4 text-sm text-muted">Para jugar en las horas sin reserva. Cuando llega tu turno tienes 5 minutos para entrar, y juegas hasta 60 min o hasta la próxima reserva.</p>
            {queue.mine ? (
              <div className="flex flex-wrap items-center gap-3">
                {queue.mine.status === 'requested'
                  ? <Badge tone="warn">Esperando aprobación</Badge>
                  : <Badge tone="ok">Puesto #{queue.mine.position}</Badge>}
                <ActionButton variant="danger" run={() => api('DELETE', `/bookings/${queue.mine!.id}`).then(refresh)}>Salir de la fila</ActionButton>
              </div>
            ) : (
              <ActionButton variant="primary" disabled={!approved || !!turn?.mine} run={() => api('POST', '/queue').then(refresh)}>Entrar a la fila</ActionButton>
            )}
          </Card>

          <Card title="Antes de jugar">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Usa Chrome en un computador.</li>
              <li>Conecta el computador por cable, no por Wi-Fi.</li>
              <li>Mando de PS4, PS5 o Xbox, por USB o Bluetooth.</li>
              <li>Si juegas en una TV, actívale el modo juego.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SlotRow({ slot: s, canBook, refresh }: { slot: Slot; canBook: boolean; refresh: () => Promise<unknown> }) {
  const label = `${String(s.hour).padStart(2, '0')}:00`
  return (
    <li className="flex min-h-14 items-center gap-3 rounded-xl bg-raised px-3 py-2">
      <span className="num w-12 font-semibold">{label}</span>
      <span className="mr-auto flex flex-wrap gap-1.5">
        {s.mine?.status === 'confirmed' ? <Badge tone="ok">Confirmada</Badge>
          : s.mine ? <Badge tone="warn">{s.taken ? `En espera · #${s.mine.position}` : `Pedida · #${s.mine.position}`}</Badge>
          : s.taken ? <Badge tone="danger">Ocupado</Badge>
          : <Badge>Libre</Badge>}
        {!s.mine && s.waiting > 0 && <Badge>{s.waiting} en espera</Badge>}
      </span>
      {s.mine
        ? <ActionButton variant="danger" aria-label={`Cancelar ${label}`} run={() => api('DELETE', `/bookings/${s.mine!.id}`).then(refresh)}>Cancelar</ActionButton>
        : <ActionButton disabled={!canBook} aria-label={`${s.taken ? 'Lista de espera' : 'Pedir'} ${label}`}
            run={() => api('POST', '/bookings', { start_at: s.start_at }).then(refresh)}>{s.taken ? 'Lista de espera' : 'Pedir'}</ActionButton>}
    </li>
  )
}
