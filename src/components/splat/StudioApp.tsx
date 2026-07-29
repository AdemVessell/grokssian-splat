import { useCallback, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Axis3d,
  Download,
  Grid3x3,
  ImagePlus,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { SplatViewport } from "./SplatViewport";
import { useSceneStore } from "@/stores/scene-store";
import {
  DEPTH_ENGINES,
  DEPTH_MODES,
  QUALITY_PRESETS,
  type DepthEngineId,
  type DepthMode,
  type QualityPreset,
} from "@/lib/splat/types";
import { cn } from "@/lib/utils";

export function StudioApp() {
  const layers = useSceneStore((s) => s.layers);
  const activeLayerId = useSceneStore((s) => s.activeLayerId);
  const status = useSceneStore((s) => s.status);
  const progress = useSceneStore((s) => s.progress);
  const bg = useSceneStore((s) => s.bg);
  const autoRotate = useSceneStore((s) => s.autoRotate);
  const showGrid = useSceneStore((s) => s.showGrid);
  const showAxes = useSceneStore((s) => s.showAxes);
  const defaultParams = useSceneStore((s) => s.defaultParams);

  const addImage = useSceneStore((s) => s.addImage);
  const runDemo = useSceneStore((s) => s.runDemo);
  const removeLayer = useSceneStore((s) => s.removeLayer);
  const setActiveLayer = useSceneStore((s) => s.setActiveLayer);
  const updateLayerParams = useSceneStore((s) => s.updateLayerParams);
  const regenerateLayer = useSceneStore((s) => s.regenerateLayer);
  const setDefaultParams = useSceneStore((s) => s.setDefaultParams);
  const setBg = useSceneStore((s) => s.setBg);
  const setAutoRotate = useSceneStore((s) => s.setAutoRotate);
  const setShowGrid = useSceneStore((s) => s.setShowGrid);
  const setShowAxes = useSceneStore((s) => s.setShowAxes);
  const exportActivePly = useSceneStore((s) => s.exportActivePly);

  const active = useMemo(
    () => layers.find((l) => l.id === activeLayerId) ?? null,
    [layers, activeLayerId],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!list.length) return;
      await addImage(list[0]!);
    },
    [addImage],
  );

  const params = active?.params ?? defaultParams;
  const patchParams = (patch: Partial<typeof defaultParams>) => {
    if (active) updateLayerParams(active.id, patch);
    else setDefaultParams(patch);
  };

  const busy = layers.some((l) => l.generating);
  const totalSplats = layers.reduce((n, l) => n + (l.cloud?.count ?? 0), 0);
  const isEmpty = layers.length === 0;

  return (
    <div
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) void onFiles(e.dataTransfer.files);
      }}
    >
      <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card">
            <Aperture className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">SplatForge</h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              SOTA single-image → 3D gaussian scenes
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-muted"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
            onClick={exportActivePly}
            disabled={!active?.cloud?.count}
          >
            <Download className="h-3.5 w-3.5" />
            PLY
          </button>
        </div>
      </header>

      {busy && (
        <div className="h-0.5 w-full bg-muted">
          <div
            className="h-full bg-foreground/70 transition-[width] duration-200"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
          />
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Layers */}
        <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-card lg:flex">
          <div className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Layers
          </div>
          <div className="space-y-2 p-3">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-sm font-medium text-background"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              Add image
            </button>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted"
              onClick={() => void runDemo()}
            >
              <Sparkles className="h-4 w-4" />
              Try demo
            </button>
          </div>
          <div className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
            {isEmpty && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                No layers yet
              </div>
            )}
            {layers.map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() => setActiveLayer(layer.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-colors",
                  layer.id === activeLayerId
                    ? "border-border bg-muted"
                    : "border-transparent hover:bg-muted/60",
                )}
              >
                <img
                  src={layer.thumbnail}
                  alt=""
                  className="h-11 w-11 rounded-lg border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{layer.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {layer.generating
                      ? "Generating…"
                      : `${(layer.cloud?.count ?? 0).toLocaleString()} pts`}
                  </p>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded p-1 hover:bg-background"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLayer(layer.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Viewport */}
        <main className="relative min-w-0 flex-1 bg-background">
          <SplatViewport />

          {isEmpty && !dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-border bg-card/95 px-6 py-8 text-center shadow-lg backdrop-blur-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted">
                  <Sparkles className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="mt-4 text-base font-semibold">SOTA Mode · image to space</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Enhanced depth, layered LDI, edge densify, metric unproject, anisotropic
                  gaussians. Drop a photo with clear foreground depth.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Upload image
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-muted"
                    onClick={() => void runDemo()}
                  >
                    <Sparkles className="h-4 w-4" />
                    Try demo
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3">
            {!isEmpty && (
              <div className="rounded-lg border border-border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm">
                <span className="font-mono text-foreground">{totalSplats.toLocaleString()}</span>{" "}
                splats · {params.quality} · {params.depthEngine}
              </div>
            )}
            <div className="pointer-events-auto ml-auto flex gap-1.5">
              <IconBtn active={autoRotate} onClick={() => setAutoRotate(!autoRotate)} label="Rotate">
                <RotateCcw className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn active={showGrid} onClick={() => setShowGrid(!showGrid)} label="Grid">
                <Grid3x3 className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn active={showAxes} onClick={() => setShowAxes(!showAxes)} label="Axes">
                <Axis3d className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
            <div className="rounded-full border border-border bg-card/90 px-4 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm">
              <span className="text-foreground/80">{status}</span>
              <span className="mx-1.5 text-border">·</span>
              Orbit · Zoom · Drop images
            </div>
          </div>

          {dragOver && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm">
              <div className="rounded-2xl border border-dashed border-border bg-card px-8 py-10 text-center">
                <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Drop image to create splats</p>
              </div>
            </div>
          )}
        </main>

        {/* Controls */}
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-card lg:flex">
          <div className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Fidelity
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            <Seg
              label="Quality"
              options={QUALITY_PRESETS.map((q) => ({ id: q.id, label: q.label }))}
              value={params.quality}
              onChange={(v) => {
                const q = v as QualityPreset;
                if (q === "sota") {
                  patchParams({
                    quality: q,
                    depthMode: "metric",
                    layeredDepth: true,
                    edgeDensify: true,
                    anisotropic: true,
                    sampleStep: 1,
                  });
                } else patchParams({ quality: q });
              }}
            />
            <Seg
              label="Depth engine"
              options={DEPTH_ENGINES.map((e) => ({ id: e.id, label: e.label }))}
              value={params.depthEngine}
              onChange={(v) => patchParams({ depthEngine: v as DepthEngineId })}
            />
            <Seg
              label="Project model"
              options={DEPTH_MODES.map((m) => ({ id: m.id, label: m.label }))}
              value={params.depthMode}
              onChange={(v) => patchParams({ depthMode: v as DepthMode })}
            />

            <Toggle
              label="Anisotropic"
              checked={params.anisotropic}
              onChange={(v) => patchParams({ anisotropic: v })}
            />
            <Toggle
              label="Layered depth (LDI)"
              checked={params.layeredDepth}
              onChange={(v) => patchParams({ layeredDepth: v })}
            />
            <Toggle
              label="Edge densify"
              checked={params.edgeDensify}
              onChange={(v) => patchParams({ edgeDensify: v })}
            />

            <SliderRow
              label="Splat size"
              value={params.splatSize}
              min={0.3}
              max={3}
              step={0.05}
              onChange={(v) => patchParams({ splatSize: v })}
            />
            <SliderRow
              label="Opacity"
              value={params.opacity}
              min={0.2}
              max={1}
              step={0.02}
              onChange={(v) => patchParams({ opacity: v })}
            />
            <SliderRow
              label="Depth scale"
              value={params.depthScale}
              min={0.3}
              max={3}
              step={0.05}
              onChange={(v) => patchParams({ depthScale: v })}
            />

            {active && (
              <button
                type="button"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-sm font-medium text-background disabled:opacity-50"
                disabled={active.generating}
                onClick={() => void regenerateLayer(active.id)}
              >
                {active.generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Rebuild splats
              </button>
            )}

            <div className="border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Scene
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {(["void", "studio", "dusk", "paper"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBg(id)}
                    className={cn(
                      "rounded-lg border px-1 py-2 text-[11px] capitalize",
                      bg === id
                        ? "border-border bg-muted font-medium"
                        : "border-transparent text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function IconBtn({
  children,
  active,
  onClick,
  label,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "rounded-lg border p-2 backdrop-blur-sm",
        active
          ? "border-border bg-secondary"
          : "border-border bg-card/90 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Seg<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-lg border px-2 py-2 text-[11px] font-medium",
              value === o.id
                ? "border-border bg-muted text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/50",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-10 rounded-full transition-colors",
          checked ? "bg-foreground" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-foreground"
      />
    </div>
  );
}
