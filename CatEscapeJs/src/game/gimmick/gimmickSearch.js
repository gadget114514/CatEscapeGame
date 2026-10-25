/**
 * Item-aware evaluation, candidate generation and alpha-beta on top of the
 * gimmick graph (spec 13.3, hammer compound moves per 14.1, dash/jump
 * moves per 14.5). Pure logic — no Babylon.js, no DOM.
 *
 * The evaluation is `evalForCat + 25*catHammers + 25*(an item or dried
 * fish cell is reachable within 2 moves)`. Brittle blocks count as
 * permanent in the search (the depth is small). A hammer turn is a
 * compound cat-side move `(target, move)`: it is generated only when the
 * cat holds a hammer, at the top 3 targets ordered by the `dist` after the
 * break, each with the cat's top 3 moves. A powered cat (the full
 * `power >= 6` gauge, shared by dash and jump per 5.2) additionally gets
 * its dash (up to 2 chained steps, top 3 plans) and corner jump (top 3
 * landings) as actions, so the trapper searches against the comeback
 * (14.5).
 */
import { cloneBoard } from '../board.js';
import { isBorder } from '../hex.js';
import { trapperCandidates } from '../candidates.js';
import { hexDistance } from './hexDir.js';
import {
  forCat,
  gMoves,
  gDistanceMap,
  gCatDistanceMap,
  gReachableArea,
  gShortestPathToEdge,
} from './graph.js';
import { isBlockable, CELL_ITEM, CELL_FISH } from './registry.js';
import {
  DASH_COST,
  DASH_STEPS,
  JUMP_COST,
  POWER_CAP,
  jumpTargets,
  jumpRescue,
} from './gimmickRules.js';

/**
 * Search node: the board plus the shared gimmick data (only `kind` is ever
 * written in the search — item/fish pickups — so it is copied per clone).
 * The multi-cat fields (`cats`, `escaped`, `catsGoal`, `selectedCat`) are
 * copied too, so a node is a complete 13.7 state, and the 14.5 power
 * fields ride along so the search can offer dash/jump moves.
 * @param {{board:import('../board.js').Board, g:object}} state
 */
export function cloneNode(state) {
  const nb = {
    board: cloneBoard(state.board),
    g: { ...state.g, kind: state.g.kind.slice() },
  };
  if (state.cats) {
    nb.cats = state.cats.slice();
    nb.escaped = state.escaped;
    nb.catTotal = state.catTotal;
    nb.catsGoal = state.catsGoal;
    nb.selectedCat = state.selectedCat;
  }
  if (state.features) {
    nb.features = state.features;
    nb.power = state.power;
  }
  return nb;
}

/**
 * Trapper candidates for gimmick rules: the basic candidates with the
 * non-blockable cells dropped (`isBlockable`). If nothing is left, the legal
 * block closest to the cat (ties broken by the rng when given, else the
 * first) — the trapper AI must always find a block while one exists
 * (bug 14.4-1).
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} [K=12]
 * @param {() => number} [rng]
 * @returns {number[]}
 */
export function gimmickCandidates(state, K = 12, rng) {
  const board = state.board;
  const base = trapperCandidates(board, K);
  const filtered = base.filter((v) => isBlockable(state, v));
  if (filtered.length > 0) return filtered;

  const g = gCatDistanceMap(state);
  let bestDist = null;
  let pool = [];
  for (let i = 0; i < board.W * board.H; i++) {
    if (!isBlockable(state, i)) continue;
    const d = g[i] === -1 ? Infinity : g[i];
    if (bestDist === null || d < bestDist) {
      bestDist = d;
      pool = [i];
    } else if (d === bestDist) {
      pool.push(i);
    }
  }
  if (pool.length === 0) return [];
  if (rng) return [pool[Math.floor(rng() * pool.length)]];
  return [pool[0]];
}

/**
 * Blocked cells at hex distance 2–3 from the cat — the hammer's break
 * targets (14.1).
 * @param {{board:import('../board.js').Board}} state
 * @returns {number[]}
 */
function breakTargets(state) {
  const b = state.board;
  const out = [];
  for (let i = 0; i < b.W * b.H; i++) {
    if (!b.blocked[i]) continue;
    const d = hexDistance(b.cat, i, b.W);
    if (d === 2 || d === 3) out.push(i);
  }
  return out;
}

/**
 * The top `n` break targets ordered by the `dist` after the break
 * (14.1), ties broken by `paths`.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} n
 * @returns {Array<{target:number, dist:number, paths:number}>}
 */
export function topBreakTargets(state, n) {
  const b = state.board;
  const scored = [];
  for (const t of breakTargets(state)) {
    const nb = cloneNode(state);
    nb.board.blocked[t] = 0;
    const d = gDistanceMap(nb);
    const dist = d.dist[b.cat] === -1 ? Infinity : d.dist[b.cat];
    scored.push({ target: t, dist, paths: d.paths[b.cat] });
  }
  scored.sort((a, b2) => a.dist - b2.dist || b2.paths - a.paths);
  return scored.slice(0, n);
}

/**
 * Distance from every cell to the nearest remaining item **or dried fish**
 * cell over the gimmick moves (multi-source reverse BFS). The trapper AI
 * guards both the same way (14.5).
 * @param {{board:import('../board.js').Board, g:{kind:Uint8Array}}} state
 * @returns {Int16Array} -1 when no item/fish cell is reachable
 */
function itemDistanceMap(state) {
  const b = state.board;
  const n = b.W * b.H;
  const dist = new Int16Array(n).fill(-1);
  const queue = [];
  for (let i = 0; i < n; i++) {
    if ((state.g.kind[i] === CELL_ITEM || state.g.kind[i] === CELL_FISH) && !b.blocked[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  const preds = new Array(n);
  for (let i = 0; i < n; i++) preds[i] = [];
  for (let v = 0; v < n; v++) {
    if (b.blocked[v]) continue;
    for (const m of gMoves(state, v)) preds[m.land].push(v);
  }
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const p of preds[v]) {
      if (dist[p] === -1) {
        dist[p] = dist[v] + 1;
        queue.push(p);
      }
    }
  }
  return dist;
}

/**
 * Is an item or dried fish cell reachable from the cat within 2 moves?
 * (a depth-2 flood, much cheaper than a full cat-distance map per leaf)
 * @param {{board:import('../board.js').Board, g:{kind:Uint8Array}}} state
 * @returns {boolean}
 */
function itemWithin2(state) {
  const b = state.board;
  const seen = new Set([b.cat]);
  let front = [b.cat];
  for (let depth = 0; depth < 2 && front.length > 0; depth++) {
    const next = [];
    for (const v of front) {
      for (const m of gMoves(state, v)) {
        if (seen.has(m.land)) continue;
        seen.add(m.land);
        const k = state.g.kind[m.land];
        if (k === CELL_ITEM || k === CELL_FISH) return true;
        next.push(m.land);
      }
    }
    front = next;
  }
  return false;
}

/** May this node's cat dash / jump (14.5)? */
function nodeCanDash(state) {
  return !!(state.features && state.features.dash && state.power >= DASH_COST);
}

function nodeCanJump(state) {
  return !!(state.features && state.features.jump && state.power >= JUMP_COST);
}

/**
 * Empty (unblocked, cat-free) neighbors of `cell` inside a search node —
 * the 18.3 pressure check the real `countEmptyNeighbors` does: cats other
 * than the mover occupy their cells exactly like blocks.
 * @param {any} state node (board + optional multi-cat fields)
 * @param {number} cell
 * @returns {number}
 */
function nodeEmptyNeighbors(state, cell) {
  const b = state.board;
  let n = 0;
  const cats = state.cats;
  const sel = state.selectedCat || 0;
  for (const j of b.nbr[cell]) {
    if (b.blocked[j]) continue;
    if (cats && cats.length > 1) {
      let occupied = false;
      for (let k = 0; k < cats.length; k++) {
        if (k !== sel && cats[k] === j) {
          occupied = true;
          break;
        }
      }
      if (occupied) continue;
    }
    n++;
  }
  return n;
}

/**
 * The 18.3 pressure gain of one cat-side step inside a search node: +1
 * only when the step started with at most 3 empty neighbors.
 * @param {any} nb node (mutated)
 * @param {number} fromCell the cell the step started from
 */
function gainStepPower(nb, fromCell) {
  if (nodeEmptyNeighbors(nb, fromCell) <= 3) {
    nb.power = Math.min(POWER_CAP, nb.power + 1);
  }
}

/**
 * Apply one normal step inside a search node: find the move for `entry`,
 * clear item/dried-fish cells on landing (14.5 pickups — fish only clears,
 * the trapper skip is not modelled in the search) and move `board.cat`.
 * @param {any} nb node (mutated)
 * @param {number} entry entry cell of the step
 * @returns {{ok:boolean, pickup:number}}
 */
function applyStepNode(nb, entry) {
  const mv = gMoves(nb, nb.board.cat).find((x) => x.to === entry);
  if (!mv) return { ok: false, pickup: 0 };
  let pickup = 0;
  const k = nb.g.kind[mv.land];
  if (k === CELL_ITEM) {
    nb.g.kind[mv.land] = 0;
    pickup = 1;
  } else if (k === CELL_FISH) {
    nb.g.kind[mv.land] = 0;
  }
  nb.board.cat = mv.land;
  return { ok: true, pickup };
}

/**
 * The top `n` dash plans (大ダッシュ, 14.5): for every first step, roll a
 * greedy dash of up to `DASH_STEPS` steps (an edge step wins at once, else
 * the smallest `dist`), then keep the best distinct endpoints by `dist`.
 * Purely a search helper — the plan lists the entry cells of each step and
 * the first one is the move the AI plays.
 * @param {{board:import('../board.js').Board, g:object, features?:object, power?:number}} state
 * @param {number} n
 * @param {Int16Array} dist the node's distance map (rollout heuristic)
 * @returns {Array<{path:number[], end:number, wins:boolean, score:number}>}
 */
export function dashPlans(state, n, dist) {
  if (!nodeCanDash(state)) return [];
  const b = state.board;
  const first = gMoves(state, b.cat);
  if (first.length === 0) return [];
  const plans = [];
  for (const m of first) {
    const nb = cloneNode(state);
    nb.features = state.features;
    nb.power = state.power;
    const path = [m.to];
    let r = applyStepNode(nb, m.to);
    if (!r.ok) continue;
    let wins = isBorder(nb.board.cat, b.W, b.H);
    let pickUps = r.pickup;
    for (let k = 1; k < DASH_STEPS && !wins; k++) {
      const moves = gMoves(nb, nb.board.cat);
      if (moves.length === 0) break;
      let pick = null;
      for (const mm of moves) {
        if (isBorder(mm.land, b.W, b.H)) {
          pick = mm;
          break;
        }
      }
      if (!pick) {
        let bestKey = Infinity;
        for (const mm of moves) {
          const key = distKey(dist[mm.land]);
          if (pick === null || key < bestKey) {
            bestKey = key;
            pick = mm;
          }
        }
      }
      /* istanbul ignore next — guarded by moves.length above */
      if (!pick) break;
      path.push(pick.to);
      r = applyStepNode(nb, pick.to);
      if (!r.ok) {
        path.pop();
        break;
      }
      pickUps += r.pickup;
      wins = isBorder(nb.board.cat, b.W, b.H);
    }
    const end = nb.board.cat;
    plans.push({
      path,
      end,
      wins,
      pickUps,
      score: wins ? -1 : distKey(dist[end]),
    });
  }
  plans.sort((a, b2) => a.score - b2.score || b2.path.length - a.path.length);
  const out = [];
  const seen = new Set();
  for (const p of plans) {
    if (seen.has(p.end)) continue;
    seen.add(p.end);
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * The top `n` corner-jump landings (窮鼠ジャンプ, 14.5) — `jumpTargets`
 * already enforces the ≤ 2 empty neighbors rule and the features gate.
 * @param {any} state
 * @param {number} n
 * @param {Int16Array} dist
 * @returns {Array<{to:number, wins:boolean, score:number}>}
 */
function jumpActions(state, n, dist) {
  if (!nodeCanJump(state)) return [];
  const b = state.board;
  const scored = jumpTargets(state).map((t) => ({
    to: t.to,
    wins: isBorder(t.to, b.W, b.H),
    score: isBorder(t.to, b.W, b.H) ? -1 : distKey(dist[t.to]),
  }));
  scored.sort((a, b2) => a.score - b2.score);
  return scored.slice(0, n);
}

/**
 * Gimmick evaluation: `evalForCat + 25*catHammers + 25*(item/fish within
 * 2)`. "Cat has no moves" is terminal (-10000): the hammer can no longer
 * rescue a stuck cat, because adjacent walls can't be broken (14.1) — the
 * one exception is the full-gauge corner jump (14.5), whose best landing
 * is scored like a first move instead.
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} hammers the cat's hammer count
 * @returns {number}
 */
export function gimmickEval(state, hammers) {
  const b = state.board;
  if (isBorder(b.cat, b.W, b.H)) return 10000;
  const moves = gMoves(state, b.cat);
  if (moves.length === 0) {
    // 14.5: only a reachable corner-jump landing keeps the game alive
    if (!nodeCanJump(state)) return -10000;
    const d = gDistanceMap(state);
    let best = Infinity;
    for (const t of jumpTargets(state)) {
      if (d.dist[t.to] === 0) return 10000; // the jump reaches an edge: win
      const dist = distKey(d.dist[t.to]);
      if (dist < best) best = dist;
    }
    if (best === Infinity) return -10000; // every landing is a dead end
    return -100 * best + 10;
  }
  const d = gDistanceMap(state);
  const dist = d.dist[b.cat];
  const base =
    dist === -1
      ? -5000 + gReachableArea(state) * 10
      : -100 * dist + 15 * Math.min(d.paths[b.cat], 20) + 5 * moves.length;
  return base + 25 * hammers + (itemWithin2(state) ? 25 : 0);
}

/**
 * Alpha-beta over the gimmick graph. The cat maximizes, the trapper
 * minimizes, win scores carry a depth bonus.
 * - the cat's actions are its legal moves; with a hammer in hand also the
 *   compound `(break target, move)` pairs (top 3 targets × top 3 moves);
 *   with the full `power >= 6` gauge also its dash (top 3 plans) and
 *   corner jump (top 3 landings) (14.5/5.2 — dash and jump cost the same
 *   6 pips). A cat with no move is only terminal when no corner jump can
 *   save it (14.5).
 * - landing on an item cell picks it up in the child node; a dried fish
 *   cell only clears (the trapper skip is not modelled here)
 * - the trapper only blocks gimmick-legal cells (`gimmickCandidates`)
 * - leaves evaluate with `gimmickEval`
 * @param {{board:import('../board.js').Board, g:object}} state
 * @param {number} hammers the cat's hammer count in this node
 * @param {number} depth
 * @param {number} alpha
 * @param {number} beta
 * @param {'cat'|'trapper'} sideToMove
 * @param {number} K candidate limit for the trapper
 * @returns {{score:number, move:number|null}} the entry cell to play, or the
 *                                             break target of a compound move
 */
export function alphaBeta(state, hammers, depth, alpha, beta, sideToMove, K) {
  const b = state.board;
  if (isBorder(b.cat, b.W, b.H)) return { score: 10000 + depth, move: null };
  const moves = gMoves(state, b.cat);
  if (moves.length === 0 && !jumpRescue(state)) {
    // terminal only when no corner jump can save the cat (14.5)
    return { score: -10000 - depth, move: null };
  }
  if (depth === 0) return { score: gimmickEval(state, hammers), move: null };

  if (sideToMove === 'cat') {
    const d = gDistanceMap(state);
    /** @type {Array<{breakTarget:number|null, to:number, kind:'move'|'dash'|'jump', path?:number[]}>} */
    const actions = moves
      .slice()
      .sort((x, y) => d.dist[x.land] - d.dist[y.land])
      .map((m) => ({ breakTarget: null, to: m.to, kind: 'move' }));
    if (hammers > 0) {
      for (const { target } of topBreakTargets(state, 3)) {
        const nb = cloneNode(state);
        nb.board.blocked[target] = 0;
        const dt = gDistanceMap(nb);
        const tm = gMoves(nb, b.cat)
          .slice()
          .sort((x, y) => dt.dist[x.land] - dt.dist[y.land])
          .slice(0, 3);
        for (const m of tm) actions.push({ breakTarget: target, to: m.to, kind: 'move' });
      }
    }
    // 14.5 comeback moves (top 3 each)
    for (const p of dashPlans(state, 3, d.dist)) {
      actions.push({ breakTarget: null, to: p.path[0], kind: 'dash', path: p.path });
    }
    for (const j of jumpActions(state, 3, d.dist)) {
      actions.push({ breakTarget: null, to: j.to, kind: 'jump' });
    }
    if (actions.length === 0) {
      // no move and no corner jump → the trapper has won (14.5 exception above)
      return { score: -10000 - depth, move: null };
    }
    let best = -Infinity;
    let bestAction = actions[0];
    for (const a of actions) {
      const nb = cloneNode(state);
      nb.features = state.features;
      nb.power = state.power;
      let nh = hammers;
      if (a.breakTarget !== null) {
        nb.board.blocked[a.breakTarget] = 0;
        nh -= 1; // break
      }
      if (a.kind === 'dash') {
        nb.power = Math.max(0, state.power - DASH_COST);
        for (const entry of /** @type {number[]} */ (a.path)) {
          const from = nb.board.cat;
          const r = applyStepNode(nb, entry);
          if (!r.ok) break;
          nh += r.pickup;
          gainStepPower(nb, from); // 18.3: +1 only under pressure
          if (isBorder(nb.board.cat, b.W, b.H)) break;
        }
      } else if (a.kind === 'jump') {
        nb.power = Math.max(0, state.power - JUMP_COST);
        const k = nb.g.kind[a.to];
        if (k === CELL_ITEM) {
          nb.g.kind[a.to] = 0;
          nh += 1;
        } else if (k === CELL_FISH) {
          nb.g.kind[a.to] = 0;
        }
        gainStepPower(nb, nb.board.cat); // 18.3: the jump's start cell
        nb.board.cat = a.to;
      } else {
        const mv = gMoves(nb, b.cat).find((x) => x.to === a.to);
        if (!mv) continue; // the break changed the move (defensive)
        if (nb.g.kind[mv.land] === CELL_ITEM) {
          nb.g.kind[mv.land] = 0;
          nh += 1; // pickup
        } else if (nb.g.kind[mv.land] === CELL_FISH) {
          nb.g.kind[mv.land] = 0;
        }
        gainStepPower(nb, b.cat); // 18.3: +1 only under pressure
        nb.board.cat = mv.land;
      }
      const { score } = alphaBeta(nb, nh, depth - 1, alpha, beta, 'trapper', K);
      if (score > best) {
        best = score;
        bestAction = a;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return { score: best, move: bestAction.breakTarget ?? bestAction.to };
  }

  const ordered = gimmickCandidates(state, K);
  if (ordered.length === 0) return { score: gimmickEval(state, hammers), move: null };
  let best = Infinity;
  let bestMove = ordered[0];
  for (const m of ordered) {
    const nb = cloneNode(state);
    nb.board.blocked[m] = 1;
    const { score } = alphaBeta(nb, hammers, depth - 1, alpha, beta, 'cat', K);
    if (score < best) {
      best = score;
      bestMove = m;
    }
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove };
}

/**
 * dist → sort key (-1/unreachable is worst).
 * @param {number} dist
 * @returns {number}
 */
function distKey(dist) {
  return dist === -1 ? Infinity : dist;
}

/**
 * The remaining cats ordered by ascending `dist` to the edge — the "most
 * urgent" cats for the trapper under `anyEscape` (spec 13.7). Rev. 8/19.4:
 * a cat with no legal move (and no full-gauge jump rescue) ranks **after**
 * every free cat — the trapper must keep sealing the cats that can still
 * move, or the game could circle forever once every cat is enclosed.
 * @param {{board:import('../board.js').Board, g:object, cats:number[]}} state
 * @returns {number[]}
 */
export function urgencyOrder(state) {
  const cats = state.cats;
  const scored = [];
  for (let j = 0; j < cats.length; j++) {
    const d = gDistanceMap(state, j);
    const stuck = gMoves(state, cats[j], j).length === 0 && !jumpRescue(state, j);
    scored.push({ j, stuck, d: distKey(d.dist[cats[j]]) });
  }
  scored.sort((a, b) =>
    a.stuck === b.stuck ? a.d - b.d || a.j - b.j : a.stuck ? 1 : -1,
  );
  return scored.map((s) => s.j);
}

/**
 * The remaining cats ordered by how easy they are to trap — the "most
 * endangered" cats under `anyCatch`: smallest `reachableArea`, then the
 * fewest empty (enterable) neighbors (spec 13.7).
 * @param {{board:import('../board.js').Board, g:object, cats:number[]}} state
 * @returns {number[]}
 */
export function endangeredOrder(state) {
  const cats = state.cats;
  const scored = [];
  for (let j = 0; j < cats.length; j++) {
    scored.push({
      j,
      area: gReachableArea(state, j),
      open: gMoves(state, cats[j], j).length,
    });
  }
  scored.sort(
    (a, b) => a.area - b.area || a.open - b.open || a.j - b.j,
  );
  return scored.map((s) => s.j);
}

/**
 * Trapper candidate generation for multi-cat games (spec 13.7).
 * - `anyCatch`: the target is the easiest cat to trap (smallest
 *   `reachableArea`, then fewest empty neighbors); its empty neighbors
 *   come first, then its shortest-route cells; truncated to `K`.
 * - `anyEscape`: the union of the candidate lists for the two most urgent
 *   cats (smallest `dist`), ordered by urgency.
 * Falls back to the plain `gimmickCandidates` when the goal-specific list
 * comes out empty, so the trapper always blocks while it can (bug 14.4-1).
 * @param {{board:import('../board.js').Board, g:object, cats:number[],
 *          catsGoal:string}} state
 * @param {number} [K=12]
 * @param {() => number} [rng]
 * @returns {{targetJ:number, candidates:number[]}}
 */
export function multiCatCandidates(state, K = 12, rng) {
  const cats = state.cats;
  if (state.catsGoal === 'anyCatch') {
    const j = endangeredOrder(state)[0];
    const out = [];
    const seen = new Set();
    for (const m of gMoves(state, cats[j], j)) {
      if (isBlockable(state, m.to) && !seen.has(m.to)) {
        seen.add(m.to);
        out.push(m.to);
      }
    }
    const path = gShortestPathToEdge(state, j) || [];
    for (const c of path) {
      if (isBlockable(state, c) && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    if (out.length > 0) return { targetJ: j, candidates: out.slice(0, K) };
    return { targetJ: j, candidates: gimmickCandidates(state, K, rng) };
  }
  const urgent = urgencyOrder(state).slice(0, 2);
  const out = [];
  const seen = new Set();
  for (const j of urgent) {
    for (const c of gimmickCandidates(forCat(state, j), K, rng)) {
      if (!seen.has(c) && isBlockable(state, c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  const targetJ = urgent.length > 0 ? urgent[0] : 0;
  if (out.length === 0) return { targetJ, candidates: gimmickCandidates(state, K, rng) };
  // the union is capped at K as well so the Hard search stays in its
  // 100 ms budget with 3 cats (implementation note, spec 13.7)
  return { targetJ, candidates: out.slice(0, K) };
}

/**
 * Multi-cat evaluation (spec 13.7): `anyEscape` is
 * `max over cats of the single-cat eval + 10 × (free cats - 1)` where a
 * "free" cat has at least one legal move; `anyCatch` is the `min over
 * remaining cats of the single-cat eval`. A cat on the edge scores an
 * instant win; every cat stuck (or any cat stuck under `anyCatch`) is an
 * instant loss — the hammer never rescues a stuck cat (14.1).
 * @param {{board:import('../board.js').Board, g:object, cats:number[],
 *          catsGoal:string}} state
 * @param {number} hammers the cat side's hammer count in this node
 * @returns {number}
 */
export function multiCatEval(state, hammers) {
  const cats = state.cats;
  const anyCatch = state.catsGoal === 'anyCatch';
  if (anyCatch && cats.length === 0) return 10000;
  let maxEval = -Infinity;
  let minEval = Infinity;
  let free = 0;
  for (let j = 0; j < cats.length; j++) {
    const e = gimmickEval(forCat(state, j), hammers);
    if (e >= 10000) return 10000; // a cat reached the edge (anyEscape wins now)
    if (e > -10000) free++;
    if (e > maxEval) maxEval = e;
    if (e < minEval) minEval = e;
  }
  if (anyCatch) return free === 0 ? -10000 : minEval;
  if (free === 0) return -10000;
  return maxEval + 10 * (free - 1);
}

/**
 * The two most relevant cats for the cat side (spec 13.7): under
 * `anyEscape` the two closest to the edge; under `anyCatch` the escapers
 * first (a cat that can escape this move always takes it), then the most
 * endangered ones.
 * @param {{board:import('../board.js').Board, g:object, cats:number[],
 *          catsGoal:string}} state
 * @param {number} n
 * @returns {number[]}
 */
export function relevantCats(state, n) {
  if (state.catsGoal === 'anyCatch') {
    const escapers = [];
    const rest = [];
    for (const j of endangeredOrder(state)) {
      const can = gMoves(state, state.cats[j], j).some((m) =>
        isBorder(m.land, state.board.W, state.board.H),
      );
      (can ? escapers : rest).push(j);
    }
    return [...escapers, ...rest].slice(0, n);
  }
  return urgencyOrder(state).slice(0, n);
}

/**
 * Alpha-beta for multi-cat games (spec 13.7). Same shape as the single-cat
 * `alphaBeta`, but the cat side moves only the two most relevant cats and
 * the win/loss terminals follow the goal. Returns the entry cell to play
 * and the cat that should make it.
 * @param {any} state a full multi-cat state (or clone)
 * @param {number} hammers the cat side's hammer count in this node
 * @param {number} depth
 * @param {number} alpha
 * @param {number} beta
 * @param {'cat'|'trapper'} sideToMove
 * @param {number} K candidate limit for the trapper
 * @returns {{score:number, move:number|null, catIndex:number|null}}
 */
export function multiCatAlphaBeta(state, hammers, depth, alpha, beta, sideToMove, K) {
  const cats = state.cats;
  const b = state.board;
  const anyCatch = state.catsGoal === 'anyCatch';
  if (anyCatch && cats.length === 0) {
    return { score: 10000 + depth, move: null, catIndex: null };
  }
  if (!anyCatch) {
    for (const c of cats) {
      if (isBorder(c, b.W, b.H)) return { score: 10000 + depth, move: null, catIndex: null };
    }
  }
  let movable = 0;
  for (let j = 0; j < cats.length; j++) {
    // a cat with no move is only stuck without a full-gauge jump (14.5)
    if (gMoves(state, cats[j], j).length > 0 || jumpRescue(state, j)) movable++;
  }
  if (anyCatch ? movable < cats.length : movable === 0) {
    return { score: -10000 - depth, move: null, catIndex: null };
  }
  if (depth === 0) return { score: multiCatEval(state, hammers), move: null, catIndex: null };

  if (sideToMove === 'cat') {
    /** @type {Array<{catIndex:number, breakTarget:number|null, to:number,
     *                 kind:'move'|'dash'|'jump', path?:number[]}>} */
    const actions = [];
    const relevant = relevantCats(state, 2);
    for (const j of relevant) {
      const d = gDistanceMap(state, j);
      const ms = gMoves(state, cats[j], j)
        .slice()
        .sort((x, y) => d.dist[x.land] - d.dist[y.land]);
      for (const m of ms) actions.push({ catIndex: j, breakTarget: null, to: m.to, kind: 'move' });
      // 14.5 comeback moves for this cat (top 3 each)
      if (state.features) {
        const s = forCat(state, j);
        for (const p of dashPlans(s, 3, d.dist)) {
          actions.push({ catIndex: j, breakTarget: null, to: p.path[0], kind: 'dash', path: p.path });
        }
        for (const t of jumpActions(s, 3, d.dist)) {
          actions.push({ catIndex: j, breakTarget: null, to: t.to, kind: 'jump' });
        }
      }
    }
    if (hammers > 0 && relevant.length > 0) {
      // the hammer applies to one cat: the most relevant one (14.1/13.7)
      const j = relevant[0];
      const s = forCat(state, j);
      for (const { target } of topBreakTargets(s, 3)) {
        const nb0 = cloneNode(state);
        nb0.selectedCat = j;
        nb0.board.cat = nb0.cats[j];
        nb0.board.blocked[target] = 0;
        const dt = gDistanceMap(nb0);
        const tm = gMoves(nb0, nb0.cats[j])
          .slice()
          .sort((x, y) => dt.dist[x.land] - dt.dist[y.land])
          .slice(0, 3);
        for (const m of tm) {
          actions.push({ catIndex: j, breakTarget: target, to: m.to, kind: 'move' });
        }
      }
    }
    let best = -Infinity;
    let bestAction = actions[0];
    for (const a of actions) {
      const nb = cloneNode(state);
      nb.features = state.features;
      nb.power = state.power;
      nb.selectedCat = a.catIndex;
      nb.board.cat = nb.cats[a.catIndex];
      let nh = hammers;
      let land = -1;
      if (a.breakTarget !== null) {
        nb.board.blocked[a.breakTarget] = 0;
        nh -= 1; // break
      }
      /** One normal step of the acting cat inside the node. */
      const stepCat = (entry) => {
        const mv = gMoves(nb, nb.cats[a.catIndex], a.catIndex).find((x) => x.to === entry);
        if (!mv) return null;
        let pickup = 0;
        const k = nb.g.kind[mv.land];
        if (k === CELL_ITEM) {
          nb.g.kind[mv.land] = 0;
          pickup = 1; // pickup (shared cat-side inventory)
        } else if (k === CELL_FISH) {
          nb.g.kind[mv.land] = 0;
        }
        const from = nb.cats[a.catIndex];
        nb.cats[a.catIndex] = mv.land;
        nb.selectedCat = a.catIndex;
        nb.board.cat = mv.land;
        gainStepPower(nb, from); // 18.3: +1 only under pressure
        return { land: mv.land, pickup };
      };
      if (a.kind === 'dash') {
        nb.power = Math.max(0, state.power - DASH_COST);
        for (const entry of /** @type {number[]} */ (a.path)) {
          const r = stepCat(entry);
          if (!r) break;
          land = r.land;
          nh += r.pickup;
          if (isBorder(r.land, b.W, b.H)) break;
        }
        if (land < 0) continue;
      } else if (a.kind === 'jump') {
        nb.power = Math.max(0, state.power - JUMP_COST);
        const k = nb.g.kind[a.to];
        if (k === CELL_ITEM) {
          nb.g.kind[a.to] = 0;
          nh += 1;
        } else if (k === CELL_FISH) {
          nb.g.kind[a.to] = 0;
        }
        gainStepPower(nb, nb.cats[a.catIndex]); // 18.3: the jump's start cell
        land = a.to;
        nb.cats[a.catIndex] = land;
        nb.selectedCat = a.catIndex;
        nb.board.cat = land;
      } else {
        const r = stepCat(a.to);
        if (!r) continue; // the break changed the move (defensive)
        land = r.land;
        nh += r.pickup;
      }
      if (anyCatch && isBorder(land, b.W, b.H)) {
        // the cat runs off the board; the others play on
        nb.cats.splice(a.catIndex, 1);
        nb.escaped += 1;
        nb.selectedCat =
          nb.cats.length > 0 ? Math.min(a.catIndex, nb.cats.length - 1) : -1;
        if (nb.cats.length > 0) nb.board.cat = nb.cats[nb.selectedCat];
      } else {
        nb.cats[a.catIndex] = land;
        nb.selectedCat = a.catIndex;
        nb.board.cat = land;
      }
      const { score } = multiCatAlphaBeta(nb, nh, depth - 1, alpha, beta, 'trapper', K);
      if (score > best) {
        best = score;
        bestAction = a;
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    if (!bestAction) return { score: -Infinity, move: null, catIndex: null };
    return {
      score: best,
      move: bestAction.breakTarget ?? bestAction.to,
      catIndex: bestAction.catIndex,
    };
  }

  const ordered = multiCatCandidates(state, K).candidates;
  if (ordered.length === 0) {
    return { score: multiCatEval(state, hammers), move: null, catIndex: null };
  }
  let best = Infinity;
  let bestMove = ordered[0];
  for (const m of ordered) {
    const nb = cloneNode(state);
    nb.board.blocked[m] = 1;
    const { score } = multiCatAlphaBeta(nb, hammers, depth - 1, alpha, beta, 'cat', K);
    if (score < best) {
      best = score;
      bestMove = m;
    }
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove, catIndex: null };
}

export { itemDistanceMap };
