import { GLITCH_COOLDOWN_MS } from './config.ts'
import type { PositionedLine } from './types.ts'
import type { Rect } from './wrap-geometry.ts'

type ActiveWordGlitch = {
  lineIndex: number
  chStart: number
  chEnd: number
  replacement: string
  until: number
}

export type GlitchSpectralBands = {
  bandSub: number
  bandLowMid: number
  bandMid: number
  bandHigh: number
  bandTransient: number
}

/** Below this, skip symbol corruption (keeps calm passages readable). */
const INTENSITY_FLOOR = 0.045

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * When `<audio>` is playing but Web Audio is not available, approximate band motion
 * so glitch intensity still moves (weaker than real analysis).
 */
export function syntheticGlitchBands(nowMs: number): GlitchSpectralBands {
  const t = nowMs * 0.001
  const wobble = (hz: number, lo: number, span: number): number =>
    lo + span * (0.5 + 0.5 * Math.sin(t * hz))
  const spike = Math.sin(t * 11.3) * Math.sin(t * 7.1)
  return {
    bandSub: wobble(2.0, 0.08, 0.35),
    bandLowMid: wobble(2.5, 0.1, 0.38),
    bandMid: wobble(2.7, 0.1, 0.4),
    bandHigh: wobble(3.1, 0.08, 0.36),
    bandTransient: clamp01(0.12 + 0.45 * spike * spike),
  }
}

/**
 * Printable ASCII only — no letters, no digits (pure “ASCII art” punctuation / operators).
 */
const GLITCH_SYMBOL_POOL = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`

function pickRandomSymbol(): string {
  return GLITCH_SYMBOL_POOL[Math.floor(Math.random() * GLITCH_SYMBOL_POOL.length)]!
}

function randomGlitchGlyph(original: string): string {
  if (original.length === 0) return original
  if (/^\s+$/.test(original)) return original
  return pickRandomSymbol()
}

function replaceRunWithSymbols(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += pickRandomSymbol()
  return out
}

function pickMultiWordLetterRange(text: string): { start: number; end: number } | null {
  const tokens: { start: number; end: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const w = m[0]!
    if (w.length >= 2 && /[a-zA-Z]/.test(w)) {
      tokens.push({ start: m.index, end: m.index + w.length })
    }
  }
  if (tokens.length === 0) return null
  const si = Math.floor(Math.random() * tokens.length)
  const available = tokens.length - si
  const nWords = Math.min(available, Math.max(2, 2 + Math.floor(Math.random() * Math.min(4, available))))
  const last = tokens[si + nWords - 1]!
  return { start: tokens[si]!.start, end: last.end }
}

export function createGlitchLineRenderer(segmenter: Intl.Segmenter) {
  let globalGlitchPhase = 0
  let nextGlitchAllowedAt = 0
  let activeWordGlitch: ActiveWordGlitch | null = null

  return {
    reset(): void {
      activeWordGlitch = null
    },

    buildDisplayLines(
      lines: PositionedLine[],
      region: Rect,
      motionActive: boolean,
      now: number,
      bands: GlitchSpectralBands,
      intensity: number,
    ): { texts: string[]; lineGlitched: boolean[] } {
      const uInt = clamp01(intensity)

      if (!motionActive || lines.length === 0 || uInt < INTENSITY_FLOOR) {
        activeWordGlitch = null
        return {
          texts: lines.map(l => l.text),
          lineGlitched: lines.map(() => false),
        }
      }

      const h = Math.max(1, region.height)
      globalGlitchPhase += (0.012 + bands.bandMid * 0.028 + bands.bandHigh * 0.04) * uInt

      const burstRoll = 0.22 * uInt
      const transientNeed = 0.14 + (1 - uInt) * 0.2
      if (
        activeWordGlitch === null &&
        bands.bandTransient * uInt > transientNeed &&
        now >= nextGlitchAllowedAt &&
        Math.random() < burstRoll
      ) {
        const topCandidates = lines
          .map((l, i) => ({ i, u: (l.y - region.y) / h }))
          .filter(x => x.u < 0.55)
        const pool = topCandidates.length > 0 ? topCandidates : lines.map((_l, i) => ({ i, u: 0 }))
        const pick = pool[Math.floor(Math.random() * pool.length)]!
        const text = lines[pick.i]!.text
        const wr = pickMultiWordLetterRange(text)
        if (wr !== null) {
          const slice = text.slice(wr.start, wr.end)
          if (slice.length >= 2) {
            activeWordGlitch = {
              lineIndex: pick.i,
              chStart: wr.start,
              chEnd: wr.end,
              replacement: replaceRunWithSymbols(slice.length),
              until: now + 380 + Math.random() * 320 * (1.1 - uInt * 0.25),
            }
            nextGlitchAllowedAt = now + GLITCH_COOLDOWN_MS + Math.round(120 + 180 * (1 - uInt))
          }
        }
      }

      if (activeWordGlitch !== null && now > activeWordGlitch.until) {
        activeWordGlitch = null
      }

      const texts: string[] = []
      const lineGlitched: boolean[] = []

      for (let li = 0; li < lines.length; li++) {
        const line = lines[li]!
        let t = line.text
        if (activeWordGlitch !== null && activeWordGlitch.lineIndex === li) {
          const g = activeWordGlitch
          t = t.slice(0, g.chStart) + g.replacement + t.slice(g.chEnd)
        }

        const u = (line.y - region.y) / h
        const wTop = Math.max(0, 1 - u / 0.36) ** 1.55
        const wMid = Math.exp(-Math.pow((u - 0.5) / 0.22, 2))
        const wBot = Math.max(0, (u - 0.64) / 0.36) ** 1.35

        const segs = [...segmenter.segment(t)]
        const parts = segs.map(s => s.segment)
        const originals = parts.slice()

        const eHigh = bands.bandHigh * uInt
        const eMid = bands.bandMid * uInt
        const eSub = bands.bandSub * uInt
        const bAvg = (bands.bandHigh + bands.bandMid + bands.bandSub + bands.bandLowMid) * 0.25 * uInt

        const applyWindow = (band: number, weight: number, phaseOffset: number): void => {
          if (weight < 0.04 || band < 0.02) return
          const len = parts.length
          if (len < 2) return
          const width = Math.max(
            2,
            Math.min(
              len,
              Math.round(len * (0.05 + 0.14 * uInt) * band + band * 9 * weight * uInt + 2 * uInt),
            ),
          )
          const speed = 0.035 + band * 0.1
          const spanLen = Math.max(1, len - width + 1)
          const start = Math.floor(
            Math.abs(Math.sin(globalGlitchPhase * speed + phaseOffset + li * 0.73)) * spanLen,
          )
          const flipChance = (0.06 + band * 0.35 * Math.min(1, weight * 1.8)) * uInt
          for (let j = start; j < Math.min(len, start + width); j++) {
            if (Math.random() < flipChance) {
              parts[j] = randomGlitchGlyph(parts[j]!)
            }
          }
        }

        applyWindow(eHigh, wTop, 0)
        applyWindow(eMid, wMid, 2.15)
        applyWindow(eSub, wBot, 4.3)
        if (uInt > 0.55) {
          applyWindow(eHigh * 0.85, wTop, 7.9)
        }

        const sprinkle = (0.008 + 0.14 * bAvg) * uInt
        for (let j = 0; j < parts.length; j++) {
          const p = parts[j]!
          if (/^\s+$/.test(p)) continue
          if (Math.random() < sprinkle) {
            parts[j] = randomGlitchGlyph(p)
          }
        }

        const joined = parts.join('')
        const scrambled = parts.some((p, i) => p !== originals[i]!)
        texts.push(joined)
        lineGlitched.push(scrambled || joined !== line.text)
      }

      return { texts, lineGlitched }
    },
  }
}
