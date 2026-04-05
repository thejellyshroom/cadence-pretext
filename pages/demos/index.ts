/**
 * Cadence demo: `layoutColumn` + polygon obstacles; draggable SVG hull; audio-driven wrap wall.
 */
import '../analytics.ts'
import { prepareWithSegments, type PreparedTextWithSegments } from '../../src/layout.ts'
import { getWrapHull, transformWrapPoints, type Point, type Rect } from './wrap-geometry.ts'
import {
  BODY_FONT,
  BODY_LINE_HEIGHT,
  clamp,
  CONTENT_RIGHT_MARGIN,
  CURSOR_WRAP_H_PAD_FRAC,
  CURSOR_WRAP_V_PAD_FRAC,
  HUD_GAP_PX,
  MAX_WRAP_CAP,
  MIN_WRAP,
  TEXT_BOTTOM_PAD,
  TEXT_TOP_PAD,
  WRAP_HULL_OPTS,
} from './config.ts'
import { layoutColumn } from './column-layout.ts'
import type { BandObstacle, PositionedLine } from './types.ts'
import {
  buildWaveObstacle,
  computeGlitchIntensity,
  createWaveMotionState,
  ensureAudioEngine,
  getAudioEngine,
  updateAudioWave,
  waitMediaCanPlay,
} from './audio.ts'
import { createGlitchLineRenderer, syntheticGlitchBands } from './display-glitch.ts'
import {
  CURSOR_SHAPES,
  RING_BLOB_NUMS_A,
  RING_BLOB_NUMS_B,
  RING_BLOB_PATH_B,
  RING_BLOB_PATH_D,
  RING_MORPH_SPEED,
  ringMorphFillRgba,
  ringWrapObstaclePoints,
  splicePathNumbers,
  svgDisplayDataUrl,
} from './cursor.ts'
/** Opening of *Blindness* (Saramago) — edit in `text.ts`. */
import { COPY } from './text.ts'

import catUrl from '../assets/cat.mp3' with { type: 'file' }
import electroUrl from '../assets/electro.mp3' with { type: 'file' }
import electronicChillUrl from '../assets/electronic-chill.mp3' with { type: 'file' }
import lofiUrl from '../assets/lofi.mp3' with { type: 'file' }

const INITIAL_COPY = (() => {
  const t = COPY.trim()
  return t.length > 0 ? t : ' '
})()

const MOTION_TRACKS: { label: string; src: string }[] = [
  { label: 'Lofi', src: lofiUrl },
  { label: 'Electronic chill', src: electronicChillUrl },
  { label: 'Electro', src: electroUrl },
  { label: 'Cat', src: catUrl },
]

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const glitchLines = createGlitchLineRenderer(graphemeSegmenter)

/** Only corrupted graphemes get `.cadence-line__glitch`; rest stay body ink. */
function setCadenceLineDisplay(
  el: HTMLSpanElement,
  layoutText: string,
  shown: string,
  motionActive: boolean,
): void {
  if (!motionActive || shown === layoutText) {
    el.textContent = shown
    return
  }
  const base = [...graphemeSegmenter.segment(layoutText)]
  const disp = [...graphemeSegmenter.segment(shown)]
  if (base.length !== disp.length) {
    el.textContent = shown
    return
  }
  const frag = document.createDocumentFragment()
  for (let i = 0; i < disp.length; i++) {
    const d = disp[i]!.segment
    const b = base[i]!.segment
    if (d !== b) {
      const span = document.createElement('span')
      span.className = 'cadence-line__glitch'
      span.textContent = d
      frag.appendChild(span)
    } else {
      frag.appendChild(document.createTextNode(d))
    }
  }
  el.replaceChildren(frag)
}
const waveState = createWaveMotionState()

function syncPool<T extends HTMLElement>(pool: T[], length: number, create: () => T, parent: HTMLElement): void {
  while (pool.length < length) {
    const element = create()
    pool.push(element)
    parent.appendChild(element)
  }
  while (pool.length > length) {
    const element = pool.pop()!
    element.remove()
  }
}

function positionedLinesEqual(a: PositionedLine[], b: PositionedLine[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    const left = a[index]!
    const right = b[index]!
    if (
      left.x !== right.x ||
      left.y !== right.y ||
      left.width !== right.width ||
      left.text !== right.text
    ) {
      return false
    }
  }
  return true
}

function contentLeftPx(): number {
  const hud = document.querySelector('.hud')
  if (!(hud instanceof HTMLElement)) return 28
  const r = hud.getBoundingClientRect()
  return Math.min(Math.ceil(r.right + HUD_GAP_PX), window.innerWidth - MIN_WRAP - 24)
}

function maxWrapPx(): number {
  const w = window.innerWidth - contentLeftPx() - CONTENT_RIGHT_MARGIN
  return clamp(Math.floor(w), MIN_WRAP, MAX_WRAP_CAP)
}

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} missing`)
  return el as T
}

function targetInHud(t: EventTarget | null): boolean {
  return t instanceof Element && Boolean(t.closest('.hud'))
}

const dom = {
  stage: getEl<HTMLDivElement>('stage'),
  hint: document.getElementById('hint') as HTMLElement,
  track: getEl<HTMLAudioElement>('track'),
  trackPickerRoot: getEl<HTMLDivElement>('trackPicker'),
  trackPickerTrigger: getEl<HTMLButtonElement>('trackPickerTrigger'),
  trackPickerList: getEl<HTMLUListElement>('trackPickerList'),
  trackPickerValue: getEl<HTMLSpanElement>('trackPickerValue'),
  audioToggle: getEl<HTMLButtonElement>('audioToggle'),
  shapeBtn: getEl<HTMLButtonElement>('shapeBtn'),
}

dom.track.src = MOTION_TRACKS[0]!.src

const pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 }
let wrapWidth = maxWrapPx()
let cursorScale = 1
let shapeIdx = 0
let pointerActive = false
let lastPointerX = 0
let prepared: PreparedTextWithSegments = prepareWithSegments(INITIAL_COPY, BODY_FONT)
const bodyLinePool: HTMLSpanElement[] = []
let committedLines: PositionedLine[] | null = null
const hullByShapeId = new Map<number, Point[]>()
let hullsReady = false
let blobHullRawA: Point[] | null = null
let blobHullRawB: Point[] | null = null

let motionPlaying = false
let soundRafId = 0

const cursorRoot = document.createElement('div')
cursorRoot.className = 'cursor-svg'

const cursorImg = document.createElement('img')
cursorImg.alt = ''
cursorImg.draggable = false

const SVG_NS = 'http://www.w3.org/2000/svg'
const morphSvg = document.createElementNS(SVG_NS, 'svg')
morphSvg.setAttribute('viewBox', '0 0 440 440')
morphSvg.setAttribute('xmlns', SVG_NS)
morphSvg.style.display = 'none'
const morphPathEl = document.createElementNS(SVG_NS, 'path')
morphPathEl.setAttribute('fill', ringMorphFillRgba(0))
morphPathEl.setAttribute('stroke', 'none')
morphPathEl.setAttribute('d', RING_BLOB_PATH_D)
morphSvg.appendChild(morphPathEl)
cursorRoot.appendChild(cursorImg)
cursorRoot.appendChild(morphSvg)

let morphAnimRaf = 0

function isBlobCursorShape(): boolean {
  return CURSOR_SHAPES[shapeIdx]!.name === 'blob'
}

function stopBlobMorphAnim(): void {
  if (morphAnimRaf !== 0) {
    cancelAnimationFrame(morphAnimRaf)
    morphAnimRaf = 0
  }
  morphPathEl.setAttribute('d', RING_BLOB_PATH_D)
  morphPathEl.setAttribute('fill', ringMorphFillRgba(0))
}

function tickBlobMorphAnim(): void {
  if (!isBlobCursorShape()) {
    morphAnimRaf = 0
    return
  }
  commitFrame()
  morphAnimRaf = requestAnimationFrame(tickBlobMorphAnim)
}

function ensureBlobMorphAnim(): void {
  if (!isBlobCursorShape() || morphAnimRaf !== 0) return
  morphAnimRaf = requestAnimationFrame(tickBlobMorphAnim)
}

function updateWrap(clientX: number): void {
  const dx = clientX - lastPointerX
  lastPointerX = clientX
  wrapWidth = clamp(wrapWidth + dx * 1.5, MIN_WRAP, maxWrapPx())
}

const scheduled = { value: false }
function scheduleRender(): void {
  if (scheduled.value) return
  scheduled.value = true
  requestAnimationFrame(() => {
    scheduled.value = false
    commitFrame()
  })
}

function startSoundLoop(): void {
  if (soundRafId !== 0) return
  const loop = (): void => {
    if (!motionPlaying || dom.track.paused) {
      soundRafId = 0
      return
    }
    scheduleRender()
    soundRafId = requestAnimationFrame(loop)
  }
  soundRafId = requestAnimationFrame(loop)
}

function stopSoundLoop(): void {
  if (soundRafId !== 0) {
    cancelAnimationFrame(soundRafId)
    soundRafId = 0
  }
}

const cursorHPad = () => Math.round(BODY_LINE_HEIGHT * CURSOR_WRAP_H_PAD_FRAC)
const cursorVPad = () => Math.round(BODY_LINE_HEIGHT * CURSOR_WRAP_V_PAD_FRAC)

function commitFrame(): void {
  const pageH = document.documentElement.clientHeight
  dom.stage.style.minHeight = `${pageH}px`

  wrapWidth = clamp(wrapWidth, MIN_WRAP, maxWrapPx())

  const region: Rect = {
    x: contentLeftPx(),
    y: TEXT_TOP_PAD,
    width: wrapWidth,
    height: Math.max(0, pageH - TEXT_TOP_PAD - TEXT_BOTTOM_PAD),
  }

  const motionActive = motionPlaying && !dom.track.paused
  const audioReactive = motionActive && getAudioEngine() !== null
  updateAudioWave(waveState, audioReactive, getAudioEngine())

  const obstacles: BandObstacle[] = []
  const waveObs = buildWaveObstacle(region, wrapWidth, waveState)
  if (waveObs !== null) obstacles.push(waveObs)

  const sz = Math.round(128 * cursorScale)
  const hx = Math.round(pointer.x - sz * 0.5)
  const hy = Math.round(pointer.y - sz * 0.5)
  cursorRoot.style.left = `${hx}px`
  cursorRoot.style.top = `${hy}px`
  cursorRoot.style.width = `${sz}px`
  cursorRoot.style.height = `${sz}px`

  const showBlobShape = isBlobCursorShape()
  cursorImg.style.display = showBlobShape ? 'none' : 'block'
  morphSvg.style.display = showBlobShape ? 'block' : 'none'
  if (showBlobShape) ensureBlobMorphAnim()
  else stopBlobMorphAnim()

  const shape = CURSOR_SHAPES[shapeIdx]!

  let blobMorphEased = 0
  if (showBlobShape) {
    const phase = performance.now() * RING_MORPH_SPEED
    const u = 0.5 + 0.5 * Math.sin(phase)
    blobMorphEased = u * u * (3 - 2 * u)
    const n = RING_BLOB_NUMS_A.length
    const nums = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      nums[i] = RING_BLOB_NUMS_A[i]! + (RING_BLOB_NUMS_B[i]! - RING_BLOB_NUMS_A[i]!) * blobMorphEased
    }
    morphPathEl.setAttribute('d', splicePathNumbers(RING_BLOB_PATH_D, nums))
    morphPathEl.setAttribute('fill', ringMorphFillRgba(blobMorphEased))
  }

  const hPad = cursorHPad()
  const vPad = cursorVPad()

  if (
    shape.name === 'blob' &&
    hullsReady &&
    blobHullRawA !== null &&
    blobHullRawB !== null &&
    blobHullRawA.length > 2 &&
    blobHullRawB.length > 2
  ) {
    const wrapPts = ringWrapObstaclePoints(hx, hy, sz, blobMorphEased, blobHullRawA, blobHullRawB)
    if (wrapPts.length > 2) {
      obstacles.push({
        kind: 'polygon',
        points: wrapPts,
        horizontalPadding: hPad,
        verticalPadding: vPad,
      })
    }
  } else {
    const pts = hullByShapeId.get(shape.id)
    if (hullsReady && pts !== undefined && pts.length > 2) {
      const r: Rect = { x: hx, y: hy, width: sz, height: sz }
      obstacles.push({
        kind: 'polygon',
        points: transformWrapPoints(pts, r, 0),
        horizontalPadding: hPad,
        verticalPadding: vPad,
      })
    }
  }

  const { lines } = layoutColumn(
    prepared,
    { segmentIndex: 0, graphemeIndex: 0 },
    region,
    BODY_LINE_HEIGHT,
    obstacles,
  )

  const now = performance.now()
  const glitchBands =
    audioReactive
      ? {
          bandSub: waveState.bandSub,
          bandLowMid: waveState.bandLowMid,
          bandMid: waveState.bandMid,
          bandHigh: waveState.bandHigh,
          bandTransient: waveState.bandTransient,
        }
      : motionActive
        ? syntheticGlitchBands(now)
        : { bandSub: 0, bandLowMid: 0, bandMid: 0, bandHigh: 0, bandTransient: 0 }

  const glitchIntensity = motionActive ? computeGlitchIntensity(glitchBands) : 0

  const { texts: displayTexts } = glitchLines.buildDisplayLines(
    lines,
    region,
    motionActive,
    now,
    glitchBands,
    glitchIntensity,
  )

  if (committedLines === null || !positionedLinesEqual(committedLines, lines)) {
    syncPool(bodyLinePool, lines.length, () => {
      const el = document.createElement('span')
      el.className = 'cadence-line'
      return el
    }, dom.stage)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const el = bodyLinePool[i]!
      el.style.left = `${line.x}px`
      el.style.top = `${line.y}px`
      el.style.font = BODY_FONT
      el.style.lineHeight = `${BODY_LINE_HEIGHT}px`
    }
    committedLines = lines.map(l => ({ ...l }))
  }

  for (let i = 0; i < lines.length; i++) {
    const el = bodyLinePool[i]!
    const line = lines[i]!
    const shown = displayTexts[i] ?? line.text
    setCadenceLineDisplay(el, line.text, shown, motionActive)
  }

  dom.stage.appendChild(cursorRoot)
}

window.addEventListener('pointerdown', e => {
  if (targetInHud(e.target)) return
  pointerActive = true
  lastPointerX = e.clientX
  pointer.x = e.clientX
  pointer.y = e.clientY
  updateWrap(e.clientX)
  scheduleRender()
})
window.addEventListener('pointerup', () => {
  pointerActive = false
})
window.addEventListener('pointermove', e => {
  pointer.x = e.clientX
  pointer.y = e.clientY
  if (pointerActive) updateWrap(e.clientX)
  scheduleRender()
})
window.addEventListener(
  'wheel',
  e => {
    if (targetInHud(e.target)) return
    e.preventDefault()
    cursorScale = clamp(cursorScale - e.deltaY * 0.001, 0.35, 2.4)
    scheduleRender()
  },
  { passive: false },
)
window.addEventListener('resize', scheduleRender)

dom.shapeBtn.addEventListener('click', () => {
  shapeIdx = (shapeIdx + 1) % CURSOR_SHAPES.length
  const s = CURSOR_SHAPES[shapeIdx]!
  dom.shapeBtn.textContent = `Obstacle · ${s.name}`
  if (isBlobCursorShape()) {
    ensureBlobMorphAnim()
  } else {
    stopBlobMorphAnim()
    cursorImg.src = svgDisplayDataUrl(s.hullSvg, s.name === 'circle' || s.name === 'cross')
  }
  committedLines = null
  scheduleRender()
})

function applyMotionTrack(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= MOTION_TRACKS.length) return
  const entry = MOTION_TRACKS[index]!
  const wasPlaying = motionPlaying && !dom.track.paused
  dom.track.pause()
  stopSoundLoop()
  dom.track.src = entry.src
  dom.track.load()
  if (wasPlaying) {
    void (async () => {
      ensureAudioEngine(dom.track)
      const eng = getAudioEngine()!
      await eng.ctx.resume()
      motionPlaying = true
      try {
        await waitMediaCanPlay(dom.track)
        await dom.track.play()
      } catch {
        motionPlaying = false
        stopSoundLoop()
        dom.audioToggle.textContent = 'Play motion'
        dom.audioToggle.setAttribute('aria-pressed', 'false')
        scheduleRender()
        return
      }
      startSoundLoop()
      dom.audioToggle.textContent = 'Pause'
      dom.audioToggle.setAttribute('aria-pressed', 'true')
      scheduleRender()
    })()
  } else {
    motionPlaying = false
    updateAudioWave(waveState, false, getAudioEngine())
    dom.audioToggle.textContent = 'Play motion'
    dom.audioToggle.setAttribute('aria-pressed', 'false')
    scheduleRender()
  }
}

let selectedTrackIndex = 0
let trackPickerOpen = false
let trackPickerOutsideClose: ((e: MouseEvent) => void) | null = null

function getTrackOptionEls(): HTMLElement[] {
  return Array.from(dom.trackPickerList.querySelectorAll<HTMLElement>('[role="option"]'))
}

function syncTrackPickerAria(): void {
  for (const el of getTrackOptionEls()) {
    const i = Number(el.dataset['index'])
    el.setAttribute('aria-selected', i === selectedTrackIndex ? 'true' : 'false')
  }
}

function focusTrackOption(index: number): void {
  const opts = getTrackOptionEls()
  if (!opts.length) return
  const i = clamp(index, 0, opts.length - 1)
  for (let j = 0; j < opts.length; j++) {
    opts[j]!.tabIndex = j === i ? 0 : -1
  }
  opts[i]!.focus()
}

function closeTrackPicker(): void {
  if (!trackPickerOpen) return
  trackPickerOpen = false
  dom.trackPickerList.hidden = true
  dom.trackPickerTrigger.setAttribute('aria-expanded', 'false')
  if (trackPickerOutsideClose) {
    document.removeEventListener('click', trackPickerOutsideClose)
    trackPickerOutsideClose = null
  }
}

function openTrackPicker(): void {
  if (trackPickerOpen) return
  trackPickerOpen = true
  dom.trackPickerList.hidden = false
  dom.trackPickerTrigger.setAttribute('aria-expanded', 'true')
  queueMicrotask(() => {
    trackPickerOutsideClose = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return
      if (dom.trackPickerRoot.contains(e.target)) return
      closeTrackPicker()
    }
    document.addEventListener('click', trackPickerOutsideClose)
  })
}

function toggleTrackPicker(): void {
  if (trackPickerOpen) closeTrackPicker()
  else openTrackPicker()
}

function selectMotionTrack(index: number): void {
  applyMotionTrack(index)
  selectedTrackIndex = index
  dom.trackPickerValue.textContent = MOTION_TRACKS[index]!.label
  syncTrackPickerAria()
}

dom.trackPickerValue.textContent = MOTION_TRACKS[0]!.label

for (let i = 0; i < MOTION_TRACKS.length; i++) {
  const li = document.createElement('li')
  li.className = 'track-picker__option'
  li.setAttribute('role', 'option')
  li.tabIndex = -1
  li.dataset['index'] = String(i)
  li.textContent = MOTION_TRACKS[i]!.label
  li.addEventListener('click', e => {
    e.stopPropagation()
    selectMotionTrack(i)
    closeTrackPicker()
    dom.trackPickerTrigger.focus()
  })
  dom.trackPickerList.appendChild(li)
}
syncTrackPickerAria()

dom.trackPickerTrigger.addEventListener('click', e => {
  e.stopPropagation()
  toggleTrackPicker()
})

dom.trackPickerTrigger.addEventListener('keydown', e => {
  if (e.key === 'Escape' && trackPickerOpen) {
    e.preventDefault()
    closeTrackPicker()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!trackPickerOpen) openTrackPicker()
    queueMicrotask(() => focusTrackOption(selectedTrackIndex))
  }
})

dom.trackPickerList.addEventListener('keydown', e => {
  const opts = getTrackOptionEls()
  const cur = opts.findIndex(el => el === document.activeElement)
  if (e.key === 'Escape') {
    e.preventDefault()
    closeTrackPicker()
    dom.trackPickerTrigger.focus()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = cur < 0 ? 0 : Math.min(cur + 1, opts.length - 1)
    focusTrackOption(next)
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    const next = cur <= 0 ? 0 : cur - 1
    focusTrackOption(next)
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (cur >= 0) {
      selectMotionTrack(Number(opts[cur]!.dataset['index']))
      closeTrackPicker()
      dom.trackPickerTrigger.focus()
    }
  }
})

dom.audioToggle.addEventListener('click', () => {
  if (dom.track.paused) {
    void (async () => {
      ensureAudioEngine(dom.track)
      const eng = getAudioEngine()!
      await eng.ctx.resume()
      motionPlaying = true
      try {
        await waitMediaCanPlay(dom.track)
        await dom.track.play()
      } catch {
        motionPlaying = false
        stopSoundLoop()
        dom.audioToggle.textContent = 'Play motion'
        dom.audioToggle.setAttribute('aria-pressed', 'false')
        scheduleRender()
        return
      }
      startSoundLoop()
      dom.audioToggle.textContent = 'Pause'
      dom.audioToggle.setAttribute('aria-pressed', 'true')
      scheduleRender()
    })()
  } else {
    dom.track.pause()
    motionPlaying = false
    stopSoundLoop()
    updateAudioWave(waveState, false, getAudioEngine())
    dom.audioToggle.textContent = 'Play motion'
    dom.audioToggle.setAttribute('aria-pressed', 'false')
    scheduleRender()
  }
})

void Promise.all(
  CURSOR_SHAPES.map(async s => {
    if (s.name === 'blob') {
      const svgA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440"><path fill="#fff" d="${RING_BLOB_PATH_D}"/></svg>`
      const svgB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440"><path fill="#fff" d="${RING_BLOB_PATH_B}"/></svg>`
      const [pa, pb] = await Promise.all([
        getWrapHull(`data:image/svg+xml,${encodeURIComponent(svgA)}`, WRAP_HULL_OPTS),
        getWrapHull(`data:image/svg+xml,${encodeURIComponent(svgB)}`, WRAP_HULL_OPTS),
      ])
      blobHullRawA = pa
      blobHullRawB = pb
      hullByShapeId.set(s.id, pa)
      return
    }
    const src = `data:image/svg+xml,${encodeURIComponent(s.hullSvg)}`
    const pts = await getWrapHull(src, WRAP_HULL_OPTS)
    hullByShapeId.set(s.id, pts)
  }),
).then(async () => {
  hullsReady = true
  await document.fonts.ready
  cursorImg.src = svgDisplayDataUrl(CURSOR_SHAPES[0]!.hullSvg)
  dom.shapeBtn.textContent = `Obstacle · ${CURSOR_SHAPES[0]!.name}`
  dom.stage.appendChild(cursorRoot)
  commitFrame()
})
