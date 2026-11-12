// A 3D grand piano that plays the palette. Built from code (no model file):
// a bentside case with its lid open, 36 keys (C3–B5, the range chord.ts maps
// colours into), one string per key, legs and a soft floor shadow.
//
// When a note sounds, its key dips, its string vibrates in the colour's hue
// and coloured light drifts up out of the open lid. Keys that belong to the
// current chord glow in their colour and carry a note label.
//
// Loaded lazily from main.ts, so three.js only downloads when the piano
// scrolls into view.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { WHITE_COUNT, keyboardLayout, onKeyboard, type KeyLayout } from './keyboard.ts'

export type PianoTheme = 'paper' | 'night'

export interface LitKey {
  midi: number
  color: string
  label: string
}

export interface Piano {
  /** Light the keys of the current chord in their colours. */
  setChord(keys: LitKey[]): void
  /** Sound a note visually after `delay` seconds: key dips, string rings, light rises. */
  strike(midi: number, delay?: number): void
  setTheme(theme: PianoTheme): void
  /** Called when the user clicks or taps a key. */
  onKey(cb: (midi: number) => void): void
  dispose(): void
}

// ---------- Dimensions (white-key widths) ----------

const KB_W = WHITE_COUNT // 21
const CHEEK = 1.3
const W = KB_W + CHEEK * 2 // case width
const L = 33 // case length, bass side
const RIM_H = 5.5
const CASE_Y = 11 // underside of the case
const KEY_Y = CASE_Y + 2.6 // top of the white keys
const WHITE_LEN = 6.3
const BLACK_LEN = 4
const BLACK_W = 0.56
const KEY_FRONT = WHITE_LEN - 0.4 // keys stick out in front of the case (z > 0)
const LID_OPEN = THREE.MathUtils.degToRad(38)

/** Distance from the keyboard to the back of the case at position x (bass is longest). */
function back(x: number): number {
  const t = THREE.MathUtils.clamp((x + W / 2) / W, 0, 1)
  let s = L * (0.36 + 0.64 * (1 - Math.pow(t, 1.45)))
  // Round off the tail corner on the bass side.
  const r = 0.14
  if (t < r) s -= L * 0.06 * (1 - Math.sqrt(1 - Math.pow((r - t) / r, 2)))
  return s
}

/** Case outline in shape space: x across, y = distance back from the keyboard. */
function outline(inset = 0, steps = 48): THREE.Shape {
  const shape = new THREE.Shape()
  const x0 = -W / 2 + inset
  const x1 = W / 2 - inset
  shape.moveTo(x0, inset)
  shape.lineTo(x1, inset)
  for (let i = 0; i <= steps; i++) {
    const x = x1 - ((x1 - x0) * i) / steps
    shape.lineTo(x, back(x) - inset)
  }
  shape.lineTo(x0, inset)
  return shape
}

/** Case wall from `outer` to `inner` inset, open at the keyboard end like a real grand. */
function wall(outer: number, inner: number, steps = 48): THREE.Shape {
  const shape = new THREE.Shape()
  const ox0 = -W / 2 + outer
  const ox1 = W / 2 - outer
  const ix0 = -W / 2 + inner
  const ix1 = W / 2 - inner
  shape.moveTo(ox1, 0)
  for (let i = 0; i <= steps; i++) {
    const x = ox1 - ((ox1 - ox0) * i) / steps
    shape.lineTo(x, back(x) - outer)
  }
  shape.lineTo(ox0, 0)
  shape.lineTo(ix0, 0)
  for (let i = 0; i <= steps; i++) {
    const x = ix0 + ((ix1 - ix0) * i) / steps
    shape.lineTo(x, back(x) - inner)
  }
  shape.lineTo(ix1, 0)
  shape.lineTo(ox1, 0)
  return shape
}

/** Extrude a shape upwards (shape y becomes -z, extrusion becomes +y). */
function slab(shape: THREE.Shape, depth: number, bevel = 0): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  })
  g.rotateX(-Math.PI / 2)
  return g
}

// ---------- Glow particles ----------

const PARTICLES = 420

const particleVert = /* glsl */ `
  attribute float alpha;
  attribute float size;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`
const particleFrag = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint, a);
    #include <colorspace_fragment>
  }
`

// ---------- Theme looks ----------

const LOOKS: Record<
  PianoTheme,
  { body: number; inner: number; board: number; floor: number; key: number; env: number; rim: number; blend: THREE.Blending }
> = {
  // Paper: a deep rosewood grand on the paper plate.
  paper: { body: 0x341a0d, inner: 0x4a2412, board: 0xcf9c5e, floor: 0.3, key: 0.72, env: 0.85, rim: 0.9, blend: THREE.NormalBlending },
  // Night: black lacquer under a stage light; the glow adds light.
  night: { body: 0x0a0908, inner: 0x241610, board: 0x7d5a30, floor: 0.5, key: 0.7, env: 1.1, rim: 1.6, blend: THREE.AdditiveBlending },
}

/** A dark showroom with softbox strips, so the lacquer picks up long,
 *  elegant highlights instead of a flat grey wash. */
function showroomTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x060607)
  const strip = (w: number, h: number, color: number, gain: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(gain), side: THREE.DoubleSide }),
    )
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    scene.add(m)
  }
  strip(44, 44, 0xfff1dd, 4, 0, 26, 0) // warm ceiling wash
  strip(6, 34, 0xffffff, 9, -24, 12, 6) // tall left softbox
  strip(6, 34, 0xdfe8ff, 7, 24, 12, 6) // tall right softbox
  strip(34, 6, 0xffd9a8, 3, 0, 8, -26) // low warm back strip
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(scene, 0.04).texture
  pmrem.dispose()
  return tex
}

/** Faint lengthwise grain for the soundboard; the board colour tints it. */
function grainTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 256, 256)
  for (let x = 0; x < 256; x += 3) {
    const wob = Math.sin(x * 0.11) * 6 + Math.sin(x * 0.031) * 10
    g.strokeStyle = `rgba(70, 40, 15, ${0.03 + ((x * 7) % 5) * 0.012})`
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x + wob, 0)
    g.bezierCurveTo(x + wob + 4, 85, x + wob - 4, 170, x + wob, 256)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(0.12, 0.12)
  tex.anisotropy = 4
  return tex
}

/** A soft dark pool that grounds the piano on the page. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 126)
  grad.addColorStop(0, 'rgba(15, 8, 4, 0.34)')
  grad.addColorStop(0.6, 'rgba(15, 8, 4, 0.16)')
  grad.addColorStop(1, 'rgba(15, 8, 4, 0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Gold maker's decal for the fallboard, Steinway-style. */
function decalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const g = c.getContext('2d')!
  const gold = g.createLinearGradient(0, 20, 0, 108)
  gold.addColorStop(0, '#8a6a2f')
  gold.addColorStop(0.45, '#f3d894')
  gold.addColorStop(0.55, '#f7e2a8')
  gold.addColorStop(1, '#8a6a2f')
  g.fillStyle = gold
  g.font = '600 62px Georgia, "Times New Roman", serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('W A D A', 256, 66)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

export function mountPiano(container: HTMLElement, theme: PianoTheme): Piano {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.className = 'piano-canvas'
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const envTex = showroomTexture(renderer)
  scene.environment = envTex

  // The piano holds still, seen from the player's treble side, so the eye stays
  // on the keys as they play. fit() sets the distance once the piano exists.
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 400)
  const VIEW_DIR = new THREE.Vector3(16, 28, 46).normalize()

  // ---------- Lights ----------

  const hemi = new THREE.HemisphereLight(0xfff4e0, 0x3a2c20, 0.55)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6)
  key.position.set(26, 60, 30)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 10, far: 160 })
  key.shadow.radius = 6
  key.shadow.camera.updateProjectionMatrix()
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xb9c4ff, 0.9)
  rim.position.set(-40, 30, -40)
  scene.add(rim)
  // Warm bounce off the floor so the lid underside and front faces stay woody.
  const bounce = new THREE.DirectionalLight(0xffe0b8, 0.55)
  bounce.position.set(6, -20, 40)
  scene.add(bounce)

  // ---------- Materials ----------

  const lacquer = new THREE.MeshPhysicalMaterial({
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.15,
  })
  const innerMat = new THREE.MeshStandardMaterial({ roughness: 0.55 })
  const boardMat = new THREE.MeshStandardMaterial({ roughness: 0.7, map: grainTexture() })
  const brass = new THREE.MeshStandardMaterial({ color: 0xc09a52, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.2 })
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.9, roughness: 0.35 })
  const feltMat = new THREE.MeshStandardMaterial({ color: 0x7a1f1f, roughness: 1 })

  const piano = new THREE.Group()
  scene.add(piano)

  // ---------- Case ----------

  const rimMesh = new THREE.Mesh(slab(wall(0, 0.7), RIM_H, 0.08), lacquer)
  rimMesh.position.y = CASE_Y
  rimMesh.castShadow = true
  piano.add(rimMesh)

  const bottom = new THREE.Mesh(slab(outline(0.2), 0.8), lacquer)
  bottom.position.y = CASE_Y
  bottom.castShadow = true
  piano.add(bottom)

  // Soundboard and the iron frame painted gold, seen through the open lid.
  const board = new THREE.Mesh(slab(outline(0.7), 0.2), boardMat)
  board.position.y = CASE_Y + 1.6
  piano.add(board)
  // The iron frame is open, like a real casting: a brass rim around the
  // inner case, a solid head under the tuning pins, and three struts
  // fanning from the head to the tail rim. The soundboard shows through
  // the openings between the struts.
  const plateY = CASE_Y + 1.85
  const plateRim = new THREE.Mesh(slab(wall(1.3, 2.5), 0.35), brass)
  plateRim.position.y = plateY
  piano.add(plateRim)
  // Shape y maps to world z = -y (see slab), so y 0.9..8 spans z -0.9..-8,
  // overlapping the struts' front ends at z = -3.5.
  const head = new THREE.Shape()
  head.moveTo(-W / 2 + 1.3, 0.9)
  head.lineTo(W / 2 - 1.3, 0.9)
  head.lineTo(W / 2 - 1.3, 8)
  head.lineTo(-W / 2 + 1.3, 8)
  head.lineTo(-W / 2 + 1.3, 0.9)
  const plateHead = new THREE.Mesh(slab(head, 0.35), brass)
  plateHead.position.y = plateY
  piano.add(plateHead)
  for (const sx of [-6.5, 0, 6.5]) {
    // From under the head (z = -3.5) to mid-way across the back rim band.
    const len = back(sx) - 2.0 - 3.5
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, len), brass)
    strut.position.set(sx, CASE_Y + 2.35, -3.5 - len / 2)
    strut.rotation.y = -sx * 0.003
    strut.castShadow = true
    piano.add(strut)
  }
  // Pinblock with two staggered rows of steel tuning pins.
  const pinblock = new THREE.Mesh(new THREE.BoxGeometry(KB_W * 0.8, 0.28, 2.4), innerMat)
  pinblock.position.set(0, CASE_Y + 2.3, -4.4)
  piano.add(pinblock)
  {
    const pinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 8)
    const pins = new THREE.InstancedMesh(pinGeo, steel, 30)
    const m4 = new THREE.Matrix4()
    for (let i = 0; i < 30; i++) {
      const row = Math.floor(i / 15)
      const x = -7.8 + (i % 15) * 1.11 + row * 0.55
      m4.makeTranslation(x, CASE_Y + 2.6, -3.9 - row * 1)
      pins.setMatrixAt(i, m4)
    }
    pins.instanceMatrix.needsUpdate = true
    piano.add(pins)
  }

  // Inner rim lining.
  const lining = new THREE.Mesh(slab(wall(0.7, 0.9), RIM_H - 0.6), innerMat)
  lining.position.y = CASE_Y + 0.3
  piano.add(lining)

  // Lid: a touch larger than the rim so it overhangs, hinged along the
  // straight bass side and propped open.
  const lidPivot = new THREE.Group()
  lidPivot.position.set(-W / 2, CASE_Y + RIM_H + 0.05, 0)
  const lid = new THREE.Mesh(slab(outline(-0.3), 0.5, 0.08), lacquer)
  lid.position.x = W / 2
  lid.castShadow = true
  lidPivot.add(lid)
  lidPivot.rotation.z = LID_OPEN
  piano.add(lidPivot)
  // Prop stick: stands on the treble rim and meets the lid where it has risen to.
  const propD = W - 3
  const propX = -W / 2 + propD * Math.cos(LID_OPEN)
  const propLen = propD * Math.sin(LID_OPEN)
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, propLen, 10), lacquer)
  prop.position.set(propX, CASE_Y + RIM_H + propLen / 2, -back(propX) * 0.5)
  piano.add(prop)

  // Keybed, cheek blocks, fallboard and the music desk.
  const keybed = new THREE.Mesh(new RoundedBoxGeometry(W, 1.2, WHITE_LEN + 0.6, 2, 0.15), lacquer)
  keybed.position.set(0, KEY_Y - 1.55, KEY_FRONT - WHITE_LEN / 2 - 0.1)
  keybed.castShadow = true
  piano.add(keybed)
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new RoundedBoxGeometry(CHEEK, 1.8, WHITE_LEN + 0.6, 2, 0.18), lacquer)
    cheek.position.set(side * (KB_W / 2 + CHEEK / 2), KEY_Y - 0.2, KEY_FRONT - WHITE_LEN / 2 - 0.1)
    cheek.castShadow = true
    piano.add(cheek)
  }
  const fall = new THREE.Mesh(new RoundedBoxGeometry(KB_W, 1.8, 0.9, 2, 0.15), lacquer)
  fall.position.set(0, KEY_Y + 0.5, -0.9)
  piano.add(fall)
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.6),
    new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, toneMapped: false }),
  )
  decal.position.set(0, KEY_Y + 0.5, -0.43)
  piano.add(decal)
  // The red felt strip where the keys meet the fallboard.
  const felt = new THREE.Mesh(new THREE.BoxGeometry(KB_W, 0.3, 0.12), feltMat)
  felt.position.set(0, KEY_Y + 0.1, -0.42)
  piano.add(felt)
  // An open music desk: frame and slats, so the strings show through.
  {
    const desk = new THREE.Group()
    const dw = KB_W * 0.55
    const dh = 4.4
    const rail = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.28), lacquer)
      m.position.set(x, y, 0)
      m.castShadow = true
      desk.add(m)
    }
    rail(0.3, dh, -dw / 2, 0)
    rail(0.3, dh, dw / 2, 0)
    rail(dw, 0.35, 0, dh / 2 - 0.17)
    rail(dw, 0.35, 0, -dh / 2 + 0.17)
    for (const fx of [-0.3, -0.1, 0.1, 0.3]) rail(0.22, dh - 0.9, fx * dw, 0)
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.25, 0.9), lacquer)
    ledge.position.set(0, -dh / 2 + 0.1, 0.35)
    desk.add(ledge)
    desk.position.set(0, KEY_Y + 3.1, -2.4)
    desk.rotation.x = -0.32
    piano.add(desk)
  }

  // Turned legs with brass caster cups, and the pedal lyre.
  const legProfile: Array<[number, number]> = [
    [0.55, 0.5],
    [0.5, 0.9],
    [0.42, 1.4],
    [0.4, 2.2],
    [0.58, 2.9],
    [0.62, 3.3],
    [0.5, 3.8],
    [0.44, 4.6],
    [0.44, 8.5],
    [0.55, 9.2],
    [0.58, 9.6],
    [0.5, 10.2],
    [0.52, CASE_Y],
  ]
  const legGeo = new THREE.LatheGeometry(legProfile.map(([r, y]) => new THREE.Vector2(r, y)), 20)
  for (const [x, z] of [
    [-W / 2 + 1.4, -1.2],
    [W / 2 - 1.4, -1.2],
    [-W / 2 + 3.5, -back(-W / 2 + 3.5) + 3],
  ]) {
    const leg = new THREE.Mesh(legGeo, lacquer)
    leg.position.set(x, 0, z)
    leg.castShadow = true
    piano.add(leg)
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.5, 16), brass)
    cup.position.set(x, 0.25, z)
    piano.add(cup)
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), brass)
    wheel.position.set(x, 0.1, z + 0.15)
    piano.add(wheel)
  }
  const lyre = new THREE.Mesh(new RoundedBoxGeometry(2.6, CASE_Y - 1.5, 0.5, 2, 0.12), lacquer)
  lyre.position.set(0, (CASE_Y - 1.5) / 2 + 1.5, -6)
  lyre.castShadow = true
  piano.add(lyre)
  for (const dx of [-0.8, 0, 0.8]) {
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 1.3), brass)
    pedal.position.set(dx, 1.2, -5.2)
    piano.add(pedal)
  }

  // Floor shadow plus a soft dark pool; the page shows through everywhere else.
  const floorMat = new THREE.ShadowMaterial({ opacity: 0.25 })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(64, 48),
    new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false }),
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.set(0, 0.02, -10)
  scene.add(pool)

  // ---------- Keys ----------

  interface KeyState {
    layout: KeyLayout
    pivot: THREE.Group
    mesh: THREE.Mesh
    mat: THREE.MeshPhysicalMaterial
    lit: THREE.Color | null
    press: number // 0..1, decays
    pulse: number // 0..1, decays
  }

  const layout = keyboardLayout()
  const whiteGeo = new THREE.BoxGeometry(0.94, 0.9, WHITE_LEN)
  const blackGeo = new THREE.BoxGeometry(BLACK_W, 0.75, BLACK_LEN)
  const keys = new Map<number, KeyState>()
  const keyMeshes: THREE.Mesh[] = []
  for (const k of layout) {
    const mat = new THREE.MeshPhysicalMaterial(
      k.black
        ? { color: 0x0e0d0c, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1 }
        : { color: 0xf6f0e2, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.25 },
    )
    const mesh = new THREE.Mesh(k.black ? blackGeo : whiteGeo, mat)
    // Keys pivot at their back end, like real ones.
    const pivot = new THREE.Group()
    pivot.position.set(k.x, k.black ? KEY_Y + 0.15 : KEY_Y - 0.45, KEY_FRONT - WHITE_LEN)
    const len = k.black ? BLACK_LEN : WHITE_LEN
    mesh.position.z = len / 2
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.midi = k.midi
    pivot.add(mesh)
    piano.add(pivot)
    keys.set(k.midi, { layout: k, pivot, mesh, mat, lit: null, press: 0, pulse: 0 })
    keyMeshes.push(mesh)
  }

  // ---------- Strings ----------

  const SEG = 28
  interface StringState {
    line: THREE.Line
    mat: THREE.LineBasicMaterial
    pos: Float32Array
    z0: number
    z1: number
    amp: number
    t: number
    freq: number
    color: THREE.Color
    base: THREE.Color
  }
  const strings = new Map<number, StringState>()
  const stringY = CASE_Y + 2.6
  for (const k of layout) {
    const z0 = -1.6
    const z1 = -(back(k.x) - 1.6)
    const pos = new Float32Array((SEG + 1) * 3)
    for (let i = 0; i <= SEG; i++) {
      pos[i * 3] = k.x
      pos[i * 3 + 1] = stringY
      pos[i * 3 + 2] = z0 + ((z1 - z0) * i) / SEG
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    // Wound copper basses under steel trebles, like a real frame.
    const base = new THREE.Color(k.midi < 56 ? 0xb26a35 : 0xd4d7dc)
    const mat = new THREE.LineBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.95 })
    const line = new THREE.Line(geo, mat)
    piano.add(line)
    strings.set(k.midi, { line, mat, pos, z0, z1, amp: 0, t: 0, freq: 9 + (k.index % 12) * 0.8, color: new THREE.Color(), base })
  }

  // ---------- Particles ----------

  const pPos = new Float32Array(PARTICLES * 3)
  const pVel = new Float32Array(PARTICLES * 3)
  const pTint = new Float32Array(PARTICLES * 3)
  const pAlpha = new Float32Array(PARTICLES)
  const pSize = new Float32Array(PARTICLES)
  const pLife = new Float32Array(PARTICLES)
  const pAge = new Float32Array(PARTICLES)
  let pNext = 0
  const pGeo = new THREE.BufferGeometry()
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
  pGeo.setAttribute('tint', new THREE.BufferAttribute(pTint, 3))
  pGeo.setAttribute('alpha', new THREE.BufferAttribute(pAlpha, 1))
  pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1))
  const pMat = new THREE.ShaderMaterial({
    vertexShader: particleVert,
    fragmentShader: particleFrag,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(pGeo, pMat)
  points.frustumCulled = false
  piano.add(points)

  function emit(s: StringState, color: THREE.Color, count: number) {
    for (let n = 0; n < count; n++) {
      const i = pNext
      pNext = (pNext + 1) % PARTICLES
      const u = Math.random()
      pPos[i * 3] = s.pos[0] + (Math.random() - 0.5) * 0.6
      pPos[i * 3 + 1] = stringY + 0.4
      pPos[i * 3 + 2] = s.z0 + (s.z1 - s.z0) * u
      pVel[i * 3] = (Math.random() - 0.5) * 1.6
      pVel[i * 3 + 1] = 4 + Math.random() * 7
      pVel[i * 3 + 2] = (Math.random() - 0.5) * 1.6 + 0.8
      pTint[i * 3] = color.r
      pTint[i * 3 + 1] = color.g
      pTint[i * 3 + 2] = color.b
      pSize[i] = 0.5 + Math.random() * 1.1
      pLife[i] = reduceMotion ? 0.8 : 1.6 + Math.random() * 1.4
      pAge[i] = 0
    }
  }

  // ---------- Note labels ----------

  const labels = new Map<number, THREE.Sprite>()
  function makeLabel(text: string, color: string): THREE.Sprite {
    const c = document.createElement('canvas')
    c.width = 160
    c.height = 64
    const g = c.getContext('2d')!
    g.fillStyle = 'rgba(20, 14, 10, 0.85)'
    if (g.roundRect) {
      g.beginPath()
      g.roundRect(2, 6, 156, 52, 26)
      g.fill()
    } else {
      g.fillRect(2, 6, 156, 52)
    }
    g.fillStyle = color
    g.beginPath()
    g.arc(30, 32, 11, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#f5ead6'
    g.font = 'bold 27px ui-monospace, Menlo, monospace'
    g.textBaseline = 'middle'
    g.fillText(text, 50, 34)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false }))
    sprite.scale.set(2.7, 1.08, 1)
    sprite.renderOrder = 10
    return sprite
  }

  // ---------- Theme ----------

  let look = LOOKS[theme]
  function applyLook(t: PianoTheme) {
    look = LOOKS[t]
    lacquer.color.setHex(look.body)
    innerMat.color.setHex(look.inner)
    boardMat.color.setHex(look.board)
    floorMat.opacity = look.floor
    scene.environmentIntensity = look.env
    rim.intensity = look.rim
    hemi.intensity = t === 'night' ? 0.35 : 0.7
    pMat.blending = look.blend
    pMat.needsUpdate = true
    for (const s of strings.values()) if (s.amp < 0.01) s.mat.color.copy(s.base)
  }
  applyLook(theme)

  // ---------- Interaction ----------

  let keyCb: ((midi: number) => void) | null = null
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let down: { x: number; y: number } | null = null

  function keyAt(ev: PointerEvent): number | null {
    const r = renderer.domElement.getBoundingClientRect()
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const hit = ray.intersectObjects(keyMeshes, false)[0]
    return hit ? (hit.object.userData.midi as number) : null
  }
  const el = renderer.domElement
  const onDown = (ev: PointerEvent) => {
    down = { x: ev.clientX, y: ev.clientY }
  }
  const onUp = (ev: PointerEvent) => {
    if (!down) return
    const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y)
    down = null
    if (moved > 6) return // a scroll or drag, not a tap
    const midi = keyAt(ev)
    if (midi !== null) keyCb?.(midi)
  }
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerType !== 'mouse' || down) return
    el.style.cursor = keyAt(ev) !== null ? 'pointer' : 'default'
  }
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointermove', onMove)

  // ---------- Size and loop ----------

  function resize() {
    const w = container.clientWidth
    const h = container.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    fit()
  }

  // Every vertex of the piano's meshes (lid included), so the fit is exact for
  // the one fixed view. Particles and labels are left out; they move.
  const hull: THREE.Vector3[] = []
  piano.updateMatrixWorld(true)
  piano.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.attributes.position
    const stride = Math.max(1, Math.floor(pos.count / 400))
    for (let i = 0; i < pos.count; i += stride) {
      hull.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld))
    }
  })
  const centre = new THREE.Box3().setFromPoints(hull).getCenter(new THREE.Vector3())
  const ndcP = new THREE.Vector3()

  /** Projected extent of the piano, in NDC, with the camera at `dist` from `target`. */
  function extent(target: THREE.Vector3, dist: number) {
    camera.position.copy(target).addScaledVector(VIEW_DIR, dist)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    const e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
    for (const p of hull) {
      ndcP.copy(p).project(camera)
      e.x0 = Math.min(e.x0, ndcP.x)
      e.x1 = Math.max(e.x1, ndcP.x)
      e.y0 = Math.min(e.y0, ndcP.y)
      e.y1 = Math.max(e.y1, ndcP.y)
    }
    return e
  }

  /** Closest distance that keeps the whole piano inside the frame, centred. */
  function fit() {
    const target = centre.clone()
    const MARGIN = 0.9
    let dist = 0
    for (let pass = 0; pass < 2; pass++) {
      let lo = 5
      let hi = 400
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2
        const e = extent(target, mid)
        if (Math.max(-e.x0, e.x1, -e.y0, e.y1) <= MARGIN) hi = mid
        else lo = mid
      }
      dist = hi
      // Shift the aim so the piano sits in the middle of the frame, then refit.
      const e = extent(target, dist)
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      target
        .addScaledVector(right, ((e.x0 + e.x1) / 2) * halfH * camera.aspect)
        .addScaledVector(up, ((e.y0 + e.y1) / 2) * halfH)
    }
    extent(target, dist)
  }

  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  // The loop only runs while the piano is on screen and the tab is showing;
  // resume() restarts it when either comes back.
  let visible = true
  let raf = 0
  const canRun = () => visible && !document.hidden
  function resume() {
    if (raf || !canRun()) return
    clock.getDelta()
    raf = requestAnimationFrame(frame)
  }
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting
    resume()
  })
  io.observe(container)
  document.addEventListener('visibilitychange', resume)

  const clock = new THREE.Clock()
  const timers = new Set<number>()
  const tmp = new THREE.Color()
  const white = new THREE.Color(0xf6f0e2)
  const ebony = new THREE.Color(0x0e0d0c)

  function frame() {
    if (!canRun()) {
      raf = 0
      return
    }
    raf = requestAnimationFrame(frame)
    const dt = Math.min(clock.getDelta(), 0.05)

    for (const k of keys.values()) {
      k.press = Math.max(0, k.press - dt * 3.2)
      k.pulse = Math.max(0, k.pulse - dt * 1.1)
      k.pivot.rotation.x = Math.sin(Math.min(k.press, 1) * Math.PI * 0.5) * 0.065
      const base = k.layout.black ? ebony : white
      if (k.lit) {
        tmp.copy(base).lerp(k.lit, (k.layout.black ? 0.75 : look.key) + k.pulse * 0.3)
        k.mat.color.copy(tmp)
        k.mat.emissive.copy(k.lit).multiplyScalar(0.12 + k.pulse * 0.9)
      } else {
        k.mat.color.copy(base)
        k.mat.emissive.setRGB(0, 0, 0)
      }
    }

    for (const s of strings.values()) {
      if (s.amp < 0.002) continue
      s.t += dt
      s.amp *= Math.exp(-dt / 1.1)
      const wob = Math.sin(s.t * s.freq * Math.PI * 2)
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG
        const env = Math.sin(Math.PI * u)
        s.pos[i * 3 + 1] = stringY + env * s.amp * wob * 0.45
        s.pos[i * 3] = s.line.userData.x0 + env * s.amp * Math.cos(s.t * s.freq * 4.1) * 0.12
      }
      s.line.geometry.attributes.position.needsUpdate = true
      tmp.copy(s.base).lerp(s.color, Math.min(1, s.amp * 1.4))
      s.mat.color.copy(tmp)
      if (s.amp < 0.002) s.mat.color.copy(s.base)
    }

    let anyAlive = false
    for (let i = 0; i < PARTICLES; i++) {
      if (pLife[i] <= 0) continue
      pAge[i] += dt
      const life = pAge[i] / pLife[i]
      if (life >= 1) {
        pLife[i] = 0
        pAlpha[i] = 0
        continue
      }
      anyAlive = true
      pVel[i * 3 + 1] *= 1 - dt * 0.35
      pPos[i * 3] += pVel[i * 3] * dt + Math.sin(pAge[i] * 3 + i) * dt * 0.6
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt
      pAlpha[i] = Math.sin(Math.PI * Math.min(1, life * 1.2)) * (look.blend === THREE.AdditiveBlending ? 0.9 : 0.75)
    }
    if (anyAlive || pAlpha.some((a) => a > 0)) {
      pGeo.attributes.position.needsUpdate = true
      pGeo.attributes.alpha.needsUpdate = true
      pGeo.attributes.tint.needsUpdate = true
      pGeo.attributes.size.needsUpdate = true
    }

    renderer.render(scene, camera)
  }
  for (const [midi, s] of strings) s.line.userData.x0 = keys.get(midi)!.layout.x
  resume()

  return {
    setChord(lit) {
      for (const k of keys.values()) k.lit = null
      for (const l of labels.values()) {
        piano.remove(l)
        l.material.map?.dispose()
        l.material.dispose()
      }
      labels.clear()
      for (const l of lit) {
        const midi = onKeyboard(l.midi)
        const k = keys.get(midi)
        if (!k) continue
        k.lit = new THREE.Color(l.color)
        const sprite = makeLabel(l.label, l.color)
        sprite.position.set(k.layout.x, KEY_Y + (k.layout.black ? 3.4 : 2.4), KEY_FRONT - 1)
        piano.add(sprite)
        labels.set(midi, sprite)
      }
    },
    strike(midi, delay = 0) {
      const m = onKeyboard(midi)
      const run = () => {
        const k = keys.get(m)
        const s = strings.get(m)
        if (!k || !s) return
        k.press = 1
        k.pulse = 1
        s.amp = 1
        s.t = 0
        s.color.copy(k.lit ?? new THREE.Color(0xf2d9a0))
        emit(s, s.color, reduceMotion ? 6 : 26)
      }
      if (delay <= 0) return run()
      const id = window.setTimeout(() => {
        timers.delete(id)
        run()
      }, delay * 1000)
      timers.add(id)
    },
    setTheme: applyLook,
    onKey(cb) {
      keyCb = cb
    },
    dispose() {
      cancelAnimationFrame(raf)
      raf = 0
      visible = false
      document.removeEventListener('visibilitychange', resume)
      timers.forEach((t) => window.clearTimeout(t))
      ro.disconnect()
      io.disconnect()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointermove', onMove)
      envTex.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
        mats.forEach((mt) => {
          ;(mt as unknown as { map?: THREE.Texture | null }).map?.dispose()
          mt.dispose()
        })
      })
      renderer.dispose()
      el.remove()
    },
  }
}
