/**
 * Tunnel render module (spec 13.3): a dark disc plus a glowing torus ring
 * in the pair color (`#b06cff`, `#2ec4b6`, `#ff6fb5`). Both ends of a pair
 * share the color, derived deterministically from the pair's lower cell.
 *
 * Rev. 6 (spec 17.4): at high/medium the disc becomes the additive
 * `FxPortal` swirl in the pair color.
 */
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { cachedMaterial, CELL_TOP } from './common.js';
import { registerFxShaders, meshUniformNames } from '../fx/shaders.js';
import { fxWarnOnce } from '../fx/fxLog.js';

/** Pair colors from the spec table, cycled by the pair key. */
export const TUNNEL_COLORS = ['#b06cff', '#2ec4b6', '#ff6fb5'];

/**
 * @param {number} pairKey min cell index of the pair
 * @returns {string} hex color
 */
export function tunnelColor(pairKey) {
  return TUNNEL_COLORS[Math.abs(pairKey | 0) % TUNNEL_COLORS.length];
}

/** scene → (hex → portal material) cache. */
const portalCache = new WeakMap();

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {string} hex
 * @returns {ShaderMaterial}
 */
function portalMaterial(scene, hex) {
  let perScene = portalCache.get(scene);
  if (!perScene) {
    perScene = new Map();
    portalCache.set(scene, perScene);
    registerFxShaders(Effect);
    scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (const mat of perScene.values()) mat.setFloat('time', t);
    });
  }
  let mat = perScene.get(hex);
  if (!mat) {
    mat = new ShaderMaterial(
      `gimPortal-${hex}`,
      scene,
      { vertex: 'FxPortal', fragment: 'FxPortal' },
      { uniforms: meshUniformNames('portal') },
    );
    mat.setFloat('time', 0);
    const c = Color3.FromHexString(hex);
    mat.setVector3('tint', c.toVector3());
    mat.alphaMode = Engine.ALPHA_ADD;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    perScene.set(hex, mat);
  }
  return mat;
}

/** @type {Map<number, import('@babylonjs/core/Meshes/mesh.js').Mesh[]>} */
const deco = new Map();

export default {
  id: 'tunnel',
  build(scene, i, state, ctx) {
    const p = ctx.cellPos(i);
    const partner = state.g.partner[i];
    const hex = tunnelColor(Math.min(i, partner >= 0 ? partner : i));

    const disc = CreateCylinder(`tunnelDisc-${i}`, { diameter: 1.5, height: 0.06, tessellation: 24 }, scene);
    disc.position.set(p.x, CELL_TOP + 0.03, p.z);
    // Fail-soft (task 26): a broken portal shader falls back to the
    // dark disc look.
    let discMat = null;
    if (ctx.tileShader) {
      try {
        discMat = portalMaterial(scene, hex);
      } catch (err) {
        fxWarnOnce('tunnel.portal', err);
        discMat = null;
      }
    }
    disc.material = discMat || cachedMaterial(scene, 'gimTunnelDisc', '#26303c');
    disc.isPickable = false;

    const ring = CreateTorus(`tunnelRing-${i}`, { diameter: 1.35, thickness: 0.12, tessellation: 24 }, scene);
    ring.position.set(p.x, CELL_TOP + 0.08, p.z);
    ring.material = cachedMaterial(scene, `gimTunnelRing-${hex}`, hex, { emissive: 0.55 });
    ring.isPickable = false;

    deco.set(i, [disc, ring]);
  },

  dispose(i) {
    const meshes = deco.get(i);
    if (!meshes) return;
    for (const m of meshes) m.dispose();
    deco.delete(i);
  },
};
