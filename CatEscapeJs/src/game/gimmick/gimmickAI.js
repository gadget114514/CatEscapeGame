/**
 * Cat AI and trapper AI for the gimmick rules, on top of the gimmick graph
 * (spec 13.2/13.3, hammer plan per 14.1, multiple cats per 13.7, power
 * gauge with dash/corner jump per 14.5). Pure functions of (state, rng);
 * never modify `state`. Pure logic — no Babylon.js, no DOM.
 */
import { isBorder } from '../hex.js';
import {
  legalCatMoves,
  legalBlocks,
  hammerTargets,
  jumpTargets,
  jumpRescue,
  armKindOf,
  DASH_COST,
  JUMP_COST,
} from './gimmickRules.js';
import {
  alphaBeta,
  multiCatAlphaBeta,
  multiCatCandidates,
  endangeredOrder,
  urgencyOrder,
  gimmickCandidates,
  gimmickEval,
  cloneNode,
  itemDistanceMap,
  dashPlans,
} from './gimmickSearch.js';
import {
  forCat,
  gMoves,
  gDistanceMap,
  gCatDistanceMap,
  gReachableArea,
} from './graph.js';
import { isBlockable, KIND_BRITTLE } from './registry.js';

// candidate generation lives in gimmickSearch.js (the search needs it too);
// re-exported here so callers can import it from the AI module.
export { gimmickCandidates, multiCatCandidates };

const NORMAL_K = 12;
const HARD_K = 10;

/**
 * The gimmick graph maps cost several times more than the plain board.js
 * ones, so the Hard search runs 3 plies (the basic search uses 4) to stay
 * under the 100 ms per-move budget with every gimmick active (13.3).
 */
const HARD_DEPTH = 3;

/**
 * With 3 cats the multi-cat tree is about three times wider (two relevant
 * cats move instead of one), so Hard drops to 2 plies there to stay under
 * the 100 ms per-move budget on an L20 board (spec 13.7 implementation
 * note — recorded in doc/gamedesign.md).
 */
const HARD_DEPTH_3CATS = 2;

/** The Hard search depth for this state (13.7 fallback). */
function hardDepth(state) {
  return state.cats && state.cats.length >= 3 ? HARD_DEPTH_3CATS : HARD_DEPTH;
}

/** distance at which the trapper AI arms a double (spec 12.5) */
const DOUBLE_DIST = { easy: 1, normal: 2, hard: 3 };

/**
 * @template T
 * @param {T[]} items
 * @param {(item:T) => number} key lower is better
 * @param {() => number} rng tie-breaker
 * @returns {T}
 */
function argMin(items, key, rng) {
  let bestVal = Infinity;
  let best = [];
  for (const item of items) {
    const v = key(item);
    if (v < bestVal) {
      bestVal = v;
      best = [item];
    } else if (v === bestVal) {
      best.push(item);
    }
  }
  return best[Math.floor(rng() * best.length)];
}

/** dist → sort key (-1/unreachable is worst). */
function distKey(dist) {
  return dist === -1 ? Infinity : dist;
}

/**
 * Which cat the cat side moves this turn (spec 13.7). The controller calls
 * this before `shouldUseItem`/`chooseCatMove` and applies the result with
 * `selectCat`, so the rest of the AI runs on the selected cat exactly as
 * in the single-cat game:
 * - with one movable cat it is selected automatically
 * - a cat that can escape this move always takes it
 * - an enclosed cat the hammer can reconnect is rescued first
 * - `anyCatch`: the most endangered cat (smallest `reachableArea`, then
 *   the fewest empty neighbors)
 * - `anyEscape`: the cat with the best (highest) single-cat eval
 * Pure: never modifies `state`.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {() => number} rng
 * @returns {number} index into `state.cats`
 */
export function chooseAICat(state, rng) {
  const cats = state.cats;
  if (!cats || cats.length <= 1) return state.selectedCat || 0;
  const movable = [];
  for (let j = 0; j < cats.length; j++) {
    // 14.5: a cornered cat with no move still "moves" while its full-gauge
    // corner jump can save it — it must be selectable for the rescue
    if (gMoves(state, cats[j], j).length > 0 || jumpRescue(state, j)) movable.push(j);
  }
  if (movable.length === 0) return state.selectedCat || 0;
  if (movable.length === 1) return movable[0];

  // a cat that can escape this move always takes it (both goals)
  for (const j of movable) {
    for (const m of gMoves(state, cats[j], j)) {
      if (isBorder(m.land, state.board.W, state.board.H)) return j;
    }
  }
  // Rev. 8/19.4: a cat whose full-gauge jump reaches an edge wins at once
  for (const j of movable) {
    const s = forCat(state, j);
    if (
      s.features &&
      s.features.jump &&
      s.power >= JUMP_COST &&
      jumpTargets(s).some((t) => isBorder(t.to, state.board.W, state.board.H))
    ) {
      return j;
    }
  }
  // rescue: a cat with no move jumps now (14.5); the hammer can't help there
  for (const j of movable) {
    if (gMoves(state, cats[j], j).length === 0) return j;
  }
  // rescue: an enclosed cat the hammer can reconnect (14.1 plan)
  if (state.items && state.items.cat.hammer > 0 && !state.hammerUsed) {
    for (const j of movable) {
      const s = forCat(state, j);
      if (gDistanceMap(s).dist[cats[j]] === -1 && hammerPlan(s) !== null) return j;
    }
  }
  if (state.catsGoal === 'anyCatch') {
    for (const j of endangeredOrder(state)) if (movable.includes(j)) return j;
  }
  // anyEscape (or fallback): the best single-cat eval, ties via rng
  const hammers = state.items ? state.items.cat.hammer : 0;
  let bestVal = -Infinity;
  let best = [];
  for (const j of movable) {
    const e = gimmickEvalOf(state, j, hammers);
    if (e > bestVal) {
      bestVal = e;
      best = [j];
    } else if (e === bestVal) {
      best.push(j);
    }
  }
  return best[Math.floor(rng() * best.length)];
}

/** Single-cat eval of cat `j` under the multi-cat occupancy (13.7). */
function gimmickEvalOf(state, j, hammers) {
  return gimmickEval(forCat(state, j), hammers);
}

/**
 * The cat whose route the "Show path hint" feature shows (spec 13.7):
 * `anyEscape` → the cat with the smallest `dist`; `anyCatch` → the most
 * endangered cat.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @returns {number} index into `state.cats` (0 when single)
 */
export function hintCat(state) {
  const cats = state.cats;
  if (!cats || cats.length <= 1) return 0;
  if (state.catsGoal === 'anyCatch') return endangeredOrder(state)[0];
  return urgencyOrder(state)[0];
}

/**
 * The hammer plan (14.1): for each break target, simulate the break and
 * then the best move; pick the (target, move) pair with the smallest
 * resulting `dist`, ties broken by `paths`.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @returns {{target:number, move:number, dist:number, paths:number}|null}
 */
export function hammerPlan(state) {
  const b = state.board;
  if (state.items.cat.hammer <= 0) return null;
  const targets = hammerTargets(state);
  const moves = gMoves(state, b.cat);
  if (targets.length === 0 || moves.length === 0) return null;

  const d0 = gDistanceMap(state);
  const enclosed = d0.dist[b.cat] === -1;
  let bestNormal = Infinity;
  for (const m of moves) {
    const dist = distKey(d0.dist[m.land]);
    if (dist < bestNormal) bestNormal = dist;
  }

  let best = null;
  for (const t of targets) {
    const nb = cloneNode(state);
    nb.board.blocked[t] = 0;
    const d = gDistanceMap(nb);
    let bestM = null;
    for (const m of gMoves(nb, b.cat)) {
      const dist = distKey(d.dist[m.land]);
      const paths = d.paths[m.land];
      if (bestM === null || dist < bestM.dist || (dist === bestM.dist && paths > bestM.paths)) {
        bestM = { move: m.to, dist, paths };
      }
    }
    if (!bestM) continue;
    if (best === null || bestM.dist < best.dist || (bestM.dist === best.dist && bestM.paths > best.paths)) {
      best = { target: t, move: bestM.move, dist: bestM.dist, paths: bestM.paths };
    }
  }
  if (!best || best.dist === Infinity) return null;
  if (enclosed) return best; // the break plus the move reconnects the cat
  if (state.difficulty === 'easy') return null; // easy: the enclosed rule only
  return best.dist <= bestNormal - 2 ? best : null;
}

/**
 * Enclosed cat (`dist == -1`): among the cat's blockable move entries pick
 * the one that minimizes the cat's reachableArea after moving there (as in
 * the basic AI); then more open moves, then random.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {() => number} rng
 * @returns {number}
 */
function bestAreaMove(state, rng) {
  const b = state.board;
  const oldCat = b.cat;
  const moves = gMoves(state, oldCat);
  // Rev. 8/19.4: an enclosed cat first grabs a reachable hammer — the
  // break plan uses it when a break reconnects the cat (the item cell
  // turns normal, so the pocket also becomes sealable afterwards)
  const idm = itemDistanceMap(state);
  if (idm[oldCat] > 0) {
    const closer = moves.filter((m) => idm[m.land] !== -1 && idm[m.land] < idm[oldCat]);
    if (closer.length > 0) return closer[Math.floor(rng() * closer.length)].to;
  }
  let bestArea = -Infinity;
  let bestMoves = -Infinity;
  let best = [];
  for (const m of moves) {
    const nb = cloneNode(state);
    nb.board.blocked[oldCat] = 1;
    nb.board.cat = m.land;
    const area = gReachableArea(nb);
    const open = gMoves(nb, m.land).length;
    if (area > bestArea) {
      bestArea = area;
      bestMoves = open;
      best = [m];
    } else if (area === bestArea) {
      if (open > bestMoves) {
        bestMoves = open;
        best = [m];
      } else if (open === bestMoves) {
        best.push(m);
      }
    }
  }
  return best[Math.floor(rng() * best.length)].to;
}

/**
 * Enclosed cat (`dist == -1`): among the cat's empty, blockable move
 * entries pick the one that minimizes the cat's reachableArea after
 * blocking it (as in the basic AI). When none is left, fall back to the
 * legal block closest to the cat (bug 14.4-1).
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {() => number} rng
 * @returns {number}
 */
function enclosedChoice(state, rng) {
  const b = state.board;
  const nbrs = gMoves(state, b.cat)
    .map((m) => m.to)
    .filter((j) => isBlockable(state, j));
  if (nbrs.length === 0) {
    const fallback = gimmickCandidates(state, 12, rng);
    return fallback.length > 0 ? fallback[0] : -1;
  }
  let bestArea = Infinity;
  let best = [];
  for (const m of nbrs) {
    const nb = cloneNode(state);
    nb.board.blocked[m] = 1;
    const area = gReachableArea(nb);
    if (area < bestArea) {
      bestArea = area;
      best = [m];
    } else if (area === bestArea) {
      best.push(m);
    }
  }
  // 19.4: equally small pockets prefer the permanent seal over a brittle
  // one that would crumble and reopen the same pocket
  const permanent = best.filter((m) => state.g.kind[m] !== KIND_BRITTLE);
  const pool = permanent.length > 0 ? permanent : best;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Normal scoring: simulate each block and score it as (newDist, -newPaths),
 * higher is better; newDist = -1 counts as +∞. A block on a brittle cell is
 * worth less (13.3): it is used only if it gives `newDist == -1` or the
 * cat's `dist <= 1`; when every candidate is discounted away, the best of
 * them is used anyway so the trapper always blocks while it can. Rev. 8
 * (19.4): among equally-scored fallback candidates a permanent
 * (non-brittle) cell wins the tie — re-blocking the same crumbling seal
 * forever only circles the game.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {number[]} candidates
 * @param {number} D the cat's current dist
 * @param {() => number} rng
 * @returns {number}
 */
function normalChoice(state, candidates, D, rng) {
  let bestKey = null;
  let best = [];
  let bestAnyKey = null;
  let bestAny = [];
  for (const m of candidates) {
    const nb = cloneNode(state);
    nb.board.blocked[m] = 1;
    const dm = gDistanceMap(nb);
    const nd = dm.dist[nb.board.cat];
    const np = dm.paths[nb.board.cat];
    const p = distKey(nd);
    const s = -np;
    if (bestAnyKey === null || p > bestAnyKey[0] || (p === bestAnyKey[0] && s > bestAnyKey[1])) {
      bestAnyKey = [p, s];
      bestAny = [m];
    } else if (p === bestAnyKey[0] && s === bestAnyKey[1]) {
      bestAny.push(m);
    }
    if (state.g.kind[m] === KIND_BRITTLE && nd !== -1 && D > 1) continue;
    if (bestKey === null || p > bestKey[0] || (p === bestKey[0] && s > bestKey[1])) {
      bestKey = [p, s];
      best = [m];
    } else if (p === bestKey[0] && s === bestKey[1]) {
      best.push(m);
    }
  }
  let pool = best.length > 0 ? best : bestAny;
  if (pool === bestAny) {
    const permanent = pool.filter((m) => state.g.kind[m] !== KIND_BRITTLE);
    if (permanent.length > 0) pool = permanent; // 19.4: no brittle re-seal loops
  }
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Should `state.turn` arm its item right now?
 * - trapper: has a double and `dist[cat] <= {easy:1, normal:2, hard:3}`
 *   (also true for -1: the cat is enclosed and about to break out), or —
 *   normal/hard only — the cat's 14.5 gauge reads ≥ 5 (a double wall on a
 *   powered-up cat)
 * - cat (14.1): has a hammer, hasn't used one this turn, and the plan
 *   holds: the cat is enclosed and the break plus the move reconnects it,
 *   or (normal/hard) the break plus the move gains at least 2 `dist` over
 *   the best move alone. Easy uses only the enclosed condition.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {() => number} rng
 * @returns {boolean}
 */
export function shouldUseItem(state, rng) {
  if (state.status !== 'playing' || state.armed) return false;
  if (state.turn === 'trapper') {
    if (state.items.trapper.double <= 0) return false;
    if (legalBlocks(state).length === 0) return false; // 19.4: nothing to block
    const th = DOUBLE_DIST[state.difficulty] ?? 2;
    const cats = state.cats;
    /** The cat the trapper is targeting (13.7). */
    let j = 0;
    if (cats && cats.length > 1) {
      j =
        state.catsGoal === 'anyCatch' ? endangeredOrder(state)[0] : urgencyOrder(state)[0];
    }
    // 14.5: Normal/Hard prefer a double wall next to a powered-up cat
    // (gauge ≥ 5), whatever its distance
    if (
      state.features &&
      state.features.power &&
      state.power >= 5 &&
      (state.difficulty === 'normal' || state.difficulty === 'hard')
    ) {
      return true;
    }
    const d = gDistanceMap(state, j);
    return d.dist[cats ? cats[j] : state.board.cat] <= th;
  }
  if (state.items.cat.hammer <= 0 || state.hammerUsed) return false;
  return hammerPlan(state) !== null;
}

/**
 * Should the cat side arm a power action (14.5)? Returns `'dash'`,
 * `'jump'` or `null`.
 * - **jump**: whenever the cat is stuck or enclosed and a landing
 *   reconnects it to a route; when it is stuck (no legal move at all) it
 *   jumps even into another pocket, because that is the only way the game
 *   continues. Easy only jumps when stuck.
 * - **dash**: never on easy; otherwise when some dash plan reaches an edge
 *   or ends at least 2 `dist` below the best single move. The plan rolls
 *   the full 2 steps greedily (edge steps win at once). Dash and jump
 *   share the full 6-pip gauge (5.2), so jump wins the tie when both are
 *   possible.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {() => number} rng
 * @returns {'dash'|'jump'|null}
 */
export function shouldUsePower(state, rng) {
  if (state.status !== 'playing' || state.armed) return null;
  if (state.turn !== 'cat') return null;
  const f = state.features;
  if (!f || !f.power) return null;
  const b = state.board;
  const d = gDistanceMap(state);
  const gmoves = gMoves(state, b.cat);
  const stuck = gmoves.length === 0;
  const enclosed = d.dist[b.cat] === -1;
  const easy = state.difficulty === 'easy';

  // Rev. 8/19.4: a jump that reaches an edge wins at once — always take
  // it (a cornered cat uses the gauge for the escape, not for pacing)
  if (f.jump && state.power >= JUMP_COST) {
    if (jumpTargets(state).some((t) => isBorder(t.to, b.W, b.H))) return 'jump';
  }
  if (f.jump && state.power >= JUMP_COST && (stuck || (enclosed && !easy))) {
    const targets = jumpTargets(state);
    if (targets.length > 0) {
      const reconnects = targets.some((t) => d.dist[t.to] !== -1);
      if (reconnects || stuck) return 'jump';
    }
  }
  if (f.dash && state.power >= DASH_COST && !easy && !stuck) {
    const plans = dashPlans(state, 3, d.dist);
    if (plans.length > 0) {
      if (plans.some((p) => p.wins)) return 'dash';
      let bestNormal = Infinity;
      for (const m of gmoves) {
        const dist = d.dist[m.land] === -1 ? Infinity : d.dist[m.land];
        if (dist < bestNormal) bestNormal = dist;
      }
      if (plans[0].score !== Infinity && plans[0].score <= bestNormal - 2) return 'dash';
    }
  }
  return null;
}

/**
 * Choose the cat's next move under the gimmick rules.
 * - a move that lands on an edge cell is taken immediately
 * - armed (hammer): the break target of the best plan (14.1)
 * - enclosed (`dist == -1`): largest reachableArea, then more open moves, random
 * - easy: 30% random, otherwise smallest dist
 * - normal: smallest dist, then largest paths, then closest to an item cell,
 *   then random
 * - hard: gimmick-graph alpha-beta, 3 plies (2 plies with 3 cats, see
 *   `hardDepth`)
 * Multiple cats (13.7): any cat escaping now wins at once; Hard searches
 * with `multiCatAlphaBeta` over the two most relevant cats and plays the
 * search's move when the selected cat can make it (the controller runs
 * `chooseAICat`/`selectCat` first); otherwise the selected cat plays the
 * single-cat logic above.
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {() => number} rng
 * @returns {number} cell index, or -1 when the cat has no move
 */
export function chooseCatMove(state, rng) {
  const b = state.board;
  const clickable = legalCatMoves(state);
  if (clickable.length === 0) return -1;
  const cats = state.cats;
  const multi = cats && cats.length > 1;
  const armedKind = armKindOf(state);

  if (armedKind === 'jump') {
    // 14.5: the jump is armed — land on the best cell (an edge first, as
    // always, then the smallest dist, ties by rng)
    const targets = jumpTargets(state);
    /* istanbul ignore next — canUsePower guaranteed a target */
    if (targets.length === 0) return -1;
    const d = gDistanceMap(state);
    let bestKey = Infinity;
    let pool = [];
    for (const t of targets) {
      const dist = d.dist[t.to] === -1 ? Infinity : d.dist[t.to];
      if (dist < bestKey) {
        bestKey = dist;
        pool = [t];
      } else if (dist === bestKey) {
        pool.push(t);
      }
    }
    return pool[Math.floor(rng() * pool.length)].to;
  }

  if (multi) {
    // any cat reaching an edge wins at once (both goals take it, 13.7)
    for (let j = 0; j < cats.length; j++) {
      for (const m of gMoves(state, cats[j], j)) {
        if (isBorder(m.land, b.W, b.H)) return m.to;
      }
    }
    if (state.difficulty === 'hard') {
      const { move, catIndex } = multiCatAlphaBeta(
        state,
        state.items.cat.hammer,
        hardDepth(state),
        -Infinity,
        Infinity,
        'cat',
        HARD_K,
      );
      // the search may target the other relevant cat: only play moves the
      // selected cat can actually make (the controller selects first)
      if (
        move !== null &&
        catIndex === (state.selectedCat || 0) &&
        clickable.includes(move)
      ) {
        return move;
      }
    }
    // fall through: the selected cat plays with the single-cat logic
  }

  const gmoves = gMoves(state, b.cat);

  for (const m of gmoves) {
    if (isBorder(m.land, b.W, b.H)) return m.to;
  }

  if (armedKind === 'hammer') {
    const plan = hammerPlan(state);
    if (plan) return plan.target;
    // armed but no useful break → play a normal move below
  }

  const d = gDistanceMap(state);
  if (d.dist[b.cat] === -1) return bestAreaMove(state, rng);

  switch (state.difficulty) {
    case 'easy': {
      if (rng() < 0.3) return gmoves[Math.floor(rng() * gmoves.length)].to;
      return argMin(gmoves, (m) => distKey(d.dist[m.land]), rng).to;
    }
    case 'normal': {
      const idm = itemDistanceMap(state);
      let bestKey = null;
      let pool = [];
      for (const m of gmoves) {
        const dist = distKey(d.dist[m.land]);
        const paths = d.paths[m.land];
        const item = idm[m.land] === -1 ? Infinity : idm[m.land];
        if (
          bestKey === null ||
          dist < bestKey[0] ||
          (dist === bestKey[0] && paths > bestKey[1]) ||
          (dist === bestKey[0] && paths === bestKey[1] && item < bestKey[2])
        ) {
          bestKey = [dist, paths, item];
          pool = [m];
        } else if (dist === bestKey[0] && paths === bestKey[1] && item === bestKey[2]) {
          pool.push(m);
        }
      }
      return pool[Math.floor(rng() * pool.length)].to;
    }
    case 'hard': {
      const { move } = alphaBeta(
        state,
        state.items.cat.hammer,
        HARD_DEPTH,
        -Infinity,
        Infinity,
        'cat',
        HARD_K,
      );
      // the search may suggest a break the controller never armed: only play
      // moves the current state actually allows
      if (move !== null && clickable.includes(move)) return move;
      return argMin(gmoves, (m) => distKey(d.dist[m.land]), rng).to;
    }
    default:
      return gmoves[Math.floor(rng() * gmoves.length)].to;
  }
}

/**
 * Choose the trapper's next block under the gimmick rules.
 * - cat already enclosed → minimize reachableArea among blockable entries
 * - easy: 50% a random blockable cell within distance 3, otherwise Normal
 * - normal: score candidates as (newDist, -newPaths), brittle cells
 *   discounted (13.3), ties random
 * - hard: gimmick-graph alpha-beta, 3 plies, candidates K=10
 * Never returns -1 while any blockable cell exists (bug 14.4-1).
 * Multiple cats (13.7): `anyEscape` blocks against the two most urgent
 * cats (union of their candidate lists); `anyCatch` targets the easiest
 * cat to trap (empty neighbors first, then its shortest-route cells).
 * @param {import('./gimmickRules.js').GimmickState} state
 * @param {() => number} rng
 * @returns {number} cell index, or -1 when there is nothing to block
 */
export function chooseBlock(state, rng) {
  const cats = state.cats;
  if (cats && cats.length > 1) {
    // multi-cat (13.7): the candidate list follows the goal
    const K = state.difficulty === 'hard' ? HARD_K : NORMAL_K;
    const { targetJ, candidates } = multiCatCandidates(state, K, rng);
    if (candidates.length === 0) return -1; // nothing blockable on the board
    const s = forCat(state, targetJ);
    const D = gDistanceMap(s).dist[cats[targetJ]];

    if (D === -1) return enclosedChoice(s, rng);

    switch (state.difficulty) {
      case 'easy': {
        if (rng() < 0.5) {
          const g = gCatDistanceMap(s);
          const near = [];
          for (let i = 0; i < state.board.W * state.board.H; i++) {
            if (isBlockable(state, i) && g[i] !== -1 && g[i] <= 3) near.push(i);
          }
          if (near.length > 0) return near[Math.floor(rng() * near.length)];
        }
        return normalChoice(s, candidates, D, rng);
      }
      case 'normal': {
        return normalChoice(s, candidates, D, rng);
      }
      case 'hard': {
        const { move } = multiCatAlphaBeta(
          state,
          state.items.cat.hammer,
          hardDepth(state),
          -Infinity,
          Infinity,
          'trapper',
          HARD_K,
        );
        if (move !== null && candidates.includes(move)) return move;
        return candidates[0];
      }
      default:
        return candidates[0];
    }
  }

  const d = gDistanceMap(state);
  const D = d.dist[state.board.cat];

  if (D === -1) return enclosedChoice(state, rng);

  const K = state.difficulty === 'hard' ? HARD_K : NORMAL_K;
  const candidates = gimmickCandidates(state, K, rng);
  if (candidates.length === 0) return -1; // nothing blockable on the board

  switch (state.difficulty) {
    case 'easy': {
      if (rng() < 0.5) {
        const g = gCatDistanceMap(state);
        const near = [];
        for (let i = 0; i < state.board.W * state.board.H; i++) {
          if (isBlockable(state, i) && g[i] !== -1 && g[i] <= 3) near.push(i);
        }
        if (near.length > 0) return near[Math.floor(rng() * near.length)];
      }
      return normalChoice(state, candidates, D, rng);
    }
    case 'normal': {
      return normalChoice(state, candidates, D, rng);
    }
    case 'hard': {
      const { move } = alphaBeta(
        state,
        state.items.cat.hammer,
        HARD_DEPTH,
        -Infinity,
        Infinity,
        'trapper',
        HARD_K,
      );
      if (move !== null && candidates.includes(move)) return move;
      return candidates[0];
    }
    default:
      return candidates[0];
  }
}
