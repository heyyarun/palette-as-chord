import { describe, expect, it } from 'vitest'
import { noteFor } from './chord.ts'
import { HIGH_MIDI, LOW_MIDI, WHITE_COUNT, isBlack, keyboardLayout, onKeyboard } from './keyboard.ts'
import { palette } from './palette.ts'

describe('keyboardLayout', () => {
  const keys = keyboardLayout()

  it('carries three octaves, C3 to B5: 21 white and 15 black keys', () => {
    expect(keys).toHaveLength(36)
    expect(WHITE_COUNT).toBe(21)
    expect(keys.filter((k) => k.black)).toHaveLength(15)
    expect(keys[0].midi).toBe(48)
    expect(keys.at(-1)!.midi).toBe(83)
  })

  it('has a key for every note a Wada colour can sing', () => {
    const midis = new Set(keys.map((k) => k.midi))
    for (const c of palette) expect(midis.has(noteFor(c.id, c.lab).midi)).toBe(true)
  })

  it('puts white keys side by side and each black key on the seam between its neighbours', () => {
    const whites = keys.filter((k) => !k.black)
    for (let i = 1; i < whites.length; i++) expect(whites[i].x - whites[i - 1].x).toBeCloseTo(1)
    expect(whites[0].x).toBeCloseTo(-WHITE_COUNT / 2 + 0.5)
    for (const k of keys.filter((k) => k.black)) {
      const below = keys[k.index - 1]
      const above = keys[k.index + 1]
      expect(k.x).toBeCloseTo((below.x + above.x) / 2)
    }
  })

  it('knows C# is black and E is white', () => {
    expect(isBlack(49)).toBe(true)
    expect(isBlack(52)).toBe(false)
  })
})

describe('onKeyboard', () => {
  it('folds notes outside C3–B5 back in by octaves', () => {
    expect(onKeyboard(36)).toBe(48)
    expect(onKeyboard(95)).toBe(83)
    expect(onKeyboard(60)).toBe(60)
    expect(onKeyboard(LOW_MIDI - 1)).toBe(LOW_MIDI + 11)
    expect(onKeyboard(HIGH_MIDI + 1)).toBe(HIGH_MIDI - 11)
  })
})
