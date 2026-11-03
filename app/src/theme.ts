// Paper (light) and Night (dark) themes. "Auto" follows the system setting.
// index.html applies the stored choice before first paint so there is no flash;
// this module keeps it in sync afterwards.

export type ThemePref = 'auto' | 'paper' | 'night'
export type Theme = 'paper' | 'night'

const KEY = 'palette-chord:theme'
const META: Record<Theme, string> = { paper: '#c5c8c2', night: '#171513' }
const dark = () => window.matchMedia('(prefers-color-scheme: dark)')

export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'paper' || v === 'night' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export const resolveTheme = (pref: ThemePref, systemDark: boolean): Theme =>
  pref === 'auto' ? (systemDark ? 'night' : 'paper') : pref

export function applyTheme(pref: ThemePref) {
  const theme = resolveTheme(pref, dark().matches)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[theme])
  document.dispatchEvent(new CustomEvent<Theme>('themechange', { detail: theme }))
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
  applyTheme(pref)
}

/** Re-apply when the system setting changes while on Auto. */
export function followSystem(getPref: () => ThemePref) {
  dark().addEventListener('change', () => {
    if (getPref() === 'auto') applyTheme('auto')
  })
}
