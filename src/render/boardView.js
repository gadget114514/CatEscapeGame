/**
 * The hex board: one mesh per cell, shared materials, block/hover/highlight
 * looks and the block animation.
 */
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import '@babylonjs/core/Animations/animatable.js'; // side effect: beginAnimation support
import { cellCenter, toRC } from '../game/hex.js';

export const CELL_SIZE = 1;
export const CELL_GAP = 0.1;
export const CELL_HEIGHT = 0.3;
export const BLOCK_SCALE = 2.5;
const BLOCK_Y = (CELL_HEIGHT * (BLOCK_SCALE - 1)) / 2; // raised so the base stays put

const ANIM_FPS = 60;
const BLOCK_FRAMES = 12; // ~200 ms

/**
 * World position of cell `i` (the board is centered on the origin).
 * @param {import('../game/board.js').Board} board
 * @param {number} i
 * @returns {{x:number, z:number}}
 */
export function cellPos(board, i) {
  const { r, c } = toRC(i, board.W);
  const offsetX = ((CELL_SIZE * Math.sqrt(3) + CELL_GAP) * (board.W - 0.5)) / 2;
  const offsetZ = ((CELL_SIZE * 1.5 + CELL_GAP * 0.866) * (board.H - 1)) / 2;
  return cellCenter(r, c, CELL_SIZE, CELL_GAP, offsetX, offsetZ);
}

function makeMaterial(scene, name, hex) {
  const mat = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(hex);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.15); // Rev. 3: uniform, keeps colors readable
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 */
export function createBoardView(scene) {
  /** @type {import('@babylonjs/core/Meshes/mesh.js').Mesh[]} */
  let meshes = [];
  let dims = { W: 0, H: 0 };
  /** @type {import('../game/rules.js').GameState|null} */
  let state = null;
  let highlightSet = new Set();
  let hintSet = new Set();
  let hoverIndex = -1;

  const mats = {
    empty: makeMaterial(scene, 'empty', '#7cc576'), // Rev. 3 colors
    border: makeMaterial(scene, 'border', '#b5dba8'),
    blocked: makeMaterial(scene, 'blocked', '#3b4a5a'),
    hover: makeMaterial(scene, 'hover', '#ffe066'),
    highlight: makeMaterial(scene, 'highlight', '#66d9ff'),
    hint: makeMaterial(scene, 'hint', '#ff7a1a'), // clearly orange (Rev. 3)
    flash: makeMaterial(scene, 'flash', '#e74c3c'),
  };

  /** @type {Map<number, import('@babylonjs/core/Meshes/mesh.js').Mesh>} hint outline rings */
  const rings = new Map();

  /**
   * Thin orange outline ring under cell `i` — shown when the cell is both a
   * hint cell and a highlighted (clickable) cell (Rev. 3).
   * @param {number} i
   */
  function hintRing(i) {
    let ring = rings.get(i);
    if (!ring) {
      ring = CreateCylinder(
        `hintRing-${i}`,
        { diameter: 2 * CELL_SIZE + 0.3, height: 0.06, tessellation: 6 },
        scene,
      );
      ring.rotation.y = Math.PI / 6;
      ring.metadata = { hintRing: true };
      ring.isPickable = false;
      ring.material = mats.hint;
      const p = cellPos(state.board, i);
      ring.position.set(p.x, -(CELL_HEIGHT / 2) + 0.04, p.z);
      ring.setEnabled(false);
      rings.set(i, ring);
    }
    return ring;
  }

  function buildMeshes(board) {
    for (const m of meshes) m.dispose();
    meshes = [];
    for (const ring of rings.values()) ring.dispose();
    rings.clear();
    dims = { W: board.W, H: board.H };
    for (let i = 0; i < board.W * board.H; i++) {
      const { r, c } = toRC(i, board.W);
      const mesh = CreateCylinder(
        `cell-${r}-${c}`,
        { diameter: 2 * CELL_SIZE, height: CELL_HEIGHT, tessellation: 6 },
        scene,
      );
      mesh.rotation.y = Math.PI / 6; // pointy-top
      const p = cellPos(board, i);
      mesh.position.set(p.x, 0, p.z);
      mesh.metadata = { index: i };
      meshes.push(mesh);
    }
  }

  function applyLook(i) {
    const mesh = meshes[i];
    if (!mesh || !state) return;
    const board = state.board;
    // hint∩highlight: the cell shows the highlight color (it is clickable)
    // and the hint appears as a thin orange outline ring underneath it.
    const wantsRing = !board.blocked[i] && hintSet.has(i) && highlightSet.has(i);
    if (wantsRing) {
      const ring = hintRing(i);
      if (!ring.isEnabled()) ring.setEnabled(true);
    } else {
      const ring = rings.get(i);
      if (ring && ring.isEnabled()) ring.setEnabled(false);
    }
    if (board.blocked[i]) {
      mesh.material = mats.blocked;
      mesh.scaling.y = BLOCK_SCALE;
      mesh.position.y = BLOCK_Y;
      return;
    }
    mesh.scaling.y = 1;
    mesh.position.y = 0;
    if (highlightSet.has(i)) mesh.material = mats.highlight;
    else if (hintSet.has(i)) mesh.material = mats.hint;
    else if (hoverIndex === i) mesh.material = mats.hover;
    else mesh.material = board.border[i] ? mats.border : mats.empty;
  }

  function applyAll() {
    for (let i = 0; i < meshes.length; i++) applyLook(i);
  }

  return {
    get meshes() {
      return meshes;
    },

    /**
     * Rebuild every cell from the game state (instant, no animation).
     * @param {import('../game/rules.js').GameState} s
     */
    rebuild(s) {
      state = s;
      if (meshes.length !== s.board.W * s.board.H) buildMeshes(s.board);
      highlightSet = new Set();
      hintSet = new Set();
      hoverIndex = -1;
      applyAll();
    },

    /**
     * @param {number[]} indices cells to highlight (legal moves)
     */
    setHighlights(indices) {
      highlightSet = new Set(indices);
      applyAll();
    },

    /**
     * @param {number[]|null} path shortest-route cells, or null to clear
     */
    setHint(path) {
      hintSet = new Set(path || []);
      applyAll();
    },

    /**
     * @param {number|null} i hovered cell
     */
    setHover(i) {
      const next = i === null || i === undefined ? -1 : i;
      if (next === hoverIndex) return;
      hoverIndex = next;
      applyAll();
    },

    /**
     * @param {number} i
     * @returns {boolean} true when the cell is empty in the current state
     */
    isCellEmpty(i) {
      return !!state && !state.board.blocked[i] && i !== state.board.cat;
    },

    /**
     * Animate the cell rising into a block (~200 ms).
     * @param {number} i
     * @returns {Promise<void>}
     */
    animateBlock(i) {
      return new Promise((resolve) => {
        const mesh = meshes[i];
        if (!mesh) {
          resolve();
          return;
        }
        mesh.material = mats.blocked;
        Animation.CreateAndStartAnimation(
          'blockScale',
          mesh,
          'scaling.y',
          ANIM_FPS,
          BLOCK_FRAMES,
          1,
          BLOCK_SCALE,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          undefined,
          () => {
            mesh.scaling.y = BLOCK_SCALE;
            resolve();
          },
          scene,
        );
        Animation.CreateAndStartAnimation(
          'blockRaise',
          mesh,
          'position.y',
          ANIM_FPS,
          BLOCK_FRAMES,
          0,
          BLOCK_Y,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          undefined,
          undefined,
          scene,
        );
      });
    },

    /**
     * Quick red flash for an illegal click.
     * @param {number} i
     */
    flashInvalid(i) {
      const mesh = meshes[i];
      if (!mesh) return;
      mesh.material = mats.flash;
      setTimeout(() => {
        if (mesh.material === mats.flash) applyLook(i);
      }, 150);
    },

    dispose() {
      for (const m of meshes) m.dispose();
      meshes = [];
      for (const ring of rings.values()) ring.dispose();
      rings.clear();
      for (const key of Object.keys(mats)) mats[key].dispose();
    },
  };
}
