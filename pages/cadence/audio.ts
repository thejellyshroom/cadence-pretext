import {
  AUDIO_FFT,
  WAVE_STOPS,
  WAVE_TEXT_FLOOR,
  clamp,
} from './config.ts'
import type { BandObstacle } from './types.ts'
import type { Point, Rect } from './wrap-geometry.ts'

/** Enough to call `play()`; `HAVE_FUTURE_DATA` + `canplay` alone can stall first play on some engines. */
export function waitMediaCanPlay(media: HTMLMediaElement): Promise<void> {
  const isReady = (): boolean => media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  if (isReady()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      media.removeEventListener('canplay', tryReady)
      media.removeEventListener('loadeddata', tryReady)
      media.removeEventListener('error', onErr)
    }
    const tryReady = (): void => {
      if (!isReady()) return
      cleanup()
      resolve()
    }
    const onErr = (): void => {
      cleanup()
      reject(media.error ?? new Error('audio load failed'))
    }
    media.addEventListener('canplay', tryReady, { once: true })
    media.addEventListener('loadeddata', tryReady, { once: true })
    media.addEventListener('error', onErr, { once: true })
    queueMicrotask(tryReady)
  })
}

export type AudioEngine = {
  ctx: AudioContext
  dry: GainNode
  silent: GainNode
  bufSub: Float32Array<ArrayBuffer>
  bufLowMid: Float32Array<ArrayBuffer>
  bufMid: Float32Array<ArrayBuffer>
  bufHigh: Float32Array<ArrayBuffer>
  bufWide: Float32Array<ArrayBuffer>
}

type EngineWithAnalysers = AudioEngine & {
  aSub: AnalyserNode
  aLowMid: AnalyserNode
  aMid: AnalyserNode
  aHigh: AnalyserNode
  aWide: AnalyserNode
}

let audioEngine: AudioEngine | null = null

function makeAnalyser(ctx: AudioContext, smoothing: number): AnalyserNode {
  const a = ctx.createAnalyser()
  a.fftSize = AUDIO_FFT
  a.smoothingTimeConstant = smoothing
  return a
}

/** Parallel crossover chains → separate analysers (time-domain RMS reads clean band energy). */
export function ensureAudioEngine(media: HTMLMediaElement): AudioEngine {
  if (audioEngine) return audioEngine
  const ctx = new AudioContext()
  const src = ctx.createMediaElementSource(media)
  const dry = ctx.createGain()
  dry.gain.value = 1
  const silent = ctx.createGain()
  silent.gain.value = 0

  src.connect(dry)
  dry.connect(ctx.destination)

  const hp = (f: number): BiquadFilterNode => {
    const n = ctx.createBiquadFilter()
    n.type = 'highpass'
    n.frequency.value = f
    n.Q.value = 0.707
    return n
  }
  const lp = (f: number): BiquadFilterNode => {
    const n = ctx.createBiquadFilter()
    n.type = 'lowpass'
    n.frequency.value = f
    n.Q.value = 0.707
    return n
  }

  const subLP = lp(140)
  const lmHP = hp(140)
  const lmLP = lp(480)
  const midHP = hp(480)
  const midLP = lp(2800)
  const hiHP = hp(2800)

  const aSub = makeAnalyser(ctx, 0.88)
  const aLowMid = makeAnalyser(ctx, 0.72)
  const aMid = makeAnalyser(ctx, 0.62)
  const aHigh = makeAnalyser(ctx, 0.45)
  const aWide = makeAnalyser(ctx, 0.35)

  src.connect(subLP)
  subLP.connect(aSub)
  aSub.connect(silent)

  src.connect(lmHP)
  lmHP.connect(lmLP)
  lmLP.connect(aLowMid)
  aLowMid.connect(silent)

  src.connect(midHP)
  midHP.connect(midLP)
  midLP.connect(aMid)
  aMid.connect(silent)

  src.connect(hiHP)
  hiHP.connect(aHigh)
  aHigh.connect(silent)

  src.connect(aWide)
  aWide.connect(silent)

  silent.connect(ctx.destination)

  const bufLen = aWide.fftSize
  audioEngine = {
    ctx,
    dry,
    silent,
    bufSub: new Float32Array(new ArrayBuffer(bufLen * 4)) as Float32Array<ArrayBuffer>,
    bufLowMid: new Float32Array(new ArrayBuffer(bufLen * 4)) as Float32Array<ArrayBuffer>,
    bufMid: new Float32Array(new ArrayBuffer(bufLen * 4)) as Float32Array<ArrayBuffer>,
    bufHigh: new Float32Array(new ArrayBuffer(bufLen * 4)) as Float32Array<ArrayBuffer>,
    bufWide: new Float32Array(new ArrayBuffer(bufLen * 4)) as Float32Array<ArrayBuffer>,
  }
  ;(audioEngine as EngineWithAnalysers).aSub = aSub
  ;(audioEngine as EngineWithAnalysers).aLowMid = aLowMid
  ;(audioEngine as EngineWithAnalysers).aMid = aMid
  ;(audioEngine as EngineWithAnalysers).aHigh = aHigh
  ;(audioEngine as EngineWithAnalysers).aWide = aWide
  return audioEngine
}

export function getAudioEngine(): AudioEngine | null {
  return audioEngine
}

function engineAnalysers(e: AudioEngine): EngineWithAnalysers {
  return e as EngineWithAnalysers
}

function rmsFloat(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf)
  let s = 0
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!
    s += x * x
  }
  return Math.sqrt(s / buf.length)
}

function normRms(x: number, gain: number): number {
  return clamp(Math.tanh(x * gain), 0, 1)
}

export type WaveMotionState = {
  waveSmoothed: Float32Array
  bandSub: number
  bandLowMid: number
  bandMid: number
  bandHigh: number
  bandTransient: number
  wideRmsSmooth: number
  spatialPhase: number
  cursorTransientPulse: number
}

export function createWaveMotionState(): WaveMotionState {
  const waveSmoothed = new Float32Array(WAVE_STOPS + 1)
  waveSmoothed.fill(1)
  return {
    waveSmoothed,
    bandSub: 0,
    bandLowMid: 0,
    bandMid: 0,
    bandHigh: 0,
    bandTransient: 0,
    wideRmsSmooth: 0,
    spatialPhase: 0,
    cursorTransientPulse: 0,
  }
}

export function updateAudioWave(state: WaveMotionState, active: boolean, engine: AudioEngine | null): void {
  const n = WAVE_STOPS + 1
  if (!active || engine === null) {
    for (let i = 0; i < n; i++) {
      state.waveSmoothed[i] = state.waveSmoothed[i]! * 0.92 + 1.0 * 0.08
    }
    state.bandSub *= 0.9
    state.bandLowMid *= 0.9
    state.bandMid *= 0.9
    state.bandHigh *= 0.9
    state.bandTransient *= 0.85
    state.wideRmsSmooth *= 0.9
    state.cursorTransientPulse *= 0.88
    return
  }

  const e = engineAnalysers(engine)
  const rSub = rmsFloat(e.aSub, e.bufSub)
  const rLm = rmsFloat(e.aLowMid, e.bufLowMid)
  const rMid = rmsFloat(e.aMid, e.bufMid)
  const rHi = rmsFloat(e.aHigh, e.bufHigh)
  const rWide = rmsFloat(e.aWide, e.bufWide)

  const tSub = normRms(rSub, 14)
  const tLm = normRms(rLm, 11)
  const tMid = normRms(rMid, 12)
  const tHi = normRms(rHi, 18)

  state.bandSub = state.bandSub * 0.82 + tSub * 0.18
  state.bandLowMid = state.bandLowMid * 0.76 + tLm * 0.24
  state.bandMid = state.bandMid * 0.7 + tMid * 0.3
  state.bandHigh = state.bandHigh * 0.58 + tHi * 0.42

  state.wideRmsSmooth = state.wideRmsSmooth * 0.94 + rWide * 0.06
  const transientRaw = clamp((rWide - state.wideRmsSmooth) / (state.wideRmsSmooth * 2.2 + 0.00015), 0, 1)
  state.bandTransient = state.bandTransient * 0.55 + transientRaw * 0.45
  state.cursorTransientPulse = clamp(state.cursorTransientPulse * 0.72 + transientRaw * 0.55, 0, 1)

  state.spatialPhase += 0.045 + state.bandMid * 0.11 + state.bandHigh * 0.07

  const span = 0.9 - WAVE_TEXT_FLOOR
  const midWiggle = (0.08 + 0.22 * state.bandLowMid) * state.bandMid
  const hiRipple = (0.04 + 0.14 * state.bandHigh) * state.bandHigh

  for (let k = 0; k < n; k++) {
    const u = k / WAVE_STOPS
    const wBot = (1 - u) ** 2.5
    const wMid = Math.exp(-Math.pow((u - 0.5) / 0.23, 2))
    const wTop = u ** 2.5

    const center = WAVE_TEXT_FLOOR + span * (0.4 + 0.22 * state.bandSub * 0.35)
    const subLocal =
      span * (0.06 + 0.52 * state.bandSub) * wBot * (0.55 + 0.45 * Math.sin(state.spatialPhase * 0.38 + u * 2.6))
    const midLocal = wMid * midWiggle * span * Math.sin(u * Math.PI * 5 + state.spatialPhase)
    const hiLocal =
      wTop *
      hiRipple *
      span *
      (0.65 * Math.sin(u * 12.7 + state.spatialPhase * 1.7) + 0.35 * Math.cos(u * 19 + state.spatialPhase * 2.3))

    const target = clamp(center + subLocal + midLocal + hiLocal, WAVE_TEXT_FLOOR, 1)
    const a = (target - WAVE_TEXT_FLOOR) / span
    state.waveSmoothed[k] = state.waveSmoothed[k]! * 0.52 + clamp(a, 0, 1) * 0.48
  }
}

/**
 * Blocks everything to the right of a vertical audio-driven edge (left-anchored:
 * text stays in [region.x, boundaryX(y)]). Boundary wiggles with spectrum by Y.
 */
export function buildWaveObstacle(region: Rect, wrapWidth: number, state: WaveMotionState): BandObstacle | null {
  if (region.height < 8) return null
  const rx = region.x + wrapWidth
  const span = 0.9 - WAVE_TEXT_FLOOR
  let minBx = rx
  for (let k = 0; k <= WAVE_STOPS; k++) {
    const a = clamp(state.waveSmoothed[k]!, 0, 1)
    const frac = WAVE_TEXT_FLOOR + span * a
    const bx = region.x + wrapWidth * frac
    if (bx < minBx) minBx = bx
  }
  if (rx - minBx < 2) return null

  const ry = region.y
  const rb = region.y + region.height
  const pts: Point[] = [
    { x: rx, y: ry },
    { x: rx, y: rb },
  ]
  for (let k = WAVE_STOPS; k >= 0; k--) {
    const t = k / WAVE_STOPS
    const y = region.y + t * region.height
    const a = clamp(state.waveSmoothed[k]!, 0, 1)
    const frac = WAVE_TEXT_FLOOR + span * a
    const bx = region.x + wrapWidth * frac
    pts.push({ x: bx, y })
  }
  return {
    kind: 'polygon',
    points: pts,
    horizontalPadding: 1,
    verticalPadding: 1,
  }
}

/**
 * 0…1 “how much should the text glitch” — bass + mid/transient punch (snare, drums)
 * + high-mid/air (synth, hats, electric). Caller passes smoothed band levels from `updateAudioWave`.
 */
export function computeGlitchIntensity(s: {
  bandSub: number
  bandLowMid: number
  bandMid: number
  bandHigh: number
  bandTransient: number
}): number {
  const bass = s.bandSub
  const body = clamp(s.bandLowMid * 0.4 + s.bandMid * 0.5, 0, 1)
  const snap = s.bandTransient
  const air = s.bandHigh
  const percussive = clamp(0.55 * snap + 0.45 * body + 0.22 * bass, 0, 1)
  const electric = clamp(0.62 * air + 0.28 * s.bandMid + 0.12 * s.bandLowMid, 0, 1)
  return clamp(0.32 * bass + 0.4 * percussive + 0.34 * electric, 0, 1)
}
