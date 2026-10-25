/**
 * Arrow render module (spec 13.3): a normal tile with a raised arrow
 * pointing along `dir` (0–5 = E, NE, NW, W, SW, SE). The arrow is built
 * from a thin box + cone, rotated to the world direction of the neighbor
 * cell so it always points the way the cat may enter.
 */
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { step } from '../../game/gimmick/hexDir.js';
import { cachedMaterial, CELL_TOP } from './common.js';

/** @type {Map<number, import('@babylonjs/core/Meshes/mesh.js').Mesh[]>} */
const deco = new Map();

export default {
  id: 'arrow',
  build(scene, i, state, ctx) {
    const b = state.board;
    const p = ctx.cellPos(i);
    const dir = state.g.dir[i];
    const n = step(i, dir, b.W, b.H);
    const pn = n >= 0 ? ctx.cellPos(n) : p;
    const angle = Math.atan2(pn.x - p.x, pn.z - p.z);
    const mat = cachedMaterial(scene, 'gimArrow', '#f0f4f8', { emissive: 0.3 });

    const root = new TransformNode(`arrow-${i}`, scene);
    root.position.set(p.x, CELL_TOP + 0.06, p.z);
    root.rotation.y = angle;
    root.isPickable = false;

    const shaft = CreateBox(`arrowShaft-${i}`, { width: 0.16, height: 0.1, depth: 0.55 }, scene);
    shaft.parent = root;
    shaft.position.set(0, 0, 0.02);
    shaft.material = mat;
    shaft.isPickable = false;

    const head = CreateCylinder(
      `arrowHead-${i}`,
      { diameterTop: 0, diameterBottom: 0.34, height: 0.3, tessellation: 6 },
      scene,
    );
    head.rotation.x = Math.PI / 2;
    head.parent = root;
    head.position.set(0, 0, 0.42);
    head.material = mat;
    head.isPickable = false;

    deco.set(i, [shaft, head]);
  },

  dispose(i) {
    const meshes = deco.get(i);
    if (!meshes) return;
    for (const m of meshes) m.dispose();
    deco.delete(i);
  },
};
