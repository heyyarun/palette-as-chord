// What a submitted palette looks like on the wire, and the one validator both
// the browser and the dev server use, so they can never disagree.

export interface SubmittedColor {
  no: string
  en: string
  hex: string
  note: string
}

export interface PaletteSubmission {
  name: string
  author: string
  colors: SubmittedColor[]
  chord: string
}

export interface StoredSubmission extends PaletteSubmission {
  id: string
  submittedAt: string
}

export const LIMITS = { name: 60, author: 40, minColors: 2, maxColors: 6 } as const

type Result = { ok: true; value: PaletteSubmission } | { ok: false; error: string }

const str = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')

export function validateSubmission(input: unknown): Result {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Nothing to submit.' }
  const o = input as Record<string, unknown>
  const name = str(o.name)
  const author = str(o.author)
  if (!name) return { ok: false, error: 'Give the palette a name.' }
  if (name.length > LIMITS.name) return { ok: false, error: `Keep the name under ${LIMITS.name} characters.` }
  if (!author) return { ok: false, error: 'Add your name.' }
  if (author.length > LIMITS.author) return { ok: false, error: `Keep your name under ${LIMITS.author} characters.` }
  if (!Array.isArray(o.colors)) return { ok: false, error: 'The palette has no colours.' }
  if (o.colors.length < LIMITS.minColors || o.colors.length > LIMITS.maxColors) {
    return { ok: false, error: `A palette needs ${LIMITS.minColors} to ${LIMITS.maxColors} colours.` }
  }
  const colors: SubmittedColor[] = []
  for (const c of o.colors as Record<string, unknown>[]) {
    const hex = str(c?.hex).toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(hex)) return { ok: false, error: 'A colour is not a valid hex value.' }
    colors.push({ no: str(c.no).slice(0, 3), en: str(c.en).slice(0, 40), hex, note: str(c.note).slice(0, 4) })
  }
  return { ok: true, value: { name, author, colors, chord: str(o.chord).slice(0, 200) } }
}

// ---------- Browser client ----------

const endpoint = () => import.meta.env?.VITE_SUBMIT_URL || '/api/palettes'

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    /* not JSON */
  }
  return `The server answered ${res.status}.`
}

export async function submitPalette(sub: PaletteSubmission): Promise<StoredSubmission> {
  const check = validateSubmission(sub)
  if (!check.ok) throw new Error(check.error)
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(check.value),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as StoredSubmission
}

export async function listSubmissions(): Promise<StoredSubmission[]> {
  const res = await fetch(endpoint())
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as StoredSubmission[]
}
