# SplatForge (Grokssian Splat)

**Single-image → 3D Gaussian splat scenes** — fully client-side.

## Features

- **Depth engines** — Heuristic & Enhanced multi-scale structure depth
- **SOTA Mode** — metric unproject, anisotropic Gaussians, LDI back-layers, edge densify
- **Auto-framing** — clouds normalized + camera fit for walkable orbit
- **PLY export**
- **Try demo** — synthetic room scene for instant QA

## Stack

- Vite + React 19 + TypeScript
- React Three Fiber / Three.js
- Zustand
- Tailwind CSS v4

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:8080 — drop an image or hit **Try demo**.

## Defaults

SOTA · Enhanced · Metric · Layered LDI · Edge densify

## Owner

[@AdemVessell](https://github.com/AdemVessell)
