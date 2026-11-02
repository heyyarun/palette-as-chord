// Palettes pinned to the page, kept in this browser only.

export interface Pin {
  id: string
  name: string
  author: string
  ids: number[]
  pinnedAt: string
  /** Set once the palette has been sent to the shared board. */
  submittedId?: string
}

const KEY = 'palette-chord:pins:v1'
const AUTHOR_KEY = 'palette-chord:author'

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadPins(s = store()): Pin[] {
  try {
    const raw = s?.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as Pin[]) : []
    return Array.isArray(list) ? list.filter((p) => p && Array.isArray(p.ids) && typeof p.name === 'string') : []
  } catch {
    return []
  }
}

export function savePins(pins: Pin[], s = store()) {
  s?.setItem(KEY, JSON.stringify(pins))
}

export function newPin(name: string, author: string, ids: number[]): Pin {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    author: author.trim(),
    ids: [...ids],
    pinnedAt: new Date().toISOString(),
  }
}

export const loadAuthor = (s = store()) => s?.getItem(AUTHOR_KEY) ?? ''
export const saveAuthor = (name: string, s = store()) => s?.setItem(AUTHOR_KEY, name.trim())
