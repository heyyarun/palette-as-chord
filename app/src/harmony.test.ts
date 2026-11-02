import { describe, expect, it } from 'vitest'
import { noteFor } from './chord.ts'
import { DUPLICATE_DELTA_E, hueGap, nameFor, suggestionsFor, wheelRelation } from './harmony.ts'
import { deltaE2000, type Lab } from './color.ts'
import { combinations, palette } from './palette.ts'

describe('hueGap', () => {
  it('measures the short way round the wheel', () => {
    expect(hueGap(10, 350)).toBe(20)
    expect(hueGap(0, 180)).toBe(180)
    expect(hueGap(90, 30)).toBe(60)
  })
})

describe('wheelRelation', () => {
  const lab = (L: number, hue: number, chroma = 40): Lab => [
    L,
    chroma * Math.cos((hue * Math.PI) / 180),
    chroma * Math.sin((hue * Math.PI) / 180),
  ]

  it('names the classic wheel relations', () => {
    expect(wheelRelation(lab(50, 20), lab(50, 200))).toBe('complement')
    expect(wheelRelation(lab(50, 20), lab(50, 140))).toBe('triad')
    expect(wheelRelation(lab(50, 20), lab(50, 50))).toBe('analogous')
    expect(wheelRelation(lab(30, 20), lab(80, 25))).toBe('tonal')
  })

  it('gives greys no wheel relation', () => {
    expect(wheelRelation([50, 0, 0], lab(50, 200))).toBeNull()
  })

  it('lands each relation on its interval', () => {
    const pc = (l: Lab) => noteFor(0, l).pitchClass
    const gap = (a: Lab, b: Lab) => {
      const d = Math.abs(pc(a) - pc(b)) % 12
      return Math.min(d, 12 - d)
    }
    expect(gap(lab(50, 30), lab(50, 210))).toBe(6) // tritone
    expect(gap(lab(50, 30), lab(50, 150))).toBe(4) // major 3rd
    expect(gap(lab(50, 30), lab(50, 60))).toBe(1) // semitone
  })
})

describe('suggestionsFor', () => {
  const firstCombo = [...combinations.get(1)!]

  it("puts Wada's own pairings first", () => {
    const ids = [firstCombo[0]]
    const sugg = suggestionsFor(ids, palette)
    const paired = new Set(
      [...combinations.values()].filter((c) => c.includes(ids[0])).flat().filter((id) => id !== ids[0]),
    )
    expect(sugg.length).toBeGreaterThan(0)
    expect(paired.has(sugg[0].id)).toBe(true)
    expect(sugg[0].relations[0]).toBe('wada')
    expect(sugg[0].comboNo).toBeDefined()
    expect(combinations.get(sugg[0].comboNo!)).toEqual(expect.arrayContaining([ids[0], sugg[0].id]))
  })

  it('never suggests a colour already there or a near-duplicate of one', () => {
    const sugg = suggestionsFor(firstCombo, palette)
    for (const s of sugg) {
      expect(firstCombo).not.toContain(s.id)
      for (const id of firstCombo) {
        expect(deltaE2000(palette[id].lab, palette[s.id].lab)).toBeGreaterThanOrEqual(DUPLICATE_DELTA_E)
      }
    }
  })

  it('ranks highest the colours tied to more of the palette', () => {
    const sugg = suggestionsFor(firstCombo, palette)
    for (let i = 1; i < sugg.length; i++) expect(sugg[i - 1].score).toBeGreaterThanOrEqual(sugg[i].score)
  })
})

describe('nameFor', () => {
  it('builds a name from the colour names and a musical form', () => {
    const cols = firstTwo()
    const name = nameFor(cols)
    expect(name.split(' ').length).toBeGreaterThanOrEqual(2)
    const words = cols.flatMap((c) => c.en.split(' '))
    expect(words).toContain(name.split(' ')[0])
  })

  it('rerolls with a new seed and is stable for the same seed', () => {
    const cols = firstTwo()
    expect(nameFor(cols, 3)).toBe(nameFor(cols, 3))
    const names = new Set([0, 1, 2, 3, 4, 5].map((s) => nameFor(cols, s)))
    expect(names.size).toBeGreaterThan(1)
  })
})

function firstTwo() {
  return [...combinations.get(1)!].map((id) => palette[id])
}
