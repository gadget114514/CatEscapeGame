/**
 * The View interface from section 6 (+ the Rev. 4 / 13.7 / 13.7
 * additions), implemented on top of boardView + catView:
 *
 * - one `catView` per cat with the 13.7 colors and a soft selection ring
 * - `animateCatPath(cells, from)` understands tunnels (hop, shrink,
 *   appear, grow), ice (a quick slide) and springs (one high arc); the
 *   controller falls back to `animateCatMove(from, to)` without it
 * - `animateCrumble(i)` / `animateStorm(indices)` for brittle blocks and
 *   the 14.5 storm
 * - `syncCats(state)` reconciles the cat views after selection changes,
 *   moves and escapes
 *
 * Rev. 6 (spec 17): every view call is fed through the fx manager
 * (`fxPlan` descriptors) — particles, shake, camera punch, post. The
 * controller still only sees the view interface.
 */
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { isBorder } from '../game/hex.js';
import { KIND_TUNNEL, KIND_ICE, KIND_SPRING } from '../game/gimmick/registry.js';
import { RENDER_BY_ID } from './gimmicks/registry.js';
import { createBoardView, cellPos, CELL_HEIGHT } from './boardView.js';
import { createCatView, CAT_COLORS } from './catView.js';
import { createFxManager } from './fx/fxManager.js';
import { hasTileShader } from './fx/fxPlan.js';
import { fxWarnOnce } from './fx/fxLog.js';

/**
 * The all-off fx stand-in (task 26): used when `createFxManager` itself
 * throws, so a completely broken fx system can never stop the game from
 * starting. Every method is a no-op.
 */
function nullFx() {
  return {
    quality: 'low',
    reducedMotion: false,
    setQuality() {},
    setReducedMotion() {},
    onViewCall() {},
    fire() {},
    setPowerAura() {},
    setDoubleArmed() {},
    resetMood() {},
    dispose() {},
  };
}

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {{quality?: string, catModel?: 'bengal'|'classic',
 *          catAnimate?: boolean}} [opts] initial fx / cat options (Rev. 6)
 */
export function createView(scene, opts = {}) {
  /** @type {ReturnType<typeof createFxManager>} */
  let fx;
  try {
    fx = createFxManager(scene, {
      camera: scene.activeCamera,
      quality: opts.quality,
    });
  } catch (err) {
    fxWarnOnce('fxManager', err);
    fx = nullFx();
  }
  const boardView = createBoardView(scene, { tileShader: hasTileShader(fx.quality) });
  /** @type {ReturnType<typeof createCatView>[]} */
  let catViews = [];
  /** Cell index each cat view currently sits on (visual truth). */
  let catCells = [];
  /** Total cats the current game started with (roots are built for it). */
  let catTotal = 1;
  let catModel = opts.catModel === 'classic' ? 'classic' : 'bengal';
  let catAnimate = opts.catAnimate !== false;

  // soft ring under the selected cat (spec 13.7)
  const ringMat = new StandardMaterial('catSelectRing', scene);
  const ringColor = Color3.FromHexString('#66d9ff');
  ringMat.diffuseColor = ringColor;
  ringMat.emissiveColor = ringColor.scale(0.5);
  ringMat.specularColor = Color3.Black();
  ringMat.alpha = 0.75;
  const selectRing = CreateTorus(
    'catSelectRing',
    { diameter: 1.9, thickness: 0.1, tessellation: 24 },
    scene,
  );
  selectRing.position.y = -(CELL_HEIGHT / 2) + 0.05;
  selectRing.isPickable = false;
  selectRing.material = ringMat;
  selectRing.setEnabled(false);

  /** @type {import('../game/rules.js').GameState|null} */
  let state = null;

  function board() {
    return state ? state.board : null;
  }

  /** fx context for the current state. */
  function fxCtx() {
    return { board: board() };
  }

  /** Rebuild every cat root from the state (called from `rebuild`). */
  function buildCats(s) {
    for (const v of catViews) v.dispose();
    catViews = [];
    catCells = [];
    const n = Math.max(1, s.catTotal || (s.cats ? s.cats.length : 1) || 1);
    catTotal = n;
    const cats = s.cats && s.cats.length > 0 ? s.cats : [s.board.cat];
    for (let j = 0; j < n; j++) {
      const view = createCatView(scene, CAT_COLORS[j % CAT_COLORS.length], j, {
        model: catModel,
        animate: catAnimate,
      });
      if (j < cats.length) {
        view.place(s.board, cats[j]);
        catCells[j] = cats[j];
      } else {
        view.setVisible(false);
        catCells[j] = -1;
      }
      catViews.push(view);
    }
  }

  /** Show the ring under the selected cat (multi-cat only, spec 13.7). */
  function updateSelectionRing() {
    const s = state;
    if (!s) {
      selectRing.setEnabled(false);
      return;
    }
    const cats = s.cats;
    const multi = !!(cats && cats.length > 1);
    const sel = s.selectedCat;
    if (!multi || !Number.isInteger(sel) || sel < 0 || sel >= catViews.length || catCells[sel] < 0) {
      selectRing.setEnabled(false);
      return;
    }
    const p = cellPos(s.board, catCells[sel]);
    selectRing.position.x = p.x;
    selectRing.position.z = p.z;
    selectRing.setEnabled(true);
  }

  /** The cat view that currently sits on `cell` (else the selected one). */
  function catAt(cell) {
    if (Number.isInteger(cell)) {
      const j = catCells.indexOf(cell);
      if (j >= 0) return j;
    }
    const sel = state && Number.isInteger(state.selectedCat) ? state.selectedCat : 0;
    return sel >= 0 && sel < catViews.length ? sel : 0;
  }

  /** True when `cell` sits next to (or on) any live cat (spec 17.2). */
  function nearCat(cell) {
    const s = state;
    if (!s || !s.board || !s.board.nbr) return false;
    for (const c of catCells) {
      if (c < 0) continue;
      if (c === cell) return true;
      const nbrs = s.board.nbr[cell];
      if (nbrs && nbrs.includes(c)) return true;
    }
    return false;
  }

  /** The move kind for fx (spec 17.3): tunnel / ice / spring / dash / jump. */
  function pathKind(cells) {
    const s = state;
    if (!s) return 'hop';
    const g = s.g;
    const kind = g && g.kind ? g.kind : null;
    const hist = s.history && s.history.length ? s.history[s.history.length - 1] : null;
    if (hist && hist.kind === 'jump') return 'jump';
    if (s.armed && s.armKind === 'dash') return 'dash';
    if (!kind || !cells || cells.length === 0) return 'hop';
    if (kind[cells[0]] === KIND_TUNNEL && cells.length >= 2) return 'tunnel';
    if (kind[cells[0]] === KIND_SPRING && cells.length >= 2) return 'spring';
    if (cells.some((c) => kind[c] === KIND_ICE)) return 'ice';
    return 'hop';
  }

  /** True when the move landed on a dried fish (14.5 → hearts, 17.3). */
  function pathFish() {
    const s = state;
    if (!s || !s.history || s.history.length === 0) return false;
    return s.history[s.history.length - 1].kind === 'fish';
  }

  return {
    /** @type {import('../game/board.js').Board|null} */
    get board() {
      return state ? state.board : null;
    },

    /** The fx manager (main.js wires quality changes through it). */
    get fx() {
      return fx;
    },

    /**
     * Rebuild every cell and the cats.
     * @param {import('../game/rules.js').GameState} s
     */
    rebuild(s) {
      state = s;
      fx.resetMood();
      boardView.setTileShader(hasTileShader(fx.quality));
      boardView.rebuild(s);
      buildCats(s);
      updateSelectionRing();
    },

    /**
     * Rev. 6: apply a new fx quality (the `演出` select, spec 17.1).
     * @param {string} quality
     */
    setFxQuality(quality) {
      fx.setQuality(quality);
      boardView.setTileShader(hasTileShader(fx.quality));
    },

    /**
     * Switch the cat visual (`bengal` GLB or the original procedural cat)
     * without restarting the game.
     * @param {'bengal'|'classic'} model
     */
    setCatModel(model) {
      const next = model === 'classic' ? 'classic' : 'bengal';
      if (next === catModel) return;
      catModel = next;
      if (state) buildCats(state);
    },

    /**
     * Turn the cats' idle / skeletal animation on or off.
     * @param {boolean} on
     */
    setCatAnimation(on) {
      catAnimate = !!on;
      for (const view of catViews) view.setAnimated(catAnimate);
    },

    /**
     * Rev. 6: the double-armed pulsing ring on the board edge (17.3).
     * @param {boolean} on
     */
    setDoubleArmed(on) {
      fx.setDoubleArmed(!!on, board());
    },

    /**
     * Reconcile the cat views with the state (spec 13.7): positions,
     * removed cats (anyCatch escapes) and the selection ring. Called after
     * selection changes and at every turn start; animations keep
     * `catCells` up to date in between. Rev. 6: also feeds the power
     * aura (17.3).
     * @param {import('../game/rules.js').GameState} [s]
     */
    syncCats(s) {
      if (s) state = s;
      if (!state) return;
      const cats = state.cats && state.cats.length > 0 ? state.cats : [state.board.cat];
      const b = state.board;
      for (let j = 0; j < catViews.length; j++) {
        if (j < cats.length) {
          const view = catViews[j];
          view.setVisible(true);
          if (catCells[j] !== cats[j]) {
            view.place(b, cats[j]);
            catCells[j] = cats[j];
          }
        } else {
          catViews[j].setVisible(false);
          catCells[j] = -1;
        }
      }
      updateSelectionRing();
      // 14.5 power-full aura under the (selected) cat (17.3)
      const sel = Number.isInteger(state.selectedCat) ? state.selectedCat : 0;
      const cell = catCells[sel] >= 0 ? catCells[sel] : catCells.find((c) => c >= 0);
      const full = !!(state.features && state.items && state.power >= 6);
      fx.setPowerAura(full, b, cell);
    },

    /**
     * Highlight candidates (escape mode: cat moves — including break targets
     * while the hammer is armed; trapper mode: none). Rev. 6: the ripple
     * travels outward from the cat over the highlighted cells (17.4).
     * @param {number[]} indices
     */
    setHighlights(indices) {
      const sel = state && Number.isInteger(state.selectedCat) ? state.selectedCat : 0;
      const origin = catCells[sel] >= 0 ? catCells[sel] : catCells.find((c) => c >= 0);
      boardView.setHighlights(indices, origin);
      fx.onViewCall('setHighlights', { origin }, fxCtx());
    },

    /**
     * "ルートを表示": the cat's shortest route to the edge (null clears it).
     * @param {number[]|null} pathIndices
     */
    setHint(pathIndices) {
      boardView.setHint(pathIndices);
    },

    /**
     * @param {number} i
     * @returns {Promise<void>} block drops in with a bounce, ~300ms
     */
    async animateBlock(i) {
      fx.onViewCall('animateBlock', { cell: i, nearCat: nearCat(i) }, fxCtx());
      await boardView.animateBlock(i);
    },

    /**
     * Hammer break: the block sinks back into the cell, ~200ms.
     * @param {number} i
     * @returns {Promise<void>}
     */
    async animateBreak(i) {
      fx.onViewCall('animateBreak', { cell: i }, fxCtx());
      await boardView.animateBreak(i);
    },

    /**
     * @param {number} from
     * @param {number} to
     * @returns {Promise<void>} hop, ~250ms + landing settle
     */
    async animateCatMove(from, to) {
      const b = board();
      if (!b) return;
      const j = catAt(from);
      fx.onViewCall('animateCatPath', { cells: [to], from, kind: 'hop' }, fxCtx());
      await catViews[j].hop(b, from, to);
      catCells[j] = to;
      updateSelectionRing();
    },

    /**
     * A whole cat move as recorded by the rules (`state.lastPath`, spec
     * 13.5): tunnels shrink/grow, ice slides, springs arc, plain moves
     * hop. `from` is the cell the cat started on (the path lists only the
     * cells the move passes over). Rev. 6 adds the per-move fx (17.3).
     * @param {number[]} cells
     * @param {number} [from]
     * @returns {Promise<void>}
     */
    async animateCatPath(cells, from) {
      const b = board();
      if (!b || !state || !cells || cells.length === 0) return;
      const j = catAt(Number.isInteger(from) ? from : null);
      const view = catViews[j];
      const g = state.g;
      const kind = g && g.kind ? g.kind : null;
      const start = Number.isInteger(from) ? from : catCells[j];
      const last = cells[cells.length - 1];
      const kind0 = kind ? kind[cells[0]] : 0;
      const moveKind = pathKind(cells);

      fx.onViewCall(
        'animateCatPath',
        { cells, from: start, kind: moveKind, fish: pathFish() },
        fxCtx(),
      );
      if (moveKind === 'dash') view.spawnGhosts(2);
      if (moveKind === 'spring') {
        // Fail-soft (task 26): a broken coil squash never blocks the move.
        try {
          const springMod = RENDER_BY_ID.spring;
          if (springMod && springMod.onEnter) springMod.onEnter(cells[0]);
        } catch (err) {
          fxWarnOnce('spring.onEnter', err);
        }
      }

      if (kind0 === KIND_TUNNEL && cells.length >= 2) {
        // hop to the entry, shrink, appear at the exit, grow (13.5)
        await view.hop(b, start, cells[0]);
        await view.shrink();
        view.place(b, last);
        await view.grow();
      } else if (kind && kind0 === KIND_SPRING && cells.length >= 2) {
        // one high arc over whatever is in between (13.5)
        await view.arcHop(b, start, last);
      } else if (cells.length > 1 && kind && cells.some((c) => kind[c] === KIND_ICE)) {
        // a quick slide with no hop (13.5)
        await view.slidePath(b, [start, ...cells]);
      } else if (moveKind === 'jump') {
        // the corner jump arcs like a spring (17.3)
        await view.arcHop(b, start, last);
      } else {
        await view.hop(b, start, last);
      }
      catCells[j] = last;
      updateSelectionRing();

      // anyCatch: the escaped cat runs off the board and is removed (13.7)
      if (state.catsGoal === 'anyCatch' && isBorder(last, b.W, b.H)) {
        await view.runOff(b);
        view.setVisible(false);
        catCells[j] = -1;
      }
    },

    /**
     * Pickup: the floating octahedron shrinks away, ~200ms.
     * @param {number} i
     * @returns {Promise<void>}
     */
    async animatePickup(i) {
      fx.onViewCall('animatePickup', { cell: i }, fxCtx());
      await boardView.animatePickup(i);
    },

    /**
     * Brittle crumble (13.5): the block shakes, then sinks.
     * @param {number} i
     * @returns {Promise<void>}
     */
    async animateCrumble(i) {
      fx.onViewCall('animateCrumble', { cell: i }, fxCtx());
      await boardView.animateCrumble(i);
    },

    /**
     * Storm (14.5): the blown-away blocks spin and fade.
     * @param {number[]} indices
     * @returns {Promise<void>}
     */
    async animateStorm(indices) {
      fx.onViewCall('animateStorm', { cells: indices, center: 0 }, fxCtx());
      await boardView.animateStorm(indices);
    },

    /**
     * @param {'catWin'|'trapperWin'} status
     * @returns {Promise<void>}
     */
    async animateResult(status) {
      boardView.setHint(null); // the route no longer matters
      selectRing.setEnabled(false);
      if (status === 'catWin') {
        const b = board();
        if (b) {
          // the cat on an edge ran out (anyEscape); else the selected one
          let j = catCells.findIndex((c, k) => c >= 0 && isBorder(c, b.W, b.H));
          if (j < 0) j = catAt(b.cat);
          const cell = catCells[j] >= 0 ? catCells[j] : b.cat;
          fx.onViewCall('animateResult', { status, cell }, fxCtx());
          await catViews[j].happyHop(); // celebration hop, then the run-off (17.2)
          await catViews[j].runOff(b);
          catCells[j] = -1;
        }
      } else {
        const b = board();
        let cell = -1;
        for (let j = 0; j < catViews.length; j++) {
          if (catCells[j] >= 0) cell = catCells[j];
        }
        fx.onViewCall('animateResult', { status, cell }, fxCtx());
        const active = [];
        for (let j = 0; j < catViews.length; j++) {
          if (catCells[j] >= 0) active.push(catViews[j]);
        }
        for (const v of active) await v.sit();
      }
    },

    /**
     * @param {number} i
     */
    flashInvalid(i) {
      boardView.flashInvalid(i);
    },

    /** Picking helpers (not part of the injected interface). */
    setHover(i) {
      boardView.setHover(i);
      // the cat's head follows the hovered cell while idle (17.2)
      const sel = state && Number.isInteger(state.selectedCat) ? state.selectedCat : 0;
      const view = catViews[sel];
      if (!view) return;
      const b = board();
      if (b && Number.isInteger(i) && i >= 0) {
        const p = cellPos(b, i);
        view.setLookTarget({ x: p.x, z: p.z });
      } else {
        view.setLookTarget(null);
      }
    },
    isCellEmpty(i) {
      return boardView.isCellEmpty(i);
    },
    get cellMeshes() {
      return boardView.meshes;
    },

    dispose() {
      fx.dispose();
      boardView.dispose();
      for (const v of catViews) v.dispose();
      catViews = [];
      selectRing.dispose();
      ringMat.dispose();
    },
  };
}
