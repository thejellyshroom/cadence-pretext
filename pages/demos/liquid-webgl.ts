/**
 * DOM typography demo: same `layoutColumn` + `getPolygonIntervalForBand` obstacle
 * pipeline as `dynamic-layout.ts`. A logo-style SVG `<img>` follows the pointer;
 * body text reflows around its hull (no WebGL).
 */
import {
  layoutNextLine,
  layoutNextLineRange,
  materializeLineRange,
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'
import {
  carveTextLineSlots,
  getPolygonIntervalForBand,
  getRectIntervalsForBand,
  getWrapHull,
  transformWrapPoints,
  type Interval,
  type Point,
  type Rect,
} from './wrap-geometry.ts'
/** Opening of *Blindness* (Saramago) — edit in `liquid-webgl-text.ts`. */
import { COPY } from './liquid-webgl-text.ts'

const INITIAL_COPY = (() => {
  const t = COPY.trim()
  return t.length > 0 ? t : ' '
})()

const BODY_FONT = `400 22px "Cormorant Garamond", Georgia, serif`
/** Canvas `font` (weight not always honored the same as CSS; size/family aligned). */
const MEASURE_FONT = `22px "Cormorant Garamond", Georgia, serif`
const BODY_LINE_HEIGHT = 36
const TEXT_TOP_PAD = 26
const TEXT_BOTTOM_PAD = 20
const MIN_WRAP = 220
const MAX_WRAP_CAP = 1600
const HUD_GAP_PX = 20
const CONTENT_RIGHT_MARGIN = 20

type BandObstacle =
  | {
      kind: 'polygon'
      points: Point[]
      horizontalPadding: number
      verticalPadding: number
    }
  | {
      kind: 'rects'
      rects: Rect[]
      horizontalPadding: number
      verticalPadding: number
    }

type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
}

const CURSOR_SHAPES = [
  {
    id: 0,
    name: 'circle',
    hullSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="46" fill="#fff"/></svg>',
  },
  {
    id: 1,
    name: 'cross',
    hullSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="54" y="22" width="20" height="84" fill="#fff"/><rect x="22" y="54" width="84" height="20" fill="#fff"/></svg>',
  },
  {
    id: 2,
    name: 'ring',
    hullSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path fill="#fff" fill-rule="evenodd" d="M64 14c27.6 0 50 22.4 50 50s-22.4 50-50 50-50-22.4-50-50 22.4-50 50-50zm0 26c-13.25 0-24 10.75-24 24s10.75 24 24 24 24-10.75 24-24-10.75-24-24-24z"/></svg>',
  },
  {
    id: 3,
    name: 'dot',
    hullSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="22" fill="#fff"/></svg>',
  },
] as const

function svgDisplayDataUrl(hullSvg: string): string {
  const vis = hullSvg.replace(/fill="#fff"/g, 'fill="rgba(94,224,255,0.22)" stroke="#5ee0ff" stroke-width="2"')
  return `data:image/svg+xml,${encodeURIComponent(vis)}`
}

const measureCtx = (() => {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) throw new Error('2D canvas required')
  c.font = MEASURE_FONT
  return c
})()

function measureTextWidthPx(text: string): number {
  return measureCtx.measureText(text).width
}

/** Greedy grapheme fit for splitting one Pretext line across side-by-side slots. */
function splitPrefixToMaxWidth(text: string, maxPx: number): [string, string] {
  if (maxPx <= 0) return ['', text]
  if (text.length === 0) return ['', '']
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let acc = ''
  let w = 0
  for (const { segment } of seg.segment(text)) {
    const tw = measureTextWidthPx(segment)
    if (w + tw > maxPx && acc.length > 0) {
      return [acc, text.slice(acc.length)]
    }
    if (w + tw > maxPx && acc.length === 0) {
      return [segment, text.slice(segment.length)]
    }
    acc += segment
    w += tw
  }
  return [text, '']
}

function getObstacleIntervals(obstacle: BandObstacle, bandTop: number, bandBottom: number): Interval[] {
  switch (obstacle.kind) {
    case 'polygon': {
      const interval = getPolygonIntervalForBand(
        obstacle.points,
        bandTop,
        bandBottom,
        obstacle.horizontalPadding,
        obstacle.verticalPadding,
      )
      return interval === null ? [] : [interval]
    }
    case 'rects':
      return getRectIntervalsForBand(
        obstacle.rects,
        bandTop,
        bandBottom,
        obstacle.horizontalPadding,
        obstacle.verticalPadding,
      )
  }
}

function layoutColumn(
  prepared: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  region: Rect,
  lineHeight: number,
  obstacles: BandObstacle[],
): { lines: PositionedLine[], cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor
  let lineTop = region.y
  const lines: PositionedLine[] = []
  while (true) {
    if (lineTop + lineHeight > region.y + region.height) break

    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    const blocked: Interval[] = []
    for (let obstacleIndex = 0; obstacleIndex < obstacles.length; obstacleIndex++) {
      const obstacle = obstacles[obstacleIndex]!
      const intervals = getObstacleIntervals(obstacle, bandTop, bandBottom)
      for (let intervalIndex = 0; intervalIndex < intervals.length; intervalIndex++) {
        blocked.push(intervals[intervalIndex]!)
      }
    }

    const slots = carveTextLineSlots(
      { left: region.x, right: region.x + region.width },
      blocked,
    )
    if (slots.length === 0) {
      lineTop += lineHeight
      continue
    }

    const ordered = [...slots].sort((a, b) => a.left - b.left)

    if (ordered.length === 1) {
      const slot = ordered[0]!
      const width = slot.right - slot.left
      const line = layoutNextLine(prepared, cursor, width)
      if (line === null) break
      lines.push({
        x: Math.round(slot.left),
        y: Math.round(lineTop),
        width: line.width,
        text: line.text,
      })
      cursor = line.end
    } else {
      let sumW = 0
      for (let i = 0; i < ordered.length; i++) {
        sumW += ordered[i]!.right - ordered[i]!.left
      }
      const lineRange = layoutNextLineRange(prepared, cursor, sumW)
      if (lineRange === null) break
      const full = materializeLineRange(prepared, lineRange)
      let remain = full.text
      for (let si = 0; si < ordered.length; si++) {
        const slot = ordered[si]!
        const slotW = slot.right - slot.left
        const isLast = si === ordered.length - 1
        let chunk: string
        if (isLast) {
          chunk = remain
        } else {
          const [a, b] = splitPrefixToMaxWidth(remain, slotW)
          chunk = a
          remain = b
        }
        if (chunk.length > 0) {
          lines.push({
            x: Math.round(slot.left),
            y: Math.round(lineTop),
            width: measureTextWidthPx(chunk),
            text: chunk,
          })
        }
      }
      cursor = full.end
    }

    lineTop += lineHeight
  }

  return { lines, cursor }
}

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

const dom = {
  stage: getEl<HTMLDivElement>('stage'),
  textarea: getEl<HTMLTextAreaElement>('copy'),
  hint: document.getElementById('hint') as HTMLElement,
  track: getEl<HTMLAudioElement>('track'),
  audioToggle: getEl<HTMLButtonElement>('audioToggle'),
  wrapVal: document.getElementById('wrapVal') as HTMLElement | null,
  shapeBtn: getEl<HTMLButtonElement>('shapeBtn'),
}

const pointer = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 }
let wrapWidth = maxWrapPx()
let cursorScale = 1
let shapeIdx = 0
let pointerActive = false
let lastPointerX = 0
let prepared: PreparedTextWithSegments = prepareWithSegments(INITIAL_COPY, BODY_FONT)
let copyRev = INITIAL_COPY
const bodyLinePool: HTMLSpanElement[] = []
let committedLines: PositionedLine[] | null = null
const hullByShapeId = new Map<number, Point[]>()
let hullsReady = false

const cursorImg = document.createElement('img')
cursorImg.className = 'cursor-svg'
cursorImg.alt = ''
cursorImg.draggable = false

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} missing`)
  return el as T
}

function syncPrepared(): void {
  const v = dom.textarea.value.trim()
  const text = v.length > 0 ? v : ' '
  if (text === copyRev) return
  copyRev = text
  prepared = prepareWithSegments(text, BODY_FONT)
  committedLines = null
}

function targetInHud(t: EventTarget | null): boolean {
  return t instanceof Element && Boolean(t.closest('.hud'))
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

function commitFrame(): void {
  syncPrepared()
  const pageH = document.documentElement.clientHeight
  dom.stage.style.minHeight = `${pageH}px`

  wrapWidth = clamp(wrapWidth, MIN_WRAP, maxWrapPx())

  const region: Rect = {
    x: contentLeftPx(),
    y: TEXT_TOP_PAD,
    width: wrapWidth,
    height: Math.max(0, pageH - TEXT_TOP_PAD - TEXT_BOTTOM_PAD),
  }

  const sz = Math.round(128 * cursorScale)
  const hx = Math.round(pointer.x - sz * 0.5)
  const hy = Math.round(pointer.y - sz * 0.5)
  cursorImg.style.left = `${hx}px`
  cursorImg.style.top = `${hy}px`
  cursorImg.style.width = `${sz}px`
  cursorImg.style.height = `${sz}px`

  const obstacles: BandObstacle[] = []
  const shape = CURSOR_SHAPES[shapeIdx]!
  const pts = hullByShapeId.get(shape.id)
  if (hullsReady && pts !== undefined && pts.length > 2) {
    const r: Rect = { x: hx, y: hy, width: sz, height: sz }
    obstacles.push({
      kind: 'polygon',
      points: transformWrapPoints(pts, r, 0),
      horizontalPadding: Math.round(BODY_LINE_HEIGHT * 0.28),
      verticalPadding: Math.round(BODY_LINE_HEIGHT * 0.08),
    })
  }

  const { lines } = layoutColumn(
    prepared,
    { segmentIndex: 0, graphemeIndex: 0 },
    region,
    BODY_LINE_HEIGHT,
    obstacles,
  )

  if (committedLines === null || !positionedLinesEqual(committedLines, lines)) {
    syncPool(bodyLinePool, lines.length, () => {
      const el = document.createElement('span')
      el.className = 'liquid-line'
      return el
    }, dom.stage)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const el = bodyLinePool[i]!
      el.textContent = line.text
      el.style.left = `${line.x}px`
      el.style.top = `${line.y}px`
      el.style.font = BODY_FONT
      el.style.lineHeight = `${BODY_LINE_HEIGHT}px`
    }
    committedLines = lines.map(l => ({ ...l }))
  }

  dom.stage.appendChild(cursorImg)

  if (dom.wrapVal) dom.wrapVal.textContent = `${wrapWidth}px`
  window.dispatchEvent(new CustomEvent('layoutstats', { detail: { lines: lines.length } }))
}

dom.textarea.value = INITIAL_COPY
dom.textarea.addEventListener('input', () => {
  committedLines = null
  scheduleRender()
})

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
  dom.shapeBtn.textContent = `Shape · ${s.name}`
  cursorImg.src = svgDisplayDataUrl(s.hullSvg)
  committedLines = null
  scheduleRender()
})

dom.audioToggle.addEventListener('click', () => {
  if (dom.track.paused) {
    void dom.track.play()
    dom.audioToggle.textContent = 'Pause'
    dom.audioToggle.setAttribute('aria-pressed', 'true')
  } else {
    dom.track.pause()
    dom.audioToggle.textContent = 'Play motion'
    dom.audioToggle.setAttribute('aria-pressed', 'false')
  }
})

void Promise.all(
  CURSOR_SHAPES.map(async s => {
    const src = `data:image/svg+xml,${encodeURIComponent(s.hullSvg)}`
    const pts = await getWrapHull(src, { smoothRadius: 6, mode: 'mean' })
    hullByShapeId.set(s.id, pts)
  }),
).then(async () => {
  hullsReady = true
  await document.fonts.ready
  cursorImg.src = svgDisplayDataUrl(CURSOR_SHAPES[0]!.hullSvg)
  dom.shapeBtn.textContent = `Shape · ${CURSOR_SHAPES[0]!.name}`
  dom.stage.appendChild(cursorImg)
  commitFrame()
})
