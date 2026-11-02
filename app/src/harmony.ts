// Colour theory for growing a palette, taken from the dictionary itself.
//
// The strongest evidence is Wada's own book: if he printed two colours in
// the same combination, they belong together. Every colour he ever paired
// with something already in the palette is a candidate, ranked by how many
// of the palette's colours it was paired with.
//
// Behind that sits the hue wheel from his supplement (附說). Classic wheel
// relations each land on a fixed interval because chord.ts wraps 30° of hue
// onto one semitone:
//   complement (180°) → tritone, triad (120°) → major 3rd,
//   analogous (≈30°) → a semitone step, tonal (same hue, new lightness) → octave.

import { deltaE2000, type Lab } from './color.ts'
import { labHue } from './chord.ts'

export type Relation = 'wada' | 'complement' | 'triad' | 'analogous' | 'tonal'

export const RELATIONS: { key: Relation; label: string; sound: string }[] = [
  { key: 'wada', label: "Wada's pairings", sound: 'printed together in the book' },
  { key: 'complement', label: 'Complement', sound: 'opposite hue · a tritone' },
  { key: 'triad', label: 'Triad', sound: 'a third of the wheel · a major 3rd' },
  { key: 'analogous', label: 'Analogous', sound: 'neighbouring hue · a semitone' },
  { key: 'tonal', label: 'Tonal', sound: 'same hue, new lightness · an octave' },
]

export interface HarmonyColor {
  id: number
  en: string
  lab: Lab
  combinations: number[]
}

export interface Suggestion {
  id: number
  score: number
  /** Every relation this colour has with the palette, strongest first. */
  relations: Relation[]
  /** The palette colour behind the main relation. */
  anchorId: number
  /** For Wada pairings: the combination number that printed them together. */
  comboNo?: number
}

/** Shortest distance between two hue angles, 0–180. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Wheel relation between two colours, or null when they have none. */
export function wheelRelation(a: Lab, b: Lab): Exclude<Relation, 'wada'> | null {
  const ha = labHue(a)
  const hb = labHue(b)
  if (ha === null || hb === null) return null
  const gap = hueGap(ha, hb)
  if (gap >= 160) return 'complement'
  if (gap >= 105 && gap <= 135) return 'triad'
  if (gap <= 12 && Math.abs(a[0] - b[0]) >= 20) return 'tonal'
  if (gap >= 15 && gap <= 45) return 'analogous'
  return null
}

const WEIGHT: Record<Relation, number> = { wada: 4, complement: 2, triad: 1.5, tonal: 1.2, analogous: 1 }

/** Colours this close to one already in the palette would only double it. */
export const DUPLICATE_DELTA_E = 8

export function suggestionsFor(paletteIds: number[], colors: HarmonyColor[]): Suggestion[] {
  const members = paletteIds.map((id) => colors[id])
  const out: Suggestion[] = []
  for (const cand of colors) {
    if (paletteIds.includes(cand.id)) continue
    if (members.some((m) => deltaE2000(m.lab, cand.lab) < DUPLICATE_DELTA_E)) continue

    let score = 0
    const found = new Map<Relation, { anchorId: number; comboNo?: number }>()
    for (const m of members) {
      const shared = m.combinations.filter((k) => cand.combinations.includes(k))
      if (shared.length) {
        score += WEIGHT.wada + shared.length - 1
        if (!found.has('wada')) found.set('wada', { anchorId: m.id, comboNo: shared[0] })
      }
      const rel = wheelRelation(m.lab, cand.lab)
      if (rel) {
        score += WEIGHT[rel]
        if (!found.has(rel)) found.set(rel, { anchorId: m.id })
      }
    }
    if (score === 0) continue

    const relations = [...found.keys()].sort((a, b) => WEIGHT[b] - WEIGHT[a])
    const main = found.get(relations[0])!
    out.push({ id: cand.id, score, relations, anchorId: main.anchorId, comboNo: main.comboNo })
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id)
}

// ---------- Names ----------

const FORMS_DARK = ['Nocturne', 'Lament', 'Fugue', 'Elegy', 'Requiem', 'Night Song']
const FORMS_MID = ['Étude', 'Ballad', 'Canon', 'Serenade', 'Interlude', 'Reverie']
const FORMS_LIGHT = ['Aubade', 'Lullaby', 'Prelude', 'Pastorale', 'Rhapsody', 'Morning Song']

/**
 * A name for a palette built from its own colour names and its mood:
 * "Coral Cobalt Nocturne". `seed` rerolls the choice.
 */
export function nameFor(colors: { en: string; lab: Lab }[], seed = 0): string {
  if (colors.length === 0) return ''
  const pick = <T,>(arr: T[], n: number) => arr[((n % arr.length) + arr.length) % arr.length]
  const wordsOf = (c: { en: string }) => {
    const w = c.en.split(/\s+/).filter((x) => x.length > 2)
    return w.length ? w : [c.en]
  }
  const meanL = colors.reduce((s, c) => s + c.lab[0], 0) / colors.length
  const forms = meanL < 45 ? FORMS_DARK : meanL < 70 ? FORMS_MID : FORMS_LIGHT
  // Borrow one word from each of two different colours, so the name mixes
  // the palette instead of repeating one colour's full name.
  const n = colors.length
  const ai = ((seed % n) + n) % n
  let bi = (ai + 1 + Math.floor(Math.abs(seed) / n)) % n
  if (bi === ai && n > 1) bi = (ai + 1) % n
  const a = colors[ai]
  const b = colors[bi]
  const first = pick(wordsOf(a), seed)
  const bw = wordsOf(b)
  let second = bw[bw.length - 1]
  if (second === first) second = pick(bw, seed + 1)
  const form = pick(forms, seed + colors.length)
  return second === first ? `${first} ${form}` : `${first} ${second} ${form}`
}
