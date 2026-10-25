/**
 * Rulesets: `basicRuleset` and `gimmickRuleset` expose the same interface so
 * the controller and the play-style layer can drive either game:
 *
 *   { kind:'basic'|'gimmick',
 *     newGame({role, ai, blocks, gimmick?, playerItems?, seed}) → state,
 *     legalBlocks(state), legalCatMoves(state), applyBlock(state,i), applyCatMove(state,i),
 *     chooseCatMove(state,rng), chooseBlock(state,rng),
 *     canUseItem(state, side) → boolean, armItem(state), disarmItem(state),
 *     shouldUseItem(state, rng) → boolean }
 *
 * The basic ruleset only wraps the existing modules (which stay untouched);
 * the `blocks` override generates the initial board here, reusing the same
 * helpers rules.js uses. Pure logic — no Babylon.js, no DOM.
 */
import { mulberry32 } from './rng.js';
import { createBoard, distanceMap } from './board.js';
import {
  INITIAL_BLOCKS,
  newGame as basicNewGame,
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
} from './rules.js';
import { chooseCatMove as basicChooseCatMove } from './catAI.js';
import { chooseBlock as basicChooseBlock } from './trapperAI.js';
import * as gimmick from './gimmick/gimmickRules.js';
import {
  chooseCatMove as gimmickChooseCatMove,
  chooseBlock as gimmickChooseBlock,
  shouldUseItem as gimmickShouldUseItem,
  shouldUsePower as gimmickShouldUsePower,
  chooseAICat as gimmickChooseAICat,
  hintCat as gimmickHintCat,
} from './gimmick/gimmickAI.js';
import { gShortestPathToEdge } from './gimmick/graph.js';

/**
 * Block count for a new game: the explicit `blocks` option, otherwise
 * `INITIAL_BLOCKS[role][ai]` (the old section-1 behavior).
 * @param {import('./rules.js').Mode} role
 * @param {import('./rules.js').Difficulty} ai
 * @param {number} [blocks]
 * @returns {number}
 */
function resolveBlocks(role, ai, blocks) {
  if (typeof blocks === 'number') return blocks;
  const n = INITIAL_BLOCKS[role] && INITIAL_BLOCKS[role][ai];
  if (typeof n !== 'number') throw new Error(`unknown role/ai: ${role}/${ai}`);
  return n;
}

/**
 * `newGame` with an explicit block count for the basic rules — mirrors the
 * generation loop of rules.js (seeded, up to 100 retries, then count − 1)
 * without editing that module.
 * @param {{role:import('./rules.js').Mode, ai:import('./rules.js').Difficulty,
 *          blocks:number, seed?:number, W?:number, H?:number}} opts
 * @returns {import('./rules.js').GameState}
 */
function basicNewGameWithBlocks({ role, ai, blocks, seed = Date.now() >>> 0, W = 11, H = 11 }) {
  const board = createBoard(W, H);
  const rng = mulberry32(seed);
  const n = W * H;
  const pool = [];
  for (let i = 0; i < n; i++) if (i !== board.cat) pool.push(i);

  let count = Math.max(0, Math.floor(blocks));
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
    if (placed || count === 0) break;
    count--;
  }

  return {
    board,
    mode: role,
    difficulty: ai,
    turn: role === 'trapper' ? 'trapper' : 'cat',
    status: 'playing',
    moveCount: 0,
    seed,
    history: [],
    // 16.1: the count actually placed (the retries lower it by 1)
    placedBlocks: count,
  };
}

/** The number of blocked cells actually on the board (16.1). */
function countBlocked(board) {
  let n = 0;
  for (let i = 0; i < board.blocked.length; i++) if (board.blocked[i]) n++;
  return n;
}

/** Wraps the untouched basic modules (items do not exist). */
export const basicRuleset = {
  kind: 'basic',
  /**
   * @param {{role:import('./rules.js').Mode, ai:import('./rules.js').Difficulty,
   *          blocks?:number, seed?:number}} opts
   */
  newGame({ role, ai, blocks, seed }) {
    if (typeof blocks === 'number') {
      return basicNewGameWithBlocks({ role, ai, blocks, seed });
    }
    const state = basicNewGame({ mode: role, difficulty: ai, seed });
    // 16.1: rules.js keeps its own setup loop untouched, so read the
    // placed count off the board
    state.placedBlocks = countBlocked(state.board);
    return state;
  },
  legalBlocks,
  legalCatMoves,
  applyBlock,
  applyCatMove,
  chooseCatMove: basicChooseCatMove,
  chooseBlock: basicChooseBlock,
  canUseItem: () => false,
  armItem: () => {},
  disarmItem: () => {},
  shouldUseItem: () => false,
};

/**
 * The gimmick modules, exposed under the same interface. Extras:
 * - multi-cat (spec 13.7): `selectCat` applies the player's cat choice,
 *   `chooseAICat` returns which cat the AI moves (the controller applies it
 *   with `selectCat` before `shouldUseItem`/`chooseCatMove`), and
 *   `hintPath` is the gimmick-aware hint route of the relevant cat.
 * - comeback gimmicks (14.5): `canUsePower`/`armPower`/`stopDash` drive the
 *   dash and the corner jump, `shouldUsePower` is the AI's decision.
 *   The basic ruleset has none of these — the controller optional-chains.
 */
export const gimmickRuleset = {
  kind: 'gimmick',
  /**
   * @param {{role:import('./rules.js').Mode, ai:import('./rules.js').Difficulty,
   *          blocks?:number, gimmick?:object, playerItems?:object, seed?:number}} opts
   */
  newGame({ role, ai, blocks, gimmick: cellsOpt, playerItems, seed }) {
    return gimmick.newGame({
      role,
      ai,
      blocks: resolveBlocks(role, ai, blocks),
      gimmick: cellsOpt,
      playerItems,
      seed,
    });
  },
  legalBlocks: gimmick.legalBlocks,
  legalCatMoves: gimmick.legalCatMoves,
  applyBlock: gimmick.applyBlock,
  applyCatMove: gimmick.applyCatMove,
  chooseCatMove: gimmickChooseCatMove,
  chooseBlock: gimmickChooseBlock,
  canUseItem: gimmick.canUseItem,
  armItem: gimmick.armItem,
  disarmItem: gimmick.disarmItem,
  shouldUseItem: gimmickShouldUseItem,
  selectCat: gimmick.selectCat,
  chooseAICat: gimmickChooseAICat,
  canUsePower: gimmick.canUsePower,
  armPower: gimmick.armPower,
  stopDash: gimmick.stopDash,
  shouldUsePower: gimmickShouldUsePower,
  /**
   * The cells the last cat move passed over (13.5): the view animates
   * them with `animateCatPath` (empty for a hammer break — the cat did
   * not move).
   * @param {import('./gimmick/gimmickRules.js').GimmickState} state
   * @returns {number[]}
   */
  lastMovePath(state) {
    return state.lastPath || [];
  },
  /**
   * @param {import('./gimmick/gimmickRules.js').GimmickState} state
   * @returns {number[]|null}
   */
  hintPath(state) {
    return gShortestPathToEdge(state, gimmickHintCat(state));
  },
};
