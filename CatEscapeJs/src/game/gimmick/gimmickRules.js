/**
 * Gimmick rules: items (cat hammer / trapper double) and the gimmick cell
 * kinds placed through the registry (spec 13.1). The hammer follows the new
 * rule 14.1: it breaks one block at hex distance 2–3 as a free action
 * before the cat's move; the turn stays with the cat. Multiple cats with a
 * goal (`anyEscape` / `anyCatch`, spec 13.7) live in `state.cats` /
 * `state.escaped`; `state.selectedCat` names the moving cat and
 * `board.cat` always mirrors `cats[selectedCat]`, so the single-cat code
 * keeps working. The 14.5 comeback gimmicks live here too: the power gauge
 * with the dash and the corner jump, the dried fish cells and the storm.
 * Pure logic — no Babylon.js, no DOM. Reuses board.js, hex.js and the
 * gimmick registry/graph.
 */
import { mulberry32, shuffle } from '../rng.js';
import { createBoard, distanceMap } from '../board.js';
import { isBorder, toIndex } from '../hex.js';
import { hexDistance, step } from './hexDir.js';
import {
  KINDS,
  CELL_NORMAL,
  CELL_ITEM,
  CELL_STONE,
  KIND_BRITTLE,
  createG,
  isBlockable,
  catInWay,
  canEnter,
  onLand,
  afterBlock,
  onTrapperTurnEnd,
} from './registry.js';
import { forCat, gMoves, gDistanceMap, moveCells } from './graph.js';

export { CELL_NORMAL, CELL_ITEM, CELL_STONE };

/** Item counts are capped at 9 (spec 12.4). */
export const ITEM_CAP = 9;

/** Power gauge (14.5/5.2): 0–6 pips, dash and corner jump both cost the
 *  full 6; the dash covers at most 2 steps (was 4 pips / 3 steps). */
export const POWER_CAP = 6;
export const DASH_COST = 6;
export const DASH_STEPS = 2;
export const JUMP_COST = 6;

/** Outer setup attempts: blocks + all kinds, then the cat-route check. */
const SETUP_ATTEMPTS = 30;

/** Start cells for 2 and 3 cats (spec 13.7, moved toward the center by
 *  Rev. 8/19.3): rows/cols on the 11×11 board. */
export const CAT_STARTS = {
  2: (W) => [toIndex(5, 4, W), toIndex(5, 6, W)],
  3: (W) => [toIndex(4, 5, W), toIndex(5, 4, W), toIndex(6, 6, W)],
};

/**
 * @typedef {{ board: import('../board.js').Board,
 *             g: { kind:Uint8Array, partner:Int16Array, dir:Int8Array, ttl:Int16Array },
 *             cells: Uint8Array,
 *             items: { trapper: {double:number}, cat: {hammer:number} },
 *             role: import('../rules.js').Side, mode: import('../rules.js').Side,
 *             ai: import('../rules.js').Difficulty,
 *             difficulty: import('../rules.js').Difficulty,
 *             turn: import('../rules.js').Side,
 *             status: 'playing'|'catWin'|'trapperWin', moveCount:number, seed:number,
 *             history: Array<{side:import('../rules.js').Side, index:number, kind:string}>,
 *             armed: boolean, armKind: 'hammer'|'double'|'dash'|'jump'|null,
 *             blocksLeft: 1|number, hammerUsed: boolean,
 *             catStuckTurns: number,
 *             lastPath: number[], crumbles: number[],
 *             cats: number[], escaped: number, catTotal: number,
 *             catsGoal: 'anyEscape'|'anyCatch'|null, selectedCat: number,
 *             power: number, dashLeft: number,
 *             features: { power:boolean, dash:boolean, jump:boolean, storm:boolean },
 *             stormUsed: boolean, storm: number[]|null,
 *             placedBlocks: number }} GimmickState
 */

function clampItem(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 0) n = 0;
  return n > ITEM_CAP ? ITEM_CAP : n;
}

/**
 * Resolve the per-side item counts from the saved inventory (`playerItems`,
 * either the full `{hammer, double}` inventory shape or a plain number for
 * the player's own item) and the level's `aiItems` count.
 * @param {import('../rules.js').Side} role the player's side
 * @param {number|{hammer?:number, double?:number}} playerItems
 * @param {number} aiItems
 */
function resolveItems(role, playerItems, aiItems) {
  const items = { trapper: { double: 0 }, cat: { hammer: 0 } };
  const pv =
    typeof playerItems === 'number'
      ? playerItems
      : playerItems && (role === 'escape' ? playerItems.hammer : playerItems.double);
  const av = typeof aiItems === 'number' ? aiItems : 0;
  if (role === 'escape') {
    items.cat.hammer = clampItem(pv);
    items.trapper.double = clampItem(av);
  } else {
    items.trapper.double = clampItem(pv);
    items.cat.hammer = clampItem(av);
  }
  return items;
}

/**
 * Normalize the per-kind counts from the level table shape
 * `{stone, tunnel, ice, arrow, brittle, spring, item}`.
 * @param {object} [gimmicks]
 * @returns {Record<string, number>}
 */
function normalizeCounts(gimmicks) {
  const out = {};
  for (const m of KINDS) {
    const v = gimmicks && Number(gimmicks[m.id]);
    out[m.id] = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  return out;
}

/**
 * Normalize the 14.5 feature flags; everything is off when the caller does
 * not pass them (basic streaks, older callers), so the comeback gimmicks
 * only exist where the level table switches them on.
 * @param {{power?:boolean, dash?:boolean, jump?:boolean, storm?:boolean}} [f]
 * @returns {{power:boolean, dash:boolean, jump:boolean, storm:boolean}}
 */
function normalizeFeatures(f) {
  return {
    power: !!(f && f.power),
    dash: !!(f && f.dash),
    jump: !!(f && f.jump),
    storm: !!(f && f.storm),
  };
}

/**
 * Create a fresh gimmick game. Blocks are placed first, exactly as in
 * section 1 (seeded, up to 100 retries, then count − 1), then the gimmick
 * kinds place themselves in unlock order. The whole setup retries until
 * every cat has a gimmick-aware route to the edge (spec 13.7). Multi-cat
 * games (`gimmick.cats` = 2 or 3) start from the fixed cells of the 13.7
 * table; `gimmick.catsGoal` selects `anyEscape` (default) or `anyCatch`.
 * `gimmick.features` switches on the 14.5 comeback gimmicks (power gauge,
 * dash, corner jump, storm) for this game.
 * @param {{role:import('../rules.js').Side, ai:import('../rules.js').Difficulty,
 *          blocks:number,
 *          gimmick?:{gimmicks?:object, aiItems?:number, cats?:number,
 *                    catsGoal?:'anyEscape'|'anyCatch',
 *                    features?:{power?:boolean, dash?:boolean,
 *                                jump?:boolean, storm?:boolean}},
 *          playerItems?:number|{hammer?:number, double?:number},
 *          seed?:number, W?:number, H?:number}} opts
 * @returns {GimmickState}
 */
export function newGame({
  role,
  ai,
  blocks,
  gimmick = {},
  playerItems = {},
  seed = Date.now() >>> 0,
  W = 11,
  H = 11,
}) {
  if (typeof blocks !== 'number' || blocks < 0) {
    throw new Error(`gimmick newGame requires a block count, got: ${blocks}`);
  }
  const board = createBoard(W, H);
  const rng = mulberry32(seed);
  const n = W * H;
  const g = createG(n);
  const counts = normalizeCounts(gimmick.gimmicks);

  const catCount = Math.min(Math.max(Math.floor(Number(gimmick.cats) || 1), 1), 3);
  const catsGoal =
    catCount >= 2 ? (gimmick.catsGoal === 'anyCatch' ? 'anyCatch' : 'anyEscape') : null;
  const catStarts =
    catCount >= 2 ? CAT_STARTS[catCount](W).slice() : [board.cat];

  const state = {
    board,
    g,
    cells: g.kind, // alias kept for the view (item/stone numbering unchanged)
    items: { trapper: { double: 0 }, cat: { hammer: 0 } },
    role,
    mode: role, // HUD compatibility (basic states carry `mode`)
    ai,
    difficulty: ai, // AI difficulty, same convention as basic states
    turn: role === 'trapper' ? 'trapper' : 'cat',
    status: 'playing',
    moveCount: 0,
    seed,
    history: [],
    armed: false,
    armKind: null,
    blocksLeft: 1,
    hammerUsed: false,
    // 19.4: consecutive cat turns that began with no legal cat move
    catStuckTurns: 0,
    lastPath: [],
    crumbles: [],
    cats: catStarts.slice(),
    escaped: 0,
    catTotal: catStarts.length,
    catsGoal,
    selectedCat: 0,
    // 14.5 comeback gimmicks
    features: normalizeFeatures(gimmick.features),
    power: 0,
    dashLeft: 0,
    stormUsed: false,
    storm: null,
  };
  board.cat = catStarts[0];

  const pool = [];
  for (let i = 0; i < n; i++) if (!catStarts.includes(i)) pool.push(i);

  /** Every cat has a plain route to the edge (fast inner check). */
  function plainRoutesOk() {
    const d = distanceMap(board);
    return catStarts.every((c) => d.dist[c] !== -1);
  }

  let count = Math.max(0, Math.floor(blocks));
  for (let attempt = 0; attempt < SETUP_ATTEMPTS; attempt++) {
    g.kind.fill(0);
    g.partner.fill(-1);
    g.dir.fill(-1);
    g.ttl.fill(0);

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
      if (plainRoutesOk()) {
        placed = true;
        break;
      }
    }
    if (!placed && count > 0) {
      count--;
      continue;
    }

    let kindsOk = true;
    for (const m of KINDS) {
      const c = counts[m.id] || 0;
      if (c > 0 && m.place && !m.place(state, c, rng)) {
        kindsOk = false;
        break;
      }
    }
    if (!kindsOk) continue;
    // the route guarantee applies to every cat (13.7)
    let allOk = true;
    for (let j = 0; j < state.cats.length; j++) {
      if (gDistanceMap(state, j).dist[state.cats[j]] === -1) {
        allOk = false;
        break;
      }
    }
    if (allOk) break;
  }

  // 16.1: the count that was actually placed — the setup lowers it after
  // 100 failed tries, and the sweep/calibration report that number
  state.placedBlocks = count;
  state.items = resolveItems(role, playerItems, gimmick.aiItems || 0);
  syncSelection(state);
  // 18.2: the opening trapper turn places one block per free cat (a fresh
  // board always has every cat movable, so this is `cats`) — unless there
  // is nothing blockable at all, in which case the turn is skipped (19.4)
  if (role === 'trapper') {
    state.blocksLeft = trapperBlocksLeft(state);
    if (state.blocksLeft <= 0 || legalBlocks(state).length === 0) endTrapperTurn(state);
  }

  return state;
}

/**
 * How many blocks the trapper places this turn:
 * - `anyEscape` (18.2): **one per cat that can still move** — a cat with no
 *   legal move doesn't count; the trapper has to stop every cat.
 * - `anyCatch` (Rev. 8/19.1): **one per turn** (+1 with a double), as with
 *   a single cat — the trapper only needs to trap one cat, so a per-cat
 *   budget would overwhelm the cat side.
 * `anyCatch`'s escaped cats are already removed from `state.cats`, so they
 * never count. One more block is added while a double is armed.
 * @param {GimmickState} state
 * @returns {number}
 */
export function trapperBlocksLeft(state) {
  let free = 0;
  const cats = state.cats;
  if (state.catsGoal === 'anyCatch' && cats && cats.length > 0) {
    for (let j = 0; j < cats.length; j++) {
      if (gMoves(state, cats[j], j).length > 0) {
        free = 1;
        break;
      }
    }
  } else if (cats && cats.length > 0) {
    for (let j = 0; j < cats.length; j++) {
      if (gMoves(state, cats[j], j).length > 0) free += 1;
    }
  } else if (gMoves(state, state.board.cat).length > 0) {
    free = 1;
  }
  const double = state.armed && state.armKind === 'double' ? 1 : 0;
  return free + double;
}

/**
 * Re-derive the selected cat (spec 13.7): with one movable cat it is
 * selected automatically; otherwise the current selection is kept when it
 * can still move, else the first movable cat. Keeps `board.cat` in sync.
 * @param {GimmickState} state
 */
export function syncSelection(state) {
  const cats = state.cats;
  if (!cats || cats.length === 0) return;
  // single cat: board.cat is authoritative (fixtures may move it directly)
  if (cats.length === 1 && cats[0] !== state.board.cat) cats[0] = state.board.cat;
  const movable = [];
  for (let j = 0; j < cats.length; j++) {
    if (gMoves(state, cats[j], j).length > 0) movable.push(j);
  }
  let sel = state.selectedCat;
  if (!Number.isInteger(sel) || sel < 0 || sel >= cats.length || !movable.includes(sel)) {
    sel = movable.length > 0 ? movable[0] : Math.min(Math.max(sel || 0, 0), cats.length - 1);
  }
  state.selectedCat = sel;
  state.board.cat = cats[sel];
}

/**
 * Select the cat the player (or controller) clicked (spec 13.7). Also
 * mirrors it into `board.cat` so the single-cat helpers agree.
 * @param {GimmickState} state
 * @param {number} j index into `state.cats`
 * @returns {boolean} false when there is no cat to select
 */
export function selectCat(state, j) {
  const cats = state.cats;
  if (!cats || cats.length === 0) return false;
  if (!Number.isInteger(j) || j < 0 || j >= cats.length) {
    throw new Error(`illegal cat index: ${j}`);
  }
  state.selectedCat = j;
  state.board.cat = cats[j];
  return true;
}

/**
 * What is armed right now? Fixtures set `armed = true` without an
 * `armKind`, so the default is the hammer (14.1 behavior unchanged).
 * @param {GimmickState} state
 * @returns {'hammer'|'double'|'dash'|'jump'|null}
 */
export function armKindOf(state) {
  if (!state.armed) return null;
  return state.armKind || 'hammer';
}

/**
 * Empty neighbors of `cell`: not blocked and no other cat standing there.
 * The 14.5 pressure/corner-jump reading of "the cat is cornered".
 * @param {GimmickState} state
 * @param {number} cell
 * @returns {number}
 */
export function countEmptyNeighbors(state, cell) {
  const b = state.board;
  let n = 0;
  for (const j of b.nbr[cell]) {
    if (!b.blocked[j] && !catInWay(state, j)) n++;
  }
  return n;
}

/**
 * The corner jump (窮鼠ジャンプ, 14.5): while the selected cat has at most
 * 2 empty neighbors it may jump over exactly one adjacent block in a
 * straight line — `step(step(cat, dir), dir)` — when the landing cell is
 * on the board, empty and enterable. Empty result while the jump feature
 * is off (or the cat has 3+ empty neighbors).
 * @param {GimmickState} state
 * @param {number} [catIndex] multi-cat: the jumping cat (default selected)
 * @returns {Array<{dir:number, over:number, to:number}>}
 */
export function jumpTargets(state, catIndex) {
  const s = catIndex == null ? state : forCat(state, catIndex);
  const b = s.board;
  if (!s.features || !s.features.jump) return [];
  const cat = b.cat;
  if (countEmptyNeighbors(s, cat) > 2) return [];
  const out = [];
  for (let dir = 0; dir < 6; dir++) {
    const over = step(cat, dir, b.W, b.H);
    if (over < 0 || !b.blocked[over]) continue; // exactly one adjacent block
    const to = step(over, dir, b.W, b.H);
    if (to < 0 || b.blocked[to] || catInWay(s, to)) continue;
    if (!canEnter(s, cat, to, dir)) continue;
    out.push({ dir, over, to });
  }
  return out;
}

/**
 * The comeback exception (14.5): with a full gauge the corner jump keeps a
 * cornered cat in the game — it is not stuck while a jump is possible.
 * @param {GimmickState} state
 * @param {number} [catIndex]
 * @returns {boolean}
 */
export function jumpRescue(state, catIndex) {
  const s = catIndex == null ? state : forCat(state, catIndex);
  if (!s.features || !s.features.jump) return false;
  if (s.power < JUMP_COST) return false;
  return jumpTargets(s).length > 0;
}

/**
 * Pips for one cat-side move (18.3): +1 **only when the moved cat started
 * the move with at most 3 empty neighbors** ("running under pressure").
 * The old flat +1 per move and the ≤ 2 pressure bonus are gone; a
 * trapper double still feeds +2.
 * @param {GimmickState} state
 * @param {number} fromCell the cell the move started from
 */
function gainMovePower(state, fromCell) {
  if (!state.features.power) return;
  if (countEmptyNeighbors(state, fromCell) <= 3) {
    state.power = Math.min(POWER_CAP, state.power + 1);
  }
}

/**
 * The storm (あらし, 14.5): the first time any cat becomes enclosed
 * (`dist == -1`), 3 random blocks fly away — never ones next to a cat.
 * The indices land in `state.storm` for the view (`animateStorm`); the
 * controller clears them after it consumed them. Fires at most once.
 * @param {GimmickState} state
 */
function maybeStorm(state) {
  if (!state.features.storm || state.stormUsed) return;
  const b = state.board;
  const cats = state.cats && state.cats.length > 0 ? state.cats : [b.cat];
  let enclosed = false;
  for (let j = 0; j < cats.length; j++) {
    if (gDistanceMap(state, j).dist[cats[j]] === -1) {
      enclosed = true;
      break;
    }
  }
  if (!enclosed) return;
  state.stormUsed = true;
  const nearCat = new Uint8Array(b.W * b.H);
  for (const c of cats) for (const j of b.nbr[c]) nearCat[j] = 1;
  const pool = [];
  for (let i = 0; i < b.W * b.H; i++) {
    if (b.blocked[i] && !nearCat[i]) pool.push(i);
  }
  const rng = mulberry32((state.seed ^ Math.imul(state.moveCount + 1, 0x9e3779b9)) >>> 0);
  shuffle(rng, pool);
  const blown = pool.slice(0, 3);
  for (const i of blown) b.blocked[i] = 0;
  state.storm = blown;
}

/**
 * Write the mover's new position into `cats`/`board.cat` (13.7): under
 * `anyCatch` a cat reaching an edge has run off the board and is removed.
 * @param {GimmickState} state
 * @param {number} idx index into `state.cats` (ignored without cats)
 * @param {number} land
 */
function commitMover(state, idx, land) {
  const b = state.board;
  if (state.cats) {
    if (state.catsGoal === 'anyCatch' && isBorder(land, b.W, b.H)) {
      // the cat runs off the board; the others play on (13.7)
      state.cats.splice(idx, 1);
      state.escaped += 1;
      state.selectedCat = state.cats.length > 0 ? Math.min(idx, state.cats.length - 1) : -1;
      if (state.cats.length > 0) b.cat = state.cats[state.selectedCat];
    } else {
      state.cats[idx] = land;
      state.selectedCat = idx;
      b.cat = land;
    }
  } else {
    b.cat = land;
  }
}

/**
 * Can the cat side still act? At least one cat has a legal move, or the
 * 14.5 corner jump can rescue a stuck one (full gauge + landing).
 * @param {GimmickState} state
 * @returns {boolean}
 */
function catSideHasMove(state) {
  const cats = state.cats;
  if (cats && cats.length > 0) {
    for (let j = 0; j < cats.length; j++) {
      if (gMoves(state, cats[j], j).length > 0 || jumpRescue(state, j)) return true;
    }
    return false;
  }
  return gMoves(state, state.board.cat).length > 0 || jumpRescue(state);
}

/**
 * Start the trapper's turn (18.2): the trapper places one block per free
 * cat (`anyEscape`) or one block per turn (`anyCatch`, Rev. 8/19.1). When
 * no cat can move at all — or, per Rev. 8/19.4, when there is nothing
 * blockable left on the board — the empty turn passes straight on; the
 * status check on the cat side then ends the game.
 * @param {GimmickState} state
 */
function beginTrapperTurn(state) {
  state.turn = 'trapper';
  state.blocksLeft = trapperBlocksLeft(state);
  if (state.blocksLeft <= 0 || legalBlocks(state).length === 0) endTrapperTurn(state);
}

/**
 * End the trapper's turn (after its last block, or an empty 18.2/19.4
 * turn): brittle timers tick (`onTrapperTurnEnd`), the (only) movable cat
 * is auto-selected and `blocksLeft` goes back to its neutral 1.
 * Rev. 8/19.4 backstop: when the cat side begins a second consecutive cat
 * turn with no legal move at all (all cats stuck, no jump available) the
 * trapper wins — a safety net beside the immediate stuck check of
 * `evaluateStatus`.
 * @param {GimmickState} state
 */
function endTrapperTurn(state) {
  state.blocksLeft = 1;
  state.armed = false;
  state.armKind = null;
  state.turn = 'cat';
  state.hammerUsed = false;
  const events = [];
  onTrapperTurnEnd(state, events);
  state.crumbles = events.filter((e) => e.type === 'crumble').map((e) => e.cell);
  syncSelection(state); // auto-select the (only) movable cat before its turn
  if (state.status === 'playing' && !catSideHasMove(state)) {
    state.catStuckTurns += 1;
    if (state.catStuckTurns >= 2) state.status = 'trapperWin';
  } else {
    state.catStuckTurns = 0;
  }
}

/**
 * Pass the turn away from the cat (end of a move/dash/jump) to the
 * trapper, whose block budget follows 18.2.
 * @param {GimmickState} state
 */
function passTurnFromCat(state) {
  state.armed = false;
  state.armKind = null;
  state.dashLeft = 0;
  beginTrapperTurn(state);
}

/**
 * All cells the trapper may block: empty cells every gimmick allows
 * (item/stone/tunnel/arrow/spring/fish cells are excluded by
 * `isBlockable`; ice and brittle cells are normal block targets).
 * @param {GimmickState} state
 * @returns {number[]}
 */
export function legalBlocks(state) {
  const out = [];
  for (let i = 0; i < state.board.W * state.board.H; i++) {
    if (isBlockable(state, i)) out.push(i);
  }
  return out;
}

/**
 * The armed hammer's break targets (14.1): blocked cells at hex distance
 * 2 or 3 from the cat. Blocks adjacent to a cat can never be broken —
 * distance 2–3 already excludes the cat's own neighbors.
 * @param {GimmickState} state
 * @returns {number[]}
 */
export function hammerTargets(state) {
  const b = state.board;
  const out = [];
  if (state.items.cat.hammer <= 0) return out;
  for (let i = 0; i < b.W * b.H; i++) {
    if (!b.blocked[i]) continue;
    const d = hexDistance(b.cat, i, b.W);
    if (d === 2 || d === 3) out.push(i);
  }
  return out;
}

/**
 * All cells the cat may click this turn: the entries of its legal moves
 * (gimmick-aware: not blocked, `canEnter` ok) plus, while an action is
 * armed, its targets — the hammer's break cells (14.1) or the corner
 * jump's landing cells (14.5). While a dash is armed the normal move list
 * *is* the dash's next step.
 * @param {GimmickState} state
 * @returns {number[]}
 */
export function legalCatMoves(state) {
  const b = state.board;
  const out = [];
  for (const m of gMoves(state, b.cat)) out.push(m.to);
  const kind = armKindOf(state);
  if (kind === 'jump') out.push(...jumpTargets(state).map((t) => t.to));
  else if (kind === 'hammer') out.push(...hammerTargets(state));
  return out;
}

function checkIndex(state, i) {
  if (!Number.isInteger(i) || i < 0 || i >= state.board.W * state.board.H) {
    throw new Error(`illegal move index: ${i}`);
  }
}

/**
 * Trapper action: block one blockable cell. The turn's budget is one
 * block per free cat under `anyEscape` (18.2) or one per turn under
 * `anyCatch` (Rev. 8/19.1), one more while a double is armed: while
 * `blocksLeft` stays above 0 the turn stays with the trapper; the last
 * block passes it to the cat side (brittle timers run then). Rev. 8/19.4:
 * when no blockable cell is left the turn also passes at once.
 * @param {GimmickState} state
 * @param {number} i
 */
export function applyBlock(state, i) {
  if (state.status !== 'playing') throw new Error('game is over');
  if (state.turn !== 'trapper') throw new Error("not the trapper's turn");
  checkIndex(state, i);
  if (!isBlockable(state, i)) throw new Error(`illegal block: ${i}`);
  state.board.blocked[i] = 1;
  afterBlock(state, i);
  state.history.push({ side: 'trapper', index: i, kind: 'block' });
  state.moveCount = state.history.length;
  state.blocksLeft -= 1;
  state.crumbles = [];
  if (state.blocksLeft <= 0 || legalBlocks(state).length === 0) endTrapperTurn(state);
  maybeStorm(state); // 14.5: the first enclosed cat calls the storm
  evaluateStatus(state);
}

/**
 * Find the cat that can move to entry `i`: the selected cat first, else the
 * lowest-index cat that reaches it (spec 13.7 — with two cats on the same
 * entry the resulting position is identical either way).
 * @param {GimmickState} state
 * @param {number} i
 * @returns {{index:number, move:object}|null}
 */
function resolveCatMove(state, i) {
  const cats = state.cats;
  const sel = state.selectedCat || 0;
  if (!cats || cats.length === 0 || cats[sel] !== state.board.cat) {
    // single cat, or a fixture that moved board.cat directly
    const move = gMoves(state, state.board.cat).find((m) => m.to === i);
    return move ? { index: sel, move } : null;
  }
  const tryCat = (j) => {
    const s = j === sel ? state : { ...state, selectedCat: j, board: { ...state.board, cat: cats[j] } };
    return gMoves(s, cats[j]).find((m) => m.to === i) || null;
  };
  let move = tryCat(sel);
  if (move) return { index: sel, move };
  for (let j = 0; j < cats.length; j++) {
    if (j === sel) continue;
    move = tryCat(j);
    if (move) return { index: j, move };
  }
  return null;
}

/**
 * Cat action. While the hammer is armed, clicking a break target destroys
 * the block (14.1): `hammer -= 1`, history kind `'break'`, and the turn
 * **stays** with the cat, which must now make its normal move. While the
 * corner jump is armed, a click on one of its landing cells jumps there
 * (14.5, `applyJump`). Otherwise a normal move follows a legal direction
 * and lands on `landing(...)`; landing on an item cell picks it up (+1
 * hammer, shared cat-side inventory, cell becomes normal) and landing on a
 * dried fish cell crumbles the trapper's most recently placed block that
 * touches no cat (18.4, recorded in `state.crumbles`). Each cat-side move
 * adds a pip to the gauge when it starts under pressure (18.3). A dash
 * step (armed `'dash'`) spends 6 pips on the first step and keeps the
 * turn while steps remain; the dash ends at once on an edge, when the
 * steps run out or when the cat has nowhere left to go. At most one hammer
 * per turn (`hammerUsed`). With multiple cats (13.7) exactly one cat moves
 * — the selected one when it reaches `i`, else the lowest-index cat that
 * does; under `anyCatch` a cat reaching an edge runs off the board
 * (removed, `escaped += 1`) and the others play on.
 * @param {GimmickState} state
 * @param {number} i
 */
export function applyCatMove(state, i) {
  if (state.status !== 'playing') throw new Error('game is over');
  if (state.turn !== 'cat') throw new Error("not the cat's turn");
  checkIndex(state, i);
  if (!legalCatMoves(state).includes(i)) throw new Error(`illegal cat move: ${i}`);
  const b = state.board;
  const kind = armKindOf(state);
  state.catStuckTurns = 0; // the cat side acted: the 19.4 backstop resets

  if (b.blocked[i] === 1) {
    // hammer break (14.1): a free action before the move
    b.blocked[i] = 0;
    state.items.cat.hammer -= 1;
    state.hammerUsed = true;
    state.armed = false;
    state.armKind = null;
    state.history.push({ side: 'cat', index: i, kind: 'break' });
    state.moveCount = state.history.length;
    state.lastPath = [];
    state.crumbles = [];
    evaluateStatus(state);
    return;
  }

  if (kind === 'jump' && jumpTargets(state).some((x) => x.to === i)) {
    applyJump(state, i); // 14.5 corner jump
    return;
  }

  const found = resolveCatMove(state, i);
  /* istanbul ignore next — guarded by legalCatMoves above */
  if (!found) throw new Error(`illegal cat move: ${i}`);
  const idx = found.index;
  const move = found.move;
  // the kinds must see the moving cat as selected (tunnel/ice/spring
  // stop before the other cats exactly as before blocks)
  if (state.cats && state.cats.length > 1) {
    state.selectedCat = idx;
    b.cat = state.cats[idx];
  }

  const start = b.cat;
  const wasDash = kind === 'dash';
  const from = b.cat;
  const land = move.land;
  const path = moveCells(state, from, i, move.dir);
  const events = [];
  onLand(state, land, events);
  const fish = events.some((e) => e.type === 'fish');
  const pickup = events.some((e) => e.type === 'pickup');
  if (wasDash && state.dashLeft === DASH_STEPS) {
    state.power = Math.max(0, state.power - DASH_COST); // the dash is paid on its first step
  }
  gainMovePower(state, start); // 18.3: +1 only under pressure
  state.history.push({
    side: 'cat',
    index: land,
    kind: fish ? 'fish' : pickup ? 'pickup' : 'move',
  });
  state.moveCount = state.history.length;
  state.lastPath = path;
  // 18.4: a dried fish landing may crumble the trapper's newest far block
  state.crumbles = events.filter((e) => e.type === 'crumble').map((e) => e.cell);
  if (wasDash) state.dashLeft -= 1;
  commitMover(state, idx, land);

  const onEdge = isBorder(land, b.W, b.H);
  const dashContinues =
    wasDash && !onEdge && state.dashLeft > 0 && gMoves(state, b.cat, idx).length > 0;
  if (dashContinues) {
    state.turn = 'cat'; // next dash step; `armed`/`armKind` stay
  } else {
    passTurnFromCat(state); // also consumes a dried fish skip (14.5)
  }
  maybeStorm(state); // 14.5: the first enclosed cat calls the storm
  evaluateStatus(state);
}

/**
 * The corner jump (窮鼠ジャンプ, 14.5): the cat hops over exactly one
 * adjacent block onto `target.to`. The landing cell's gimmick triggers
 * normally (a dried fish crumbles a far block, 18.4), landing on an edge
 * wins, and the turn then passes as after a normal move. The gauge was
 * validated at arm time and pays here (6 pips, the full gauge).
 * @param {GimmickState} state
 * @param {number} i the landing cell
 */
function applyJump(state, i) {
  const b = state.board;
  const targets = jumpTargets(state);
  const t = targets.find((x) => x.to === i);
  /* istanbul ignore next — guarded by legalCatMoves above */
  if (!t) throw new Error(`illegal jump: ${i}`);
  const start = b.cat;
  const idx = state.selectedCat || 0;
  state.power = Math.max(0, state.power - JUMP_COST);
  const events = [];
  onLand(state, i, events);
  const fish = events.some((e) => e.type === 'fish');
  const pickup = events.some((e) => e.type === 'pickup');
  gainMovePower(state, start); // 18.3: +1 only under pressure
  state.history.push({
    side: 'cat',
    index: i,
    kind: fish ? 'fish' : pickup ? 'pickup' : 'jump',
  });
  state.moveCount = state.history.length;
  state.lastPath = [i];
  // 18.4: a dried fish landing may crumble the trapper's newest far block
  state.crumbles = events.filter((e) => e.type === 'crumble').map((e) => e.cell);
  commitMover(state, idx, i);
  passTurnFromCat(state); // 18.2: the trapper's budget follows the free cats
  maybeStorm(state);
  evaluateStatus(state);
}

/**
 * Arm the current side's item. The trapper's double decrements the count
 * immediately and adds one block to the turn's budget (18.2: free cats +
 * this double) — and feeds the cat side's 14.5 gauge +2 pips; the cat's
 * hammer just sets `armed` (the count is spent on the break). At most one
 * hammer per turn.
 * @param {GimmickState} state
 */
export function armItem(state) {
  if (state.status !== 'playing') throw new Error('game is over');
  if (state.armed) throw new Error('item already armed');
  if (state.turn === 'trapper') {
    if (state.items.trapper.double <= 0) throw new Error('no double to arm');
    state.items.trapper.double -= 1;
    state.armKind = 'double';
    state.armed = true;
    state.blocksLeft = trapperBlocksLeft(state); // free cats + this double
    if (state.features.power) {
      state.power = Math.min(POWER_CAP, state.power + 2); // 14.5: a double feeds the gauge
    }
  } else {
    if (state.items.cat.hammer <= 0) throw new Error('no hammer to arm');
    if (state.hammerUsed) throw new Error('hammer already used this turn');
    state.armKind = 'hammer';
  }
  state.armed = true;
  state.history.push({ side: state.turn, index: -1, kind: 'arm' });
  state.moveCount = state.history.length;
}

/**
 * Clear the armed flag without spending anything (a double already spent at
 * arm time is not refunded; the pending second block is cancelled so the
 * next block passes the turn as usual). A dash that already took its first
 * step can only be ended with `stopDash`, so disarming mid-dash is ignored.
 * Power actions have not spent anything yet at arm time (14.5), so
 * cancelling them is always free.
 * @param {GimmickState} state
 */
export function disarmItem(state) {
  const kind = armKindOf(state);
  if (kind === 'dash' && state.dashLeft < DASH_STEPS) return; // dash in motion
  state.armed = false;
  state.armKind = null;
  state.dashLeft = 0;
  // cancelling the double drops its extra block; the free-cat budget stays
  if (state.turn === 'trapper') state.blocksLeft = trapperBlocksLeft(state);
}

/**
 * Can `side` arm an item right now? The cat gets at most one hammer per
 * turn (`hammerUsed`).
 * @param {GimmickState} state
 * @param {import('../rules.js').Side} side
 * @returns {boolean}
 */
export function canUseItem(state, side) {
  if (state.status !== 'playing' || state.armed) return false;
  if (state.turn !== side || state.armed) return false;
  if (side === 'trapper') {
    // 19.4: a double is pointless when nothing is blockable any more
    return state.items.trapper.double > 0 && legalBlocks(state).length > 0;
  }
  return state.items.cat.hammer > 0 && !state.hammerUsed;
}

/**
 * Can the cat side use the `kind` power right now (14.5/5.2)? The dash
 * needs its feature, the full 6 pips and somewhere to go; the corner jump
 * needs its feature, the full 6 pips and a legal landing (≤ 2 empty
 * neighbors and exactly one block to hop over).
 * @param {GimmickState} state
 * @param {'dash'|'jump'} kind
 * @returns {boolean}
 */
export function canUsePower(state, kind) {
  if (state.status !== 'playing' || state.armed) return false;
  if (state.turn !== 'cat') return false;
  const f = state.features;
  if (!f) return false;
  if (kind === 'dash') {
    return !!f.dash && state.power >= DASH_COST && gMoves(state, state.board.cat).length > 0;
  }
  if (kind === 'jump') {
    return !!f.jump && state.power >= JUMP_COST && jumpTargets(state).length > 0;
  }
  return false;
}

/**
 * Arm a power action (14.5), mirroring `armItem`: nothing is spent yet —
 * the dash pays on its first step, the jump on the jump itself — so a
 * cancel (`disarmItem`) costs nothing. `stopDash` ends an ongoing dash.
 * @param {GimmickState} state
 * @param {'dash'|'jump'} kind
 */
export function armPower(state, kind) {
  if (state.status !== 'playing') throw new Error('game is over');
  if (state.armed) throw new Error('item already armed');
  if (state.turn !== 'cat') throw new Error("not the cat's turn");
  if (kind !== 'dash' && kind !== 'jump') throw new Error(`unknown power: ${kind}`);
  if (!canUsePower(state, kind)) throw new Error(`power not available: ${kind}`);
  state.armed = true;
  state.armKind = kind;
  state.dashLeft = kind === 'dash' ? DASH_STEPS : 0;
}

/**
 * The `ここで止める` button (14.5): end the dash early. Before the first
 * step this only disarms (nothing was spent); after a step it passes the
 * turn (dried fish skip included).
 * @param {GimmickState} state
 * @returns {boolean} whether the dash was ended/cancelled
 */
export function stopDash(state) {
  if (state.status !== 'playing' || state.turn !== 'cat') return false;
  if (armKindOf(state) !== 'dash') return false;
  if (state.dashLeft === DASH_STEPS) {
    disarmItem(state); // nothing spent yet — just cancel
    return true;
  }
  passTurnFromCat(state);
  evaluateStatus(state);
  return true;
}

/**
 * Rev. 8/19.4 root cause of the late-level draws: a sealed pocket whose
 * cells are all unblockable gimmick cells (springs, tunnels, stones …)
 * can never make a cat stuck, so the cats could shuffle there forever.
 * The trapper wins when **every** remaining cat is enclosed (`dist == -1`)
 * and nothing can ever reconnect any of them to the edge:
 * - no hammer break reconnects — with the hammers in inventory **or**
 *   gained later from an unpicked item cell in a pocket (every blocked
 *   cell at distance 2–3 from a pocket cell simulated one at a time)
 * - no full-gauge jump landing reconnects (14.5)
 * - no pending brittle crumble reconnects (13.3 — the timers tick before
 *   this runs, so a crumble that opens a route gets its chance first; a
 *   chain of two dependent crumbles is not modelled)
 * Storm blocks were already blown away before this runs (14.5).
 * @param {GimmickState} state
 * @returns {boolean} true when the position is dead for the cat side
 */
function sealedDeadEnd(state) {
  const multi = !!(state.cats && state.cats.length > 0);
  const cats = multi ? state.cats : [state.board.cat];
  const dists = new Array(cats.length);
  for (let j = 0; j < cats.length; j++) {
    const d = gDistanceMap(state, multi ? j : undefined);
    if (d.dist[cats[j]] !== -1) return false; // a route still exists
    dists[j] = d;
  }
  const b = state.board;
  /** Would freeing cell `t` reconnect any cat to the edge? */
  const reconnectsIfFreed = (t) => {
    const nb = { ...state, board: { ...b, blocked: b.blocked.slice() } };
    nb.board.blocked[t] = 0;
    for (let j = 0; j < cats.length; j++) {
      if (gDistanceMap(nb, multi ? j : undefined).dist[cats[j]] !== -1) return true;
    }
    return false;
  };
  // the pockets: every cell the cats can currently rest on; an unpicked
  // item cell inside one grants a hammer later (14.1)
  const regionCells = [];
  let hammerPossible = !!(state.items && state.items.cat.hammer > 0);
  for (let j = 0; j < cats.length; j++) {
    const s = forCat(state, multi ? j : undefined);
    const seen = new Set([s.board.cat]);
    const stack = [s.board.cat];
    while (stack.length > 0) {
      const v = stack.pop();
      regionCells.push(v);
      if (state.g.kind[v] === CELL_ITEM) hammerPossible = true;
      for (const m of gMoves(s, v)) {
        if (!seen.has(m.land)) {
          seen.add(m.land);
          stack.push(m.land);
        }
      }
    }
  }
  const targets = new Set();
  // 14.1: every blocked cell a hammer could break (distance 2–3 from a
  // pocket cell — the cat may stand anywhere in its pocket when breaking)
  if (hammerPossible) {
    for (const v of regionCells) {
      for (let i = 0; i < b.W * b.H; i++) {
        if (!b.blocked[i]) continue;
        const d = hexDistance(v, i, b.W);
        if (d === 2 || d === 3) targets.add(i);
      }
    }
  }
  // 13.3: every standing brittle block crumbles on its timer
  for (let i = 0; i < state.g.kind.length; i++) {
    if (state.g.kind[i] === KIND_BRITTLE && b.blocked[i]) targets.add(i);
  }
  for (const t of targets) {
    if (reconnectsIfFreed(t)) return false;
  }
  // 14.5: a full-gauge jump landing that reconnects
  for (let j = 0; j < cats.length; j++) {
    const s = forCat(state, multi ? j : undefined);
    if (s.features && s.features.jump && s.power >= JUMP_COST) {
      for (const t of jumpTargets(s)) {
        if (dists[j].dist[t.to] !== -1) return false;
      }
    }
  }
  return true;
}

/**
 * cat on edge → catWin. At the start of the cat's turn a cat is stuck when
 * it has no legal move (gimmick-aware: arrow cells may refuse entry) →
 * trapperWin — the plain rule; the hammer never changes that because
 * adjacent walls can't be broken (14.1).
 *
 * **Comeback exception (14.5)**: a cat with no legal move is *not* stuck
 * while the power gauge is full (6) and a corner jump is possible — the
 * trapper has to finish before the gauge fills.
 *
 * Multiple cats (13.7, with the 14.1 hammer / 14.5 jump overrides): a cat
 * is "stuck" exactly as above — the hammer never rescues it, the full-gauge
 * corner jump does.
 * - `anyEscape`: the cat side wins as soon as **any** cat reaches an edge
 *   cell (the game ends at once); the trapper wins when at the start of
 *   the cat side's turn **no** cat has a legal move (unless one of them
 *   can corner-jump).
 * - `anyCatch`: a cat reaching an edge has already run off the board
 *   (removed by `applyCatMove`); the cat side wins when **every** cat has
 *   escaped; the trapper wins when at the start of the cat side's turn
 *   **any** remaining cat has no legal move (full-gauge jump excepted).
 * @param {GimmickState} state
 * @returns {GimmickState['status']}
 */
export function evaluateStatus(state) {
  const b = state.board;
  const cats = state.cats;
  if (cats && cats.length === 0) {
    state.status = 'catWin'; // anyCatch: every cat escaped
    return state.status;
  }
  // 19.4: every cat sealed in an untrappable pocket (no reconnect left)
  // is a dead end — the trapper wins instead of the game circling forever
  if (state.status === 'playing' && sealedDeadEnd(state)) {
    state.status = 'trapperWin';
    return state.status;
  }
  if (cats && cats.length > 1) {
    if (state.catsGoal === 'anyCatch') {
      if (state.turn === 'cat') {
        for (let j = 0; j < cats.length; j++) {
          if (gMoves(state, cats[j], j).length === 0 && !jumpRescue(state, j)) {
            state.status = 'trapperWin';
            return state.status;
          }
        }
      }
      state.status = 'playing';
      return state.status;
    }
    // anyEscape
    for (const c of cats) {
      if (isBorder(c, b.W, b.H)) {
        state.status = 'catWin';
        return state.status;
      }
    }
    if (state.turn === 'cat') {
      let anyMovable = false;
      for (let j = 0; j < cats.length; j++) {
        if (gMoves(state, cats[j], j).length > 0 || jumpRescue(state, j)) {
          anyMovable = true;
          break;
        }
      }
      if (!anyMovable) {
        state.status = 'trapperWin';
        return state.status;
      }
    }
    state.status = 'playing';
    return state.status;
  }
  if (isBorder(b.cat, b.W, b.H)) {
    state.status = 'catWin';
  } else if (state.turn === 'cat' && gMoves(state, b.cat).length === 0) {
    state.status = jumpRescue(state) ? 'playing' : 'trapperWin';
  } else {
    state.status = 'playing';
  }
  return state.status;
}
