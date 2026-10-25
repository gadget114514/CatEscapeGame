/**
 * Ice render module (spec 13.3): pale blue `#bfe9ff`, glossy. The cell
 * material changes; a block on ice still shows as a normal block.
 *
 * Rev. 6 (spec 17.4): at high/medium the cell uses the `FxIce` shader
 * (fresnel rim + a moving specular streak); `low` keeps the glossy
 * StandardMaterial.
 */
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { cachedMaterial } from './common.js';
import { registerFxShaders, meshUniformNames } from '../fx/shaders.js';
import { fxWarnOnce } from '../fx/fxLog.js';

/** scene → the shared FxIce material (one per scene). */
const shaderCache = new WeakMap();

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @returns {ShaderMaterial}
 */
function iceShaderMaterial(scene) {
  let mat = shaderCache.get(scene);
  if (!mat) {
    registerFxShaders(Effect);
    mat = new ShaderMaterial(
      'gimIceFx',
      scene,
      { vertex: 'FxIce', fragment: 'FxIce' },
      { uniforms: meshUniformNames('ice') },
    );
    mat.setFloat('time', 0);
    mat.setVector3('baseColor', Color3.FromHexString('#bfe9ff').toVector3());
    mat.backFaceCulling = false;
    shaderCache.set(scene, mat);
    // one observer per scene keeps the streak moving
    scene.onBeforeRenderObservable.add(() => {
      mat.setFloat('time', performance.now() / 1000);
    });
  }
  return mat;
}

export default {
  id: 'ice',
  build(scene, i, _state, ctx) {
    // Fail-soft (task 26): a broken shader falls back to the glossy
    // StandardMaterial look.
    if (ctx.tileShader) {
      try {
        ctx.setCellStyle(i, { material: iceShaderMaterial(scene) });
        return;
      } catch (err) {
        fxWarnOnce('ice.shader', err);
      }
    }
    ctx.setCellStyle(i, {
      material: cachedMaterial(scene, 'gimIce', '#bfe9ff', { gloss: true, emissive: 0.2 }),
    });
  },
  dispose() {},
};
