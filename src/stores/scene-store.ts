import { create } from "zustand";
import {
  cloudToPly,
  createDemoImageDataUrl,
  generateSplatCloud,
} from "@/lib/splat/generate";
import { DEFAULT_PARAMS, type SplatLayer, type SplatParams } from "@/lib/splat/types";

function uid() {
  return `layer_${Math.random().toString(36).slice(2, 10)}`;
}

function makeThumbnail(dataUrl: string, size = 96): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d")!;
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(c.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export type BgPreset = "void" | "studio" | "dusk" | "paper";

interface SceneState {
  layers: SplatLayer[];
  activeLayerId: string | null;
  bg: BgPreset;
  autoRotate: boolean;
  showGrid: boolean;
  showAxes: boolean;
  status: string;
  progress: number;
  defaultParams: SplatParams;
  setDefaultParams: (patch: Partial<SplatParams>) => void;
  addImage: (file: File | string, name?: string) => Promise<void>;
  runDemo: () => Promise<void>;
  removeLayer: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  updateLayerParams: (id: string, patch: Partial<SplatParams>) => void;
  updateLayerTransform: (
    id: string,
    patch: Partial<Pick<SplatLayer, "position" | "rotation" | "scale" | "visible" | "name">>,
  ) => void;
  regenerateLayer: (id: string) => Promise<void>;
  setBg: (bg: BgPreset) => void;
  setAutoRotate: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  setShowAxes: (v: boolean) => void;
  exportActivePly: () => void;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  layers: [],
  activeLayerId: null,
  bg: "void",
  autoRotate: true,
  showGrid: false,
  showAxes: false,
  status: "Drop an image to begin",
  progress: 0,
  defaultParams: { ...DEFAULT_PARAMS },

  setDefaultParams: (patch) =>
    set((s) => ({ defaultParams: { ...s.defaultParams, ...patch } })),

  addImage: async (file, name) => {
    set({ status: "Reading image…", progress: 0.05 });
    let dataUrl: string;
    let layerName: string;
    if (typeof file === "string") {
      dataUrl = file;
      layerName = name ?? "Image";
    } else {
      dataUrl = await fileToDataUrl(file);
      layerName = name ?? file.name.replace(/\.[^.]+$/, "") || "Image";
    }
    const params = { ...get().defaultParams };
    const thumbnail = await makeThumbnail(dataUrl);
    const id = uid();
    const layer: SplatLayer = {
      id,
      name: layerName,
      imageDataUrl: dataUrl,
      thumbnail,
      sourceImages: [dataUrl],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      visible: true,
      params,
      cloud: null,
      generating: true,
    };
    set((s) => ({
      layers: [...s.layers, layer],
      activeLayerId: id,
      status: "Generating gaussian splats…",
      progress: 0.1,
    }));
    try {
      const cloud = await generateSplatCloud(dataUrl, params, {
        onProgress: (p, msg) => set({ progress: p, status: msg }),
      });
      set((s) => ({
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, cloud, generating: false } : l,
        ),
        status: `${cloud.count.toLocaleString()} splats · ${layerName}`,
        progress: 1,
      }));
    } catch (e) {
      console.error(e);
      set((s) => ({
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, generating: false } : l,
        ),
        status: "Generation failed",
        progress: 0,
      }));
    }
  },

  runDemo: async () => {
    const dataUrl = createDemoImageDataUrl();
    await get().addImage(dataUrl, "SOTA demo room");
  },

  removeLayer: (id) => {
    set((s) => {
      const layers = s.layers.filter((l) => l.id !== id);
      return {
        layers,
        activeLayerId:
          s.activeLayerId === id ? (layers[0]?.id ?? null) : s.activeLayerId,
        status: layers.length ? s.status : "Drop an image to begin",
        progress: 0,
      };
    });
  },

  setActiveLayer: (id) => set({ activeLayerId: id }),

  updateLayerParams: (id, patch) => {
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, params: { ...l.params, ...patch } } : l,
      ),
    }));
  },

  updateLayerTransform: (id, patch) => {
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    }));
  },

  regenerateLayer: async (id) => {
    const layer = get().layers.find((l) => l.id === id);
    if (!layer) return;
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, generating: true } : l)),
      status: "Regenerating splats…",
      progress: 0.05,
    }));
    try {
      const cloud = await generateSplatCloud(layer.imageDataUrl, layer.params, {
        onProgress: (p, msg) => set({ progress: p, status: msg }),
      });
      set((s) => ({
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, cloud, generating: false } : l,
        ),
        status: `${cloud.count.toLocaleString()} splats · ${layer.name}`,
        progress: 1,
      }));
    } catch (e) {
      console.error(e);
      set((s) => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, generating: false } : l)),
        status: "Generation failed",
        progress: 0,
      }));
    }
  },

  setBg: (bg) => set({ bg }),
  setAutoRotate: (v) => set({ autoRotate: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowAxes: (v) => set({ showAxes: v }),

  exportActivePly: () => {
    const { layers, activeLayerId } = get();
    const layer = layers.find((l) => l.id === activeLayerId);
    if (!layer?.cloud || layer.cloud.count === 0) return;
    const ply = cloudToPly(layer.cloud, layer.name);
    const blob = new Blob([ply], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${layer.name.replace(/\s+/g, "_").toLowerCase()}.ply`;
    a.click();
    URL.revokeObjectURL(url);
    set({ status: `Exported ${layer.name}.ply` });
  },
}));
