/** Layout, typography, and tuning constants for the Cadence demo. */

export const BODY_FONT = `400 22px "Cormorant Garamond", Georgia, serif`
/** Canvas `font` (weight not always honored the same as CSS; size/family aligned). */
export const MEASURE_FONT = `22px "Cormorant Garamond", Georgia, serif`
export const BODY_LINE_HEIGHT = 36
export const TEXT_TOP_PAD = 26
export const TEXT_BOTTOM_PAD = 20
export const MIN_WRAP = 220
export const MAX_WRAP_CAP = 1600
export const HUD_GAP_PX = 20
export const CONTENT_RIGHT_MARGIN = 20
/** Vertical samples for the left-anchored audio “wall” polygon */
export const WAVE_STOPS = 56
/** Minimum fraction of `wrapWidth` kept for text at lowest energy (narrowest rows). */
export const WAVE_TEXT_FLOOR = 0.14

export const AUDIO_FFT = 2048
export const GLITCH_COOLDOWN_MS = 95
/** Glitch line tint — must contrast `--ink` (#e8e4dc); cyan reads clearly on the dark stage. */
export const GLITCH_LINE_COLOR = '#5ee0ff'

/** Fraction of `BODY_LINE_HEIGHT`: horizontal inset around cursor hull for text wrap. */
export const CURSOR_WRAP_H_PAD_FRAC = 0.03
/** Fraction of `BODY_LINE_HEIGHT`: vertical inset (used as fallback scan offset in band geometry). */
export const CURSOR_WRAP_V_PAD_FRAC = 0.012

/** Lower `smoothRadius` follows the raster hull more tightly; hull cache key changes on edits. */
export const WRAP_HULL_OPTS = { smoothRadius: 3, mode: 'mean' as const }

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
