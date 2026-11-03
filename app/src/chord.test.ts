import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARPEGGIO_STEP, chordFor, chordReading, intervalName, labHue, noteFor, octaveForLightness, playArpeggio } from './chord.ts'
import { palette } from './palette.ts'

describe('labHue', () => {
  it('reads red near 0° and its complement near 180°', () => {
    const red = palette.find((c) => c.en === 'English Red')!
    const green = palette.find((c) => c.en === 'Sea Green')!
    const hr = labHue(red.lab)!
    const hg = labHue(green.lab)!
    expect(hr).toBeGreaterThanOrEqual(0)
    expect(hr).toBeLessThan(360)
    const apart = Math.abs(hr - hg)
    expect(Math.min(apart, 360 - apart)).toBeGreaterThan(60)
  })

  it('returns null for near-grey', () => {
    const gray = palette.find((c) => c.en === 'Neutral Gray')!
    expect(labHue(gray.lab)).toBeNull()
  })
})

describe('noteFor', () => {
  it('maps every Wada colour into a singable range, C3–B5', () => {
    for (const c of palette) {
      const n = noteFor(c.id, c.lab)
      expect(n.midi).toBeGreaterThanOrEqual(48) // C3
      expect(n.midi).toBeLessThanOrEqual(83) // B5
      expect(n.freq).toBeGreaterThan(120)
      expect(n.freq).toBeLessThan(1100)
    }
  })

  it('keeps neighbouring hues to neighbouring semitones', () => {
    const a = noteFor(0, [60, 40, 0]) // hue 0°
    const b = noteFor(1, [60, 34.6, 20]) // hue 30°
    expect((b.pitchClass - a.pitchClass + 12) % 12).toBe(1)
  })

  it('puts dark and light greys on the same pitch class in different octaves', () => {
    const dark = noteFor(0, [20, 0, 0])
    const light = noteFor(1, [90, 0, 0])
    expect(dark.pitchClass).toBe(light.pitchClass)
    expect(dark.octave).toBeLessThan(light.octave)
  })

  it('moves octaves with lightness', () => {
    expect(octaveForLightness(20)).toBe(3)
    expect(octaveForLightness(50)).toBe(4)
    expect(octaveForLightness(80)).toBe(5)
  })
})

describe('chordFor', () => {
  it('sorts the chord low to high and reads like a lead sheet', () => {
    const colors = [palette[0], palette[10], palette[100]].map((c) => ({ id: c.id, lab: c.lab }))
    const chord = chordFor(colors)
    const midis = chord.map((n) => n.midi)
    expect([...midis].sort((x, y) => x - y)).toEqual(midis)
    const reading = chordReading(chord)
    for (const n of chord) expect(reading).toContain(n.name)
  })

  it('names the classic intervals', () => {
    expect(intervalName(7)).toBe('perfect 5th')
    expect(intervalName(4)).toBe('major 3rd')
    expect(intervalName(6)).toBe('tritone')
    expect(intervalName(0)).toBe('unison')
    expect(intervalName(12)).toBe('octave')
  })
})

describe('playArpeggio', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stop silences notes already sounding and cancels the rest', () => {
    vi.useFakeTimers()
    // playArpeggio schedules with window timers; point them at the faked clock.
    vi.stubGlobal('window', {
      setTimeout: (...args: [() => void, number]) => setTimeout(...args),
      clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    })
    interface FakeOsc {
      stopArgs: unknown[][]
    }
    const oscs: FakeOsc[] = []
    const audio = {
      currentTime: 0,
      destination: {},
      createOscillator: () => {
        const osc: FakeOsc & {
          type: OscillatorType
          frequency: { value: number }
          connect: () => { connect: () => void }
          start: () => void
          stop: (...args: unknown[]) => void
        } = {
          type: 'sine',
          frequency: { value: 0 },
          connect: () => ({ connect: () => {} }),
          start: () => {},
          stop: (...args: unknown[]) => {
            osc.stopArgs.push(args)
          },
          stopArgs: [],
        }
        oscs.push(osc)
        return osc
      },
      createGain: () => ({
        gain: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      }),
    } as unknown as AudioContext

    const notes = chordFor([
      { id: 1, lab: [50, 40, 0] },
      { id: 2, lab: [50, 0, 40] },
      { id: 3, lab: [50, -40, 0] },
    ])
    const stop = playArpeggio(notes, audio)
    expect(oscs).toHaveLength(0)

    // The first note (t=0) has started; the second (t=240ms) has not.
    vi.advanceTimersByTime((ARPEGGIO_STEP * 1000) / 2)
    expect(oscs).toHaveLength(1)

    stop()
    // playNote schedules one timed stop; the arpeggio stop adds an immediate one.
    expect(oscs[0].stopArgs).toContainEqual([])

    // The remaining notes never start.
    vi.advanceTimersByTime(ARPEGGIO_STEP * 1000 * notes.length)
    expect(oscs).toHaveLength(1)
  })
})
