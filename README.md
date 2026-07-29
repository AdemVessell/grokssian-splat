# SplatForge (Grokssian Splat)

[![Live demo](https://img.shields.io/badge/live-grokssian--splat.grok.me-0a0a0b?style=for-the-badge&logo=vercel&logoColor=white)](https://grokssian-splat.grok.me/)
[![GitHub Pages](https://img.shields.io/badge/mirror-GitHub%20Pages-222?style=for-the-badge&logo=github)](https://ademvessell.github.io/grokssian-splat/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](./LICENSE)

**Single-image → interactive 3D Gaussian splat scenes** — fully client-side.  
Drop a photo, get a walkable/orbitable point cloud with anisotropic Gaussians, layered depth, and PLY export.

### 🌐 Live

| Host | URL |
|------|-----|
| **Primary** | **[https://grokssian-splat.grok.me/](https://grokssian-splat.grok.me/)** |
| GitHub Pages mirror | [https://ademvessell.github.io/grokssian-splat/](https://ademvessell.github.io/grokssian-splat/) |
| Source | [github.com/AdemVessell/grokssian-splat](https://github.com/AdemVessell/grokssian-splat) |

> Prefer the **primary** host for the production experience. Pages is a continuous mirror of `main`.

---

## Features

- **Depth engines** — Heuristic (fast) and Enhanced (multi-scale structure)
- **SOTA Mode** — metric unproject, anisotropic Gaussians, LDI back-layers, edge densify
- **Project models** — Metric · Relief · Portrait · Sphere · Panorama · Flat
- **Quality presets** — Draft · Balanced · Ultra · SOTA
- **Auto-framing** — normalized cloud + camera fit for comfortable orbit
- **Layers** — multi-image scene stack
- **PLY export** — active layer → `.ply`
- **Try demo** — synthetic room for instant QA (no upload)

## Defaults (recommended start)

```
Quality          SOTA
Depth engine     Enhanced
Project model    Metric
Anisotropic      on
Layered depth    on
Edge densify     on
```

Tip: leave SOTA defaults alone and change **Project model** to match the image  
(Portrait for people, Relief for sculpture/cameo, Panorama/Sphere for wrap worlds).

## Quick start (local)

```bash
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) — drop an image or hit **Try demo**.

```bash
npm run build      # production build (root base)
npm run preview    # serve dist/
npm run typecheck  # tsc --noEmit
```

## Stack

| Layer | Tech |
|-------|------|
| App | Vite 6 · React 19 · TypeScript |
| 3D | React Three Fiber · Three.js · Drei |
| State | Zustand |
| UI | Tailwind CSS v4 · Lucide |

## How it works (high level)

1. **Depth** — monocular estimate from luminance / multi-scale structure (client-only; not a neural depth API).
2. **Sample** — adaptive densify near edges; optional LDI back-layer emission.
3. **Project** — unproject or wrap samples into 3D (metric pinhole, relief, portrait, sphere, panorama, flat).
4. **Render** — anisotropic Gaussian-ish ellipsoids with confidence-aware opacity.
5. **Frame** — normalize bounds and fit the orbit camera.

Best inputs: clear near / mid / far layers, strong subject silhouettes, medium FOV photos.  
Weak inputs: flat illustrations, foggy low-contrast frames, extreme wide-angle distortion.

## Project layout

```
src/
  components/splat/   Studio UI + R3F viewport + splat cloud
  lib/splat/          depth · project · SOTA sampling · generate · PLY
  stores/             scene / layer state (Zustand)
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Dev server on `:8080` |
| `npm run build` | Typecheck + production build |
| `npm run build:pages` | Build with `/grokssian-splat/` base for GitHub Pages |
| `npm run preview` | Preview production build |
| `npm run typecheck` | TypeScript only |

## Deploy

- **Primary production:** [grokssian-splat.grok.me](https://grokssian-splat.grok.me/) (hosted separately; keep in sync with this repo as the source of truth).
- **GitHub Pages:** on every push to `main`, [`.github/workflows/pages.yml`](./.github/workflows/pages.yml) builds with `GITHUB_PAGES=true` and deploys the `dist/` artifact.

Enable **Settings → Pages → Source: GitHub Actions** if the first deploy needs a one-time confirm.

## License

[MIT](./LICENSE) © Adem Vessell

## Owner

[@AdemVessell](https://github.com/AdemVessell)
