import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { SplatCloud, SplatParams } from "@/lib/splat/types";
import { fragmentShader, vertexShader } from "@/lib/splat/shaders";

interface Props {
  cloud: SplatCloud;
  params: SplatParams;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

export function GaussianSplatCloud({
  cloud,
  params,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: Props) {
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    if (cloud.count === 0) {
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
      return geo;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(cloud.positions.slice(0, cloud.count * 3), 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(cloud.colors.slice(0, cloud.count * 3), 3));
    geo.setAttribute("aScale", new THREE.BufferAttribute(cloud.scales.slice(0, cloud.count * 3), 3));
    geo.setAttribute("aNormal", new THREE.BufferAttribute(cloud.normals.slice(0, cloud.count * 3), 3));
    geo.setAttribute("aOpacity", new THREE.BufferAttribute(cloud.opacities.slice(0, cloud.count), 1));
    geo.setAttribute("aConfidence", new THREE.BufferAttribute(cloud.confidences.slice(0, cloud.count), 1));
    geo.computeBoundingSphere();
    return geo;
  }, [cloud]);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uSize: { value: params.splatSize },
        uOpacity: { value: params.opacity },
        uPixelRatio: {
          value: typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.75) : 1,
        },
        uConfidenceCull: { value: params.confidenceCull },
      },
    });
    materialRef.current = mat;
    return mat;
  }, [cloud]);

  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.uniforms.uSize!.value = params.splatSize;
    mat.uniforms.uOpacity!.value = params.opacity;
    mat.uniforms.uConfidenceCull!.value = params.confidenceCull;
  }, [params.splatSize, params.opacity, params.confidenceCull]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  if (cloud.count === 0) return null;

  return (
    <points
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
      scale={scale}
      frustumCulled={false}
    />
  );
}
