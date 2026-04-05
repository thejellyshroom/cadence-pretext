# Cadence

**Cadence** is the shipped Pretext browser demo at `/` (entry HTML: `pages/index.html`, bootstrap: `pages/cadence/index.ts`, runtime: `pages/cadence/cadence-app.ts`). It combines **streaming line layout** (`layoutNextLine` / `layoutNextLineRange`), a **polygon wrap obstacle** driven by **audio spectrum**, and a **draggable SVG hull** so you can see obstacle-aware reflow in motion. The old `/demos/index` URL redirects to `/`.

**Viewport:** Cadence is **desktop-only** (about **1024px** min width). Narrower viewports see a short message instead; the demo script is not loaded until the viewport qualifies.

It is a dogfood page for the rich layout path: prepare once with segments, then step lines manually while widths change every frame.

## Run it locally

From the repo root:

```sh
bun install
bun start
```

Open [http://localhost:3000/](http://localhost:3000/) (or [http://localhost:3000/demos/index](http://localhost:3000/demos/index), which redirects to `/`).

On GitHub Pages builds, the same entry is exposed as the main demo route for this package’s static site.

## What to try

- **Motion audio** — Pick a track and press **Play motion**. An `AudioContext` analyzes the playing `<audio>` element (parallel band splits + RMS). That signal drives a **moving wrap boundary** on the text column (see `audio.ts` / `updateAudioWave`).
- **Obstacle** — Cycle **Obstacle · …** to swap the floating hull between **blob** (morphing path) and **circle**. The hull is a separate wrap obstacle from the audio-driven edge; both participate in `layoutColumn` via `wrap-geometry.ts`.
- **Drag & scale** — Move the SVG obstacle; **scroll** (wheel) to resize it. The text reflows immediately against the new hull and wrap column.
- **Glitch display** — With motion playing, some graphemes are redrawn with a cyan “glitch” treatment when the display string diverges from the layout string (`display-glitch.ts`, `.cadence-line__glitch` in `pages/index.html`).

## Pretext APIs in use

| Area | API |
|------|-----|
| Prepare | `prepareWithSegments()` — segments + measurement for the body copy |
| Streaming layout | `layoutNextLine`, `layoutNextLineRange`, `materializeLineRange` inside `column-layout.ts` |
| Geometry | `getWrapHull`, polygon interval helpers in `wrap-geometry.ts` |

The demo does **not** rely on the opaque `prepare()` handle alone; it needs the richer cursor/range materialization path to interleave obstacles and band geometry.

## Source map

| File | Role |
|------|------|
| `../index.html` | Shell, HUD, styles (`.cadence-page`, `.cadence-line`, panel layout) |
| `index.ts` | Main loop: resize, audio, obstacles, pool sync, events |
| `column-layout.ts` | `layoutColumn` — band obstacles + `layoutNextLine` stepping |
| `wrap-geometry.ts` | Hull math, polygon/rect intervals, transform |
| `cursor.ts` | Cursor shapes, blob morph, `svgDisplayDataUrl` for HUD preview |
| `audio.ts` | Web Audio analysis, wave obstacle state |
| `display-glitch.ts` | Intensity + per-line display corruption |
| `config.ts` | Typography, FFT size, clamps, padding constants |
| `text.ts` | Body copy (`COPY`) — default is an excerpt you can replace |
| `types.ts` | Shared obstacle / positioned line types |

Bundled motion tracks are imported in `index.ts` from `pages/assets/*.mp3` (`cat`, `electro`, `electronic-chill`, `lofi`).

## Customizing

- **Copy** — Edit `text.ts` (`COPY`). Keep a non-empty string after trim; the bootstrap falls back to a single space if empty.
- **Tracks** — Adjust `MOTION_TRACKS` in `index.ts` (add imports with Bun’s `with { type: 'file' }` for new files under `pages/assets/`).
- **Tuning** — FFT size, wave stops, padding, and line metrics live in `config.ts`.

## Browser notes

- **Audio** — Playback uses a real `<audio>` element; analysis taps it through `createMediaElementSource`. Some browsers require a user gesture before `AudioContext` unlocks; **Play motion** is wired for that path.
- **Fonts** — The HUD uses Google Fonts (Cormorant Garamond + DM Mono) from `pages/index.html`. Canvas measurement in Pretext uses the configured `MEASURE_FONT` / `BODY_FONT` in `config.ts`; keep those aligned with what you want to match in the browser.

## Related docs

- Package overview and API surface: [README.md](../../README.md) at repo root  
- Dev server and tooling: [DEVELOPMENT.md](../../DEVELOPMENT.md)
