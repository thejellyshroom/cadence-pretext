/**
 * Liquid WebGL typography — dramatically enhanced.
 * Per-line widths from Pretext drive vertex displacement on a high-res grid.
 * Two-pass rendering: geometry pass → fullscreen post (bloom + chroma aberration + grain).
 * Text is rasterized to canvas, sampled on the bent surface with a cinematic env map.
 */
import {
  prepareWithSegments,
  layoutWithLines,
  type LayoutLine,
  type PreparedTextWithSegments,
} from '../../src/layout.ts'

const BASE_FONT_PX = 20
/** Match HUD webfont so canvas metrics track Pretext */
const FONT_FAMILY = '"Cormorant Garamond", Georgia, serif'
/** Pretext prepare + break widths are measured at this size */
const PREPARE_FONT = `${BASE_FONT_PX}px ${FONT_FAMILY}`
const LINE_LEAD = 1.42
const MAX_LINE_TEX = 512
const GRID_X = 120
const GRID_Y = 160
const MIN_WRAP = 220
/** Logical max; clamped to viewport each frame */
const MAX_WRAP_CAP = 1200

function maxWrapPx(): number {
  return clamp(Math.floor(window.innerWidth - 56), MIN_WRAP, MAX_WRAP_CAP)
}

const CURSOR_SHAPES = [
  { id: 0, name: 'circle', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="10" fill="none" stroke="#7fd4ff" stroke-width="1.5" opacity="0.95"/><circle cx="16" cy="16" r="2" fill="#7fd4ff" opacity="0.75"/></svg>' },
  { id: 1, name: 'cross', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><line x1="16" y1="3" x2="16" y2="29" stroke="#7fd4ff" stroke-width="1.5" opacity="0.95"/><line x1="3" y1="16" x2="29" y2="16" stroke="#7fd4ff" stroke-width="1.5" opacity="0.95"/></svg>' },
  { id: 2, name: 'ring', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="none" stroke="#7fd4ff" stroke-width="2.5" opacity="0.95"/></svg>' },
  { id: 3, name: 'dot', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="4.5" fill="#7fd4ff" opacity="0.95"/></svg>' },
] as const

function cursorDataUrl(s: (typeof CURSOR_SHAPES)[number]): string {
  return `url("data:image/svg+xml,${encodeURIComponent(s.svg)}") 16 16, crosshair`
}

// ─── Geometry pass ────────────────────────────────────────────────────────────

const VERT_SRC = `#version 300 es
precision highp float;

uniform mat4 uMvp;
uniform sampler2D uLineNormTex;
uniform float uLineCount;
uniform float uTexSize;
uniform vec2 uQuad;
uniform float uTime;
uniform float uDisp;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform vec3 uCamPos;
uniform float uTilt;
uniform float uPulse;
uniform float uEnergy;
uniform vec2 uCursor;
uniform float uCursorRadius;
uniform int uCursorShape;

layout(location = 0) in vec2 aUv;

out vec2 vUv;
out vec3 vWorld;
out vec3 vN;
out float vLine;

float sampleW(float idx) {
  float u = (idx + 0.5) / uTexSize;
  return texture(uLineNormTex, vec2(u, 0.5)).r;
}

float cursorField(vec2 pos, vec2 cur, float r, int shape) {
  vec2 d = pos - cur;
  float dist = length(d);
  if (shape == 0) {
    return exp(-dist * dist / (r * r * 0.28 + 1e-5)) * 0.44;
  } else if (shape == 1) {
    float cx = exp(-d.x * d.x / (r * r * 0.04 + 1e-5)) * exp(-dist * dist / (r * r * 0.55 + 1e-5));
    float cy = exp(-d.y * d.y / (r * r * 0.04 + 1e-5)) * exp(-dist * dist / (r * r * 0.55 + 1e-5));
    return (cx + cy) * 0.25;
  } else if (shape == 2) {
    float dr = abs(dist - r * 0.52);
    return exp(-dr * dr / (r * r * 0.012 + 1e-5)) * 0.36;
  } else {
    return exp(-dist * dist / (r * r * 0.018 + 1e-5)) * 0.6;
  }
}

void main() {
  vUv = aUv;

  float n    = max(uLineCount, 1.0);
  float li   = clamp(floor(aUv.y * n), 0.0, n - 1.0);
  vLine = li / n;

  float wC  = sampleW(li);
  float wP  = sampleW(max(li - 1.0, 0.0));
  float wN  = sampleW(min(li + 1.0, n - 1.0));
  float wA  = sampleW(max(li - 2.0, 0.0));
  float wB  = sampleW(min(li + 2.0, n - 1.0));
  float wAA = sampleW(max(li - 3.0, 0.0));
  float wBB = sampleW(min(li + 3.0, n - 1.0));

  float diff1 = wN - wP;
  float diff2 = (wB - wA) * 0.5;
  float diff3 = (wBB - wAA) * 0.25;
  float lateral = (diff1 + diff2 + diff3) * uDisp * 0.015 * (1.0 + uMid * 0.14);

  // Short lines recess, long lines read forward — driven by normalized line width
  float sink = (1.0 - wC) * uDisp * 0.16 * (1.0 + uBass * 0.42);

  float wave = sin(uTime * 0.52 + aUv.y * 6.28) * uBass * 0.032
             + cos(uTime * 0.86 + aUv.x * 6.28 * 0.48) * uBass * 0.017;

  float nx = fract(sin(dot(vec2(li * 13.0 + aUv.x * 37.0, uTime * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
  float grit = (nx - 0.5) * uHigh * 0.022;

  float z = sink + wave + grit;

  vec2 ctr = aUv - vec2(0.5, 0.5);
  float rad = length(ctr);
  float shock = sin(rad * 22.0 - uTime * 5.8 - uPulse * 10.0) * uPulse * 0.06;
  float breathe = sin(rad * 7.5 + uTime * 1.75) * uEnergy * 0.03;
  z += shock + breathe;

  float band = smoothstep(0.35, 0.65, fract(aUv.y * 4.0 - uTime * 0.48 + uBass * 0.35));
  z += band * uBass * 0.04;

  // Mids: per-line ripple (line index in phase)
  z += sin(li * 0.83 + uTime * 2.38) * uMid * 0.055;

  lateral *= (1.0 + uPulse * 0.1 + uEnergy * 0.05 + uMid * 0.04);

  float tilt = sin(uTime * 0.14) * 0.022 + uTilt * 0.048 + uPulse * 0.065;
  float perspShift = (aUv.y - 0.5) * tilt;

  vec2 planeBase = vec2(
    (aUv.x - 0.5) * 2.0 * uQuad.x,
    (aUv.y - 0.5) * 2.0 * uQuad.y + perspShift
  );
  float pull = cursorField(planeBase, uCursor, uCursorRadius, uCursorShape);
  z += pull * (0.4 + uPulse * 0.16);

  vec2 plane = vec2(planeBase.x + lateral, planeBase.y);
  vec3 pos = vec3(plane, z);

  float dZdy = diff1 * uDisp * 0.072;
  float dZdx = pull * 0.11 + lateral * 0.07;
  vN = normalize(vec3(-dZdx, -dZdy, 1.0));

  vWorld = pos;
  gl_Position = uMvp * vec4(pos, 1.0);
}
`

const FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D uTextTex;
uniform vec3 uCamPos;
uniform float uEnvMix;
uniform vec3 uAccent;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uPulse;
uniform float uEnergy;

in vec2 vUv;
in vec3 vWorld;
in vec3 vN;
in float vLine;

out vec4 outColor;

vec3 envRim(vec3 R) {
  vec3 voidCol = vec3(0.006, 0.006, 0.009);
  float h = R.y * 0.5 + 0.5;
  vec3 rim = vec3(0.02, 0.04, 0.06) * smoothstep(0.2, 0.95, h);
  return voidCol + rim * 0.35;
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 R = reflect(-V, N);

  vec2 st = vec2(vUv.x + N.x * 0.0007, vUv.y + N.y * 0.0007);
  vec4 tex = texture(uTextTex, st);

  vec3 env = envRim(R);
  env += uPulse * vec3(0.04, 0.07, 0.12) * 0.22;
  env += uEnergy * vec3(0.02, 0.03, 0.05);
  env += vec3(0.015, 0.025, 0.04) * sin(uTime * 0.7 + vLine * 10.0) * uMid * 0.4;

  float cosTheta = max(dot(N, V), 0.0);
  float fresnel = pow(1.0 - cosTheta, 4.2);
  float fMix = fresnel * (uEnvMix + uPulse * 0.22);

  vec3 tinted = mix(tex.rgb, tex.rgb * (1.0 + env * 0.12), fMix * 0.4);
  vec3 lit = mix(tinted, env, fMix);

  lit += fresnel * uAccent * (0.35 + uPulse * 0.5 + uBass * 0.2);
  lit += pow(fresnel, 2.2) * uBass * vec3(0.85, 0.32, 0.12) * 0.18;

  float iri = sin(vLine * 6.28 * 3.0 + uTime * (0.5 + uMid * 0.9)) * 0.032 * fresnel;
  lit += vec3(iri * 0.5, iri * 0.28, -iri * 0.18);

  float cover = clamp(tex.a * 1.12, 0.0, 1.0);
  vec3 bg = vec3(0.01, 0.01, 0.012);
  vec3 rgb = mix(bg, lit, cover);

  outColor = vec4(rgb, 1.0);
}
`

// ─── Post-process pass (bloom + chroma + grain + vignette) ───────────────────

const POST_VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

const POST_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uPulse;
uniform vec2 uRes;

in vec2 vUv;
out vec4 outColor;

// Fast 9-tap box blur for bloom
vec3 blur(sampler2D tex, vec2 uv, vec2 texel, float r) {
  vec3 acc = vec3(0.0);
  float w = 0.0;
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      float ww = 1.0;
      acc += texture(tex, uv + vec2(float(x), float(y)) * texel * r).rgb * ww;
      w += ww;
    }
  }
  return acc / w;
}

void main() {
  vec2 texel = 1.0 / uRes;

  vec2 cc = vUv - 0.5;
  float warpAmt = 0.0004 + uPulse * 0.0012 + uMid * 0.0006;
  vec2 warp = vec2(sin(cc.y * 24.0 + uTime * 2.0), cos(cc.x * 20.0 + uTime * 1.6)) * warpAmt;

  float edge = length(vUv - 0.5) * 2.0;
  float aberr = 0.00015 + edge * 0.0005 + uHigh * 0.00025 + uPulse * 0.00035;
  aberr = min(aberr, 0.0025);
  vec2 dir = normalize(vUv - 0.5 + 1e-4);

  vec2 wv = vUv + warp * 0.35;
  float r = texture(uScene, wv + dir * aberr).r;
  float g = texture(uScene, wv).g;
  float b = texture(uScene, wv - dir * aberr * 0.85).b;
  vec3 col = vec3(r, g, b);

  vec3 blurred = blur(uScene, wv, texel, 1.2 + uBass * 0.9 + uPulse * 0.7);
  float lum = dot(blurred, vec3(0.2126, 0.7152, 0.0722));
  float threshold = 0.52 - uBass * 0.08 - uPulse * 0.06;
  vec3 bloom = blurred * smoothstep(threshold, threshold + 0.14, lum);
  col += bloom * (0.22 + uBass * 0.25 + uPulse * 0.35);

  float t = uTime * 193.0;
  float noise = fract(sin(dot(vUv * uRes + t, vec2(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * (0.018 + uHigh * 0.022);

  float vig = smoothstep(1.06, 0.34, length(vUv - 0.5) * 1.5);
  vig *= 1.0 - uPulse * 0.08;
  col *= vig;

  col = col / (col + vec3(0.55)) * 1.48;

  outColor = vec4(col, 1.0);
}
`

// ─── State ───────────────────────────────────────────────────────────────────

const DEFAULT_COPY =
  `Typography is not decoration. It is the architecture of thought made visible — the measure of a line, ` +
  `the weight of a word, the silence between sentences, the way a paragraph accrues gravity as it runs. ` +
  `We read in time: the eye falls through the block, rests, returns, and each return finds a slightly ` +
  `different topography because the words were never neutral. Pretext measures once with the browser font ` +
  `engine, then every reflow is arithmetic — no DOM thrash, no synchronous layout, only widths and cursors ` +
  `you can trust for canvas, for WebGL, for anything that must stay in sync with what users actually see. ` +
  `Line breaks become geometry: a long line beside a short one folds the surface in Z, and the reflection ` +
  `slides along that crease like light on water. Drag the canvas to sculpt wrap width; play the motion loop ` +
  `and watch each line borrow energy from its own slice of the spectrum — bass swells the early lines, ` +
  `air and hats tickle the late ones, and the paragraph reads as a sentence even while it dances. ` +
  `Optional live mic swaps the feed. Mixed scripts stay honest: 混合文字 AGI 春天到了 بدأت الرحلة 🚀 ` +
  `https://example.com/path?q=test&emoji=✨ Numbers 3.14159265 and ranges 7:00–9:00. ` +
  `The missing ingredient was never more particles; it was tying signal to readable structure, one line at a time.`

const dom = {
  canvas:       getEl<HTMLCanvasElement>('gl'),
  textarea:     getEl<HTMLTextAreaElement>('copy'),
  hint:         document.getElementById('hint') as HTMLElement,
  track:        getEl<HTMLAudioElement>('track'),
  audioToggle:  getEl<HTMLButtonElement>('audioToggle'),
  audioFile:    getEl<HTMLInputElement>('audioFile'),
  micBtn:       getEl<HTMLButtonElement>('mic'),
  shapeBtn:     getEl<HTMLButtonElement>('shapeBtn'),
  wrapVal:      document.getElementById('wrapVal') as HTMLElement | null,
}

let prepared: PreparedTextWithSegments = prepareWithSegments(DEFAULT_COPY, PREPARE_FONT)
let wrapWidth = maxWrapPx()
let pointerNdc = { x: 99, y: 99 }
let cursorRadius = 0.48
let shapeIdx = 0
let pointerActive = false
let lastPointerX  = 0
let tiltTarget    = 0
let tiltSmoothed  = 0
let audioEngine: AudioEngine | null = null
let motionPlaying = false
let smoothedBass  = 0
let smoothedMid   = 0
let smoothedHigh  = 0
let smoothedSub   = 0
let smoothedPulse = 0
let energyFollow  = 0
let procBuffer: AudioBuffer | null = null

const textCanvas = document.createElement('canvas')
const textCtx    = (() => {
  const c = textCanvas.getContext('2d', { alpha: true })
  if (!c) throw new Error('2D canvas unsupported')
  return c
})()

const lineNormScratch = new Uint8Array(new ArrayBuffer(MAX_LINE_TEX)) as Uint8Array<ArrayBuffer>

// ─── WebGL init ───────────────────────────────────────────────────────────────

const gl = (() => {
  const g = dom.canvas.getContext('webgl2', {
    alpha: false, antialias: false, powerPreference: 'high-performance',
  })
  if (!g) { dom.hint.textContent = 'WebGL2 required.'; throw new Error('no webgl2') }
  g.disable(g.DEPTH_TEST)
  g.disable(g.STENCIL_TEST)
  return g
})()

const geomProg = makeProgram(gl, VERT_SRC, FRAG_SRC)
const postProg = makeProgram(gl, POST_VERT, POST_FRAG)

const geomLoc = {
  uMvp:          gl.getUniformLocation(geomProg, 'uMvp')!,
  uLineNormTex:  gl.getUniformLocation(geomProg, 'uLineNormTex')!,
  uTextTex:      gl.getUniformLocation(geomProg, 'uTextTex')!,
  uLineCount:    gl.getUniformLocation(geomProg, 'uLineCount')!,
  uTexSize:      gl.getUniformLocation(geomProg, 'uTexSize')!,
  uQuad:         gl.getUniformLocation(geomProg, 'uQuad')!,
  uTime:         gl.getUniformLocation(geomProg, 'uTime')!,
  uDisp:         gl.getUniformLocation(geomProg, 'uDisp')!,
  uBass:         gl.getUniformLocation(geomProg, 'uBass')!,
  uMid:          gl.getUniformLocation(geomProg, 'uMid')!,
  uHigh:         gl.getUniformLocation(geomProg, 'uHigh')!,
  uEnvMix:       gl.getUniformLocation(geomProg, 'uEnvMix')!,
  uAccent:       gl.getUniformLocation(geomProg, 'uAccent')!,
  uCamPos:       gl.getUniformLocation(geomProg, 'uCamPos')!,
  uTilt:         gl.getUniformLocation(geomProg, 'uTilt')!,
  uPulse:        gl.getUniformLocation(geomProg, 'uPulse')!,
  uEnergy:       gl.getUniformLocation(geomProg, 'uEnergy')!,
  uCursor:       gl.getUniformLocation(geomProg, 'uCursor')!,
  uCursorRadius: gl.getUniformLocation(geomProg, 'uCursorRadius')!,
  uCursorShape:  gl.getUniformLocation(geomProg, 'uCursorShape')!,
  lineTex:       gl.createTexture()!,
  textTex:       gl.createTexture()!,
}

const postLoc = {
  uScene: gl.getUniformLocation(postProg, 'uScene')!,
  uTime:  gl.getUniformLocation(postProg, 'uTime')!,
  uBass:  gl.getUniformLocation(postProg, 'uBass')!,
  uMid:   gl.getUniformLocation(postProg, 'uMid')!,
  uHigh:  gl.getUniformLocation(postProg, 'uHigh')!,
  uPulse: gl.getUniformLocation(postProg, 'uPulse')!,
  uRes:   gl.getUniformLocation(postProg, 'uRes')!,
}

const gridBuffers   = createGrid(gl)
const quadBuffers   = createQuad(gl)
let   offscreen     = createOffscreen(gl, 1, 1) // resized each frame

// ─── Events ───────────────────────────────────────────────────────────────────

dom.textarea.value = DEFAULT_COPY
dom.textarea.addEventListener('input', () => {
  const v = dom.textarea.value.trim()
  prepared = prepareWithSegments(v.length > 0 ? v : ' ', PREPARE_FONT)
})

function targetInHud(t: EventTarget | null): boolean {
  return t instanceof Element && Boolean(t.closest('.hud'))
}

function setPointerNdc(clientX: number, clientY: number): void {
  pointerNdc = {
    x: (clientX / window.innerWidth) * 2 - 1,
    y: -((clientY / window.innerHeight) * 2 - 1),
  }
}

window.addEventListener('pointerdown', e => {
  if (targetInHud(e.target)) return
  pointerActive = true
  lastPointerX  = e.clientX
  setPointerNdc(e.clientX, e.clientY)
  updateWrap(e.clientX)
})
window.addEventListener('pointerup', () => {
  pointerActive = false
  tiltTarget = 0
})
window.addEventListener('pointermove', e => {
  setPointerNdc(e.clientX, e.clientY)
  if (!pointerActive) return
  tiltTarget = (e.clientX / window.innerWidth - 0.5) * 2.0
  updateWrap(e.clientX)
})
document.documentElement.addEventListener('pointerleave', () => {
  pointerNdc = { x: 99, y: 99 }
})
window.addEventListener(
  'wheel',
  e => {
    if (targetInHud(e.target)) return
    e.preventDefault()
    cursorRadius = clamp(cursorRadius - e.deltaY * 0.001, 0.12, 1.45)
  },
  { passive: false },
)
window.addEventListener('resize', resizeCanvas)

dom.shapeBtn.addEventListener('click', () => {
  shapeIdx = (shapeIdx + 1) % CURSOR_SHAPES.length
  const s = CURSOR_SHAPES[shapeIdx]!
  dom.shapeBtn.textContent = `Shape · ${s.name}`
  dom.canvas.style.cursor = cursorDataUrl(s)
})
dom.canvas.style.cursor = cursorDataUrl(CURSOR_SHAPES[0]!)
dom.shapeBtn.textContent = `Shape · ${CURSOR_SHAPES[0]!.name}`

dom.audioToggle.addEventListener('click', () => {
  void toggleMotionAudio()
})

dom.audioFile.addEventListener('change', () => {
  const f = dom.audioFile.files?.[0]
  if (!f) return
  dom.track.pause()
  stopProceduralSource()
  disconnectActiveInput()
  dom.track.src = URL.createObjectURL(f)
  void dom.track.load()
  if (motionPlaying) void startTrackOrSynthPlayback()
})

dom.micBtn.addEventListener('click', () => {
  void toggleMic()
})

// ─── Render loop ──────────────────────────────────────────────────────────────

document.fonts.ready.then(() => {
  const v = dom.textarea.value.trim()
  prepared = prepareWithSegments(v.length > 0 ? v : ' ', PREPARE_FONT)
  resizeCanvas()
  requestAnimationFrame(frame)
})

function frame(now: number): void {
  requestAnimationFrame(frame)

  const t = now * 0.001
  tiltSmoothed += (tiltTarget - tiltSmoothed) * 0.06

  resizeCanvas()
  updateAudio()

  wrapWidth = clamp(wrapWidth, MIN_WRAP, maxWrapPx())
  const layoutLineHeight = BASE_FONT_PX * LINE_LEAD
  const layoutMaxWidth = wrapWidth

  const { lines } = layoutWithLines(prepared, layoutMaxWidth, layoutLineHeight)
  fillLineTex(lines, layoutMaxWidth)
  rasterizeText(lines, layoutMaxWidth)

  const w = dom.canvas.width
  const h = dom.canvas.height

  // Ensure offscreen FBO matches canvas
  if (offscreen.w !== w || offscreen.h !== h) {
    offscreen = createOffscreen(gl, w, h)
  }

  // ── Pass 1: geometry → offscreen FBO ─────────────────────────────────────
  gl.bindFramebuffer(gl.FRAMEBUFFER, offscreen.fbo)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0.006, 0.006, 0.008, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.useProgram(geomProg)

  const texAspect    = textCanvas.width / Math.max(1, textCanvas.height)
  const screenAspect = w / h
  let quadX = 1, quadY = 1
  if (texAspect > screenAspect) quadY = screenAspect / texAspect
  else quadX = texAspect / screenAspect

  const accentR = 0.22 + smoothedBass * 0.75
  const accentG = 0.42 + smoothedMid * 0.45
  const accentB = 0.88 + smoothedHigh * 0.28

  gl.uniform1f(geomLoc.uTime,      t)
  gl.uniform1f(geomLoc.uLineCount, Math.max(1, Math.min(lines.length, MAX_LINE_TEX)))
  gl.uniform1f(geomLoc.uTexSize,   MAX_LINE_TEX)
  gl.uniform2f(geomLoc.uQuad,      quadX, quadY)
  gl.uniform1f(geomLoc.uDisp,      1.12 + smoothedMid * 0.55 + smoothedPulse * 0.5)
  gl.uniform1f(geomLoc.uBass,      Math.max(smoothedBass, smoothedPulse * 0.65))
  gl.uniform1f(geomLoc.uMid,       smoothedMid)
  gl.uniform1f(geomLoc.uHigh,      smoothedHigh)
  gl.uniform1f(geomLoc.uEnvMix,    0.12 + smoothedBass * 0.14 + smoothedPulse * 0.12)
  gl.uniform3f(
    geomLoc.uAccent,
    clamp(accentR * 0.5 + 0.12, 0, 1),
    clamp(accentG * 0.72 + 0.18, 0, 1),
    clamp(accentB * 0.88 + 0.1, 0, 1),
  )
  const eye = cameraEye(tiltSmoothed)
  gl.uniform3f(geomLoc.uCamPos, eye[0]!, eye[1]!, eye[2]!)
  gl.uniform1f(geomLoc.uTilt,      tiltSmoothed)
  gl.uniform1f(geomLoc.uPulse,     smoothedPulse)
  gl.uniform1f(geomLoc.uEnergy,    energyFollow)
  gl.uniform2f(geomLoc.uCursor,     pointerNdc.x * quadX, pointerNdc.y * quadY)
  gl.uniform1f(geomLoc.uCursorRadius, cursorRadius)
  gl.uniform1i(geomLoc.uCursorShape, CURSOR_SHAPES[shapeIdx]!.id)

  // Line width texture
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, geomLoc.lineTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, MAX_LINE_TEX, 1, 0, gl.RED, gl.UNSIGNED_BYTE, lineNormScratch)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(geomLoc.uLineNormTex, 0)

  // Text texture
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, geomLoc.textTex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(geomLoc.uTextTex, 1)

  gl.uniformMatrix4fv(geomLoc.uMvp, false, perspectiveMvp(screenAspect, tiltSmoothed))

  gl.bindVertexArray(gridBuffers.vao)
  gl.drawElements(gl.TRIANGLES, gridBuffers.indexCount, gl.UNSIGNED_INT, 0)
  gl.bindVertexArray(null)

  // ── Pass 2: post-process → screen ─────────────────────────────────────────
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, w, h)
  gl.clearColor(0, 0, 0, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.useProgram(postProg)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, offscreen.tex)
  gl.uniform1i(postLoc.uScene, 0)
  gl.uniform1f(postLoc.uTime,  t)
  gl.uniform1f(postLoc.uBass,  smoothedBass)
  gl.uniform1f(postLoc.uMid,   smoothedMid)
  gl.uniform1f(postLoc.uHigh,  smoothedHigh)
  gl.uniform1f(postLoc.uPulse, smoothedPulse)
  gl.uniform2f(postLoc.uRes,   w, h)

  gl.bindVertexArray(quadBuffers.vao)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
  gl.bindVertexArray(null)

  // HUD update
  if (dom.wrapVal) dom.wrapVal.textContent = `${wrapWidth}px`
  const lineVal = document.getElementById('lineVal')
  if (lineVal) lineVal.textContent = `${lines.length}`

  // Dispatch audio band data for the decorative bars
  window.dispatchEvent(new CustomEvent('audiobands', {
    detail: {
      bass: smoothedBass,
      mid: smoothedMid,
      high: smoothedHigh,
      pulse: smoothedPulse,
      energy: energyFollow,
    },
  }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fillLineTex(lines: ReadonlyArray<{ width: number }>, layoutMaxWidth: number): void {
  lineNormScratch.fill(0)
  const n = Math.min(lines.length, MAX_LINE_TEX)
  for (let i = 0; i < n; i++) {
    lineNormScratch[i] = Math.round(
      Math.min(1, lines[i]!.width / Math.max(1, layoutMaxWidth)) * 255,
    )
  }
}

/** Raster uses the same size as `PREPARE_FONT` so lines never overflow the texture. */
function rasterizeText(lines: ReadonlyArray<LayoutLine>, layoutMaxWidth: number): void {
  const n = lines.length
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const lineStep = BASE_FONT_PX * LINE_LEAD

  if (n === 0) {
    textCanvas.width = Math.max(1, Math.floor(layoutMaxWidth * dpr))
    textCanvas.height = Math.max(1, Math.floor(lineStep * dpr))
    textCtx.setTransform(1, 0, 0, 1, 0, 0)
    textCtx.scale(dpr, dpr)
    textCtx.clearRect(0, 0, layoutMaxWidth, lineStep)
    return
  }

  const totalH = n * lineStep
  textCanvas.width = Math.max(1, Math.floor(layoutMaxWidth * dpr))
  textCanvas.height = Math.max(1, Math.floor(totalH * dpr))
  textCtx.setTransform(1, 0, 0, 1, 0, 0)
  textCtx.scale(dpr, dpr)
  textCtx.clearRect(0, 0, layoutMaxWidth, totalH)
  textCtx.textBaseline = 'top'
  textCtx.font = `${BASE_FONT_PX}px ${FONT_FAMILY}`

  let y = 0
  for (let i = 0; i < n; i++) {
    const line = lines[i]!
    textCtx.fillStyle = 'rgba(120, 200, 255, 0.06)'
    textCtx.fillText(line.text, 0.45, y + 0.35)
    textCtx.fillStyle = '#ebe6de'
    textCtx.fillText(line.text, 0, y)
    y += lineStep
  }
}

function updateWrap(clientX: number): void {
  const dx = clientX - lastPointerX
  lastPointerX = clientX
  wrapWidth = clamp(wrapWidth + dx * 1.5, MIN_WRAP, maxWrapPx())
}

function updateAudio(): void {
  const decay = 0.82
  const reactive = Boolean(audioEngine && (motionPlaying || audioEngine.micActive))
  if (!reactive) {
    smoothedBass *= decay
    smoothedMid *= decay
    smoothedHigh *= decay
    smoothedSub *= decay
    smoothedPulse *= 0.88
    energyFollow *= 0.9
    return
  }

  const e = audioEngine!
  const { analyser, freq, prevFreq, time } = e
  analyser.getByteFrequencyData(freq)
  analyser.getByteTimeDomainData(time)

  const n = freq.length
  const subEnd = Math.max(2, Math.floor(n * 0.025))
  const i1 = Math.max(subEnd + 1, Math.floor(n * 0.07))
  const i2 = Math.floor(n * 0.32)

  let sub = 0
  for (let i = 0; i < subEnd; i++) sub += freq[i]!
  let b = 0
  for (let i = subEnd; i < i1; i++) b += freq[i]!
  let m = 0
  for (let i = i1; i < i2; i++) m += freq[i]!
  let h = 0
  for (let i = i2; i < n; i++) h += freq[i]!

  const sv = sub / (subEnd * 255)
  const bv = b / ((i1 - subEnd) * 255)
  const mv = m / ((i2 - i1) * 255)
  const hv = h / ((n - i2) * 255)

  let flux = 0
  for (let i = 0; i < n; i++) {
    const d = freq[i]! - prevFreq[i]!
    if (d > 0) flux += d
  }
  prevFreq.set(freq)

  let rms = 0
  for (let i = 0; i < time.length; i++) {
    const v = (time[i]! - 128) / 128
    rms += v * v
  }
  rms = Math.sqrt(rms / time.length)

  const fluxN = Math.min(1, flux / (n * 40))
  const attack = decay * 0.97
  smoothedSub = smoothedSub * attack + sv * (1 - attack)
  smoothedBass = smoothedBass * attack + Math.max(bv, sv * 1.1) * (1 - attack)
  smoothedMid = smoothedMid * attack + mv * (1 - attack)
  smoothedHigh = smoothedHigh * attack + hv * (1 - attack)

  const pulseTarget = Math.min(1, fluxN * 3.2 + rms * 1.8 + sv * 0.9)
  smoothedPulse = smoothedPulse * 0.72 + pulseTarget * 0.28
  energyFollow = energyFollow * 0.86 + rms * 0.14 + sv * 0.08
}

type AudioEngine = {
  ctx: AudioContext
  analyser: AnalyserNode
  masterGain: GainNode
  freq: Uint8Array<ArrayBuffer>
  prevFreq: Uint8Array<ArrayBuffer>
  time: Uint8Array<ArrayBuffer>
  mediaSource: MediaElementAudioSourceNode | null
  procSource: AudioBufferSourceNode | null
  micSource: MediaStreamAudioSourceNode | null
  micStream: MediaStream | null
  micActive: boolean
}

function ensureAudioEngine(): AudioEngine {
  if (audioEngine) return audioEngine
  const ctx = new AudioContext()
  const masterGain = ctx.createGain()
  masterGain.gain.value = 1
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.38
  masterGain.connect(analyser)
  analyser.connect(ctx.destination)
  const bin = analyser.frequencyBinCount
  const freq = new Uint8Array(new ArrayBuffer(bin)) as Uint8Array<ArrayBuffer>
  const prevFreq = new Uint8Array(new ArrayBuffer(bin)) as Uint8Array<ArrayBuffer>
  const tLen = analyser.fftSize
  const time = new Uint8Array(new ArrayBuffer(tLen)) as Uint8Array<ArrayBuffer>
  audioEngine = {
    ctx,
    analyser,
    masterGain,
    freq,
    prevFreq,
    time,
    mediaSource: null,
    procSource: null,
    micSource: null,
    micStream: null,
    micActive: false,
  }
  procBuffer ??= buildProceduralMotionLoop(ctx)
  return audioEngine
}

function disconnectActiveInput(): void {
  const e = audioEngine
  if (!e) return
  if (e.procSource) {
    try {
      e.procSource.stop()
    } catch {
      /* already stopped */
    }
    e.procSource.disconnect()
    e.procSource = null
  }
  if (e.micSource) {
    e.micSource.disconnect()
    e.micSource = null
  }
  // Keep MediaElementAudioSourceNode — browser allows only one per <audio> element
  e.mediaSource?.disconnect()
}

function stopProceduralSource(): void {
  const e = audioEngine
  if (!e?.procSource) return
  try {
    e.procSource.stop()
  } catch {
    /* */
  }
  e.procSource.disconnect()
  e.procSource = null
}

async function startTrackOrSynthPlayback(): Promise<void> {
  const e = ensureAudioEngine()
  if (e.micActive) return
  await e.ctx.resume()
  disconnectActiveInput()
  dom.track.volume = 0.95

  const hasSrc = Boolean(dom.track.src || dom.track.currentSrc)
  if (hasSrc) {
    try {
      if (!e.mediaSource) e.mediaSource = e.ctx.createMediaElementSource(dom.track)
      e.mediaSource.connect(e.masterGain)
      await dom.track.play()
      return
    } catch {
      e.mediaSource?.disconnect()
    }
  }

  const bs = e.ctx.createBufferSource()
  bs.buffer = procBuffer ?? buildProceduralMotionLoop(e.ctx)
  procBuffer = bs.buffer
  bs.loop = true
  bs.connect(e.masterGain)
  bs.start(0)
  e.procSource = bs
}

function stopMotionPlayback(): void {
  dom.track.pause()
  stopProceduralSource()
  const e = audioEngine
  if (!e || e.micActive) return
  e.mediaSource?.disconnect()
}

async function toggleMotionAudio(): Promise<void> {
  ensureAudioEngine()
  if (motionPlaying) {
    motionPlaying = false
    stopMotionPlayback()
    dom.audioToggle.textContent = 'Play motion'
    dom.audioToggle.setAttribute('aria-pressed', 'false')
    return
  }
  motionPlaying = true
  dom.audioToggle.textContent = 'Pause'
  dom.audioToggle.setAttribute('aria-pressed', 'true')
  await startTrackOrSynthPlayback()
}

async function toggleMic(): Promise<void> {
  const e = ensureAudioEngine()
  if (e.micActive) {
    e.micStream?.getTracks().forEach(t => t.stop())
    e.micStream = null
    e.micActive = false
    disconnectActiveInput()
    dom.micBtn.textContent = 'Live mic'
    dom.micBtn.setAttribute('aria-pressed', 'false')
    if (motionPlaying) await startTrackOrSynthPlayback()
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    await e.ctx.resume()
    disconnectActiveInput()
    dom.track.pause()
    stopProceduralSource()
    const src = e.ctx.createMediaStreamSource(stream)
    src.connect(e.masterGain)
    e.micSource = src
    e.micStream = stream
    e.micActive = true
    dom.micBtn.textContent = 'Mic on'
    dom.micBtn.setAttribute('aria-pressed', 'true')
  } catch {
    dom.micBtn.textContent = 'Mic denied'
  }
}

/** ~1.25s loop: kicks, noise snares, hat shimmer — always works without an MP3 */
function buildProceduralMotionLoop(ctx: AudioContext): AudioBuffer {
  const dur = 1.28
  const rate = ctx.sampleRate
  const n = Math.floor(rate * dur)
  const buf = ctx.createBuffer(1, n, rate)
  const d = buf.getChannelData(0)
  const step = dur / 4
  for (let i = 0; i < n; i++) {
    const t = i / rate
    const beat = Math.floor(t / step) % 4
    const ph = (t % step) / step
    let v = 0
    if (beat === 0) v += Math.sin(ph * Math.PI) * Math.exp(-ph * 11) * 0.95
    if (beat === 2) v += (Math.random() - 0.5) * Math.exp(-ph * 25) * 0.55
    v += Math.sin(t * 440 * 2 * Math.PI) * 0.045 * Math.abs(Math.sin(t * 16 * Math.PI))
    v += Math.sin(t * 220 * 2 * Math.PI) * 0.035 * Math.sin(t * 8 * Math.PI)
    d[i] = Math.tanh(v * 1.15) * 0.5
  }
  return buf
}

function resizeCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.floor(window.innerWidth * dpr)
  const h = Math.floor(window.innerHeight * dpr)
  if (dom.canvas.width !== w || dom.canvas.height !== h) {
    dom.canvas.width = w; dom.canvas.height = h
  }
  wrapWidth = clamp(wrapWidth, MIN_WRAP, maxWrapPx())
}

// ─── WebGL utilities ──────────────────────────────────────────────────────────

function makeProgram(g: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const sh = g.createShader(type)!
    g.shaderSource(sh, src); g.compileShader(sh)
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh)!)
    return sh
  }
  const prog = g.createProgram()!
  g.attachShader(prog, compile(g.VERTEX_SHADER, vs))
  g.attachShader(prog, compile(g.FRAGMENT_SHADER, fs))
  g.linkProgram(prog)
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog)!)
  return prog
}

function createGrid(g: WebGL2RenderingContext) {
  const vx = GRID_X + 1, vy = GRID_Y + 1
  const uv  = new Float32Array(vx * vy * 2)
  let o = 0
  for (let j = 0; j < vy; j++) for (let i = 0; i < vx; i++) {
    uv[o++] = i / GRID_X; uv[o++] = j / GRID_Y
  }
  const idx: number[] = []
  for (let j = 0; j < GRID_Y; j++) for (let i = 0; i < GRID_X; i++) {
    const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1
    idx.push(a, b, c, b, d, c)
  }
  const ia = new Uint32Array(idx)
  const vao = g.createVertexArray()!
  g.bindVertexArray(vao)
  const vbo = g.createBuffer()!
  g.bindBuffer(g.ARRAY_BUFFER, vbo); g.bufferData(g.ARRAY_BUFFER, uv, g.STATIC_DRAW)
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
  const ibo = g.createBuffer()!
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo); g.bufferData(g.ELEMENT_ARRAY_BUFFER, ia, g.STATIC_DRAW)
  g.bindVertexArray(null)
  return { vao, indexCount: ia.length }
}

function createQuad(g: WebGL2RenderingContext) {
  const verts = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1])
  const vao   = g.createVertexArray()!
  g.bindVertexArray(vao)
  const vbo = g.createBuffer()!
  g.bindBuffer(g.ARRAY_BUFFER, vbo); g.bufferData(g.ARRAY_BUFFER, verts, g.STATIC_DRAW)
  g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
  g.bindVertexArray(null)
  return { vao }
}

function createOffscreen(g: WebGL2RenderingContext, w: number, h: number) {
  const tex = g.createTexture()!
  g.bindTexture(g.TEXTURE_2D, tex)
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
  const fbo = g.createFramebuffer()!
  g.bindFramebuffer(g.FRAMEBUFFER, fbo)
  g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0)
  g.bindFramebuffer(g.FRAMEBUFFER, null)
  return { fbo, tex, w, h }
}

function cameraEye(tiltSmoothed: number): Float32Array {
  const pitch = (7.5 * Math.PI) / 180
  const yaw = tiltSmoothed * 0.09
  const dist = 3.45
  const x = Math.sin(yaw) * dist * 0.22
  const y = Math.sin(pitch) * dist * 0.38 + 0.04
  const z = Math.cos(yaw) * Math.cos(pitch) * dist
  return new Float32Array([x, y, z])
}

function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy * 0.5)
  const nf = 1 / (near - far)
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2 * far * near * nf,
    0,
  ])
}

function mat4LookAt(eye: Float32Array, center: Float32Array, up: Float32Array): Float32Array {
  let zx = eye[0]! - center[0]!
  let zy = eye[1]! - center[1]!
  let zz = eye[2]! - center[2]!
  let len = Math.hypot(zx, zy, zz) || 1e-6
  zx /= len
  zy /= len
  zz /= len
  let xx = up[1]! * zz - up[2]! * zy
  let xy = up[2]! * zx - up[0]! * zz
  let xz = up[0]! * zy - up[1]! * zx
  len = Math.hypot(xx, xy, xz) || 1e-6
  xx /= len
  xy /= len
  xz /= len
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx
  return new Float32Array([
    xx,
    yx,
    zx,
    0,
    xy,
    yy,
    zy,
    0,
    xz,
    yz,
    zz,
    0,
    -(xx * eye[0]! + xy * eye[1]! + xz * eye[2]!),
    -(yx * eye[0]! + yy * eye[1]! + yz * eye[2]!),
    -(zx * eye[0]! + zy * eye[1]! + zz * eye[2]!),
    1,
  ])
}

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r]! * b[c * 4 + 0]! +
        a[1 * 4 + r]! * b[c * 4 + 1]! +
        a[2 * 4 + r]! * b[c * 4 + 2]! +
        a[3 * 4 + r]! * b[c * 4 + 3]!
    }
  }
  return o
}

function perspectiveMvp(viewAspect: number, tiltSmoothed: number): Float32Array {
  const eye = cameraEye(tiltSmoothed)
  const center = new Float32Array([0, 0, 0])
  const up = new Float32Array([0, 1, 0])
  const view = mat4LookAt(eye, center, up)
  const proj = mat4Perspective((44 * Math.PI) / 180, viewAspect, 0.09, 26)
  return mat4Mul(proj, view)
}

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }
function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} missing`)
  return el as T
}