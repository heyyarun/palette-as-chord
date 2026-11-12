# Palette as Chord

Hear a colour combination as a chord.

**Live:** https://palette-as-chord.vercel.app

Palette as Chord starts from one of the 348 colour combinations in Sanzo Wada's
<span lang="ja">配色総鑑</span> (*Haishoku Sōkan*, 1933–35), the book behind Seigensha's
*A Dictionary of Color Combinations*, and plays it as a chord. You can grow the chord
from 2 to 6 colours, name it, pin it and submit it to a shared wall.

Made with [offrun.dev](https://offrun.dev).

## How colour becomes sound

- **Hue → pitch class.** The hue wheel maps onto the circle of twelve semitones, with
  30° of hue = 1 semitone.
- **Lightness → octave.** Dark colours sound in octave 3, mid-tones in octave 4 and
  light colours in octave 5 (C3–B5).
- **Relations → intervals.** When you grow a chord, Wada's own pairings are suggested
  first. After them come hue-wheel relations, each with its musical interval:
  complement = tritone, triad = major third, analogous = semitone, tonal = octave.
  Near-duplicates (CIEDE2000 ΔE < 8) are left out.

## Features

- Step through Wada's combinations, or shuffle them.
- Play the chord or an arpeggio (Web Audio), shown on a 3D grand piano (three.js).
- Grow the palette from suggestions, filtered by relation.
- Name a palette (or get a suggested name), then pin it on this device (localStorage).
- Submit name + author + palette to `/api/palettes`.
- Paper and Night themes, plus Auto, which follows the system setting.
- On iPhone, sound plays even with the silent switch on.

## Run it

The web app lives in `app/` (Vite + TypeScript, no framework).

```sh
cd app
npm install
npm run dev        # http://localhost:5173
npm run dev:phone  # HTTPS on your LAN (self-signed) for testing on a phone
npm test           # vitest unit tests
npm run build      # typecheck + production build into app/dist
```

## Project layout

```
app/
  index.html
  src/
    main.ts            UI: composer, grow, pin form, pinned board, submitted wall
    chord.ts           hue/lightness → notes, Web Audio playback
    harmony.ts         suggestions (Wada pairings + wheel relations), generated names
    color.ts           sRGB → CIELAB, CIEDE2000
    palette.ts         joins colours, Japanese names and combinations
    piano3d.ts         3D grand piano
    keyboard.ts        piano key layout (C3–B5, 36 keys)
    theme.ts           Paper / Night / Auto
    pins.ts            pinned palettes in localStorage
    submission.ts      validation + submit client
    style.css          design tokens and styles
    data/              Wada colour data and Japanese names
  submissions-plugin.ts  dev/preview server for /api/palettes
haishoku-soukan/       NDL scans of the original volumes (not in git)
```

## Submissions

During `npm run dev` and `npm run preview`, a small Vite middleware
(`app/submissions-plugin.ts`) serves `GET`/`POST /api/palettes` and stores entries in
`app/submissions/palettes.json` (gitignored).

The deployed site is a static build, so `/api/palettes` does not exist there and
submitting fails. To fix that, point the app at a hosted endpoint at build time:

```sh
VITE_SUBMIT_URL=https://your-backend.example/palettes npm run build
```

The endpoint should accept the same JSON as the dev middleware: name ≤ 60 characters,
author ≤ 40 characters and 2–6 colours.

## Deploy

The app is deployed on Vercel. Pushing `main` to GitHub deploys production
automatically.

## Credits

- Colours and combinations: Sanzo Wada, <span lang="ja">配色総鑑</span> (1933–35), via
  the [dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations)
  dataset by Matt DesLauriers (MIT; see `app/src/data/LICENSE-wada-colors.md`).
- Japanese colour names were transcribed from the public-domain scans at the
  National Diet Library, Japan.
- The look takes its colours from those scans: the grey scanning bed, the paper,
  the swatch rules and the NDL date stamp.
