function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

export function computeDepthGradient(
  depth: Float32Array,
  w: number,
  h: number,
): Float32Array {
  const out = new Float32Array(w * h);
  const at = (x: number, y: number) => {
    const xx = Math.min(w - 1, Math.max(0, x));
    const yy = Math.min(h - 1, Math.max(0, y));
    return depth[yy * w + xx] ?? 0.5;
  };
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
  for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i]! * inv * 1.35);
  return out;
}

export function refineConfidenceWithGradient(
  confidence: Float32Array,
  gradient: Float32Array,
): Float32Array {
  const out = new Float32Array(confidence.length);
  for (let i = 0; i < out.length; i++) {
    const c = confidence[i] ?? 0.5;
    const g = gradient[i] ?? 0;
    out[i] = clamp01(c * 0.72 + g * 0.35 + 0.08);
  }
  return out;
}

export function adaptiveStepAt(
  gradient: number,
  baseStep: number,
  edgeDensify: boolean,
): number {
  if (!edgeDensify) return Math.max(1, baseStep);
  if (gradient > 0.45) return 1;
  if (gradient > 0.25) return Math.max(1, Math.min(baseStep, 2));
  return Math.max(baseStep, 3);
}

export function shouldEmitLayer(
  gradient: number,
  depth: number,
  conf: number,
  layered: boolean,
): boolean {
  if (!layered) return false;
  if (gradient < 0.38) return false;
  if (conf < 0.12) return false;
  if (depth < 0.06 || depth > 0.98) return false;
  return true;
}

export function layeredDepthOffset(depth: number, gradient: number): number {
  return clamp01(depth - (0.04 + gradient * 0.1));
}

export function localColorStructure(
  color: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  const lum = (ix: number, iy: number) => {
    const xx = Math.min(w - 1, Math.max(0, ix));
    const yy = Math.min(h - 1, Math.max(0, iy));
    const i = (yy * w + xx) * 4;
    return (0.2126 * color[i]! + 0.7152 * color[i + 1]! + 0.0722 * color[i + 2]!) / 255;
  };
  const c = lum(x, y);
  let acc = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const d = lum(x + dx, y + dy) - c;
      acc += d * d;
    }
  }
  return clamp01(Math.sqrt(acc) * 3.2);
}
