import { transformWrapPoints, type Point, type Rect } from './wrap-geometry.ts'
import { clamp } from './config.ts'

/** Organic morphing blob (two key poses); `getWrapHull` rasterizes this path for wrap obstacles. */
export const RING_BLOB_PATH_D =
  'M220,336.3128090254031C252.00055773264276,336.63488816515695,266.68135446539156,297.6901670561501,282.62774051123,269.9439564635384C294.6864757233104,248.96213614932105,304.9139847278972,225.28775289997802,296.94044971285797,202.4388444363967C289.69446713099586,181.67480534590575,266.2692445312969,174.58937399585142,246.20774402263547,165.57905878110665C227.1815474960508,157.03373446859098,208.4236963481901,149.39342894065916,187.97455875736017,153.4984860249882C156.3759558496417,159.8417397756695,113.2832832306527,162.59317767079952,105.40507428049439,193.84445600629888C97.51616105544676,225.13819605816832,138.70604929358987,243.55167436277966,158.9333882351494,268.6989978316814C178.9594170445246,293.5960456204142,188.05001704023027,335.99123891050675,220,336.3128090254031'

/** Second key pose (same command structure / numeric count as `RING_BLOB_PATH_D`) for full-shape morph. */
export const RING_BLOB_PATH_B =
  'M220,402.7445645129774C274.50157579696565,411.2607214684987,326.2209934648226,375.2642466299743,360.51706420139504,332.0586193844929C394.7126431097373,288.97959009552613,411.67859078377614,232.61470640139808,397.1570112259457,179.56506824521537C383.26856905971044,128.8283816101474,336.9145264990095,98.43325094396809,290.03402043672594,74.57285807515434C241.33657402692705,49.787711739445015,176.42601645394697,9.492740024885542,136.68507063392707,46.99476651743662C96.30243027558262,85.10233585955547,154.79170855272457,149.07947881503978,152.2994227780274,204.54778503663832C150.80936329432453,237.71054533063844,114.79598200417206,263.9260186607403,125.52649000711071,295.34011017364503C141.74191787288078,342.81157515523813,170.43688014684568,395.00006718968575,220,402.7445645129774'

/** ~5.5s full A↔B cycle (radians per ms). */
export const RING_MORPH_SPEED = 0.00115

/** Must match morph `<svg viewBox="0 0 …">` — used for `getBBox` → screen mapping. */
export const RING_VIEWBOX = 440

const RING_FILL_RGB_A = { r: 255, g: 214, b: 232 }
const RING_FILL_RGB_B = { r: 138, g: 63, b: 252 }

export function pathNumbersFromD(d: string): number[] {
  const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi
  const m = d.match(re)
  return m ? m.map(Number) : []
}

export function splicePathNumbers(d: string, numbers: readonly number[]): string {
  let i = 0
  const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi
  return d.replace(re, () => {
    const v = numbers[i++]
    return v !== undefined ? String(v) : '0'
  })
}

export const RING_BLOB_NUMS_A = pathNumbersFromD(RING_BLOB_PATH_D)
export const RING_BLOB_NUMS_B = pathNumbersFromD(RING_BLOB_PATH_B)
if (RING_BLOB_NUMS_B.length !== RING_BLOB_NUMS_A.length) {
  throw new Error('Morph blob paths must have the same numeric token count for lerping')
}

export const CURSOR_SHAPES = [
  {
    id: 0,
    name: 'blob',
    hullSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440"><path fill="#fff" d="${RING_BLOB_PATH_D}"/></svg>`,
  },
  {
    id: 1,
    name: 'circle',
    hullSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="46" fill="#fff"/></svg>',
  },
] as const

export type CursorShape = (typeof CURSOR_SHAPES)[number]

/** Cursor `<img>` preview: blob stays soft glass; circle uses solid accent fill. */
export function svgDisplayDataUrl(hullSvg: string, opaqueFill = false): string {
  const fill = opaqueFill ? 'fill="#5ee0ff"' : 'fill="rgba(94,224,255,0.22)"'
  const vis = hullSvg.replace(/fill="#fff"/g, fill)
  return `data:image/svg+xml,${encodeURIComponent(vis)}`
}

export function ringMorphFillRgba(eased: number): string {
  const u = clamp(eased, 0, 1)
  const r = Math.round(RING_FILL_RGB_A.r + (RING_FILL_RGB_B.r - RING_FILL_RGB_A.r) * u)
  const g = Math.round(RING_FILL_RGB_A.g + (RING_FILL_RGB_B.g - RING_FILL_RGB_A.g) * u)
  const b = Math.round(RING_FILL_RGB_A.b + (RING_FILL_RGB_B.b - RING_FILL_RGB_A.b) * u)
  return `rgba(${r},${g},${b},0.82)`
}

/** Vertices along each raster hull before lerping A↔B in screen space (counts may differ per pose). */
const RING_WRAP_HULL_SAMPLES = 56

function polygonEdgeCumulative(pts: Point[]): { total: number; cum: number[] } {
  const n = pts.length
  const cum: number[] = new Array(n + 1)
  cum[0] = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
    cum[i + 1] = total
  }
  return { total, cum }
}

function pointOnClosedPolygonAtDist(pts: Point[], cum: number[], dist: number): Point {
  const n = pts.length
  const total = cum[n]!
  if (total < 1e-9) return pts[0]!
  let d = dist % total
  if (d < 0) d += total
  for (let i = 0; i < n; i++) {
    const c0 = cum[i]!
    const c1 = cum[i + 1]!
    if (d <= c1) {
      const edgeLen = c1 - c0
      const t = edgeLen < 1e-9 ? 0 : (d - c0) / edgeLen
      const a = pts[i]!
      const b = pts[(i + 1) % n]!
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
  }
  return pts[0]!
}

function resampleClosedPolygon(pts: Point[], samples: number): Point[] {
  if (pts.length < 3 || samples < 3) return pts
  const { total, cum } = polygonEdgeCumulative(pts)
  if (total < 1e-9) return pts
  const out: Point[] = []
  for (let k = 0; k < samples; k++) {
    out.push(pointOnClosedPolygonAtDist(pts, cum, (k / samples) * total))
  }
  return out
}

/** Wrap obstacle for the morphing blob: lerp hull A/B in screen space after uniform resampling. */
export function ringWrapObstaclePoints(
  hx: number,
  hy: number,
  sz: number,
  eased: number,
  rawA: Point[],
  rawB: Point[],
): Point[] {
  const r: Rect = { x: hx, y: hy, width: sz, height: sz }
  const screenA = transformWrapPoints(rawA, r, 0)
  const screenB = transformWrapPoints(rawB, r, 0)
  const a = resampleClosedPolygon(screenA, RING_WRAP_HULL_SAMPLES)
  const b = resampleClosedPolygon(screenB, RING_WRAP_HULL_SAMPLES)
  const u = clamp(eased, 0, 1)
  return a.map((p, i) => ({
    x: p.x + (b[i]!.x - p.x) * u,
    y: p.y + (b[i]!.y - p.y) * u,
  }))
}

/**
 * Lerped hull vertices are not the true morphed outline: intermediate paths can be shorter/narrower
 * than linear interpolation of A/B hulls, especially on the vertical axis. After updating `pathEl`’s
 * `d`, map the wrap polygon to the path’s `getBBox()` in screen space (independent X/Y scale from
 * hull bbox) so wrap tracks wheel scale (`sz`) and animation.
 */
export function fitBlobWrapToPathScreenBBox(
  wrapPts: Point[],
  pathEl: SVGPathElement,
  hx: number,
  hy: number,
  sz: number,
): Point[] {
  if (wrapPts.length < 3 || sz < 2) return wrapPts
  let bb: DOMRect
  try {
    bb = pathEl.getBBox()
  } catch {
    return wrapPts
  }
  if (bb.width < 0.5 || bb.height < 0.5) return wrapPts

  const scale = sz / RING_VIEWBOX
  const target = {
    x: hx + bb.x * scale,
    y: hy + bb.y * scale,
    width: bb.width * scale,
    height: bb.height * scale,
  }
  const tcx = target.x + target.width * 0.5
  const tcy = target.y + target.height * 0.5

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < wrapPts.length; i++) {
    const p = wrapPts[i]!
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const w = maxX - minX
  const h = maxY - minY
  if (w < 1 || h < 1) return wrapPts

  const scx = (minX + maxX) * 0.5
  const scy = (minY + maxY) * 0.5
  const sx = target.width / w
  const sy = target.height / h

  const out: Point[] = new Array(wrapPts.length)
  for (let i = 0; i < wrapPts.length; i++) {
    const p = wrapPts[i]!
    out[i] = {
      x: tcx + (p.x - scx) * sx,
      y: tcy + (p.y - scy) * sy,
    }
  }
  return out
}
