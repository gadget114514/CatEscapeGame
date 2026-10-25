/**
 * Spring render module (spec 13.3): a coil (stacked tori) with a red pad
 * on top. Entering it in `dir` flings the cat two cells further on.
 *
 * Rev. 6 (spec 17.3): `onEnter` squashes the coil when the cat lands on
 * it (called by the view's path animation).
 */
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import '@babylonjs/core/Animations/animatable.js'; // side effect: beginAnimation support
import { cachedMaterial, CELL_TOP } from './common.js';
import { fxWarnOnce } from '../fx/fxLog.js';

/** @type {Map<number, import('@babylonjs/core/Meshes/mesh.js').Mesh[]>} */
const deco = new Map();

const ANIM_FPS = 60;
const SQUASH_FRAMES = 12; // ~200 ms squash + release

export default {
  id: 'spring',
  build(scene, i, _state, ctx) {
    const p = ctx.cellPos(i);
    const coilMat = cachedMaterial(scene, 'gimSpringCoil', '#b0b8c0');
    const meshes = [];
    for (let k = 0; k < 3; k++) {
      const coil = CreateTorus(
        `springCoil-${i}-${k}`,
        { diameter: 0.8 - k * 0.12, thickness: 0.09, tessellation: 16 },
        scene,
      );
      coil.position.set(p.x, CELL_TOP + 0.08 + k * 0.11, p.z);
      coil.material = coilMat;
      coil.isPickable = false;
      meshes.push(coil);
    }
    const pad = CreateCylinder(`springPad-${i}`, { diameter: 0.62, height: 0.1, tessellation: 16 }, scene);
    pad.position.set(p.x, CELL_TOP + 0.44, p.z);
    pad.material = cachedMaterial(scene, 'gimSpringPad', '#e05545', { emissive: 0.25 });
    pad.isPickable = false;
    meshes.push(pad);
    deco.set(i, meshes);
  },

  /**
   * Rev. 6: squash the coil down and let it spring back (spec 17.3).
   * @param {number} i
   */
  onEnter(i) {
    const meshes = deco.get(i);
    if (!meshes || meshes.length === 0) return;
    const pad = meshes[meshes.length - 1];
    const scene = pad.getScene();
    const y0 = pad.position.y;
    Animation.CreateAndStartAnimation(
      `springSquash-${i}`,
      pad,
      'position.y',
      ANIM_FPS,
      SQUASH_FRAMES,
      y0,
      y0 - 0.18,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
      undefined,
      () => {
        Animation.CreateAndStartAnimation(
          `springBack-${i}`,
          pad,
          'position.y',
          ANIM_FPS,
          SQUASH_FRAMES,
          y0 - 0.18,
          y0,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          undefined,
          undefined,
          scene,
        );
      },
      scene,
    );
    for (let k = 0; k < meshes.length - 1; k++) {
      const coil = meshes[k];
      Animation.CreateAndStartAnimation(
        `springCoilSquash-${i}-${k}`,
        coil,
        'scaling.y',
        ANIM_FPS,
        SQUASH_FRAMES,
        1,
        0.6,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
        undefined,
        () => {
          Animation.CreateAndStartAnimation(
            `springCoilBack-${i}-${k}`,
            coil,
            'scaling.y',
            ANIM_FPS,
            SQUASH_FRAMES,
            0.6,
            1,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
            undefined,
            undefined,
            scene,
          );
        },
        scene,
      );
    }
  },

  dispose(i) {
    const meshes = deco.get(i);
    if (!meshes) return;
    for (const m of meshes) m.dispose();
    deco.delete(i);
  },
};
