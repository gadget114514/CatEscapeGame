/**
 * The View interface from section 6, implemented on top of boardView + catView.
 * The hint ("Show path hint") is refreshed after every move while enabled.
 */
import { createBoardView } from './boardView.js';
import { createCatView } from './catView.js';
import { shortestPathToEdge } from '../game/board.js';

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 */
export function createView(scene) {
  const boardView = createBoardView(scene);
  const catView = createCatView(scene);
  /** @type {import('../game/rules.js').GameState|null} */
  let state = null;
  let hintEnabled = false;

  function refreshHint() {
    if (hintEnabled && state) boardView.setHint(shortestPathToEdge(state.board));
    else boardView.setHint(null);
  }

  return {
    /** @type {import('../game/board.js').Board|null} */
    get board() {
      return state ? state.board : null;
    },

    /**
     * Rebuild every cell and the cat.
     * @param {import('../game/rules.js').GameState} s
     */
    rebuild(s) {
      state = s;
      boardView.rebuild(s);
      catView.place(s.board, s.board.cat);
      catView.reset();
      refreshHint();
    },

    /**
     * Highlight candidates (escape mode: cat moves; trapper mode: none).
     * @param {number[]} indices
     */
    setHighlights(indices) {
      boardView.setHighlights(indices);
    },

    /**
     * "Show path hint": the cat's shortest route (null clears it).
     * @param {number[]|null} pathIndices
     */
    setHint(pathIndices) {
      boardView.setHint(pathIndices);
    },

    /**
     * Hint checkbox: while on, the hint is refreshed after every move.
     * @param {boolean} on
     */
    setHintEnabled(on) {
      hintEnabled = !!on;
      refreshHint();
    },

    /**
     * @param {number} i
     * @returns {Promise<void>} cell rises, ~200ms
     */
    async animateBlock(i) {
      await boardView.animateBlock(i);
      refreshHint();
    },

    /**
     * @param {number} from
     * @param {number} to
     * @returns {Promise<void>} hop, ~250ms
     */
    async animateCatMove(from, to) {
      if (state) await catView.hop(state.board, from, to);
      refreshHint();
    },

    /**
     * @param {'catWin'|'trapperWin'} status
     * @returns {Promise<void>}
     */
    async animateResult(status) {
      boardView.setHint(null); // the route no longer matters
      if (status === 'catWin') {
        if (state) await catView.runOff(state.board);
      } else {
        await catView.sit();
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
    },
    isCellEmpty(i) {
      return boardView.isCellEmpty(i);
    },
    get cellMeshes() {
      return boardView.meshes;
    },
  };
}
