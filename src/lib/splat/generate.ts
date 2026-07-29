import { estimateDepth, loadImageElement } from "./depth";
import { normalizeCloud } from "./frame";
import {
  anisotropicScalesFromNormalAndDepth,
  estimateNormalFromDepth,
  projectPoint,
} from "./project";
import {
  adaptiveStepAt,
  computeDepthGradient,
  layeredDepthOffset,
  localColorStructure,
  refineConfidenceWithGradient,
  shouldEmitLayer,
} from "./sota";
import type { QualityPreset, SplatCloud, SplatParams } from "./types";

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

function qualityConfig(quality: QualityPreset | undefined, sampleStep: number) {
  const q = quality ?? "balanced";
  switch (q) {
    case "draft":
      return { maxDim: 280, step: Math.max(sampleStep, 4), maxSplats: 12_000 };
    case "ultra":
      return { maxDim: 640, step: Math.max(1, sampleStep), maxSplats: 70_000 };
    case "sota":
      // Default path: denser sampling + higher resolution for portrait / architecture detail
      return { maxDim: 560, step: Math.max(1, Math.min(sampleStep, 2)), maxSplats: 58_000 };
    case "balanced":
    default:
      return { maxDim: 400, step: Math.max(1, Math.round(sampleStep)), maxSplats: 28_000 };
  }
}

function emptyCloud(): SplatCloud {
  return {
    positions: new Float32Array(0),
    colors: new Float32Array(0),
    scales: new Float32Array(0),
    normals: new Float32Array(0),
    opacities: new Float32Array(0),
    confidences: new Float32Array(0),
    count: 0,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  };
}

async function loadColorExact(imageSrc: string, w: number, h: number) {
  const img = await loadImageElement(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

type GrowBuf = {
  positions: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
  normals: Float32Array;
  opacities: Float32Array;
  confidences: Float32Array;
  count: number;
  capacity: number;
};

function makeGrow(cap: number): GrowBuf {
  return {
    positions: new Float32Array(cap * 3),
    colors: new Float32Array(cap * 3),
    scales: new Float32Array(cap * 3),
    normals: new Float32Array(cap * 3),
    opacities: new Float32Array(cap),
    confidences: new Float32Array(cap),
    count: 0,
    capacity: cap,
  };
}

function ensureCap(g: GrowBuf, need: number) {
  if (g.count + need <= g.capacity) return;
  const next = Math.max(g.capacity * 2, g.count + need + 1024);
  const grow = (src: Float32Array, stride: number) => {
    const n = new Float32Array(next * stride);
    n.set(src.subarray(0, g.count * stride));
    return n;
  };
  g.positions = grow(g.positions, 3);
  g.colors = grow(g.colors, 3);
  g.scales = grow(g.scales, 3);
  g.normals = grow(g.normals, 3);
  g.opacities = grow(g.opacities, 1);
  g.confidences = grow(g.confidences, 1);
  g.capacity = next;
}

export async function generateSplatCloud(
  imageSrc: string,
  params: SplatParams,
  options?: { onProgress?: (p: number, msg: string) => void },
): Promise<SplatCloud> {
  const onProgress = options?.onProgress;
  const { maxDim, step: baseStep, maxSplats } = qualityConfig(
    params.quality,
    params.sampleStep,
  );
  const confidenceCull = params.confidenceCull ?? 0.05;
  const fovDeg = params.fovDeg ?? 52;
  const anisotropic = params.anisotropic !== false;
  const layered = params.layeredDepth ?? params.quality === "sota";
  const edgeDensify =
    params.edgeDensify ?? (params.quality === "sota" || params.quality === "ultra");

  onProgress?.(0.05, "Loading image…");
  const engine = params.depthEngine === "heuristic" ? "heuristic" : "enhanced";
  onProgress?.(0.1, `Depth · ${engine}…`);

  const depthMap = await estimateDepth(imageSrc, engine, {
    invert: params.invertDepth,
    softFocus: params.softFocus,
    maxDim,
    centerBias: params.depthMode === "portrait" ? 0.85 : 0.28,
  });

  const w = depthMap.width;
  const h = depthMap.height;
  const colorData = await loadColorExact(imageSrc, w, h);
  onProgress?.(0.4, "Analyzing structure…");

  const gradient = computeDepthGradient(depthMap.depth, w, h);
  const confBuf = refineConfidenceWithGradient(depthMap.confidence, gradient);
  const depthBuf = depthMap.depth;
  const aspect = w / Math.max(1, h);
  const grow = makeGrow(Math.min(maxSplats + 2048, 80_000));

  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };

  const boost = params.colorBoost;
  const baseOpacity = params.opacity;
  const visited = edgeDensify ? new Uint8Array(w * h) : null;
  let hardStop = false;

  for (let y = 0; y < h && !hardStop; y++) {
    if (y % 16 === 0) {
      onProgress?.(0.42 + (y / h) * 0.5, `Sampling ${grow.count.toLocaleString()} splats…`);
    }
    for (let x = 0; x < w && !hardStop; ) {
      if (grow.count >= maxSplats) {
        hardStop = true;
        break;
      }
      const di = y * w + x;
      const grad = gradient[di] ?? 0;
      const stepHere = adaptiveStepAt(grad, baseStep, edgeDensify);

      if (visited) {
        if (visited[di]) {
          x += 1;
          continue;
        }
        for (let yy = y; yy < Math.min(h, y + stepHere); yy++) {
          for (let xx = x; xx < Math.min(w, x + stepHere); xx++) {
            visited[yy * w + xx] = 1;
          }
        }
      }

      const pi = (y * w + x) * 4;
      if (colorData[pi + 3]! < params.alphaThreshold) {
        x += stepHere;
        continue;
      }

      let conf = confBuf[di] ?? 0;
      conf = clamp01(conf * 0.85 + localColorStructure(colorData, w, h, x, y) * 0.2);
      if (conf < confidenceCull) {
        x += stepHere;
        continue;
      }

      const depth = depthBuf[di] ?? 0.5;
      if (conf < Math.max(confidenceCull * 1.5, 0.1) && (depth < 0.06 || depth > 0.97)) {
        x += stepHere;
        continue;
      }

      const nx = x / (w - 1 || 1);
      const ny = y / (h - 1 || 1);

      const emitOne = (
        d: number,
        opacityMul: number,
        confMul: number,
        scaleMul: number,
        isLayer: boolean,
      ) => {
        const [px, py, pz] = projectPoint(
          params.depthMode,
          nx,
          ny,
          d,
          params.depthScale,
          aspect,
          fovDeg,
        );
        let normal = estimateNormalFromDepth(
          depthBuf,
          w,
          h,
          x,
          y,
          fovDeg,
          aspect,
          params.depthScale,
        );
        if (!anisotropic) normal = [0, 0, 1];

        // Bake relative scales; live size from uSize
        let sc = anisotropic
          ? anisotropicScalesFromNormalAndDepth(
              normal,
              d,
              stepHere,
              1.0 * scaleMul,
              params.depthScale,
              grad,
            )
          : ([
              stepHere * 0.55 * scaleMul,
              stepHere * 0.55 * scaleMul,
              stepHere * 0.55 * scaleMul,
            ] as [number, number, number]);

        if (isLayer) sc = [sc[0] * 1.15, sc[1] * 1.15, sc[2] * 1.35];

        const r = clamp01((colorData[pi]! / 255) * boost);
        const gv = clamp01((colorData[pi + 1]! / 255) * boost);
        const b = clamp01((colorData[pi + 2]! / 255) * boost);
        const opacity = clamp01(
          baseOpacity * Math.sqrt(Math.max(conf * confMul, 1e-4)) * opacityMul * (1 + grad * 0.1),
        );

        ensureCap(grow, 1);
        const o = grow.count * 3;
        grow.positions[o] = px;
        grow.positions[o + 1] = py;
        grow.positions[o + 2] = pz;
        grow.colors[o] = r;
        grow.colors[o + 1] = gv;
        grow.colors[o + 2] = b;
        grow.normals[o] = normal[0];
        grow.normals[o + 1] = normal[1];
        grow.normals[o + 2] = normal[2];
        grow.scales[o] = sc[0];
        grow.scales[o + 1] = sc[1];
        grow.scales[o + 2] = sc[2];
        grow.opacities[grow.count] = opacity;
        grow.confidences[grow.count] = clamp01(conf * confMul);
        grow.count++;
        bounds.minX = Math.min(bounds.minX, px);
        bounds.minY = Math.min(bounds.minY, py);
        bounds.minZ = Math.min(bounds.minZ, pz);
        bounds.maxX = Math.max(bounds.maxX, px);
        bounds.maxY = Math.max(bounds.maxY, py);
        bounds.maxZ = Math.max(bounds.maxZ, pz);
      };

      emitOne(depth, 1, 1, 1, false);
      if (shouldEmitLayer(grad, depth, conf, layered)) {
        emitOne(layeredDepthOffset(depth, grad), 0.42, 0.75, 1.05, true);
      }
      x += stepHere;
    }
  }

  onProgress?.(0.95, "Framing cloud…");
  if (grow.count === 0) {
    onProgress?.(1, "Empty cloud");
    return emptyCloud();
  }

  const raw: SplatCloud = {
    positions: grow.positions.slice(0, grow.count * 3),
    colors: grow.colors.slice(0, grow.count * 3),
    scales: grow.scales.slice(0, grow.count * 3),
    normals: grow.normals.slice(0, grow.count * 3),
    opacities: grow.opacities.slice(0, grow.count),
    confidences: grow.confidences.slice(0, grow.count),
    count: grow.count,
    bounds: {
      min: [bounds.minX, bounds.minY, bounds.minZ],
      max: [bounds.maxX, bounds.maxY, bounds.maxZ],
    },
  };

  const cloud = normalizeCloud(raw);
  onProgress?.(1, `${cloud.count.toLocaleString()} splats`);
  return cloud;
}

export function createDemoImageDataUrl(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#3d3428";
  ctx.fillRect(0, 300, 640, 180);
  const wall = ctx.createLinearGradient(0, 0, 0, 300);
  wall.addColorStop(0, "#c4b8a8");
  wall.addColorStop(1, "#8a7e70");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, 640, 300);
  const sky = ctx.createLinearGradient(380, 40, 380, 220);
  sky.addColorStop(0, "#6eb0e0");
  sky.addColorStop(1, "#b8d4e8");
  ctx.fillStyle = sky;
  ctx.fillRect(360, 40, 200, 180);
  ctx.strokeStyle = "#5a5048";
  ctx.lineWidth = 8;
  ctx.strokeRect(360, 40, 200, 180);
  ctx.beginPath();
  ctx.moveTo(460, 40);
  ctx.lineTo(460, 220);
  ctx.moveTo(360, 130);
  ctx.lineTo(560, 130);
  ctx.stroke();
  ctx.fillStyle = "#2a4a6e";
  ctx.fillRect(40, 220, 260, 90);
  ctx.fillStyle = "#1e3a58";
  ctx.fillRect(40, 200, 40, 110);
  ctx.fillRect(260, 200, 40, 110);
  ctx.fillStyle = "#2d6b3a";
  ctx.beginPath();
  ctx.ellipse(120, 160, 35, 50, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5c4030";
  ctx.fillRect(110, 200, 20, 30);
  ctx.fillStyle = "#f0d060";
  ctx.beginPath();
  ctx.arc(300, 140, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#888";
  ctx.fillRect(295, 168, 10, 60);

  return canvas.toDataURL("image/png");
}

export function cloudToPly(cloud: SplatCloud, name = "splat"): string {
  const n = cloud.count;
  const lines = [
    "ply",
    "format ascii 1.0",
    `comment SplatForge — ${name}`,
    `element vertex ${n}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    "end_header",
  ];
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = cloud.positions[o]!.toFixed(5);
    const y = cloud.positions[o + 1]!.toFixed(5);
    const z = cloud.positions[o + 2]!.toFixed(5);
    const r = Math.round(clamp01(cloud.colors[o]!) * 255);
    const g = Math.round(clamp01(cloud.colors[o + 1]!) * 255);
    const b = Math.round(clamp01(cloud.colors[o + 2]!) * 255);
    lines.push(`${x} ${y} ${z} ${r} ${g} ${b}`);
  }
  return lines.join("\n");
}
