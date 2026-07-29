import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";
import * as THREE from "three";
import { GaussianSplatCloud } from "./GaussianSplatCloud";
import { useSceneStore, type BgPreset } from "@/stores/scene-store";

const BG: Record<BgPreset, string> = {
  void: "#0a0a0b",
  studio: "#16161a",
  dusk: "#121018",
  paper: "#e8e6e1",
};

function FitCamera() {
  const layers = useSceneStore((s) => s.layers);
  const { camera, controls } = useThree();
  const key = useMemo(
    () =>
      layers
        .filter((l) => l.visible && l.cloud && l.cloud.count > 0)
        .map((l) => `${l.id}:${l.cloud!.count}`)
        .join("|"),
    [layers],
  );

  useEffect(() => {
    if (!key) return;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    let any = false;
    for (const layer of layers) {
      if (!layer.visible || !layer.cloud || layer.cloud.count === 0) continue;
      any = true;
      const b = layer.cloud.bounds;
      minX = Math.min(minX, b.min[0]);
      minY = Math.min(minY, b.min[1]);
      minZ = Math.min(minZ, b.min[2]);
      maxX = Math.max(maxX, b.max[0]);
      maxY = Math.max(maxY, b.max[1]);
      maxZ = Math.max(maxZ, b.max[2]);
    }
    if (!any) return;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const radius =
      Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.5) * 0.6;
    const dist = Math.max(2.2, radius * 2.4);
    camera.position.set(cx, cy + radius * 0.15, cz + dist);
    camera.near = 0.05;
    camera.far = 100;
    camera.updateProjectionMatrix();
    const ctrl = controls as { target?: THREE.Vector3; update?: () => void } | null;
    if (ctrl?.target) {
      ctrl.target.set(cx, cy, cz);
      ctrl.update?.();
    }
  }, [key, camera, controls, layers]);

  return null;
}

function SceneContents() {
  const layers = useSceneStore((s) => s.layers);
  const bg = useSceneStore((s) => s.bg);
  const showGrid = useSceneStore((s) => s.showGrid);
  const showAxes = useSceneStore((s) => s.showAxes);
  const autoRotate = useSceneStore((s) => s.autoRotate);
  const { scene } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(BG[bg]);
  }, [bg, scene]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 3]} intensity={0.4} />
      {layers.map((layer) =>
        layer.visible && layer.cloud ? (
          <GaussianSplatCloud
            key={`${layer.id}-${layer.cloud.count}`}
            cloud={layer.cloud}
            params={layer.params}
            position={layer.position}
            rotation={layer.rotation}
            scale={layer.scale}
          />
        ) : null,
      )}
      {showGrid && (
        <Grid
          args={[20, 20]}
          cellSize={0.5}
          cellThickness={0.6}
          cellColor="#2a2a30"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#3a3a44"
          fadeDistance={18}
          infiniteGrid
          position={[0, -1.4, 0]}
        />
      )}
      {showAxes && (
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#c4c4cc", "#a0a0aa", "#8a8a96"]} labelColor="#f4f4f5" />
        </GizmoHelper>
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.06}
        autoRotate={autoRotate}
        autoRotateSpeed={0.55}
        minDistance={0.6}
        maxDistance={18}
      />
      <FitCamera />
    </>
  );
}

export function SplatViewport() {
  const bg = useSceneStore((s) => s.bg);
  return (
    <div className="absolute inset-0 touch-none">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.35, 3.2], fov: 50, near: 0.05, far: 100 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color(BG[bg]), 1);
        }}
      >
        <SceneContents />
      </Canvas>
    </div>
  );
}
