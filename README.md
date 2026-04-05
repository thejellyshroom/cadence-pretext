# Cadence

A real-time typographic experience built on a fork of [Pretext](https://github.com/chenglou/pretext).

**[Live demo →](https://chenglou.me/pretext/)**

---

## What it is

Cadence is a browser demo that wraps body text around a moving obstacle — a morphing hull driven by an audio spectrum analyzer — while the column reflows live at 60fps.

The obstacle breathes with the music. The text reorganizes around it. Line breaks shift in real time as the available width changes shape. You can drag the hull, resize it, swap its geometry, and watch the paragraph find its new form.

It looks like a visual effect. It is actually a layout engine running at full speed.

---

## Why this requires Pretext

Most text layout in the browser works by writing to the DOM and asking it what happened: `getBoundingClientRect()`, `offsetHeight`, `getClientRects()`. These calls force synchronous layout reflow. At 60fps, with a column that changes shape every frame, that approach falls apart immediately.

Pretext sidesteps this entirely. It measures text once with the browser's own font engine during a `prepare()` call, caches the segment widths, and then makes every subsequent layout pass pure arithmetic — no DOM reads, no canvas calls, no reflow. Resize is microseconds. Changing the available width frame-by-frame costs essentially nothing.

Cadence uses the streaming layout path specifically:

```ts
// Every frame, the hull shape changes.
// layoutNextLineRange steps through the paragraph
// with a different maxWidth per line, depending on
// where the obstacle sits at that exact Y position.

let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

while (true) {
  const width = availableWidthAt(y, hull)   // hull moves every frame
  const range = layoutNextLineRange(prepared, cursor, width)
  if (range === null) break

  const line = materializeLineRange(prepared, range)
  renderLine(line, y)

  cursor = range.end
  y += lineHeight
}
```

The key: `prepareWithSegments()` runs once when the text or font changes. `layoutNextLineRange()` runs every frame and costs nothing except arithmetic over the cached segment widths. The hull can move continuously without re-measuring a single glyph.

This is the specific capability that makes Cadence possible. Without Pretext's prepare-once / layout-cheap model, obstacle-aware reflow at frame rate is not practical in the browser.

---

## What Pretext provides

This repo is a fork of [chenglou/pretext](https://github.com/chenglou/pretext). The upstream library ships:

- `prepare()` / `layout()` — fast height prediction with no DOM dependency
- `prepareWithSegments()` — richer handle with cursor-based streaming layout
- `layoutNextLine()` / `layoutNextLineRange()` — step through a paragraph one line at a time with a per-line width
- `materializeLineRange()` — turn a geometry range into a renderable string
- `walkLineRanges()` — geometry-only traversal for layout math without building strings
- `measureLineGeometry()` — line count and max width in a single pass
- Full multilingual support: Latin, CJK, Arabic, Indic, bidi, emoji, mixed scripts

Cadence uses the streaming path (`layoutNextLineRange` + `materializeLineRange`) because the available width changes per line per frame. The fixed-width APIs (`layoutWithLines`, `walkLineRanges`) are not enough — Cadence needs to ask "what is the width here, at this Y, given where the obstacle is right now" for every single line on every single frame.

---

## How it works

**Prepare once:**
```ts
const prepared = prepareWithSegments(COPY, BODY_FONT)
```
This is the only expensive call. It segments the text, measures each segment with canvas, and builds the cached width table. Everything after this is cheap.

**Layout every frame:**
```ts
// hull.intervalAt(y) returns the available width at vertical position y,
// accounting for the obstacle geometry and the audio-driven wave boundary.
// This changes continuously as the hull moves and the audio plays.

const range = layoutNextLineRange(prepared, cursor, hull.intervalAt(y))
```

**Audio drives the obstacle:**
The `AudioContext` analyzes the playing track with an FFT. Band energy maps to the hull's scale, morph factor, and wave amplitude. The obstacle literally breathes with the music — and because Pretext's layout is arithmetic after prepare, the text reorganizes around every breath without dropping a frame.

**Cursor shapes:**
The floating hull can be a blob (morphing bezier path) or a circle. Each produces a different obstacle geometry, a different width function per Y position, and therefore a different column shape. The text does not know or care what shape the obstacle is. It just flows into whatever space is available.

---

## Source

| File | Role |
|------|------|
| `index.html` | Shell, panel, styles |
| `index.ts` | Main loop: resize, audio, obstacles, pool sync, events |
| `column-layout.ts` | `layoutColumn` — per-line width computation + `layoutNextLineRange` stepping |
| `wrap-geometry.ts` | Hull math, polygon interval helpers, coordinate transforms |
| `cursor.ts` | Cursor shapes, blob morph, SVG preview generation |
| `audio.ts` | Web Audio analysis, wave obstacle state |
| `display-glitch.ts` | Per-line display corruption tied to audio intensity |
| `config.ts` | Typography constants, FFT size, wave parameters |
| `text.ts` | Body copy — edit `COPY` to change the paragraph |
| `types.ts` | Shared obstacle and positioned-line types |

---

## Run locally

```sh
bun install
bun start
```

Open [http://localhost:3000](http://localhost:3000).

---

## Try it

- **Play motion** — Pick a built-in track or drop in your own audio file. The hull expands and contracts with the spectrum. Watch the line count change in the Activity card as the available width shifts.
- **Obstacle** — Cycle through blob and circle. Each shape produces a different column profile. The blob morphs continuously.
- **Drag and scroll** — Move the obstacle anywhere in the column. Scroll to resize it. The text wraps around it in real time regardless of position or scale.
- **Type in the panel** — Replace the body copy. `prepareWithSegments()` re-runs on the new text. Everything else stays the same.

---

## Credits

Cadence is built on [Pretext](https://github.com/chenglou/pretext) by [chenglou](https://github.com/chenglou), who also originated the core insight: measure with the browser's font engine once, then make layout arithmetic. The streaming line APIs that Cadence depends on were designed and implemented in Pretext upstream. This fork exists to build the demo; the layout engine is entirely Pretext's work.