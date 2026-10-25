/**
 * Item render module (spec 13.3/12.7): the floating yellow octahedron.
 * It bobs and rotates while the game runs; picking it up (a cat landing
 * on the cell) shrinks it away over ~200 ms. The pickup animation lives
 * here (boardView delegates `animatePickup` to this module).
 */
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import '@babylonjs/core/Animations/animatable.js'; // side effect: beginAnimation support
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters.js';
import { cachedMaterial } from './common.js';

export const ITEM_Y = 0.9;
const ANIM_FPS = 60;
const PICKUP_FRAMES = 12; // ~200 ms

/** @type {Map<number, import('@babylonjs/core/Meshes/mesh.js').Mesh>} */
const meshes = new Map();
/** @type {{scene: any, observer: any}|null} */
let bobbing = null;

/**
 * Spin + bob the floating octahedra (one observer per scene).
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 */
function ensureBobbing(scene) {
  if (bobbing && bobbing.scene === scene) return;
  if (bobbing) bobbing.scene.onBeforeRenderObservable.remove(bobbing.observer);
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime();
    for (const mesh of meshes.values()) {
      mesh.rotation.y += dt * 0.002;
      const meta = mesh.metadata || (mesh.metadata = {});
      meta.bob = (meta.bob || 0) + dt * 0.004;
      mesh.position.y = ITEM_Y + Math.sin(meta.bob) * 0.1;
    }
  });
  bobbing = { scene, observer };
}

/**
 * Dispose item mesh `i`, but only when `mesh` is still the live one (a
 * pending pickup animation must not dispose a freshly rebuilt item).
 * @param {number} i
 * @param {import('@babylonjs/core/Meshes/mesh.js').Mesh} mesh
 */
function release(i, mesh) {
  if (meshes.get(i) === mesh) {
    meshes.delete(i);
    mesh.dispose();
  }
}

export default {
  id: 'item',
  build(scene, i, _state, ctx) {
    ensureBobbing(scene);
    const p = ctx.cellPos(i);
    const mesh = CreatePolyhedron(`item-${i}`, { type: 1, size: 0.32 }, scene);
    mesh.position.set(p.x, ITEM_Y, p.z);
    mesh.metadata = { itemOf: i, bob: (i % 17) * 0.37 };
    mesh.isPickable = false; // taps fall through to the cell below
    const mat = cachedMaterial(scene, 'gimItem', '#ffd23f', { emissive: 0.35 });
    // Rev. 6 (17.4): an emissive rim the bloom / glow layer picks up
    if (!mat.emissiveFresnelParameters) {
      const fres = new FresnelParameters();
      fres.bias = 0.25;
      fres.power = 2.2;
      fres.leftColor = Color3.FromHexString('#ffe066');
      fres.rightColor = Color3.Black();
      mat.emissiveFresnelParameters = fres;
    }
    mesh.material = mat;
    meshes.set(i, mesh);
  },

  /**
   * Pickup: shrink the octahedron to zero over ~200 ms, then dispose it.
   * @param {number} i
   * @returns {Promise<void>}
   */
  animatePickup(i) {
    return new Promise((resolve) => {
      const mesh = meshes.get(i);
      if (!mesh) {
        resolve();
        return;
      }
      const scene = mesh.getScene();
      const anim = new Animation(
        'pickupScale',
        'scaling',
        ANIM_FPS,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
      );
      anim.setKeys([
        { frame: 0, value: mesh.scaling.clone() },
        { frame: PICKUP_FRAMES, value: Vector3.Zero() },
      ]);
      mesh.animations = [anim];
      scene.beginAnimation(mesh, 0, PICKUP_FRAMES, false, 1, () => {
        release(i, mesh);
        resolve();
      });
    });
  },

  dispose(i) {
    const mesh = meshes.get(i);
    if (!mesh) return;
    meshes.delete(i);
    mesh.dispose();
  },
};
