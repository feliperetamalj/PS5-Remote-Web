// Protocolo del mando: 16 bytes little-endian por el DataChannel "pad".
//   u16 seq · u32 buttons · i16 lx, ly, rx, ry · u8 l2, r2
// Los bits de `buttons` son los de ChiakiControllerButton (chiaki-ng, lib/include/chiaki/controller.h).
// media/ aplica su propia máscara: lo que se bloquea aquí es cortesía, la seguridad está en el servidor.

export const BTN = {
  CROSS: 1 << 0, MOON: 1 << 1, BOX: 1 << 2, PYRAMID: 1 << 3,
  LEFT: 1 << 4, RIGHT: 1 << 5, UP: 1 << 6, DOWN: 1 << 7,
  L1: 1 << 8, R1: 1 << 9, L3: 1 << 10, R3: 1 << 11,
  OPTIONS: 1 << 12, SHARE: 1 << 13, TOUCHPAD: 1 << 14, PS: 1 << 15,
} as const

// Índice = botón del layout "standard" de la Gamepad API (igual para Xbox, DualShock 4 y DualSense).
// 6 y 7 son los gatillos (analógicos, van aparte). 8 (Back/Share/Create) → touchpad, que GTA usa para el mapa.
// 16 (Home/PS) no se envía. 17 es el clic del touchpad en los mandos de PlayStation.
const STANDARD = [
  BTN.CROSS, BTN.MOON, BTN.BOX, BTN.PYRAMID, BTN.L1, BTN.R1, 0, 0,
  BTN.TOUCHPAD, BTN.OPTIONS, BTN.L3, BTN.R3, BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT, 0, BTN.TOUCHPAD,
]

export type PadState = { buttons: number; lx: number; ly: number; rx: number; ry: number; l2: number; r2: number }
export const NEUTRAL: PadState = { buttons: 0, lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0 }

type PadLike = { buttons: readonly { pressed: boolean; value: number }[]; axes: readonly number[] }

/** Zona muerta radial: bajo el umbral es 0 y el resto se reescala para no perder recorrido. */
function stick(x = 0, y = 0, deadzone: number): [number, number] {
  const mag = Math.hypot(x, y)
  if (mag <= deadzone) return [0, 0]
  const k = Math.min((mag - deadzone) / (1 - deadzone), 1) / mag
  return [Math.round(x * k * 32767), Math.round(y * k * 32767)]
}

export function readPad(gp: PadLike, deadzone = 0.08): PadState {
  let buttons = 0
  for (let i = 0; i < STANDARD.length; i++) if (gp.buttons[i]?.pressed) buttons |= STANDARD[i]
  const [lx, ly] = stick(gp.axes[0], gp.axes[1], deadzone)
  const [rx, ry] = stick(gp.axes[2], gp.axes[3], deadzone)
  const trigger = (i: number) => Math.round(Math.min(Math.max(gp.buttons[i]?.value ?? 0, 0), 1) * 255)
  return { buttons, lx, ly, rx, ry, l2: trigger(6), r2: trigger(7) }
}

export const samePad = (a: PadState, b: PadState) =>
  a.buttons === b.buttons && a.lx === b.lx && a.ly === b.ly && a.rx === b.rx && a.ry === b.ry && a.l2 === b.l2 && a.r2 === b.r2

export function encodePad(seq: number, s: PadState): ArrayBuffer {
  const buf = new ArrayBuffer(16)
  const v = new DataView(buf)
  v.setUint16(0, seq & 0xffff, true)
  v.setUint32(2, s.buttons >>> 0, true)
  v.setInt16(6, s.lx, true); v.setInt16(8, s.ly, true); v.setInt16(10, s.rx, true); v.setInt16(12, s.ry, true)
  v.setUint8(14, s.l2); v.setUint8(15, s.r2)
  return buf
}
