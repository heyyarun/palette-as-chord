// Palette as Chord: every Wada colour gets one audible pitch.
//
// Wada's supplement (附說) pastes wavelengths (470–660 nm) around his 24-hue
// wheel. Transposing light down to sound directly keeps every note inside a
// minor sixth (660/470 ≈ 5.9 semitones), so everything sounds like one dense
// cluster. Instead we keep what the wheel is actually for — adjacency — and
// wrap the hue circle onto the pitch-class circle, the way the wheel itself
// wraps: neighbouring hues are neighbouring semitones, opposite hues are a
// tritone apart. Lightness picks the octave so a dark and a light of the same
// hue are the same note in different octaves.

import type { Lab } from './color.ts'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export interface ChordNote {
  id: number
  /** CIELAB hue angle in degrees, 0–360. Null when the colour is near-grey. */
  hue: number | null
  pitchClass: number
  octave: number
  midi: number
  name: string
  freq: number
}

/** CIELAB hue angle. Returns null for near-achromatic colours (chroma < 8). */
export function labHue([, a, b]: Lab): number | null {
  const chroma = Math.hypot(a, b)
  if (chroma < 8) return null
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return h < 0 ? h + 360 : h
}

/** Octave follows lightness: dark colours sound low, light colours high. */
export function octaveForLightness(L: number): number {
  if (L < 35) return 3
  if (L < 65) return 4
  return 5
}

export function noteFor(id: number, lab: Lab): ChordNote {
  const hue = labHue(lab)
  // Grey colours have no hue to sing; they keep C so lightness still moves them.
  const pitchClass = hue === null ? 0 : Math.round(hue / 30) % 12
  const octave = octaveForLightness(lab[0])
  const midi = (octave + 1) * 12 + pitchClass
  return {
    id,
    hue,
    pitchClass,
    octave,
    midi,
    name: `${NOTE_NAMES[pitchClass]}${octave}`,
    freq: 440 * Math.pow(2, (midi - 69) / 12),
  }
}

export interface ChordInput {
  id: number
  lab: Lab
}

/** One note per colour, sorted low to high so the chord reads bottom-up. */
export function chordFor(colors: ChordInput[]): ChordNote[] {
  return colors.map((c) => noteFor(c.id, c.lab)).sort((a, b) => a.midi - b.midi || a.id - b.id)
}

/** Interval name for two MIDI notes, e.g. 7 -> "perfect fifth". */
export function intervalName(semitones: number): string {
  const s = ((semitones % 12) + 12) % 12
  // Same pitch class an octave or more apart is an octave, not a unison.
  if (s === 0 && semitones !== 0) return 'octave'
  return (
    {
      0: 'unison',
      1: 'minor 2nd',
      2: 'major 2nd',
      3: 'minor 3rd',
      4: 'major 3rd',
      5: 'perfect 4th',
      6: 'tritone',
      7: 'perfect 5th',
      8: 'minor 6th',
      9: 'major 6th',
      10: 'minor 7th',
      11: 'major 7th',
    } as Record<number, string>
  )[s]
}

/** One-line shape of a chord, e.g. "C4 + E4 + G4 · major 3rd + minor 3rd". */
export function chordReading(notes: ChordNote[]): string {
  if (notes.length === 0) return ''
  const names = notes.map((n) => n.name).join(' + ')
  if (notes.length < 2) return names
  const steps = notes.slice(1).map((n, i) => intervalName(n.midi - notes[i].midi))
  return `${names} · ${steps.join(' + ')}`
}

// ---------- Playback (Web Audio; the mapping above stays pure and testable) ----------

let sharedCtx: AudioContext | null = null

export type AudioSessionProbe = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & {
  audioSession?: { type: string }
}

/** Route Web Audio through the playback channel so the chord sounds even
 *  with the Ring/Silent switch on. Safari 17+ only; no-op elsewhere. */
export function requestPlaybackSession(nav: AudioSessionProbe): void {
  try {
    if (nav.audioSession) nav.audioSession.type = 'playback'
  } catch {
    /* read-only or unsupported: the silent switch keeps working */
  }
}

/** True where the page cannot make sound on silent: iOS without the Audio
 *  Session API (Safari < 17), where Web Audio stays ambient and the
 *  Ring/Silent switch mutes it. */
export function silentSwitchMutes(nav: AudioSessionProbe): boolean {
  if (nav.audioSession) return false
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true
  // iPadOS reports a Mac platform; touch gives it away.
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1
}

function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  requestPlaybackSession(navigator)
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  sharedCtx ??= new AC()
  if (sharedCtx.state === 'suspended') void sharedCtx.resume()
  return sharedCtx
}

/** Play one note. Returns a stop function. No-op where Web Audio is missing. */
export function playNote(freq: number, seconds = 1.4, audio = ctx()): () => void {
  if (!audio) return () => {}
  const t = audio.currentTime
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, t)
  gain.gain.linearRampToValueAtTime(0.22, t + 0.025)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
  osc.connect(gain).connect(audio.destination)
  osc.start(t)
  osc.stop(t + seconds + 0.05)
  return () => {
    try {
      osc.stop()
    } catch {
      /* already stopped */
    }
  }
}

/** Play a chord as simultaneous notes, lowest first with a tiny 35 ms strum. */
export function playChord(notes: ChordNote[], seconds = 1.8, audio = ctx()): () => void {
  if (!audio) return () => {}
  const stops = notes.map((n, i) => {
    const t = audio.currentTime + i * STRUM
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = i === 0 ? 'triangle' : 'sine'
    osc.frequency.value = n.freq
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.2 / Math.sqrt(notes.length), t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + seconds + 0.05)
    return osc
  })
  return () => {
    for (const osc of stops) {
      try {
        osc.stop()
      } catch {
        /* already stopped */
      }
    }
  }
}

/** Seconds between notes when a chord is strummed or broken. */
export const STRUM = 0.035
export const ARPEGGIO_STEP = 0.24

/** Play the notes one after another, low to high. Returns a stop function. */
export function playArpeggio(notes: ChordNote[], audio = ctx()): () => void {
  if (!audio) return () => {}
  // playNote's stop never throws: it swallows "already stopped" itself.
  const stops: Array<() => void> = []
  const timers = notes.map((n, i) =>
    window.setTimeout(() => {
      stops.push(playNote(n.freq, 1.1, audio))
    }, i * ARPEGGIO_STEP * 1000),
  )
  return () => {
    for (const t of timers) window.clearTimeout(t)
    for (const stop of stops.splice(0)) stop()
  }
}
