import type { SplatCloud } from "./types";

/** Center cloud at origin and scale so max span ≈ targetExtent. */
export function normalizeCloud(
  cloud: SplatCloud,
  targetExtent = 2.65,
): SplatCloud {
  if (cloud.count === 0) return cloud;
  const { min, max } = cloud.bounds;
  const cx = (min[0] + max[0]) * 0.5;
  const cy = (min[1] + max[1]) * 0.5;
  const cz = (min[2] + max[2]) * 0.5;
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  const s = targetExtent / span;

  const positions = new Float32Array(cloud.count * 3);
  const scales = new Float32Array(cloud.count * 3);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < cloud.count; i++) {
    const o = i * 3;
    const x = (cloud.positions[o]! - cx) * s;
    const y = (cloud.positions[o + 1]! - cy) * s;
    const z = (cloud.positions[o + 2]! - cz) * s;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    scales[o] = cloud.scales[o]! * s;
    scales[o + 1] = cloud.scales[o + 1]! * s;
    scales[o + 2] = cloud.scales[o + 2]! * s;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    ...cloud,
    positions,
    scales,
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}
