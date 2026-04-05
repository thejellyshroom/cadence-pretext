# Cadence native

Experimental sibling to the shipped [Cadence](../CADENCE.md) demo at `/`. This folder **does not import** `../../src/layout.ts` or any other Pretext package code.

## Layout approach

- **Obstacle**: invisible `float: left` shim with `shape-outside` set from the same hull polygons as the main demo (`getWrapHull`, blob morph, etc.).
- **Audio column**: `padding-left` on the flow container from a **single vertical sample** of `waveSmoothed` (mid column), not the full per-row polygon boundary used with Pretext.
- **Copy**: normal `article` + `white-space: pre-wrap` + `overflow-wrap: break-word` — the browser’s line breaker, not segment-sum layout.

## Run

With the repo dev server:

```sh
bun start
```

Open `/demos/cadence-native/` (see `package.json` `start` entry for the exact HTML list).

## Files

Copied verbatim from `pages/demos/` (still no Pretext): `config.ts`, `types.ts`, `wrap-geometry.ts`, `audio.ts`, `cursor.ts`. `text-body.ts` is the same corpus as `text.ts`. Only `index.ts` / `index.html` are specific to this experiment.
