// Layout of the piano keyboard the colours can play. chord.ts maps every
// colour into C3–B5, so the 3D piano carries exactly those three octaves:
// 36 keys, 21 white and 15 black. Units are white-key widths.

export const LOW_MIDI = 48 // C3
export const HIGH_MIDI = 83 // B5

const BLACK_PCS = new Set([1, 3, 6, 8, 10])

export const isBlack = (midi: number) => BLACK_PCS.has(((midi % 12) + 12) % 12)

export interface KeyLayout {
  midi: number
  black: boolean
  /** Centre of the key across the keyboard, 0 at the middle. */
  x: number
  /** Index among the 36 keys, low to high. */
  index: number
}

export const WHITE_COUNT = (() => {
  let n = 0
  for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) if (!isBlack(m)) n++
  return n
})()

/** Every key from C3 to B5 with its position. Black keys sit on the seam between their white neighbours. */
export function keyboardLayout(): KeyLayout[] {
  const keys: KeyLayout[] = []
  let white = 0
  for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) {
    const black = isBlack(m)
    const left = -WHITE_COUNT / 2
    const x = black ? left + white : left + white + 0.5
    keys.push({ midi: m, black, x, index: m - LOW_MIDI })
    if (!black) white++
  }
  return keys
}

/** Clamp a MIDI note onto the keyboard by octaves, so nothing falls off the end. */
export function onKeyboard(midi: number): number {
  let m = midi
  while (m < LOW_MIDI) m += 12
  while (m > HIGH_MIDI) m -= 12
  return m
}
