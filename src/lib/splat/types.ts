export type DepthEngineId = "heuristic" | "enhanced";
export type QualityPreset = "draft" | "balanced" | "ultra" | "sota";
export type DepthMode =
  | "relief"
  | "portrait"
  | "sphere"
  | "panorama"
  | "flat"
  | "metric";

export interface SplatParams {
  sampleStep: number;
  depthMode: DepthMode;
  depthEngine: DepthEngineId;
  depthScale: number;
  splatSize: number;
  opacity: number;
  alphaThreshold: number;
  invertDepth: boolean;
  colorBoost: number;
  softFocus: number;
  anisotropic: boolean;
  normalStrength: number;
  confidenceCull: number;
  fovDeg: number;
  quality: QualityPreset;
  layeredDepth: boolean;
  edgeDensify: boolean;
}

export interface DepthMap {
  width: number;
  height: number;
  depth: Float32Array;
  confidence: Float32Array;
}

export interface SplatCloud {
  positions: Float32Array;
  colors: Float32Array;
  scales: Float32Array;
  normals: Float32Array;
  opacities: Float32Array;
  confidences: Float32Array;
  count: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export interface SplatLayer {
  id: string;
  name: string;
  imageDataUrl: string;
  thumbnail: string;
  sourceImages?: string[];
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  visible: boolean;
  params: SplatParams;
  cloud: SplatCloud | null;
  generating: boolean;
}

export const DEFAULT_PARAMS: SplatParams = {
  // Highest visual fidelity out of the box — tuned for portraits & detailed scenes.
  // Tighter splat size preserves fine edges/texture; denser SOTA budget + LDI + edges.
  sampleStep: 1,
  depthMode: "metric",
  depthEngine: "enhanced",
  depthScale: 1.25,
  splatSize: 1.05,
  opacity: 0.92,
  alphaThreshold: 6,
  invertDepth: false,
  colorBoost: 1.08,
  softFocus: 0.08,
  anisotropic: true,
  normalStrength: 1.2,
  confidenceCull: 0.012,
  fovDeg: 50,
  quality: "sota",
  layeredDepth: true,
  edgeDensify: true,
};

export const DEPTH_MODES: { id: DepthMode; label: string; hint: string }[] = [
  { id: "metric", label: "Metric", hint: "True camera unproject" },
  { id: "relief", label: "Relief", hint: "Depth-driven extrusion" },
  { id: "portrait", label: "Portrait", hint: "Subject pop with center bias" },
  { id: "sphere", label: "Sphere", hint: "Wrap onto a sphere" },
  { id: "panorama", label: "Panorama", hint: "Cylindrical wrap" },
  { id: "flat", label: "Flat", hint: "Billboard plane" },
];

export const DEPTH_ENGINES: {
  id: DepthEngineId;
  label: string;
  hint: string;
}[] = [
  { id: "heuristic", label: "Heuristic", hint: "Fast luminance + edges" },
  { id: "enhanced", label: "Enhanced", hint: "Multi-scale structure depth" },
];

export const QUALITY_PRESETS: {
  id: QualityPreset;
  label: string;
  hint: string;
}[] = [
  { id: "draft", label: "Draft", hint: "Sparse · instant" },
  { id: "balanced", label: "Balanced", hint: "Speed / quality mix" },
  { id: "ultra", label: "Ultra", hint: "Dense anisotropic" },
  { id: "sota", label: "SOTA", hint: "LDI + edge densify + metric" },
];
