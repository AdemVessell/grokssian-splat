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
  const W = 960;
  const H = 720;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  };
  const noise = (x: number, y: number, s = 1) => {
    const n = Math.sin(x * 12.9898 * s + y * 78.233 * s) * 43758.5453;
    return n - Math.floor(n);
  };

  const wallGrad = ctx.createLinearGradient(0, 0, 0, 460);
  wallGrad.addColorStop(0, "#e8e0d4");
  wallGrad.addColorStop(0.55, "#d4c8b8");
  wallGrad.addColorStop(1, "#b8aa98");
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, W, 460);
  for (let y = 0; y < 460; y += 3) {
    for (let x = 0; x < W; x += 3) {
      const n = noise(x, y, 0.7);
      if (n > 0.62) {
        ctx.fillStyle = `rgba(90,70,50,${0.04 + n * 0.05})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  const wx = 520, wy = 48, ww = 360, wh = 300;
  ctx.fillStyle = "#6a5e52";
  ctx.fillRect(wx - 18, wy - 14, ww + 36, wh + 28);
  ctx.fillStyle = "#4a4238";
  ctx.fillRect(wx - 10, wy - 8, ww + 20, wh + 16);
  const sky = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  sky.addColorStop(0, "#5a9fd4");
  sky.addColorStop(0.45, "#8ec4e8");
  sky.addColorStop(0.72, "#c5dce8");
  sky.addColorStop(1, "#9bb89a");
  ctx.fillStyle = sky;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.ellipse(wx + 90, wy + 70, 70, 22, -0.2, 0, Math.PI * 2);
  ctx.ellipse(wx + 140, wy + 78, 50, 16, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(wx + 260, wy + 55, 55, 18, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3d5a40";
  for (let i = 0; i < 14; i++) {
    const tx = wx + 20 + i * 24 + noise(i, 1) * 10;
    const th = 40 + noise(i, 2) * 50;
    ctx.beginPath();
    ctx.moveTo(tx, wy + wh);
    ctx.lineTo(tx + 12, wy + wh - th);
    ctx.lineTo(tx + 24, wy + wh);
    ctx.fill();
  }
  ctx.strokeStyle = "#2e2820";
  ctx.lineWidth = 10;
  ctx.strokeRect(wx, wy, ww, wh);
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.moveTo(wx, wy + wh / 2);
  ctx.lineTo(wx + ww, wy + wh / 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(wx + 4, wy + 4, ww - 8, wh - 8);

  const floorTop = 460;
  const floorGrad = ctx.createLinearGradient(0, floorTop, 0, H);
  floorGrad.addColorStop(0, "#8a6e4e");
  floorGrad.addColorStop(1, "#5c4834");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, floorTop, W, H - floorTop);
  ctx.strokeStyle = "rgba(40,28,16,0.35)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const y = floorTop + 8 + i * 22;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y + (i - 6) * 1.2);
    ctx.stroke();
  }
  for (let x = 0; x < W; x += 48) {
    ctx.strokeStyle = `rgba(30,20,10,${0.2 + noise(x, 3) * 0.15})`;
    ctx.beginPath();
    ctx.moveTo(x, floorTop);
    ctx.lineTo(x + (x - W / 2) * 0.08, H);
    ctx.stroke();
  }
  for (let i = 0; i < 900; i++) {
    const x = noise(i, 4) * W;
    const y = floorTop + noise(i, 5) * (H - floorTop);
    ctx.fillStyle = `rgba(40,28,14,${0.08 + noise(i, 6) * 0.12})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  ctx.fillStyle = "#6b3a3a";
  rr(80, 520, 420, 160, 8);
  ctx.fill();
  ctx.fillStyle = "#8a4e4e";
  rr(100, 535, 380, 130, 6);
  ctx.fill();
  ctx.strokeStyle = "#c9a070";
  ctx.lineWidth = 3;
  rr(110, 545, 360, 110, 4);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#c9a070" : "#5a3030";
    ctx.fillRect(120 + i * 44, 555, 36, 10);
    ctx.fillRect(120 + i * 44, 640, 36, 10);
  }

  ctx.fillStyle = "rgba(20,12,8,0.35)";
  ctx.beginPath();
  ctx.ellipse(280, 545, 200, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  const sofaGrad = ctx.createLinearGradient(60, 380, 60, 540);
  sofaGrad.addColorStop(0, "#3a5a7a");
  sofaGrad.addColorStop(1, "#243e58");
  ctx.fillStyle = sofaGrad;
  rr(70, 390, 420, 150, 14);
  ctx.fill();
  ctx.fillStyle = "#2e4c68";
  rr(90, 430, 380, 90, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,30,45,0.45)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(280, 430);
  ctx.lineTo(280, 520);
  ctx.stroke();
  ctx.fillStyle = "#2a4864";
  rr(70, 340, 420, 70, 12);
  ctx.fill();
  ctx.fillStyle = "#1e3850";
  rr(55, 350, 48, 185, 10);
  ctx.fill();
  rr(457, 350, 48, 185, 10);
  ctx.fill();
  ctx.fillStyle = "rgba(180,210,230,0.12)";
  rr(58, 350, 42, 16, 6);
  ctx.fill();
  rr(460, 350, 42, 16, 6);
  ctx.fill();
  for (let y = 400; y < 520; y += 4) {
    for (let x = 100; x < 450; x += 4) {
      if (noise(x, y, 1.4) > 0.7) {
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(x, y, 2, 1);
      }
    }
  }

  ctx.fillStyle = "#6b4428";
  ctx.beginPath();
  ctx.moveTo(155, 420);
  ctx.lineTo(195, 420);
  ctx.lineTo(188, 480);
  ctx.lineTo(162, 480);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#4a3020";
  ctx.fillRect(158, 416, 34, 8);
  ctx.strokeStyle = "#3d2a18";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(175, 416);
  ctx.quadraticCurveTo(170, 360, 178, 300);
  ctx.stroke();
  const leafColors = ["#1e6b35", "#2a8a42", "#165a28", "#3a9a50", "#0f4a20"];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = 55 + noise(i, 7) * 35;
    const lx = 178 + Math.cos(a) * r * 0.85;
    const ly = 290 + Math.sin(a) * r * 0.55 - 20;
    ctx.fillStyle = leafColors[i % leafColors.length]!;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 18 + noise(i, 8) * 12, 8 + noise(i, 9) * 6, a * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#4aba60";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.ellipse(178 + Math.cos(a) * 70, 275 + Math.sin(a) * 40, 10, 5, a, 0, Math.PI * 2);
    ctx.fill();
  }

  const lx = 480, ly = 200;
  const glow = ctx.createRadialGradient(lx, ly, 5, lx, ly, 90);
  glow.addColorStop(0, "rgba(255,220,120,0.55)");
  glow.addColorStop(0.4, "rgba(255,200,80,0.18)");
  glow.addColorStop(1, "rgba(255,180,60,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(lx, ly, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f5e6a8";
  ctx.beginPath();
  ctx.moveTo(lx - 38, ly + 8);
  ctx.lineTo(lx + 38, ly + 8);
  ctx.lineTo(lx + 28, ly - 42);
  ctx.lineTo(lx - 28, ly - 42);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e8d080";
  ctx.beginPath();
  ctx.moveTo(lx - 28, ly - 42);
  ctx.lineTo(lx + 28, ly - 42);
  ctx.lineTo(lx + 22, ly - 52);
  ctx.lineTo(lx - 22, ly - 52);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#888890";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(lx, ly + 8);
  ctx.lineTo(lx, 530);
  ctx.stroke();
  ctx.fillStyle = "#4a4a52";
  ctx.beginPath();
  ctx.ellipse(lx, 538, 28, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#5c4030";
  rr(600, 470, 100, 12, 3);
  ctx.fill();
  ctx.fillStyle = "#4a3224";
  ctx.fillRect(630, 482, 12, 55);
  ctx.fillRect(660, 482, 12, 55);
  ctx.fillStyle = "#3a281c";
  ctx.beginPath();
  ctx.ellipse(650, 540, 42, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c4b8a8";
  ctx.beginPath();
  ctx.moveTo(640, 468);
  ctx.quadraticCurveTo(625, 440, 635, 410);
  ctx.quadraticCurveTo(650, 400, 665, 410);
  ctx.quadraticCurveTo(675, 440, 660, 468);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#a89888";
  ctx.fillRect(642, 405, 16, 8);
  ctx.strokeStyle = "#8a7a50";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(650, 405);
    ctx.quadraticCurveTo(640 + i * 8, 370, 630 + i * 12, 340 + noise(i, 10) * 20);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(20,12,8,0.25)";
  ctx.beginPath();
  ctx.ellipse(175, 482, 28, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  const vig = ctx.createRadialGradient(W / 2, H * 0.4, 200, W / 2, H * 0.4, 600);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(20,12,8,0.22)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

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
