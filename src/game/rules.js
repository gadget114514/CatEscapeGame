/**
 * Game rules: new game setup, legal moves, applying moves, status evaluation.
 * Pure logic — no Babylon.js, no DOM.
 */
import { mulberry32 } from './rng.js';
import { createBoard, isEmpty, emptyNeighbors, distanceMap } from './board.js';
import { isBorder } from './hex.js';

/**
 * @typedef {'trapper'|'escape'} Mode
 * @typedef {'easy'|'normal'|'hard'} Difficulty
 * @typedef {'trapper'|'cat'} Side
 * @typedef {{ board: import('./board.js').Board, mode:Mode, difficulty:Difficulty,
 *             turn:Side, status:'playing'|'catWin'|'trapperWin', moveCount:number,
 *             seed:number, history:Array<{side:Side, index:number}> }} GameState
 */

/** Number of initial blocks per mode and difficulty (spec section 1). */
export const INITIAL_BLOCKS = {
  trapper: { easy: 15, normal: 11, hard: 7 },
  escape: { easy: 5, normal: 8, hard: 11 },
};

/**
 * Create a fresh game. Initial blocks are placed at random, never on the cat's
 * cell, retrying until the cat has at least one route to the edge (up to 100
 * retries, then the block count is reduced by 1).
 * @param {{mode:Mode, difficulty:Difficulty, seed?:number, W?:number, H?:number}} opts
 * @returns {GameState}
 */
export function newGame({ mode, difficulty, seed = Date.now() >>> 0, W = 11, H = 11 }) {
  const countFor = INITIAL_BLOCKS[mode] && INITIAL_BLOCKS[mode][difficulty];
  if (typeof countFor !== 'number') {
    throw new Error(`unknown mode/difficulty: ${mode}/${difficulty}`);
  }
  const board = createBoard(W, H);
  const rng = mulberry32(seed);
  const n = W * H;

  const pool = [];
  for (let i = 0; i < n; i++) if (i !== board.cat) pool.push(i);

  let count = countFor;
  for (;;) {
    let placed = false;
    for (let t = 0; t < 100; t++) {
      board.blocked.fill(0);
      const chosen = pool.slice();
      for (let k = 0; k < count; k++) {
        const j = k + Math.floor(rng() * (chosen.length - k));
        const tmp = chosen[k];
        chosen[k] = chosen[j];
        chosen[j] = tmp;
      }
      for (let k = 0; k < count; k++) board.blocked[chosen[k]] = 1;
      if (distanceMap(board).dist[board.cat] !== -1) {
        placed = true;
        break;
      }
    }
    if (placed) break;
    if (count === 0) break;
    count--;
  }

  return {
    board,
    mode,
    difficulty,
    turn: mode === 'trapper' ? 'trapper' : 'cat',
    status: 'playing',
    moveCount: 0,
    seed,
    history: [],
  };
}

/**
 * All cells the trapper may block (every empty cell, never the cat's cell).
 * @param {GameState} state
 * @returns {number[]}
 */
export function legalBlocks(state) {
  const out = [];
  for (let i = 0; i < state.board.W * state.board.H; i++) {
    if (isEmpty(state.board, i)) out.push(i);
  }
  return out;
}

/**
 * All cells the cat may move to (its empty neighbors).
 * @param {GameState} state
 * @returns {number[]}
 */
export function legalCatMoves(state) {
  return emptyNeighbors(state.board, state.board.cat);
}

function checkIndex(state, i) {
  if (!Number.isInteger(i) || i < 0 || i >= state.board.W * state.board.H) {
    throw new Error(`illegal move index: ${i}`);
  }
}

/**
 * Trapper action: block one empty cell (not the cat's cell).
 * Mutates `state`; throws on an illegal move; turn → 'cat'; recomputes status.
 * @param {GameState} state
 * @param {number} i
 */
export function applyBlock(state, i) {
  if (state.status !== 'playing') throw new Error('game is over');
  if (state.turn !== 'trapper') throw new Error("not the trapper's turn");
  checkIndex(state, i);
  if (!isEmpty(state.board, i)) throw new Error(`illegal block: ${i}`);
  state.board.blocked[i] = 1;
  state.history.push({ side: 'trapper', index: i });
  state.moveCount = state.history.length;
  state.turn = 'cat';
  evaluateStatus(state);
}

/**
 * Cat action: move to an empty neighboring cell.
 * Mutates `state`; throws on an illegal move; turn → 'trapper'; recomputes status.
 * @param {GameState} state
 * @param {number} i
 */
export function applyCatMove(state, i) {
  if (state.status !== 'playing') throw new Error('game is over');
  if (state.turn !== 'cat') throw new Error("not the cat's turn");
  checkIndex(state, i);
  if (!legalCatMoves(state).includes(i)) throw new Error(`illegal cat move: ${i}`);
  state.history.push({ side: 'cat', index: i });
  state.moveCount = state.history.length;
  state.board.cat = i;
  state.turn = 'trapper';
  evaluateStatus(state);
}

/**
 * cat on edge → catWin / cat's turn with no moves → trapperWin.
 * Mutates and returns `state.status`.
 * @param {GameState} state
 * @returns {GameState['status']}
 */
export function evaluateStatus(state) {
  const b = state.board;
  if (isBorder(b.cat, b.W, b.H)) {
    state.status = 'catWin';
  } else if (state.turn === 'cat' && emptyNeighbors(b, b.cat).length === 0) {
    state.status = 'trapperWin';
  } else {
    state.status = 'playing';
  }
  return state.status;
}
