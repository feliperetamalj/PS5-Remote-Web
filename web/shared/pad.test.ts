import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BTN, readPad, encodePad, samePad, NEUTRAL } from './pad.ts'

const pad = (pressed: number[], axes = [0, 0, 0, 0], values: Record<number, number> = {}) => ({
  axes,
  buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
})

test('mapeo: Back va al touchpad, Start a Options y Home no se envía', () => {
  assert.equal(readPad(pad([0])).buttons, BTN.CROSS)
  assert.equal(readPad(pad([8])).buttons, BTN.TOUCHPAD)
  assert.equal(readPad(pad([9])).buttons, BTN.OPTIONS)
  assert.equal(readPad(pad([16])).buttons, 0)
  assert.equal(readPad(pad([12, 15])).buttons, BTN.UP | BTN.RIGHT)
  const all = readPad(pad(Array.from({ length: 18 }, (_, i) => i))).buttons
  assert.equal(all & (BTN.PS | BTN.SHARE), 0) // el cliente nunca arma PS ni Create
})

test('sticks: zona muerta, recorrido completo y gatillos', () => {
  assert.deepEqual(readPad(pad([], [0.05, -0.05, 0, 0])), NEUTRAL)
  const full = readPad(pad([], [1, 0, 0, -1], { 6: 0.5, 7: 1 }))
  assert.deepEqual([full.lx, full.ly, full.rx, full.ry, full.l2, full.r2], [32767, 0, 0, -32767, 128, 255])
  assert.equal(readPad(pad([], [1, 1, 0, 0])).lx <= 32767, true) // diagonal no desborda int16
  assert.equal(samePad(full, { ...full }), true)
  assert.equal(samePad(full, NEUTRAL), false)
})

test('paquete: 16 bytes little-endian', () => {
  const buf = encodePad(0x1_0002, { buttons: BTN.CROSS | BTN.TOUCHPAD, lx: -2, ly: 3, rx: 32767, ry: -32768, l2: 7, r2: 255 })
  assert.equal(buf.byteLength, 16)
  assert.deepEqual([...new Uint8Array(buf)], [2, 0, 1, 0x40, 0, 0, 0xfe, 0xff, 3, 0, 0xff, 0x7f, 0, 0x80, 7, 255])
})
