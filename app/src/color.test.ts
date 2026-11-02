import { describe, expect, it } from 'vitest'
import { CLOSE_DELTA_E, deltaE2000, medianRGB, nearest, rgbToLab, tierFor, type Lab } from './color.ts'
import { palette } from './palette.ts'

describe('rgbToLab', () => {
  it('maps white and black to the ends of L*', () => {
    const w = rgbToLab([255, 255, 255])
    expect(w[0]).toBeCloseTo(100, 2)
    expect(Math.abs(w[1])).toBeLessThan(0.01)
    expect(Math.abs(w[2])).toBeLessThan(0.01)
    expect(rgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 5)
  })

  it('matches the reference value for pure sRGB red', () => {
    const [L, a, b] = rgbToLab([255, 0, 0])
    expect(L).toBeCloseTo(53.24, 1)
    expect(a).toBeCloseTo(80.09, 1)
    expect(b).toBeCloseTo(67.2, 1)
  })
})

describe('deltaE2000', () => {
  // Test pairs from Sharma, Wu & Dalal (2005), Table 1.
  const pairs: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ]
  it.each(pairs)('%j vs %j = %d', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 3)
    expect(deltaE2000(b, a)).toBeCloseTo(expected, 3)
  })
})

describe('nearest', () => {
  it('finds each Wada colour as its own nearest match', () => {
    for (const c of palette) {
      const m = nearest(c.lab, palette)
      expect(m.deltaE).toBeCloseTo(0, 6)
      expect(palette[m.id].hex).toBe(c.hex)
    }
  })

  it('a slightly shifted colour still matches the original as a close match', () => {
    const c = palette.find((p) => p.en === 'Grenadine Pink')!
    const [r, g, b] = c.rgb
    const m = nearest(rgbToLab([r + 6, g - 4, b + 3]), palette)
    expect(m.id).toBe(c.id)
    expect(m.deltaE).toBeLessThan(CLOSE_DELTA_E)
  })
})

describe('tierFor', () => {
  it('splits exact, close and far at the thresholds', () => {
    expect(tierFor(0)).toBe('exact')
    expect(tierFor(6)).toBe('exact')
    expect(tierFor(6.01)).toBe('close')
    expect(tierFor(12)).toBe('close')
    expect(tierFor(12.01)).toBe('far')
  })
})

describe('medianRGB', () => {
  it('ignores a few bright specular pixels', () => {
    const px: number[] = []
    for (let i = 0; i < 16; i++) px.push(...(i < 3 ? [255, 255, 255, 255] : [120, 60, 30, 255]))
    expect(medianRGB(new Uint8ClampedArray(px))).toEqual([120, 60, 30])
  })
})
