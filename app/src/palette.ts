import rawColors from './data/wada-colors.json'
import rawNames from './data/japanese-names.json'
import { hexToRgb, rgbToLab, type Lab, type RGB } from './color.ts'

interface RawColor {
  name: string
  combinations: number[]
  swatch: number
  hex: string
}

export interface JapaneseName {
  index: number
  kanji: string
  kana: string
  confidence: 'high' | 'medium' | 'low' | 'not_found'
}

export interface WadaColor {
  id: number
  no: string
  en: string
  kanji: string
  kana: string
  hex: string
  rgb: RGB
  lab: Lab
  chapter: number
  combinations: number[]
}

export function buildPalette(colors: RawColor[], names: JapaneseName[]): WadaColor[] {
  const byIndex = new Map(names.map((n) => [n.index, n]))
  return colors.map((c, id) => {
    const jp = byIndex.get(id)
    // Low-confidence readings from the scans are left out rather than shown as fact.
    const trusted = jp && (jp.confidence === 'high' || jp.confidence === 'medium')
    const rgb = hexToRgb(c.hex)
    return {
      id,
      no: String(id + 1).padStart(3, '0'),
      en: c.name,
      kanji: trusted ? jp.kanji : '',
      kana: trusted ? jp.kana : '',
      hex: c.hex,
      rgb,
      lab: rgbToLab(rgb),
      chapter: c.swatch,
      combinations: c.combinations,
    }
  })
}

export function buildCombinations(palette: WadaColor[]): Map<number, number[]> {
  const combos = new Map<number, number[]>()
  for (const c of palette) {
    for (const k of c.combinations) {
      if (!combos.has(k)) combos.set(k, [])
      combos.get(k)!.push(c.id)
    }
  }
  return combos
}

export const palette = buildPalette(rawColors as RawColor[], rawNames as JapaneseName[])
export const combinations = buildCombinations(palette)
