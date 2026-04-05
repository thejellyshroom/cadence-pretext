import {
  layoutNextLine,
  layoutNextLineRange,
  materializeLineRange,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'
import {
  carveTextLineSlots,
  getPolygonIntervalForBand,
  getRectIntervalsForBand,
  type Interval,
  type Rect,
} from './wrap-geometry.ts'
import { MEASURE_FONT } from './config.ts'
import type { BandObstacle, PositionedLine } from './types.ts'

const measureCtx = (() => {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) throw new Error('2D canvas required')
  c.font = MEASURE_FONT
  return c
})()

export function measureTextWidthPx(text: string): number {
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

export function layoutColumn(
  prepared: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  region: Rect,
  lineHeight: number,
  obstacles: BandObstacle[],
): { lines: PositionedLine[]; cursor: LayoutCursor } {
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

    const slots = carveTextLineSlots({ left: region.x, right: region.x + region.width }, blocked)
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
