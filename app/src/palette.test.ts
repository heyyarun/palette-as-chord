import { describe, expect, it } from 'vitest'
import { buildPalette, combinations, palette } from './palette.ts'

describe('palette', () => {
  it("has Wada's 159 colours in 348 combinations of 2 to 4", () => {
    expect(palette).toHaveLength(159)
    expect(combinations.size).toBe(348)
    for (const ids of combinations.values()) {
      expect(ids.length).toBeGreaterThanOrEqual(2)
      expect(ids.length).toBeLessThanOrEqual(4)
    }
  })

  it('numbers colours from 001', () => {
    expect(palette[0].no).toBe('001')
    expect(palette[158].no).toBe('159')
  })

  it('carries the Japanese names read from the 1933 plates', () => {
    const byEn = (en: string) => palette.find((c) => c.en === en)!
    expect(byEn('Grenadine Pink')).toMatchObject({ kanji: '洗朱', kana: 'あらいしゅ' })
    expect(byEn('English Red')).toMatchObject({ kanji: '蒲色', kana: 'かばいろ' })
    expect(palette.every((c) => c.kanji && c.kana)).toBe(true)
  })

  it('shows only confident Japanese readings', () => {
    const raw = [
      { name: 'A', combinations: [1], swatch: 0, hex: '#ff0000' },
      { name: 'B', combinations: [1], swatch: 0, hex: '#00ff00' },
    ]
    const p = buildPalette(raw, [
      { index: 0, kanji: '赤', kana: 'あか', confidence: 'high' },
      { index: 1, kanji: '緑', kana: 'みどり', confidence: 'low' },
    ])
    expect(p[0].kanji).toBe('赤')
    expect(p[1].kanji).toBe('')
    expect(p[1].kana).toBe('')
  })
})
