export const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute vec3 aScale;
  attribute vec3 aNormal;
  attribute float aOpacity;
  attribute float aConfidence;

  varying vec3 vColor;
  varying float vAlpha;

  uniform float uSize;
  uniform float uOpacity;
  uniform float uPixelRatio;
  uniform float uConfidenceCull;

  void main() {
    if (aConfidence < uConfidenceCull) {
      vColor = vec3(0.0);
      vAlpha = 0.0;
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(0.35, -mvPosition.z);

    vec3 nView = normalize(normalMatrix * aNormal);
    vec3 viewDir = normalize(-mvPosition.xyz);
    float ndotv = max(0.0, dot(nView, viewDir));

    vColor = aColor * (0.82 + 0.28 * ndotv);
    vAlpha = aOpacity * uOpacity * mix(0.9, 1.0, aConfidence);

    float sx = max(aScale.x, 0.02);
    float sy = max(aScale.y, 0.02);
    float sz = max(aScale.z, 0.02);
    float avgScale = (sx + sy + sz) * (1.0 / 3.0);

    gl_PointSize = clamp(avgScale * uSize * uPixelRatio * (160.0 / dist), 1.5, 64.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float q = dot(c, c);
    float g = exp(-q * 9.5);
    float alpha = g * vAlpha;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;
