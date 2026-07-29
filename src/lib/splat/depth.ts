import type { DepthMap } from "./types";

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function imageToCanvas(img: HTMLImageElement, maxDim: number) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

function luminance(data: Uint8ClampedArray, w: number, h: number) {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] =
      (0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!) / 255;
  }
  return out;
}

function sobel(lum: Float32Array, w: number, h: number) {
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) =>
    lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]!;
  let maxG = 1e-6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        -at(x - 1, y - 1) +
        at(x + 1, y - 1) -
        2 * at(x - 1, y) +
        2 * at(x + 1, y) -
        at(x - 1, y + 1) +
        at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1) +
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1);
      const g = Math.hypot(gx, gy);
      out[y * w + x] = g;
      if (g > maxG) maxG = g;
    }
  }
  const inv = 1 / maxG;
  for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i]! * inv);
  return out;
}

function blur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const rad = Math.max(1, r | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0,
        n = 0;
      for (let k = -rad; k <= rad; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        s += src[y * w + xx]!;
        n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0,
        n = 0;
      for (let k = -rad; k <= rad; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        s += tmp[yy * w + x]!;
        n++;
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function percentileStretch(values: Float32Array, lo = 0.02, hi = 0.98) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const a = sorted[Math.floor(lo * (sorted.length - 1))] ?? 0;
  const b = sorted[Math.floor(hi * (sorted.length - 1))] ?? 1;
  const inv = 1 / Math.max(1e-6, b - a);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = clamp01((values[i]! - a) * inv);
  }
  return out;
}

export async function estimateDepth(
  imageSrc: string,
  engine: "heuristic" | "enhanced",
  options: {
    invert?: boolean;
    softFocus?: number;
    maxDim?: number;
    centerBias?: number;
  } = {},
): Promise<DepthMap> {
  const maxDim = options.maxDim ?? 512;
  const img = await loadImageElement(imageSrc);
  const { width, height, data } = imageToCanvas(img, maxDim);
  const lum = luminance(data, width, height);
  const grad = sobel(lum, width, height);

  let mean = 0;
  for (let i = 0; i < lum.length; i++) mean += lum[i]!;
  mean /= lum.length;

  const values = new Float32Array(width * height);
  const confidence = new Float32Array(width * height);

  if (engine === "heuristic") {
    const bias = options.centerBias ?? 0.28;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const nx = x / (width - 1 || 1) - 0.5;
        const ny = y / (height - 1 || 1) - 0.5;
        const radial = clamp01(1 - Math.hypot(nx, ny) * 1.8);
        let d = lum[i]! * 0.7 + (1 - Math.abs(lum[i]! - mean)) * 0.15 + radial * bias * 0.35;
        d += grad[i]! * 0.12;
        values[i] = clamp01(d);
        confidence[i] = clamp01(0.35 + grad[i]! * 0.55 + radial * 0.15);
      }
    }
  } else {
    const smoothed = blur(lum, width, height, Math.max(2, Math.round(Math.min(width, height) * 0.012)));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const adaptive = clamp01((lum[i]! - mean) * 1.35 + 0.5);
        const base = adaptive * 0.62 + lum[i]! * 0.38;
        let d = smoothed[i]! * 0.55 + base * 0.3 + grad[i]! * 0.15;
        d += grad[i]! * 0.08;
        values[i] = clamp01(d);
        confidence[i] = clamp01(0.28 + grad[i]! * 0.6 + Math.abs(lum[i]! - mean) * 0.25);
      }
    }
  }

  let depth = percentileStretch(values);
  if (options.invert) {
    for (let i = 0; i < depth.length; i++) depth[i] = 1 - depth[i]!;
  }
  if (options.softFocus && options.softFocus > 0) {
    const r = Math.max(1, Math.round(options.softFocus * 4));
    depth = blur(depth, width, height, r);
  }

  return { width, height, depth, confidence };
}
