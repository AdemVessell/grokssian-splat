function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** Pinhole unproject. depth01 higher = nearer. Mid depth centered at origin. */
export function unprojectPixel(
  nx: number,
  ny: number,
  depth01: number,
  fovDeg: number,
  aspect: number,
  depthScale: number,
): [number, number, number] {
  const fov = (Math.max(1, fovDeg) * Math.PI) / 180;
  const tanHalf = Math.tan(fov * 0.5);
  const ds = Math.max(0.05, depthScale);
  const near = 0.85 * ds;
  const far = 2.55 * ds;
  const zCam = near + (1 - clamp01(depth01)) * (far - near);
  const ndcX = (nx - 0.5) * 2;
  const ndcY = (0.5 - ny) * 2;
  const x = ndcX * aspect * tanHalf * zCam * 0.92;
  const y = ndcY * tanHalf * zCam * 0.92;
  const z = zCam - (near + far) * 0.5;
  return [x, y, z];
}

export function estimateNormalFromDepth(
  depth: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  fovDeg: number,
  aspect: number,
  depthScale: number,
): [number, number, number] {
  const sample = (ix: number, iy: number) => {
    const xx = Math.min(w - 1, Math.max(0, Math.round(ix)));
    const yy = Math.min(h - 1, Math.max(0, Math.round(iy)));
    return depth[yy * w + xx] ?? 0.5;
  };
  const unp = (ix: number, iy: number) => {
    const u = ix / (w - 1 || 1);
    const v = iy / (h - 1 || 1);
    return unprojectPixel(u, v, sample(ix, iy), fovDeg, aspect, depthScale);
  };
  const p = unp(x, y);
  const px1 = unp(Math.min(w - 1, x + 1), y);
  const mx1 = unp(Math.max(0, x - 1), y);
  const py1 = unp(x, Math.min(h - 1, y + 1));
  const my1 = unp(x, Math.max(0, y - 1));
  const dx: [number, number, number] = [px1[0] - mx1[0], px1[1] - mx1[1], px1[2] - mx1[2]];
  const dy: [number, number, number] = [py1[0] - my1[0], py1[1] - my1[1], py1[2] - my1[2]];
  let nx = dx[1] * dy[2] - dx[2] * dy[1];
  let ny = dx[2] * dy[0] - dx[0] * dy[2];
  let nz = dx[0] * dy[1] - dx[1] * dy[0];
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-8) return [0, 0, 1];
  nx /= len;
  ny /= len;
  nz /= len;
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return [nx, ny, nz];
}

export function anisotropicScalesFromNormalAndDepth(
  normal: [number, number, number],
  depth01: number,
  sampleStep: number,
  baseSize: number,
  depthScale: number,
  gradient = 0,
): [number, number, number] {
  const d = clamp01(depth01);
  const depthFactor = 0.7 + (1 - d) * 0.4 + d * 0.2;
  const stepFactor = Math.max(0.55, sampleStep) * 0.85;
  let plane = Math.max(
    0.08,
    baseSize * stepFactor * depthFactor * Math.max(0.55, depthScale * 0.7),
  );
  if (gradient > 0.3) plane *= 0.82 + (1 - gradient) * 0.15;
  const facing = Math.abs(normal[2]);
  const stretch = 1 + (1 - facing) * 0.55;
  const sx = plane * stretch;
  const sy = plane * (0.9 + facing * 0.1) * stretch;
  const sz = plane * (0.16 + facing * 0.1);
  return [sx, sy, sz];
}

export function projectPoint(
  mode: string,
  nx: number,
  ny: number,
  depth: number,
  depthScale: number,
  aspect: number,
  fovDeg = 60,
): [number, number, number] {
  if (mode === "metric") {
    return unprojectPixel(nx, ny, depth, fovDeg, aspect, depthScale);
  }
  const x = (nx - 0.5) * 2 * aspect;
  const y = (0.5 - ny) * 2;
  switch (mode) {
    case "flat":
      return [x, y, 0];
    case "portrait": {
      const cx = nx - 0.5;
      const cy = ny - 0.5;
      const r = Math.sqrt(cx * cx + cy * cy);
      const radial = clamp01(1 - r * 1.85);
      const d = clamp01(depth * 0.75 + radial * 0.25);
      return [x, y, (d - 0.5) * 2 * depthScale];
    }
    case "sphere": {
      const cx = (nx - 0.5) * 2;
      const cy = (ny - 0.5) * 2;
      const rr = cx * cx + cy * cy;
      if (rr > 1.02) return [x, y, -depthScale];
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, rr)));
      const r = 1 + (depth - 0.5) * 0.25 * depthScale;
      return [cx * r * aspect, -cy * r, z * r * depthScale];
    }
    case "panorama": {
      const theta = (nx - 0.5) * Math.PI * 1.6;
      const radius = 1.1 + (depth - 0.5) * depthScale * 0.55;
      return [Math.sin(theta) * radius, y, Math.cos(theta) * radius];
    }
    case "relief":
    default:
      return [x, y, (depth - 0.5) * 2 * depthScale];
  }
}
