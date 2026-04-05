import type { Point, Rect } from './wrap-geometry.ts'

export type BandObstacle =
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

export type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
}
