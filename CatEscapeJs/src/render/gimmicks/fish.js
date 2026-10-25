/**
 * Dried fish render module (14.5 にぼし): a small tan fish resting on the
 * cell. Landing on it makes the cat side move twice in a row.
 */
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { cachedMaterial, CELL_TOP } from './common.js';

/** @type {Map<number, import('@babylonjs/core/Meshes/mesh.js').Mesh[]>} */
const deco = new Map();

export default {
  id: 'fish',
  build(scene, i, _state, ctx) {
    const p = ctx.cellPos(i);
    const tan = cachedMaterial(scene, 'gimFish', '#d9b38c');

    const body = CreateSphere(`fishBody-${i}`, { diameter: 0.5, segments: 8 }, scene);
    body.scaling.set(1.5, 0.55, 0.8);
    body.position.set(p.x, CELL_TOP + 0.12, p.z);
    body.material = tan;
    body.isPickable = false;

    const tail = CreateCylinder(
      `fishTail-${i}`,
      { diameterTop: 0, diameterBottom: 0.28, height: 0.22, tessellation: 4 },
      scene,
    );
    tail.rotation.z = Math.PI / 2;
    tail.rotation.y = Math.PI / 4;
    tail.position.set(p.x - 0.42, CELL_TOP + 0.12, p.z);
    tail.material = tan;
    tail.isPickable = false;

    deco.set(i, [body, tail]);
  },

  dispose(i) {
    const meshes = deco.get(i);
    if (!meshes) return;
    for (const m of meshes) m.dispose();
    deco.delete(i);
  },
};
