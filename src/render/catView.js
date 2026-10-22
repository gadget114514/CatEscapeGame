/**
 * The cat: a small procedural model (no external assets) with hop / escape /
 * caught animations, driven by `scene.onBeforeRenderObservable`.
 */
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { cellPos, CELL_SIZE, CELL_GAP } from './boardView.js';

const BASE_Y = 0.1; // body rests on the cell top (height 0.3 → top at 0.15)
const BASE_SCALE = 1.4; // Rev. 3: the cat was too small (must stay in one cell)
const HOP_MS = 250;
const HOP_HEIGHT = 0.8;
const WIN_MS = 700;
const WIN_CELLS = 3;
const SIT_MS = 600;
const SHAKE_COUNT = 3;

function makeMaterial(scene, name, hex, emissive = 0.35) {
  const mat = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(hex);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(emissive);
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 */
export function createCatView(scene) {
  const fur = makeMaterial(scene, 'catFur', '#f39c34');
  const black = makeMaterial(scene, 'catBlack', '#1a1a1a', 0.1);

  const root = new TransformNode('cat', scene);
  root.scaling.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
  const parts = [];

  function part(mesh, mat) {
    mesh.material = mat;
    mesh.parent = root;
    mesh.isPickable = false;
    parts.push(mesh);
    return mesh;
  }

  // body: ellipsoid
  const body = part(CreateSphere('catBody', { diameter: 1, segments: 10 }, scene), fur);
  body.scaling.set(0.8, 0.6, 1.1);
  body.position.set(0, 0.35, 0);
  // head (z pulled in so head+tail stay within one cell at 1.4×)
  const head = part(CreateSphere('catHead', { diameter: 0.55, segments: 8 }, scene), fur);
  head.position.set(0, 0.65, 0.42);
  // ears: cones (there is no CreateCone — a cone is a cylinder with diameterTop 0)
  for (const side of [-1, 1]) {
    const ear = part(
      CreateCylinder(
        `catEar${side}`,
        { diameterTop: 0, diameterBottom: 0.22, height: 0.3, tessellation: 6 },
        scene,
      ),
      fur,
    );
    ear.position.set(side * 0.17, 0.93, 0.42);
    ear.rotation.z = side * -0.25;
  }
  // tail (shortened vs. the original so the 1.4× footprint stays in one cell)
  const tail = part(
    CreateCylinder('catTail', { diameter: 0.12, height: 0.55, tessellation: 8 }, scene),
    fur,
  );
  tail.position.set(0, 0.45, -0.44);
  tail.rotation.x = -0.95;
  // eyes
  for (const side of [-1, 1]) {
    const eye = part(CreateSphere(`catEye${side}`, { diameter: 0.09, segments: 6 }, scene), black);
    eye.position.set(side * 0.12, 0.7, 0.65);
  }

  /** @type {{kind:'hop'|'win'|'sit', t:number, dur:number, from?:any, to?:any, yaw?:number, dir?:any, done?:Function}|null} */
  let anim = null;

  scene.onBeforeRenderObservable.add(() => {
    if (!anim) return;
    const dt = scene.getEngine().getDeltaTime();
    anim.t = Math.min(1, anim.t + dt / anim.dur);
    const t = anim.t;
    if (anim.kind === 'hop') {
      root.position.x = anim.from.x + (anim.to.x - anim.from.x) * t;
      root.position.z = anim.from.z + (anim.to.z - anim.from.z) * t;
      root.position.y = BASE_Y + HOP_HEIGHT * Math.sin(Math.PI * t);
      root.rotation.y = anim.yaw;
    } else if (anim.kind === 'win') {
      const d = WIN_CELLS * (CELL_SIZE * Math.sqrt(3) + CELL_GAP);
      root.position.x = anim.from.x + anim.dir.x * d * t;
      root.position.z = anim.from.z + anim.dir.z * d * t;
      root.position.y = BASE_Y + 0.2 * t;
      root.rotation.y = anim.yaw;
      const v = 1 - t;
      for (const p of parts) p.visibility = v;
    } else if (anim.kind === 'sit') {
      root.rotation.z = 0.25 * Math.sin(Math.PI * 2 * SHAKE_COUNT * t) * (1 - t);
    }
    if (t >= 1) {
      const done = anim.done;
      anim = null;
      root.rotation.z = 0;
      if (done) done();
    }
  });

  /**
   * @param {import('../game/board.js').Board} board
   * @param {number} index
   */
  function cellWorld(board, index) {
    const p = cellPos(board, index);
    return { x: p.x, y: BASE_Y, z: p.z };
  }

  return {
    root,

    /**
     * Place the cat without animation.
     * @param {import('../game/board.js').Board} board
     * @param {number} index
     */
    place(board, index) {
      anim = null;
      const p = cellWorld(board, index);
      root.position.set(p.x, p.y, p.z);
    },

    /** Reset appearance after a finished game (fade / squash). */
    reset() {
      anim = null;
      root.rotation.set(0, 0, 0);
      root.scaling.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
      for (const p of parts) p.visibility = 1;
    },

    /**
     * Hop from one cell to another (~250 ms, parabolic arc).
     * @param {import('../game/board.js').Board} board
     * @param {number} from
     * @param {number} to
     * @returns {Promise<void>}
     */
    hop(board, from, to) {
      return new Promise((resolve) => {
        const a = cellWorld(board, from);
        const b = cellWorld(board, to);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        anim = {
          kind: 'hop',
          t: 0,
          dur: HOP_MS,
          from: a,
          to: b,
          yaw: Math.atan2(dx, dz),
          done: () => {
            root.position.set(b.x, BASE_Y, b.z);
            resolve();
          },
        };
      });
    },

    /**
     * catWin: run off the board — 3 cells outward from the edge while fading.
     * @param {import('../game/board.js').Board} board
     * @returns {Promise<void>}
     */
    runOff(board) {
      return new Promise((resolve) => {
        const p = root.position;
        let dx = p.x;
        let dz = p.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        anim = {
          kind: 'win',
          t: 0,
          dur: WIN_MS,
          from: { x: p.x, y: p.y, z: p.z },
          dir: { x: dx, z: dz },
          yaw: Math.atan2(dx, dz),
          done: resolve,
        };
      });
    },

    /**
     * trapperWin: shake side to side 3 times, then sit (squash to 0.8 height).
     * @returns {Promise<void>}
     */
    sit() {
      return new Promise((resolve) => {
        anim = {
          kind: 'sit',
          t: 0,
          dur: SIT_MS,
          done: () => {
            root.scaling.y = BASE_SCALE * 0.8; // squash relative to the base scale
            resolve();
          },
        };
      });
    },

    dispose() {
      anim = null;
      for (const m of parts) m.dispose();
      root.dispose();
      fur.dispose();
      black.dispose();
    },
  };
}
