export type RGB = [number, number, number]
export type Lab = [number, number, number]

// Match tiers for colour distance: at or below EXACT reads as the colour
// itself; at or below CLOSE it still counts as a close match.
export const EXACT_DELTA_E = 6
export const CLOSE_DELTA_E = 12

export type Tier = 'exact' | 'close' | 'far'

export function tierFor(deltaE: number): Tier {
  if (deltaE <= EXACT_DELTA_E) return 'exact'
  if (deltaE <= CLOSE_DELTA_E) return 'close'
  return 'far'
}

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

// sRGB (D65) → CIELAB (D65 white)
export function rgbToLab([r, g, b]: RGB): Lab {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

// CIEDE2000 (Sharma, Wu & Dalal 2005), kL = kC = kH = 1
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const hp = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0
    const h = deg(Math.atan2(b, a))
    return h < 0 ? h + 360 : h
  }
  const h1p = hp(a1p, b1)
  const h2p = hp(a2p, b2)

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2))

  const Lbarp = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbarp = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2
    else hbarp = (h1p + h2p - 360) / 2
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63))
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2)
  const Sc = 1 + 0.045 * Cbarp
  const Sh = 1 + 0.015 * Cbarp * T
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  )
}

export interface Match {
  id: number
  deltaE: number
}

export function nearest(lab: Lab, candidates: { id: number; lab: Lab }[]): Match {
  let best: Match = { id: -1, deltaE: Infinity }
  for (const c of candidates) {
    const d = deltaE2000(lab, c.lab)
    if (d < best.deltaE) best = { id: c.id, deltaE: d }
  }
  return best
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

// Per-channel median of an RGBA buffer: robust to specular highlights and edges in the reticle.
export function medianRGB(data: Uint8ClampedArray): RGB {
  const n = data.length / 4
  const chans: number[][] = [[], [], []]
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] === 0) continue
    chans[0].push(data[i * 4])
    chans[1].push(data[i * 4 + 1])
    chans[2].push(data[i * 4 + 2])
  }
  const med = (arr: number[]) => {
    if (arr.length === 0) return 0
    arr.sort((a, b) => a - b)
    const m = arr.length >> 1
    return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2
  }
  return [med(chans[0]), med(chans[1]), med(chans[2])]
}
