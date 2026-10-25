/**
 * The hex board: one mesh per cell, shared materials, block/hover/highlight
 * looks and the block animation. Gimmick cell looks and decorations are
 * delegated to the render modules in `gimmicks/registry.js` (spec 13.5):
 * each module may set a base cell style (`ctx.setCellStyle`) and build
 * decoration meshes; interactive states (highlight/hint/hover/block)
 * override the base look. Also owns the crumble (brittle block, 13.3) and
 * storm (14.5) animations.
 *
 * Rev. 6 (spec 17.2/17.4): empty/border tiles use the procedural
 * `FxTile` shader at high/medium (grass gradient, per-cell noise, rim
 * light, exit pulse, highlight breathing, hover pulse and the move
 * ripple); `low` keeps the StandardMaterial tiles. Hovered tiles lift by
 * 0.08, highlighted cells breathe, and a block now drops in from y+3
 * with a bounce ease.
 */
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector2 } from '@babylonjs/core/Maths/math.vector.js';
import { Animation } from '@babylonjs/core/Animations/animation.js';
import { BounceEase, EasingFunction } from '@babylonjs/core/Animations/easing.js';
import '@babylonjs/core/Animations/animatable.js'; // side effect: beginAnimation support
import { cellCenter, toRC } from '../game/hex.js';
import { GIMMICK_RENDERERS, RENDER_BY_KIND } from './gimmicks/registry.js';
import { registerFxShaders, meshUniformNames } from './fx/shaders.js';
import { fxWarnOnce } from './fx/fxLog.js';

export const CELL_SIZE = 1;
export const CELL_GAP = 0.1;
export const CELL_HEIGHT = 0.3;
export const BLOCK_SCALE = 2.5;
const BLOCK_Y = (CELL_HEIGHT * (BLOCK_SCALE - 1)) / 2; // raised so the base stays put
export const ITEM_Y = 0.9; // item octahedra float above the cell (gimmicks/item.js)

const ANIM_FPS = 60;
const BLOCK_FRAMES = 18; // ~300 ms: the drop-in with a bounce (17.2)
const CRUMBLE_FRAMES = 27; // ~450 ms: shake, then sink
const STORM_FRAMES = 30; // ~500 ms: spin and fade
const HOVER_LIFT = 0.08; // hover lift (17.2)
const RIPPLE_MS = 700;

let tileShadersRegistered = false;

/**
 * Deterministic per-cell seed for the tile noise.
 * @param {number} i
 * @returns {number}
 */
function cellSeedOf(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

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
 * @param {{tileShader?: boolean}} [opts] initial fx quality choice (17.4)
 */
export function createBoardView(scene, opts = {}) {
  /** @type {import('@babylonjs/core/Meshes/mesh.js').Mesh[]} */
  let meshes = [];
  let dims = { W: 0, H: 0 };
  /** @type {import('../game/rules.js').GameState|null} */
  let state = null;
  let highlightSet = new Set();
  let hintSet = new Set();
  let hoverIndex = -1;
  /** Base cell look set by gimmick modules: index → {material, scaleY, y}. */
  let styles = new Map();
  /** Rev. 6: custom tile shader on/off (high/medium vs low). */
  let tileShaderOn = !!opts.tileShader;
  /** @type {Map<number, ShaderMaterial>} per-cell tile materials (17.4) */
  let tileMats = new Map();
  let clock = 0;
  /** @type {{x:number, z:number}|null} */
  let rippleOrigin = null;
  let rippleT = 1;

  const mats = {
    empty: makeMaterial(scene, 'empty', '#7cc576'), // Rev. 3 colors
    border: makeMaterial(scene, 'border', '#b5dba8'),
    blocked: makeMaterial(scene, 'blocked', '#3b4a5a'),
    hover: makeMaterial(scene, 'hover', '#ffe066'),
    highlight: makeMaterial(scene, 'highlight', '#66d9ff'),
    hint: makeMaterial(scene, 'hint', '#ff7a1a'), // clearly orange (Rev. 3)
    flash: makeMaterial(scene, 'flash', '#e74c3c'),
    breakable: makeMaterial(scene, 'breakable', '#ff5a5a'), // Rev. 4 armed hammer
  };

  const BASE_HEX = { empty: '#7cc576', border: '#b5dba8', hint: '#ff7a1a' };

  // Fail-soft (task 26): a broken shader registration must never stop
  // the board from building — fall back to the StandardMaterial tiles.
  if (tileShaderOn && !tileShadersRegistered) {
    try {
      registerFxShaders(Effect);
      tileShadersRegistered = true;
    } catch (err) {
      fxWarnOnce('boardView.tileShaders', err);
      tileShaderOn = false;
    }
  }

  /**
   * Build the tile shader material of one cell (17.4). Fail-soft:
   * returns null so the caller falls back to the StandardMaterial look.
   * @param {number} i
   * @returns {ShaderMaterial|null}
   */
  function makeTileMat(i) {
    try {
      const mat = new ShaderMaterial(
        `tileFx-${i}`,
        scene,
        { vertex: 'FxTile', fragment: 'FxTile' },
        { uniforms: meshUniformNames('tile') },
      );
      mat.setFloat('time', 0);
      mat.setFloat('cellSeed', cellSeedOf(i));
      mat.setFloat('highlight', 0);
      mat.setFloat('hover', 0);
      mat.setFloat('isExit', 0);
      mat.setFloat('rippleTime', 1);
      mat.setVector2('rippleOrigin', new Vector2(0, 0));
      mat.setVector3('baseColor', Color3.FromHexString(BASE_HEX.empty).toVector3());
      mat.backFaceCulling = false;
      return mat;
    } catch (err) {
      fxWarnOnce('boardView.tileMat', err);
      return null;
    }
  }

  function disposeTileMats() {
    for (const m of tileMats.values()) {
      if (m) m.dispose();
    }
    tileMats.clear();
  }

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

  /**
   * Context handed to the gimmick render modules (spec 13.5).
   * @param {import('../game/board.js').Board} board
   */
  function makeCtx(board) {
    return {
      board,
      tileShader: tileShaderOn, // Rev. 6: modules may swap in shader looks (17.4)
      cellPos: (i) => cellPos(board, i),
      cellTopY: CELL_HEIGHT / 2,
      /**
       * Base look of the cell under the interactive states.
       * @param {number} i
       * @param {{material:import('@babylonjs/core/Materials/standardMaterial.js').StandardMaterial,
       *          scaleY?:number, y?:number}} style
       */
      setCellStyle(i, style) {
        styles.set(i, style);
      },
    };
  }

  function buildMeshes(board) {
    for (const m of meshes) m.dispose();
    meshes = [];
    for (const ring of rings.values()) ring.dispose();
    rings.clear();
    disposeTileMats();
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
      if (tileShaderOn) tileMats.set(i, makeTileMat(i));
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
      // armed hammer: a highlighted blocked neighbor is a break target
      mesh.material = highlightSet.has(i) ? mats.breakable : mats.blocked;
      mesh.scaling.y = BLOCK_SCALE;
      mesh.position.y = BLOCK_Y;
      return;
    }
    mesh.scaling.y = 1;
    const style = styles.get(i);
    const isHover = hoverIndex === i;
    // hover: the tile lifts with an emissive pulse (17.2)
    mesh.position.y = isHover && !style ? HOVER_LIFT : style ? style.y ?? 0 : 0;

    const tile = tileMats.get(i);
    if (tile && !style) {
      const isBorder = !!board.border[i];
      const base =
        hintSet.has(i) && !highlightSet.has(i)
          ? BASE_HEX.hint
          : isBorder
            ? BASE_HEX.border
            : BASE_HEX.empty;
      tile.setColor3('baseColor', Color3.FromHexString(base));
      tile.setFloat('highlight', highlightSet.has(i) ? 1 : 0);
      tile.setFloat('hover', isHover ? 1 : 0);
      tile.setFloat('isExit', isBorder ? 1 : 0);
      mesh.material = tile;
      return;
    }
    if (highlightSet.has(i)) mesh.material = mats.highlight;
    else if (hintSet.has(i)) mesh.material = mats.hint;
    else if (isHover) mesh.material = mats.hover;
    else if (style) {
      // gimmick base look (stone/ice/brittle/…, spec 13.5)
      mesh.material = style.material;
      mesh.scaling.y = style.scaleY ?? 1;
      return;
    } else {
      mesh.material = board.border[i] ? mats.border : mats.empty;
    }
  }

  function applyAll() {
    for (let i = 0; i < meshes.length; i++) applyLook(i);
  }

  /* Rev. 6: the shader clock, the highlight/hover breathing and the
   * move ripple all ride one render-loop observer (spec 17.2/17.4). */
  const highlightColor = Color3.FromHexString('#66d9ff');
  const hoverColor = Color3.FromHexString('#ffe066');
  const frameObserver = scene.onBeforeRenderObservable.add(() => {
    // Fail-soft (task 26): a broken uniform update must never kill the
    // render loop — it logs once and the shaders keep their last state.
    try {
      const dt = scene.getEngine().getDeltaTime();
      clock += dt / 1000;
      if (rippleT < 1) rippleT = Math.min(1, rippleT + dt / RIPPLE_MS);
      if (tileMats.size > 0) {
        const ov = rippleOrigin || { x: 0, z: 0 };
        const v = new Vector2(ov.x, ov.z);
        for (const m of tileMats.values()) {
          if (!m) continue;
          m.setFloat('time', clock);
          m.setFloat('rippleTime', rippleT);
          m.setVector2('rippleOrigin', v);
        }
      }
      // shared-material fallback (low, and gimmick-styled interactive cells)
      const breath = 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(clock * 5.2));
      mats.highlight.emissiveColor = highlightColor.scale(breath);
      const pulse = 0.15 + 0.15 * (0.5 + 0.5 * Math.sin(clock * 6.0));
      mats.hover.emissiveColor = hoverColor.scale(pulse);
    } catch (err) {
      fxWarnOnce('boardView.frame', err);
    }
  });

  return {
    get meshes() {
      return meshes;
    },

    /**
     * Rebuild every cell from the game state (instant, no animation).
     * Gimmick cells carry `state.g.kind` (aliased as `state.cells`): the
     * render module for each kind styles the cell and builds its
     * decorations (spec 13.5).
     * @param {import('../game/rules.js').GameState} s
     */
    rebuild(s) {
      state = s;
      if (meshes.length !== s.board.W * s.board.H) buildMeshes(s.board);
      if (tileShaderOn && tileMats.size !== meshes.length) {
        disposeTileMats();
        for (let i = 0; i < meshes.length; i++) tileMats.set(i, makeTileMat(i));
      }
      highlightSet = new Set();
      hintSet = new Set();
      hoverIndex = -1;
      styles = new Map();
      const n = s.board.W * s.board.H;
      for (let i = 0; i < n; i++) {
        for (const m of GIMMICK_RENDERERS) m.dispose(i);
      }
      const kind = s.g && s.g.kind ? s.g.kind : s.cells;
      if (kind) {
        const ctx = makeCtx(s.board);
        for (let i = 0; i < n; i++) {
          const mod = RENDER_BY_KIND[kind[i]];
          if (mod) mod.build(scene, i, s, ctx);
        }
        for (const m of GIMMICK_RENDERERS) if (m.update) m.update(s);
      }
      applyAll();
    },

    /**
     * @param {number[]} indices cells to highlight (legal moves)
     * @param {number} [origin] ripple origin cell (the cat, spec 17.4)
     */
    setHighlights(indices, origin) {
      highlightSet = new Set(indices);
      if (tileShaderOn && Number.isInteger(origin) && origin >= 0 && state) {
        const p = cellPos(state.board, origin);
        rippleOrigin = { x: p.x, z: p.z };
        rippleT = 0;
      }
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
     * Rev. 6: switch the tile look between the `FxTile` shader
     * (high/medium) and the StandardMaterial fallback (low). Fail-soft
     * (task 26): any shader failure reverts to the fallback look.
     * @param {boolean} on
     */
    setTileShader(on) {
      const next = !!on;
      if (next === tileShaderOn) return;
      tileShaderOn = next;
      try {
        if (next && !tileShadersRegistered) {
          registerFxShaders(Effect);
          tileShadersRegistered = true;
        }
        disposeTileMats();
        if (next && state) {
          for (let i = 0; i < meshes.length; i++) {
            const mat = makeTileMat(i);
            if (mat) tileMats.set(i, mat);
          }
        }
      } catch (err) {
        fxWarnOnce('boardView.setTileShader', err);
        tileShaderOn = false;
        disposeTileMats();
      }
      applyAll();
    },

    /**
     * @param {number} i
     * @returns {boolean} true when the cell is empty (no block, no cat)
     */
    isCellEmpty(i) {
      if (!state || state.board.blocked[i]) return false;
      const cats = state.cats;
      if (cats && cats.length > 0) {
        for (const c of cats) if (c === i) return false;
        return true;
      }
      return i !== state.board.cat;
    },

    /**
     * Animate the block dropping in from above with a bounce (~300 ms,
     * spec 17.2).
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
        mesh.scaling.y = BLOCK_SCALE;
        const bounce = new BounceEase(1.4);
        bounce.setEasingMode(EasingFunction.EASINGMODE_EASEOUT);
        Animation.CreateAndStartAnimation(
          'blockDrop',
          mesh,
          'position.y',
          ANIM_FPS,
          BLOCK_FRAMES,
          BLOCK_Y + 3,
          BLOCK_Y,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          bounce,
          () => {
            mesh.position.y = BLOCK_Y;
            resolve();
          },
          scene,
        );
      });
    },

    /**
     * Pickup: the gimmick item module shrinks the floating octahedron
     * over ~200 ms (spec 12.7/13.5).
     * @param {number} i
     * @returns {Promise<void>}
     */
    animatePickup(i) {
      const mod = RENDER_BY_KIND[1]; // KIND_ITEM
      if (mod && mod.animatePickup) return mod.animatePickup(i);
      return Promise.resolve();
    },

    /**
     * Break: sink the block back into the cell over ~200 ms, then restore
     * the cell's normal look (spec 12.7).
     * @param {number} i
     * @returns {Promise<void>}
     */
    animateBreak(i) {
      return new Promise((resolve) => {
        const mesh = meshes[i];
        if (!mesh) {
          resolve();
          return;
        }
        Animation.CreateAndStartAnimation(
          'breakScale',
          mesh,
          'scaling.y',
          ANIM_FPS,
          BLOCK_FRAMES,
          BLOCK_SCALE,
          1,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          undefined,
          () => {
            mesh.scaling.y = 1;
            applyLook(i);
            resolve();
          },
          scene,
        );
        Animation.CreateAndStartAnimation(
          'breakDrop',
          mesh,
          'position.y',
          ANIM_FPS,
          BLOCK_FRAMES,
          BLOCK_Y,
          0,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          undefined,
          undefined,
          scene,
        );
      });
    },

    /**
     * Brittle crumble (13.3/13.5): the block shakes, then sinks into the
     * cell; the cell stays brittle. The block is already gone from the
     * state, so it is drawn temporarily.
     * @param {number} i
     * @returns {Promise<void>}
     */
    animateCrumble(i) {
      return new Promise((resolve) => {
        const mesh = meshes[i];
        if (!mesh) {
          resolve();
          return;
        }
        mesh.material = mats.blocked;
        mesh.scaling.y = BLOCK_SCALE;
        mesh.position.y = BLOCK_Y;
        const x0 = mesh.position.x;
        // shake (first half), then sink (second half)
        const keys = [];
        const shakes = 6;
        for (let k = 0; k <= shakes; k++) {
          keys.push({
            frame: Math.round((k * CRUMBLE_FRAMES) / 2 / shakes),
            value: x0 + (k % 2 === 0 ? 0.05 : -0.05),
          });
        }
        keys.push({ frame: CRUMBLE_FRAMES, value: x0 });
        const shakeAnim = new Animation(
          'crumbleShake',
          'position.x',
          ANIM_FPS,
          Animation.ANIMATIONTYPE_FLOAT,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
        );
        shakeAnim.setKeys(keys);
        mesh.animations = [shakeAnim];
        scene.beginAnimation(mesh, 0, CRUMBLE_FRAMES, false, 1, () => {
          mesh.position.x = x0;
          applyLook(i);
          resolve();
        });
        Animation.CreateAndStartAnimation(
          'crumbleSinkY',
          mesh,
          'scaling.y',
          ANIM_FPS,
          CRUMBLE_FRAMES,
          BLOCK_SCALE,
          1,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          undefined,
          undefined,
          scene,
        );
        Animation.CreateAndStartAnimation(
          'crumbleSink',
          mesh,
          'position.y',
          ANIM_FPS,
          CRUMBLE_FRAMES,
          BLOCK_Y,
          0,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
          undefined,
          undefined,
          scene,
        );
      });
    },

    /**
     * Storm (14.5): the blown-away blocks spin and fade, then the cells
     * return to their normal look. The blocks are already gone from the
     * state, so they are drawn temporarily.
     * @param {number[]} indices
     * @returns {Promise<void>}
     */
    animateStorm(indices) {
      const list = (indices || []).filter((i) => meshes[i]);
      if (list.length === 0) return Promise.resolve();
      return new Promise((resolve) => {
        let remaining = list.length;
        for (const i of list) {
          const mesh = meshes[i];
          mesh.material = mats.blocked;
          mesh.scaling.y = BLOCK_SCALE;
          mesh.position.y = BLOCK_Y;
          Animation.CreateAndStartAnimation(
            `stormSpin-${i}`,
            mesh,
            'rotation.y',
            ANIM_FPS,
            STORM_FRAMES,
            mesh.rotation.y,
            mesh.rotation.y + Math.PI * 2,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
            undefined,
            undefined,
            scene,
          );
          Animation.CreateAndStartAnimation(
            `stormLift-${i}`,
            mesh,
            'position.y',
            ANIM_FPS,
            STORM_FRAMES,
            BLOCK_Y,
            BLOCK_Y + 1.6,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
            undefined,
            undefined,
            scene,
          );
          Animation.CreateAndStartAnimation(
            `stormFade-${i}`,
            mesh,
            'visibility',
            ANIM_FPS,
            STORM_FRAMES,
            1,
            0,
            Animation.ANIMATIONLOOPMODE_CONSTANT,
            undefined,
            () => {
              mesh.visibility = 1;
              mesh.scaling.y = 1;
              applyLook(i);
              remaining -= 1;
              if (remaining === 0) resolve();
            },
            scene,
          );
        }
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
      scene.onBeforeRenderObservable.remove(frameObserver);
      const n = meshes.length;
      for (let i = 0; i < n; i++) {
        for (const m of GIMMICK_RENDERERS) m.dispose(i);
      }
      for (const m of meshes) m.dispose();
      meshes = [];
      for (const ring of rings.values()) ring.dispose();
      rings.clear();
      disposeTileMats();
      for (const key of Object.keys(mats)) mats[key].dispose();
    },
  };
}
