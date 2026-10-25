/**
 * Brittle render module (spec 13.3): a cracked tile — the base cell is a
 * slightly deeper green and three darker lines (the cracks) sit on top.
 * A block placed on it still renders through the normal block look; the
 * cracks stay hidden underneath until the block crumbles.
 */
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { cachedMaterial, CELL_TOP } from './common.js';

/** @type {Map<number, import('@babylonjs/core/Meshes/mesh.js').Mesh[]>} */
const deco = new Map();

export default {
  id: 'brittle',
  build(scene, i, _state, ctx) {
    const p = ctx.cellPos(i);
    ctx.setCellStyle(i, { material: cachedMaterial(scene, 'gimBrittle', '#63a85c') });
    const crackMat = cachedMaterial(scene, 'gimBrittleCrack', '#3c6b38');
    const meshes = [];
    // three thin cracks across the tile, deterministic per cell
    const rots = [(i * 0.7) % Math.PI, ((i * 1.3) + 1.1) % Math.PI, ((i * 2.1) + 2.2) % Math.PI];
    for (let k = 0; k < 3; k++) {
      const crack = CreateBox(`brittleCrack-${i}-${k}`, { width: 0.06, height: 0.02, depth: 1.1 }, scene);
      crack.position.set(p.x, CELL_TOP + 0.02, p.z);
      crack.rotation.y = rots[k];
      crack.material = crackMat;
      crack.isPickable = false;
      meshes.push(crack);
    }
    deco.set(i, meshes);
  },

  dispose(i) {
    const meshes = deco.get(i);
    if (!meshes) return;
    for (const m of meshes) m.dispose();
    deco.delete(i);
  },
};
