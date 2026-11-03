import './style.css'
import { ARPEGGIO_STEP, STRUM, chordFor, chordReading, playArpeggio, playChord, playNote, silentSwitchMutes, type ChordNote } from './chord.ts'
import { hexToRgb, rgbToLab } from './color.ts'
import { RELATIONS, nameFor, suggestionsFor, type Relation, type Suggestion } from './harmony.ts'
import { combinations, palette } from './palette.ts'
import { loadAuthor, loadPins, newPin, saveAuthor, savePins, type Pin } from './pins.ts'
import type { Piano } from './piano3d.ts'
import { applyTheme, followSystem, loadThemePref, setThemePref, type ThemePref } from './theme.ts'
import { LIMITS, listSubmissions, submitPalette, type StoredSubmission } from './submission.ts'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<header class="top">
  <div class="theme-switch" role="radiogroup" aria-label="Theme" id="theme-switch">
    <button type="button" role="radio" data-theme-pref="paper">Paper</button>
    <button type="button" role="radio" data-theme-pref="night">Night</button>
    <button type="button" role="radio" data-theme-pref="auto">Auto</button>
  </div>
  <h1 class="brand">Palette as Chord</h1>
  <p class="provenance">After Sanzo Wada's <span lang="ja">配色総鑑</span> (1933–35)</p>
</header>
<main>
  <article class="plate" aria-labelledby="composer-title">
    <h2 class="plate-title" id="composer-title">Your chord</h2>
    <div class="picker">
      <button type="button" class="btn btn-quiet" id="src-prev" aria-label="Previous Wada combination">← Prev</button>
      <p class="plate-no" id="src-label" aria-live="polite"></p>
      <div class="picker-btns">
        <button type="button" class="btn btn-quiet" id="src-next" aria-label="Next Wada combination">Next →</button>
        <button type="button" class="btn btn-quiet" id="src-shuffle" aria-label="Random Wada combination">Shuffle</button>
      </div>
    </div>
    <div class="frame chord-strip" id="strip" role="list" aria-label="Colours in your chord"></div>
    <p class="chord-reading" id="reading" aria-live="polite"></p>
    <div class="chord-actions">
      <button type="button" class="btn btn-ink" id="play">Play chord</button>
      <button type="button" class="btn btn-line" id="arp">Arpeggio</button>
    </div>
    <p class="silent-hint" id="silent-hint" hidden>No sound on iPhone? Silent mode mutes web audio here — turn the Ring/Silent switch off.</p>
    <figure class="piano-stage" id="piano-stage">
      <p class="piano-status" id="piano-status">Tuning the piano…</p>
      <figcaption class="piano-caption">Tap a key to play it</figcaption>
    </figure>
    <p class="hint">Hue wraps onto pitch (30° = one semitone), lightness picks the octave. Tap a swatch to hear its note.</p>
  </article>

  <section class="plate" aria-labelledby="grow-title">
    <h2 class="plate-title" id="grow-title">Grow the chord</h2>
    <p class="hint" id="grow-hint"></p>
    <div class="filters" role="radiogroup" aria-label="Colour relation" id="filters"></div>
    <p class="filter-sound" id="filter-sound"></p>
    <ul class="suggestions" id="suggestions"></ul>
    <div class="more"><button type="button" class="btn btn-quiet" id="more" hidden>Show more</button></div>
  </section>

  <section class="plate" aria-labelledby="pin-title">
    <h2 class="plate-title" id="pin-title">Pin it</h2>
    <form class="pin-form" id="pin-form" novalidate>
      <div class="field">
        <label for="pin-name">Palette name</label>
        <div class="field-row">
          <input id="pin-name" name="name" maxlength="${LIMITS.name}" autocomplete="off" required />
          <button type="button" class="btn btn-line" id="reroll" aria-label="Suggest another name">Suggest</button>
        </div>
      </div>
      <div class="field">
        <label for="pin-author">Your name</label>
        <input id="pin-author" name="author" maxlength="${LIMITS.author}" autocomplete="nickname" />
      </div>
      <p class="form-msg" id="pin-msg" role="status"></p>
      <div class="chord-actions">
        <button type="submit" class="btn btn-ink" value="pin">Pin to page</button>
        <button type="submit" class="btn btn-line" value="submit">Pin &amp; submit</button>
      </div>
    </form>
  </section>

  <section class="board" aria-labelledby="board-title">
    <h2 class="section-title" id="board-title">Pinned <span class="count" id="board-count"></span></h2>
    <p class="hint" id="board-empty">Nothing pinned yet. Find a chord you like, name it and pin it here.</p>
    <ul class="cards" id="board"></ul>
  </section>

  <section class="board" aria-labelledby="wall-title">
    <h2 class="section-title" id="wall-title">Submitted <span class="count" id="wall-count"></span></h2>
    <p class="hint" id="wall-msg"></p>
    <ul class="cards" id="wall"></ul>
  </section>

  <p class="credits">Colours: Sanzo Wada, <span lang="ja">配色総鑑</span> (1933–34), via the MIT-licensed dataset by Matt DesLauriers.</p>
</main>
`

// ---------- Theme ----------

let themePref: ThemePref = loadThemePref()
const themeSwitch = $<HTMLDivElement>('#theme-switch')
function renderThemeSwitch() {
  for (const b of themeSwitch.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')) {
    const on = b.dataset.themePref === themePref
    b.setAttribute('aria-checked', String(on))
    b.tabIndex = on ? 0 : -1
  }
}
themeSwitch.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-pref]')
  if (!b) return
  themePref = b.dataset.themePref as ThemePref
  setThemePref(themePref)
  renderThemeSwitch()
})
// Arrow keys move between options, as a radio group should.
themeSwitch.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return
  const opts = [...themeSwitch.querySelectorAll<HTMLButtonElement>('[data-theme-pref]')]
  const i = opts.findIndex((o) => o.dataset.themePref === themePref)
  const next = opts[(i + (e.key === 'ArrowRight' ? 1 : -1) + opts.length) % opts.length]
  next.click()
  next.focus()
})
applyTheme(themePref)
followSystem(() => themePref)
renderThemeSwitch()

// ---------- State ----------

const comboKeys = [...combinations.keys()].sort((a, b) => a - b)
let sourceNo = comboKeys[0]
let ids: number[] = [...combinations.get(sourceNo)!]
let edited = false
let filter: Relation | 'all' = 'all'
let shown = 6
let nameSeed = 0
let pins: Pin[] = loadPins()
let wall: StoredSubmission[] = []
let stopSound: (() => void) | null = null

const notesOf = (list: number[]) => chordFor(list.map((id) => palette[id]))
const stop = () => {
  stopSound?.()
  stopSound = null
}

// ---------- Composer ----------

const strip = $<HTMLDivElement>('#strip')

function renderComposer() {
  const notes = notesOf(ids)
  $('#src-label').textContent = edited ? `Grown from No. ${sourceNo}` : `Wada No. ${sourceNo}`
  strip.innerHTML =
    notes
      .map((n) => {
        const c = palette[n.id]
        const removable = ids.length > LIMITS.minColors
        return `<div class="chord-sw" role="listitem" data-id="${n.id}" style="background:${c.hex}">
        <button type="button" class="sw-play" data-id="${n.id}" aria-label="Play ${n.name}, ${esc(c.en)}"></button>
        <span class="chord-note">${n.name}</span>
        <span class="chord-name">${esc(c.kanji || c.en)}</span>
        <span class="chord-en">${esc(c.en)}</span>
        ${removable ? `<button type="button" class="sw-remove" data-id="${n.id}" aria-label="Remove ${esc(c.en)}">×</button>` : ''}
      </div>`
      })
      .join('') +
    (ids.length < LIMITS.maxColors
      ? `<a class="chord-slot" href="#grow-title" aria-label="Add a colour from the suggestions below"><span>+</span></a>`
      : '')
  $('#reading').textContent = chordReading(notes)
  piano?.setChord(notes.map((n) => ({ midi: n.midi, color: palette[n.id].hex, label: n.name })))
  refreshAutoName()
  renderSuggestions()
}

/** Light each swatch, and press its piano key, as its note sounds. */
function flash(notes: ChordNote[], step: number) {
  notes.forEach((n, i) => {
    piano?.strike(n.midi, i * step)
    const el = strip.querySelector<HTMLElement>(`.chord-sw[data-id="${n.id}"]`)
    if (!el) return
    el.classList.remove('is-sounding')
    void el.offsetWidth
    el.style.animationDelay = `${i * step}s`
    el.classList.add('is-sounding')
  })
}

function playCurrent(mode: 'chord' | 'arp' = 'chord') {
  stop()
  const notes = notesOf(ids)
  stopSound = mode === 'chord' ? playChord(notes) : playArpeggio(notes)
  flash(notes, mode === 'chord' ? STRUM : ARPEGGIO_STEP)
}

function setSource(no: number) {
  stop()
  sourceNo = no
  ids = [...combinations.get(no)!]
  edited = false
  shown = 6
  renderComposer()
}

function addColor(id: number) {
  if (ids.length >= LIMITS.maxColors || ids.includes(id)) return
  ids = [...ids, id]
  edited = true
  renderComposer()
  playCurrent()
}

function removeColor(id: number) {
  if (ids.length <= LIMITS.minColors) return
  ids = ids.filter((x) => x !== id)
  edited = true
  stop()
  renderComposer()
}

strip.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const rm = t.closest<HTMLButtonElement>('.sw-remove')
  if (rm) return removeColor(Number(rm.dataset.id))
  const play = t.closest<HTMLButtonElement>('.sw-play')
  if (play) {
    const n = notesOf([Number(play.dataset.id)])[0]
    playNote(n.freq)
    flash([n], 0)
  }
})

$('#play').addEventListener('click', () => playCurrent('chord'))
$('#arp').addEventListener('click', () => playCurrent('arp'))
const step = (dir: 1 | -1) => {
  const i = comboKeys.indexOf(sourceNo)
  setSource(comboKeys[(i + dir + comboKeys.length) % comboKeys.length])
}
$('#src-prev').addEventListener('click', () => step(-1))
$('#src-next').addEventListener('click', () => step(1))
$('#src-shuffle').addEventListener('click', () => setSource(comboKeys[Math.floor(Math.random() * comboKeys.length)]))

// ---------- 3D piano ----------

let piano: Piano | null = null
const stage = $<HTMLElement>('#piano-stage')
const pianoStatus = $<HTMLParagraphElement>('#piano-status')
const currentTheme = () => (document.documentElement.dataset.theme === 'night' ? 'night' : 'paper')

function canUseWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

async function loadPiano() {
  if (!canUseWebGL()) {
    pianoStatus.textContent = 'This browser cannot draw 3D, so the piano is hidden. The swatches above still play.'
    stage.classList.add('is-unavailable')
    return
  }
  try {
    const { mountPiano } = await import('./piano3d.ts')
    piano = mountPiano(stage, currentTheme())
    piano.onKey((midi) => {
      playNote(440 * Math.pow(2, (midi - 69) / 12))
      // A key in the chord also lights its swatch; flash() presses the key.
      const n = notesOf(ids).find((x) => x.midi === midi)
      if (n) flash([n], 0)
      else piano!.strike(midi)
    })
    pianoStatus.hidden = true
    stage.classList.add('is-ready')
    renderComposer()
  } catch (err) {
    console.error(err)
    pianoStatus.textContent = 'The piano could not load. The swatches above still play.'
    stage.classList.add('is-unavailable')
  }
}

// Only fetch three.js when the piano is about to scroll into view.
const stageWatch = new IntersectionObserver(
  (entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    stageWatch.disconnect()
    void loadPiano()
  },
  { rootMargin: '300px' },
)
stageWatch.observe(stage)
document.addEventListener('themechange', () => piano?.setTheme(currentTheme()))

// ---------- Suggestions ----------

const relLabel = (r: Relation) => RELATIONS.find((x) => x.key === r)!.label

function reason(s: Suggestion): string {
  const anchor = palette[s.anchorId].en
  switch (s.relations[0]) {
    case 'wada':
      return `Wada paired it with ${anchor} in No. ${s.comboNo}`
    case 'complement':
      return `Opposite ${anchor} on the wheel`
    case 'triad':
      return `A third of the wheel from ${anchor}`
    case 'analogous':
      return `Next to ${anchor} on the wheel`
    case 'tonal':
      return `${anchor}'s hue in another light`
  }
}

function renderSuggestions() {
  const all = suggestionsFor(ids, palette)
  const counts = new Map<Relation, number>()
  for (const s of all) for (const r of s.relations) counts.set(r, (counts.get(r) ?? 0) + 1)
  const list = filter === 'all' ? all : all.filter((s) => s.relations.includes(filter as Relation))
  const full = ids.length >= LIMITS.maxColors

  $('#grow-hint').textContent = full
    ? `Six colours is the limit. Remove one to make room.`
    : `Colours that belong with yours, by Wada's own pairings first, then by the hue wheel.`

  $('#filters').innerHTML = [
    { key: 'all', label: 'All', n: all.length },
    ...RELATIONS.map((r) => ({ key: r.key, label: r.label, n: counts.get(r.key) ?? 0 })),
  ]
    .map(
      (f) =>
        `<button type="button" role="radio" class="chip" data-key="${f.key}" aria-checked="${filter === f.key}" ${f.n === 0 && f.key !== filter ? 'disabled' : ''}>${f.label} <span class="chip-n">${f.n}</span></button>`,
    )
    .join('')
  $('#filter-sound').textContent = filter === 'all' ? '' : `Sounds like: ${RELATIONS.find((r) => r.key === filter)!.sound}`

  const current = notesOf(ids)
  $('#suggestions').innerHTML = list.length
    ? list
        .slice(0, shown)
        .map((s) => {
          const c = palette[s.id]
          const note = notesOf([s.id])[0]
          const doubles = current.some((n) => n.midi === note.midi)
          return `<li class="sugg">
          <span class="sugg-sw" style="background:${c.hex}"></span>
          <span class="sugg-body">
            <span class="sugg-name"><span lang="ja">${esc(c.kanji)}</span> ${esc(c.en)} <span class="sugg-note">${note.name}${doubles ? ' · doubles a note' : ''}</span></span>
            <span class="sugg-why">${esc(reason(s))}</span>
            <span class="sugg-tags">${s.relations.map((r) => `<span class="tag tag-${r}">${relLabel(r)}</span>`).join('')}</span>
          </span>
          <span class="sugg-actions">
            <button type="button" class="btn btn-line btn-sm" data-listen="${s.id}" aria-label="Listen to your chord with ${esc(c.en)}">Listen</button>
            <button type="button" class="btn btn-ink btn-sm" data-add="${s.id}" ${full ? 'disabled' : ''} aria-label="Add ${esc(c.en)}">Add</button>
          </span>
        </li>`
        })
        .join('')
    : `<li class="sugg-empty">No colour in the book has this relation to your palette.</li>`
  const more = $<HTMLButtonElement>('#more')
  more.hidden = list.length <= shown
  more.textContent = `Show more (${list.length - shown})`
}

$('#filters').addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip')
  if (!chip || chip.disabled) return
  filter = chip.dataset.key as Relation | 'all'
  shown = 6
  renderSuggestions()
})

$('#suggestions').addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  const add = t.closest<HTMLButtonElement>('[data-add]')
  if (add) return addColor(Number(add.dataset.add))
  const listen = t.closest<HTMLButtonElement>('[data-listen]')
  if (listen) {
    stop()
    stopSound = playChord(notesOf([...ids, Number(listen.dataset.listen)]))
  }
})

$('#more').addEventListener('click', () => {
  shown += 6
  renderSuggestions()
})

// ---------- Naming and pinning ----------

const nameInput = $<HTMLInputElement>('#pin-name')
const authorInput = $<HTMLInputElement>('#pin-author')
const pinMsg = $<HTMLParagraphElement>('#pin-msg')
authorInput.value = loadAuthor()

/** Keep a suggested name in the field until the user types their own. */
function refreshAutoName(force = false) {
  if (!force && nameInput.dataset.touched === 'true') return
  nameInput.value = nameFor(ids.map((id) => palette[id]), nameSeed)
  nameInput.dataset.touched = 'false'
}
nameInput.addEventListener('input', () => (nameInput.dataset.touched = nameInput.value ? 'true' : 'false'))
$('#reroll').addEventListener('click', () => {
  nameSeed++
  refreshAutoName(true)
})
authorInput.addEventListener('change', () => saveAuthor(authorInput.value))

function say(el: HTMLElement, text: string, tone: 'ok' | 'err' = 'ok') {
  el.textContent = text
  el.dataset.tone = tone
}

$<HTMLFormElement>('#pin-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const andSubmit = (e.submitter as HTMLButtonElement | null)?.value === 'submit'
  const name = nameInput.value.trim()
  const author = authorInput.value.trim()
  if (!name) return say(pinMsg, 'Give the palette a name first.', 'err'), nameInput.focus()
  if (andSubmit && !author) return say(pinMsg, 'Add your name to submit.', 'err'), authorInput.focus()
  saveAuthor(author)
  const pin = newPin(name, author, ids)
  pins = [pin, ...pins]
  savePins(pins)
  renderBoard()
  say(pinMsg, `Pinned “${name}”.`)
  nameSeed++
  refreshAutoName(true)
  if (andSubmit) void submitPin(pin.id)
  document.querySelector(`[data-pin="${pin.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

// ---------- Board ----------

const miniStrip = (hexes: string[]) =>
  `<span class="mini-strip">${hexes.map((h) => `<span style="background:${esc(h)}"></span>`).join('')}</span>`

function renderBoard() {
  $('#board-count').textContent = pins.length ? `(${pins.length})` : ''
  $<HTMLParagraphElement>('#board-empty').hidden = pins.length > 0
  $('#board').innerHTML = pins
    .map((p) => {
      const notes = notesOf(p.ids)
      return `<li class="card" data-pin="${p.id}">
        ${miniStrip(notes.map((n) => palette[n.id].hex))}
        <h3 class="card-name">${esc(p.name)}</h3>
        <p class="card-by">${p.author ? `by ${esc(p.author)}` : 'unsigned'}</p>
        <p class="card-reading">${esc(chordReading(notes))}</p>
        <p class="form-msg" data-msg="${p.id}" role="status">${p.submittedId ? 'Submitted.' : ''}</p>
        <div class="card-actions">
          <button type="button" class="btn btn-ink btn-sm" data-act="play">Play</button>
          <button type="button" class="btn btn-line btn-sm" data-act="edit">Edit</button>
          <button type="button" class="btn btn-line btn-sm" data-act="submit" ${p.submittedId ? 'disabled' : ''}>${p.submittedId ? 'Submitted' : 'Submit'}</button>
          <button type="button" class="btn btn-quiet btn-sm" data-act="unpin">Unpin</button>
        </div>
      </li>`
    })
    .join('')
}

async function submitPin(pinId: string) {
  const pin = pins.find((p) => p.id === pinId)
  if (!pin || pin.submittedId) return
  const msg = () => document.querySelector<HTMLElement>(`[data-msg="${pinId}"]`)
  const author = pin.author || authorInput.value.trim()
  if (!author) {
    say(msg()!, 'Add your name in the form above, then submit.', 'err')
    authorInput.focus()
    return
  }
  const btn = document.querySelector<HTMLButtonElement>(`[data-pin="${pinId}"] [data-act="submit"]`)
  if (btn) (btn.disabled = true), (btn.textContent = 'Sending…')
  const notes = notesOf(pin.ids)
  try {
    const saved = await submitPalette({
      name: pin.name,
      author,
      chord: chordReading(notes),
      colors: notes.map((n) => {
        const c = palette[n.id]
        return { no: c.no, en: c.en, hex: c.hex, note: n.name }
      }),
    })
    pins = pins.map((p) => (p.id === pinId ? { ...p, author, submittedId: saved.id } : p))
    savePins(pins)
    renderBoard()
    wall = [saved, ...wall.filter((w) => w.id !== saved.id)]
    renderWall()
  } catch (err) {
    if (btn) (btn.disabled = false), (btn.textContent = 'Submit')
    say(msg()!, `Not sent: ${(err as Error).message}`, 'err')
  }
}

$('#board').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]')
  const card = btn?.closest<HTMLElement>('[data-pin]')
  if (!btn || !card) return
  const pin = pins.find((p) => p.id === card.dataset.pin)
  if (!pin) return
  switch (btn.dataset.act) {
    case 'play':
      stop()
      stopSound = playChord(notesOf(pin.ids))
      break
    case 'edit':
      stop()
      ids = [...pin.ids]
      edited = true
      nameInput.value = pin.name
      nameInput.dataset.touched = 'true'
      renderComposer()
      $('#composer-title').scrollIntoView({ behavior: 'smooth' })
      break
    case 'submit':
      void submitPin(pin.id)
      break
    case 'unpin':
      pins = pins.filter((p) => p.id !== pin.id)
      savePins(pins)
      renderBoard()
      break
  }
})

// ---------- Submitted wall ----------

const wallNotes = (s: StoredSubmission) =>
  chordFor(s.colors.map((c, i) => ({ id: i, lab: rgbToLab(hexToRgb(c.hex)) })))

function renderWall() {
  $('#wall-count').textContent = wall.length ? `(${wall.length})` : ''
  if (!wall.length && !$('#wall-msg').textContent) $('#wall-msg').textContent = 'No submissions yet. Be the first.'
  else if (wall.length) $('#wall-msg').textContent = ''
  $('#wall').innerHTML = wall
    .map(
      (s) => `<li class="card" data-sub="${esc(s.id)}">
        ${miniStrip(s.colors.map((c) => c.hex))}
        <h3 class="card-name">${esc(s.name)}</h3>
        <p class="card-by">by ${esc(s.author)} · ${new Date(s.submittedAt).toLocaleDateString()}</p>
        <p class="card-reading">${esc(s.chord)}</p>
        <div class="card-actions"><button type="button" class="btn btn-ink btn-sm" data-act="play">Play</button></div>
      </li>`,
    )
    .join('')
}

$('#wall').addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>('[data-sub]')
  const sub = card && wall.find((w) => w.id === card.dataset.sub)
  if (!sub || !(e.target as HTMLElement).closest('[data-act="play"]')) return
  stop()
  stopSound = playChord(wallNotes(sub))
})

listSubmissions()
  .then((list) => {
    wall = list
    renderWall()
  })
  .catch(() => {
    $('#wall-msg').textContent = 'The submission board is not reachable from here.'
  })

renderComposer()
renderBoard()
renderWall()
// Older iOS mutes web audio on silent with no override; say so up front.
$<HTMLElement>('#silent-hint').hidden = !silentSwitchMutes(navigator)
