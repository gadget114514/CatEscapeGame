/**
 * GLSL sources for the Rev. 6 fx (spec 17.4), kept as plain JS strings so
 * the CSP stays intact (no eval, no external files). This module is pure
 * (no Babylon import) so the sources are unit-testable on Node; the
 * render modules copy them into `Effect.ShadersStore` / `ShaderMaterial`.
 *
 * Shaders: `FxTile` (grass gradient + rim + exit/highlight/hover pulses +
 * move ripple), `FxIce` (fresnel + moving specular streak), `FxPortal`
 * (polar-UV swirl for tunnel ends), `FxShockwave` (radial distortion
 * post) and `FxDesat` (desaturation post for the trapped moment).
 */

/** ShaderStore name prefixes. */
export const SHADER_NAMES = ['FxTile', 'FxIce', 'FxPortal', 'FxShockwave', 'FxDesat'];

/** Shared vertex shader: world position, world normal and UV varyings. */
export const MESH_VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUV;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(world) * normal);
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

/** Tile shader fragment (spec 17.4). */
export const TILE_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUV;
uniform float time;
uniform vec3 baseColor;
uniform float highlight;
uniform float hover;
uniform float isExit;
uniform float cellSeed;
uniform vec2 rippleOrigin;
uniform float rippleTime;
uniform vec3 cameraPosition;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float up = clamp(n.y, 0.0, 1.0);
  float grad = mix(0.84, 1.1, clamp((vWorldPos.y + 0.15) / 0.45, 0.0, 1.0));
  float noise = (hash(cellSeed) - 0.5) * 0.07
    + (hash(cellSeed * 3.7 + floor(vUV.x * 6.0)) - 0.5) * 0.035;
  vec3 col = baseColor * (grad + noise);
  col = mix(baseColor * 0.86, col, up * 0.55 + 0.45);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.5);
  col += vec3(0.55, 0.75, 0.95) * fres * 0.16;
  float breath = 0.15 + 0.2 * (0.5 + 0.5 * sin(time * 5.2 + cellSeed));
  col += vec3(0.25, 0.7, 0.95) * highlight * breath;
  col += vec3(1.0, 0.85, 0.35) * hover * (0.2 + 0.1 * sin(time * 6.0));
  float exitPulse = isExit * (0.1 + 0.08 * sin(time * 2.2 + cellSeed));
  col += vec3(0.4, 0.95, 0.85) * exitPulse;
  float dist = length(vWorldPos.xz - rippleOrigin);
  float ring = exp(-abs(dist - rippleTime * 6.0) * 2.2) * max(0.0, 1.0 - rippleTime);
  col += vec3(0.4, 0.85, 1.0) * ring * 0.45;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Ice fragment: fresnel rim + a specular streak sliding over the cell. */
export const ICE_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUV;
uniform float time;
uniform vec3 baseColor;
uniform vec3 cameraPosition;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vWorldPos);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);
  float wave = sin(vWorldPos.x * 3.2 + vWorldPos.z * 2.1 + time * 1.6) * 0.5 + 0.5;
  float streak = smoothstep(0.9, 1.0, wave);
  vec3 col = baseColor * (0.88 + fres * 0.5) + vec3(1.0) * streak * 0.3;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Tunnel portal fragment: polar-UV swirl in the pair color, additive. */
export const PORTAL_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying vec2 vUV;
uniform float time;
uniform vec3 tint;

void main() {
  vec2 p = vUV - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float swirl = sin(a * 3.0 + time * 4.0 - r * 7.0) * 0.5 + 0.5;
  float alpha = smoothstep(1.0, 0.15, r) * (0.3 + 0.45 * swirl);
  gl_FragColor = vec4(tint * (0.55 + swirl * 0.8), alpha);
}
`;

/** Shockwave post-process fragment (radial distortion ring). */
export const SHOCKWAVE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float time;
uniform vec2 center;
uniform float strength;

void main() {
  vec2 d = vUV - center;
  float dist = length(d);
  float band = exp(-pow((dist - time) / 0.09, 2.0));
  vec2 dir = dist > 0.0001 ? d / dist : vec2(0.0);
  vec2 offset = dir * band * strength * 0.035 * (1.0 - time);
  gl_FragColor = texture2D(textureSampler, vUV + offset);
}
`;

/** Desaturation post-process fragment (trapped moment, spec 17.2). */
export const DESAT_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float amount;

void main() {
  vec4 c = texture2D(textureSampler, vUV);
  float g = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(mix(c.rgb, vec3(g), amount), c.a);
}
`;

/**
 * Copy every fx shader into `Effect.ShadersStore` (idempotent). Takes the
 * `Effect` class as an argument so this module stays Babylon-free.
 * @param {{ShadersStore: Record<string, string>}} Effect
 */
export function registerFxShaders(Effect) {
  const store = Effect.ShadersStore;
  store.FxTileVertexShader = MESH_VERTEX_SHADER;
  store.FxTileFragmentShader = TILE_FRAGMENT_SHADER;
  store.FxIceVertexShader = MESH_VERTEX_SHADER;
  store.FxIceFragmentShader = ICE_FRAGMENT_SHADER;
  store.FxPortalVertexShader = MESH_VERTEX_SHADER;
  store.FxPortalFragmentShader = PORTAL_FRAGMENT_SHADER;
  store.FxShockwavePixelShader = SHOCKWAVE_FRAGMENT_SHADER;
  store.FxDesatPixelShader = DESAT_FRAGMENT_SHADER;
}

/**
 * The uniform list a `ShaderMaterial` needs for one of the mesh shaders.
 * @param {'tile'|'ice'|'portal'} kind
 * @returns {string[]}
 */
export function meshUniformNames(kind) {
  if (kind === 'tile') {
    return [
      'world',
      'worldViewProjection',
      'cameraPosition',
      'time',
      'baseColor',
      'highlight',
      'hover',
      'isExit',
      'cellSeed',
      'rippleOrigin',
      'rippleTime',
    ];
  }
  if (kind === 'ice') return ['world', 'worldViewProjection', 'cameraPosition', 'time', 'baseColor'];
  return ['world', 'worldViewProjection', 'time', 'tint'];
}
