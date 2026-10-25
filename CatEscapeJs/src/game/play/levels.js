/**
 * Level tables (spec 14.3; they replace the 12.6/13.4 tables). Pure data,
 * no dependencies. With basic rules only `ai` and `blocks` are used; the
 * gimmick rules also use `aiItems` and the per-kind `gimmicks` counts.
 *
 * `blocks` is per difficulty (14.6): difficulty changes only the initial
 * block count, everything else stays as the row defines it. Until the
 * designer runs `npm run calibrate` all three difficulties start from the
 * same value the table had before.
 *
 * Rev. 7 (18.1): `blocks` and `range` are stored **per rules kind**
 * (`basic` / `gimmick`) — the two games balance independently, so each
 * keeps its own calibrated centers and slider ranges. Both kinds start
 * from the same 14.3 values; `npm run calibrate --rules <kind>` writes
 * only that kind's entries and leaves the other untouched.
 *
 * @typedef {{ easy:number, normal:number, hard:number }} BlockCenters
 * @typedef {{ easy:[number,number], normal:[number,number],
 *             hard:[number,number] }} BlockRangeTable
 * @typedef {{ id:number, course:'escape'|'trapper', ai:'easy'|'normal'|'hard',
 *             blocks: Record<'basic'|'gimmick', BlockCenters>,
 *             range?: Partial<Record<'basic'|'gimmick', BlockRangeTable>>,
 *             aiItems:number,
 *             gimmicks: { stone:number, tunnel:number, ice:number, fish:number,
 *                         arrow:number, brittle:number, spring:number, item:number },
 *             cats:number, catsGoal:'anyEscape'|'anyCatch'|null,
 *             intro:string|null }} Level
 */

/** Gimmick keys in unlock order (14.2, fish added by 14.5). */
export const GIMMICK_KEYS = ['stone', 'tunnel', 'ice', 'fish', 'arrow', 'brittle', 'spring', 'item'];

/** The three level-play difficulties (14.6), in ascending difficulty. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'];

/**
 * Build a gimmicks object; missing kinds default to 0.
 * @param {Partial<Level['gimmicks']>} [g]
 * @returns {Level['gimmicks']}
 */
function G(g = {}) {
  return {
    stone: g.stone || 0,
    tunnel: g.tunnel || 0,
    ice: g.ice || 0,
    fish: g.fish || 0,
    arrow: g.arrow || 0,
    brittle: g.brittle || 0,
    spring: g.spring || 0,
    item: g.item || 0,
  };
}

/** All three difficulties start from the row's original block count (14.6). */
function B(n) {
  return { easy: n, normal: n, hard: n };
}

/**
 * Both rules kinds start from the same centers (18.1); calibration then
 * writes each kind's entry separately.
 */
function BB(n) {
  return { basic: B(n), gimmick: B(n) };
}

/** Escape course: the player is the cat, `aiItems` are the AI trapper's doubles. */
// calibrated 2026-10-25
export const ESCAPE_LEVELS = [
  { id: 1, course: 'escape', ai: 'easy', blocks: { basic: { easy: 20, normal: 32, hard: 36 }, gimmick: { easy: 26, normal: 32, hard: 38 } }, range: { basic: { easy: [15, 25], normal: [30, 34], hard: [34, 38] }, gimmick: { easy: [23, 29], normal: [29, 35], hard: [35, 41] } }, aiItems: 0, gimmicks: G(), cats: 1, catsGoal: null, intro: null },
  { id: 2, course: 'escape', ai: 'easy', blocks: { basic: { easy: 24, normal: 30, hard: 36 }, gimmick: { easy: 28, normal: 38, hard: 46 } }, range: { basic: { easy: [21, 27], normal: [27, 33], hard: [33, 39] }, gimmick: { easy: [23, 33], normal: [34, 42], hard: [42, 50] } }, aiItems: 0, gimmicks: G({ stone: 2 }), cats: 1, catsGoal: null, intro: 'stone' },
  { id: 3, course: 'escape', ai: 'easy', blocks: { basic: { easy: 28, normal: 36, hard: 40 }, gimmick: { easy: 30, normal: 38, hard: 42 } }, range: { basic: { easy: [24, 32], normal: [34, 38], hard: [38, 42] }, gimmick: { easy: [26, 34], normal: [36, 40], hard: [40, 44] } }, aiItems: 0, gimmicks: G({ stone: 2 }), cats: 1, catsGoal: null, intro: null },
  { id: 4, course: 'escape', ai: 'easy', blocks: { basic: { easy: 26, normal: 34, hard: 38 }, gimmick: { easy: 28, normal: 36, hard: 42 } }, range: { basic: { easy: [22, 30], normal: [32, 36], hard: [36, 40] }, gimmick: { easy: [24, 32], normal: [33, 39], hard: [39, 45] } }, aiItems: 1, gimmicks: G({ stone: 2 }), cats: 1, catsGoal: null, intro: 'double' },
  { id: 5, course: 'escape', ai: 'easy', blocks: { basic: { easy: 28, normal: 32, hard: 38 }, gimmick: { easy: 28, normal: 36, hard: 42 } }, range: { basic: { easy: [26, 30], normal: [30, 34], hard: [35, 41] }, gimmick: { easy: [24, 32], normal: [33, 39], hard: [39, 45] } }, aiItems: 1, gimmicks: G({ stone: 2 }), cats: 1, catsGoal: null, intro: null },
  { id: 6, course: 'escape', ai: 'easy', blocks: { basic: { easy: 32, normal: 36, hard: 40 }, gimmick: { easy: 34, normal: 42, hard: 52 } }, range: { basic: { easy: [30, 34], normal: [34, 38], hard: [38, 42] }, gimmick: { easy: [30, 38], normal: [38, 46], hard: [47, 57] } }, aiItems: 1, gimmicks: G({ stone: 2, tunnel: 1 }), cats: 1, catsGoal: null, intro: 'tunnel' },
  { id: 7, course: 'escape', ai: 'normal', blocks: { basic: { easy: 14, normal: 16, hard: 18 }, gimmick: { easy: 22, normal: 28, hard: 32 } }, range: { basic: { easy: [13, 15], normal: [15, 17], hard: [17, 19] }, gimmick: { easy: [19, 25], normal: [26, 30], hard: [30, 34] } }, aiItems: 1, gimmicks: G({ stone: 2, tunnel: 1 }), cats: 1, catsGoal: null, intro: null },
  { id: 8, course: 'escape', ai: 'normal', blocks: { basic: { easy: 14, normal: 16, hard: 20 }, gimmick: { easy: 22, normal: 30, hard: 36 } }, range: { basic: { easy: [13, 15], normal: [15, 17], hard: [18, 22] }, gimmick: { easy: [18, 26], normal: [27, 33], hard: [33, 39] } }, aiItems: 1, gimmicks: G({ stone: 2, tunnel: 1, ice: 3 }), cats: 1, catsGoal: null, intro: 'ice' },
  { id: 9, course: 'escape', ai: 'normal', blocks: { basic: { easy: 16, normal: 18, hard: 18 }, gimmick: { easy: 22, normal: 34, hard: 38 } }, range: { basic: { easy: [15, 17], normal: [18, 18], hard: [18, 18] }, gimmick: { easy: [17, 27], normal: [32, 36], hard: [36, 40] } }, aiItems: 1, gimmicks: G({ stone: 2, tunnel: 1, ice: 3, fish: 2 }), cats: 1, catsGoal: null, intro: null },
  { id: 10, course: 'escape', ai: 'normal', blocks: { basic: { easy: 16, normal: 20, hard: 24 }, gimmick: { easy: 22, normal: 30, hard: 38 } }, range: { basic: { easy: [14, 18], normal: [18, 22], hard: [22, 26] }, gimmick: { easy: [18, 26], normal: [26, 34], hard: [34, 42] } }, aiItems: 1, gimmicks: G({ stone: 1, tunnel: 1, ice: 3, fish: 2, arrow: 3 }), cats: 1, catsGoal: null, intro: 'arrow' },
  { id: 11, course: 'escape', ai: 'normal', blocks: { basic: { easy: 16, normal: 20, hard: 24 }, gimmick: { easy: 22, normal: 32, hard: 42 } }, range: { basic: { easy: [14, 18], normal: [18, 22], hard: [22, 26] }, gimmick: { easy: [17, 27], normal: [27, 37], hard: [37, 47] } }, aiItems: 1, gimmicks: G({ stone: 1, tunnel: 1, ice: 3, fish: 2, arrow: 3 }), cats: 1, catsGoal: null, intro: null },
  { id: 12, course: 'escape', ai: 'normal', blocks: { basic: { easy: 18, normal: 20, hard: 24 }, gimmick: { easy: 32, normal: 40, hard: 46 } }, range: { basic: { easy: [17, 19], normal: [19, 21], hard: [22, 26] }, gimmick: { easy: [28, 36], normal: [37, 43], hard: [43, 49] } }, aiItems: 1, gimmicks: G({ stone: 1, tunnel: 1, ice: 4, fish: 2, arrow: 3, brittle: 6 }), cats: 1, catsGoal: null, intro: 'brittle' },
  { id: 13, course: 'escape', ai: 'normal', blocks: { basic: { easy: 18, normal: 20, hard: 24 }, gimmick: { easy: 30, normal: 44, hard: 50 } }, range: { basic: { easy: [17, 19], normal: [19, 21], hard: [22, 26] }, gimmick: { easy: [25, 35], normal: [41, 47], hard: [47, 53] } }, aiItems: 1, gimmicks: G({ stone: 1, tunnel: 1, ice: 4, fish: 2, arrow: 3, brittle: 6 }), cats: 1, catsGoal: null, intro: null },
  { id: 14, course: 'escape', ai: 'hard', blocks: { basic: { easy: 14, normal: 16, hard: 18 }, gimmick: { easy: 52, normal: 58, hard: 58 } }, range: { basic: { easy: [13, 15], normal: [15, 17], hard: [17, 19] }, gimmick: { easy: [49, 55], normal: [58, 58], hard: [58, 58] } }, aiItems: 2, gimmicks: G({ stone: 1, tunnel: 2, ice: 4, fish: 2, arrow: 4, brittle: 6, spring: 2 }), cats: 1, catsGoal: null, intro: 'spring' },
  { id: 15, course: 'escape', ai: 'hard', blocks: { basic: { easy: 14, normal: 18, hard: 20 }, gimmick: { easy: 54, normal: 54, hard: 54 } }, range: { basic: { easy: [12, 16], normal: [17, 19], hard: [19, 21] }, gimmick: { easy: [54, 54], normal: [54, 54], hard: [54, 54] } }, aiItems: 2, gimmicks: G({ stone: 1, tunnel: 2, ice: 4, fish: 3, arrow: 4, brittle: 6, spring: 2 }), cats: 1, catsGoal: null, intro: null },
  { id: 16, course: 'escape', ai: 'hard', blocks: { basic: { easy: 14, normal: 18, hard: 20 }, gimmick: { easy: 60, normal: 60, hard: 60 } }, range: { basic: { easy: [12, 16], normal: [17, 19], hard: [19, 21] }, gimmick: { easy: [60, 60], normal: [60, 60], hard: [60, 60] } }, aiItems: 2, gimmicks: G({ tunnel: 2, ice: 4, fish: 3, arrow: 4, brittle: 8, spring: 2, item: 2 }), cats: 1, catsGoal: null, intro: 'hammer' },
  { id: 17, course: 'escape', ai: 'hard', blocks: { basic: { easy: 18, normal: 20, hard: 24 }, gimmick: { easy: 54, normal: 54, hard: 54 } }, range: { basic: { easy: [17, 19], normal: [19, 21], hard: [22, 26] }, gimmick: { easy: [54, 54], normal: [54, 54], hard: [54, 54] } }, aiItems: 2, gimmicks: G({ tunnel: 2, ice: 4, fish: 3, arrow: 4, brittle: 8, spring: 2, item: 2 }), cats: 2, catsGoal: 'anyEscape', intro: 'cats2Escape' },
  { id: 18, course: 'escape', ai: 'hard', blocks: { basic: { easy: 16, normal: 18, hard: 24 }, gimmick: { easy: 40, normal: 56, hard: 56 } }, range: { basic: { easy: [15, 17], normal: [17, 19], hard: [21, 27] }, gimmick: { easy: [35, 45], normal: [56, 56], hard: [56, 56] } }, aiItems: 2, gimmicks: G({ tunnel: 2, ice: 4, fish: 3, arrow: 4, brittle: 8, spring: 3, item: 2 }), cats: 2, catsGoal: 'anyCatch', intro: 'cats2Catch' },
  { id: 19, course: 'escape', ai: 'hard', blocks: { basic: { easy: 16, normal: 18, hard: 26 }, gimmick: { easy: 60, normal: 60, hard: 60 } }, range: { basic: { easy: [15, 17], normal: [17, 19], hard: [22, 30] }, gimmick: { easy: [60, 60], normal: [60, 60], hard: [60, 60] } }, aiItems: 2, gimmicks: G({ tunnel: 2, ice: 4, fish: 3, arrow: 4, brittle: 8, spring: 3, item: 2 }), cats: 3, catsGoal: 'anyEscape', intro: 'cats3Escape' },
  { id: 20, course: 'escape', ai: 'hard', blocks: { basic: { easy: 16, normal: 18, hard: 22 }, gimmick: { easy: 36, normal: 44, hard: 50 } }, range: { basic: { easy: [15, 17], normal: [17, 19], hard: [20, 24] }, gimmick: { easy: [32, 40], normal: [41, 47], hard: [47, 53] } }, aiItems: 2, gimmicks: G({ tunnel: 2, ice: 4, fish: 3, arrow: 4, brittle: 8, spring: 3, item: 2 }), cats: 3, catsGoal: 'anyCatch', intro: 'cats3Catch' },
];

/** Trapper course: the player is the trapper, `aiItems` are the AI cat's hammers. */
// calibrated 2026-10-25
export const TRAPPER_LEVELS = [
  { id: 1, course: 'trapper', ai: 'easy', blocks: { basic: { easy: 26, normal: 16, hard: 10 }, gimmick: { easy: 26, normal: 16, hard: 10 } }, range: { basic: { easy: [21, 31], normal: [13, 19], hard: [7, 13] }, gimmick: { easy: [21, 31], normal: [13, 19], hard: [7, 13] } }, aiItems: 0, gimmicks: G(), cats: 1, catsGoal: null, intro: null },
  { id: 2, course: 'trapper', ai: 'easy', blocks: { basic: { easy: 22, normal: 14, hard: 10 }, gimmick: { easy: 22, normal: 16, hard: 10 } }, range: { basic: { easy: [18, 26], normal: [12, 16], hard: [8, 12] }, gimmick: { easy: [19, 25], normal: [13, 19], hard: [7, 13] } }, aiItems: 0, gimmicks: G({ stone: 1 }), cats: 1, catsGoal: null, intro: 'stone' },
  { id: 3, course: 'trapper', ai: 'easy', blocks: { basic: { easy: 20, normal: 12, hard: 10 }, gimmick: { easy: 24, normal: 16, hard: 10 } }, range: { basic: { easy: [16, 24], normal: [11, 13], hard: [9, 11] }, gimmick: { easy: [20, 28], normal: [13, 19], hard: [7, 13] } }, aiItems: 0, gimmicks: G({ stone: 1 }), cats: 1, catsGoal: null, intro: null },
  { id: 4, course: 'trapper', ai: 'easy', blocks: { basic: { easy: 18, normal: 14, hard: 6 }, gimmick: { easy: 10, normal: 6, hard: 2 } }, range: { basic: { easy: [16, 20], normal: [12, 16], hard: [2, 10] }, gimmick: { easy: [8, 12], normal: [4, 8], hard: [0, 4] } }, aiItems: 0, gimmicks: G({ stone: 1 }), cats: 1, catsGoal: null, intro: 'double' },
  { id: 5, course: 'trapper', ai: 'easy', blocks: { basic: { easy: 16, normal: 12, hard: 8 }, gimmick: { easy: 10, normal: 6, hard: 2 } }, range: { basic: { easy: [14, 18], normal: [10, 14], hard: [6, 10] }, gimmick: { easy: [8, 12], normal: [4, 8], hard: [0, 4] } }, aiItems: 0, gimmicks: G({ stone: 1 }), cats: 1, catsGoal: null, intro: null },
  { id: 6, course: 'trapper', ai: 'easy', blocks: { basic: { easy: 16, normal: 12, hard: 8 }, gimmick: { easy: 18, normal: 14, hard: 8 } }, range: { basic: { easy: [14, 18], normal: [10, 14], hard: [6, 10] }, gimmick: { easy: [16, 20], normal: [12, 16], hard: [5, 11] } }, aiItems: 0, gimmicks: G({ stone: 1, tunnel: 1 }), cats: 1, catsGoal: null, intro: 'tunnel' },
  { id: 7, course: 'trapper', ai: 'normal', blocks: { basic: { easy: 22, normal: 20, hard: 18 }, gimmick: { easy: 28, normal: 20, hard: 18 } }, range: { basic: { easy: [21, 23], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [24, 32], normal: [19, 21], hard: [17, 19] } }, aiItems: 0, gimmicks: G({ stone: 1, tunnel: 1 }), cats: 1, catsGoal: null, intro: null },
  { id: 8, course: 'trapper', ai: 'normal', blocks: { basic: { easy: 24, normal: 20, hard: 18 }, gimmick: { easy: 28, normal: 24, hard: 20 } }, range: { basic: { easy: [22, 26], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [26, 30], normal: [22, 26], hard: [18, 22] } }, aiItems: 0, gimmicks: G({ stone: 1, tunnel: 1, ice: 3 }), cats: 1, catsGoal: null, intro: 'ice' },
  { id: 9, course: 'trapper', ai: 'normal', blocks: { basic: { easy: 22, normal: 20, hard: 16 }, gimmick: { easy: 26, normal: 22, hard: 18 } }, range: { basic: { easy: [21, 23], normal: [19, 21], hard: [14, 18] }, gimmick: { easy: [24, 28], normal: [20, 24], hard: [16, 20] } }, aiItems: 0, gimmicks: G({ stone: 1, tunnel: 1, ice: 3 }), cats: 1, catsGoal: null, intro: null },
  { id: 10, course: 'trapper', ai: 'normal', blocks: { basic: { easy: 22, normal: 20, hard: 18 }, gimmick: { easy: 22, normal: 18, hard: 14 } }, range: { basic: { easy: [21, 23], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [20, 24], normal: [16, 20], hard: [12, 16] } }, aiItems: 0, gimmicks: G({ stone: 2, tunnel: 1, ice: 3, arrow: 3 }), cats: 1, catsGoal: null, intro: 'arrow' },
  { id: 11, course: 'trapper', ai: 'normal', blocks: { basic: { easy: 22, normal: 18, hard: 16 }, gimmick: { easy: 24, normal: 18, hard: 14 } }, range: { basic: { easy: [20, 24], normal: [17, 19], hard: [15, 17] }, gimmick: { easy: [21, 27], normal: [16, 20], hard: [12, 16] } }, aiItems: 0, gimmicks: G({ stone: 2, tunnel: 1, ice: 3, arrow: 3 }), cats: 1, catsGoal: null, intro: null },
  { id: 12, course: 'trapper', ai: 'normal', blocks: { basic: { easy: 20, normal: 16, hard: 14 }, gimmick: { easy: 24, normal: 18, hard: 16 } }, range: { basic: { easy: [18, 22], normal: [15, 17], hard: [13, 15] }, gimmick: { easy: [21, 27], normal: [17, 19], hard: [15, 17] } }, aiItems: 0, gimmicks: G({ stone: 2, tunnel: 1, ice: 4, arrow: 3, brittle: 6 }), cats: 1, catsGoal: null, intro: 'brittle' },
  { id: 13, course: 'trapper', ai: 'normal', blocks: { basic: { easy: 22, normal: 18, hard: 16 }, gimmick: { easy: 22, normal: 16, hard: 14 } }, range: { basic: { easy: [20, 24], normal: [17, 19], hard: [15, 17] }, gimmick: { easy: [19, 25], normal: [15, 17], hard: [13, 15] } }, aiItems: 0, gimmicks: G({ stone: 2, tunnel: 1, ice: 4, arrow: 3, brittle: 6 }), cats: 1, catsGoal: null, intro: null },
  { id: 14, course: 'trapper', ai: 'hard', blocks: { basic: { easy: 24, normal: 20, hard: 18 }, gimmick: { easy: 38, normal: 32, hard: 24 } }, range: { basic: { easy: [22, 26], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [35, 41], normal: [29, 35], hard: [20, 28] } }, aiItems: 0, gimmicks: G({ stone: 2, tunnel: 2, ice: 4, arrow: 4, brittle: 6, spring: 2 }), cats: 1, catsGoal: null, intro: 'spring' },
  { id: 15, course: 'trapper', ai: 'hard', blocks: { basic: { easy: 22, normal: 20, hard: 18 }, gimmick: { easy: 44, normal: 38, hard: 34 } }, range: { basic: { easy: [21, 23], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [41, 47], normal: [36, 40], hard: [32, 36] } }, aiItems: 0, gimmicks: G({ stone: 2, tunnel: 2, ice: 4, fish: 1, arrow: 4, brittle: 6, spring: 2 }), cats: 1, catsGoal: null, intro: null },
  { id: 16, course: 'trapper', ai: 'hard', blocks: { basic: { easy: 24, normal: 20, hard: 18 }, gimmick: { easy: 58, normal: 46, hard: 36 } }, range: { basic: { easy: [22, 26], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [53, 60], normal: [41, 51], hard: [31, 41] } }, aiItems: 1, gimmicks: G({ stone: 3, tunnel: 2, ice: 4, fish: 1, arrow: 4, brittle: 8, spring: 2, item: 2 }), cats: 1, catsGoal: null, intro: 'hammer' },
  { id: 17, course: 'trapper', ai: 'hard', blocks: { basic: { easy: 22, normal: 20, hard: 18 }, gimmick: { easy: 48, normal: 42, hard: 20 } }, range: { basic: { easy: [21, 23], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [45, 51], normal: [39, 45], hard: [15, 25] } }, aiItems: 1, gimmicks: G({ stone: 3, tunnel: 2, ice: 4, fish: 1, arrow: 4, brittle: 8, spring: 2, item: 2 }), cats: 2, catsGoal: 'anyEscape', intro: 'cats2Escape' },
  { id: 18, course: 'trapper', ai: 'hard', blocks: { basic: { easy: 24, normal: 20, hard: 18 }, gimmick: { easy: 38, normal: 32, hard: 24 } }, range: { basic: { easy: [22, 26], normal: [19, 21], hard: [17, 19] }, gimmick: { easy: [35, 41], normal: [29, 35], hard: [20, 28] } }, aiItems: 1, gimmicks: G({ stone: 3, tunnel: 2, ice: 4, fish: 1, arrow: 4, brittle: 8, spring: 3, item: 2 }), cats: 2, catsGoal: 'anyCatch', intro: 'cats2Catch' },
  { id: 19, course: 'trapper', ai: 'hard', blocks: { basic: { easy: 20, normal: 18, hard: 12 }, gimmick: { easy: 32, normal: 20, hard: 0 } }, range: { basic: { easy: [19, 21], normal: [17, 19], hard: [9, 15] }, gimmick: { easy: [27, 37], normal: [15, 25], hard: [0, 5] } }, aiItems: 1, gimmicks: G({ stone: 3, tunnel: 2, ice: 4, fish: 1, arrow: 4, brittle: 8, spring: 3, item: 2 }), cats: 3, catsGoal: 'anyEscape', intro: 'cats3Escape' },
  { id: 20, course: 'trapper', ai: 'hard', blocks: { basic: { easy: 20, normal: 20, hard: 14 }, gimmick: { easy: 22, normal: 14, hard: 8 } }, range: { basic: { easy: [20, 20], normal: [20, 20], hard: [11, 17] }, gimmick: { easy: [18, 26], normal: [11, 17], hard: [5, 11] } }, aiItems: 1, gimmicks: G({ stone: 3, tunnel: 2, ice: 4, fish: 1, arrow: 4, brittle: 8, spring: 3, item: 2 }), cats: 3, catsGoal: 'anyCatch', intro: 'cats3Catch' },
];

/** Number of levels per course. */
export const LEVEL_COUNT = 20;

/**
 * First level of each course where the 14.5 comeback features switch on.
 * `dash` also switches the power gauge on (`power`); the trapper course's
 * cat is the AI there, so its gauge reads "AI power" in the spec table.
 * @type {{escape: {dash:number, jump:number, storm:number},
 *         trapper: {dash:number, jump:number, storm:number}}}
 */
export const FEATURE_UNLOCKS = {
  escape: { dash: 3, jump: 7, storm: 11 },
  trapper: { dash: 13, jump: 15, storm: Infinity },
};

/**
 * The 14.5 comeback features active at `course` level `level` (a feature
 * stays on for every later level of its course).
 * @param {'escape'|'trapper'} course
 * @param {number} level
 * @returns {{power:boolean, dash:boolean, jump:boolean, storm:boolean}}
 */
export function levelFeatures(course, level) {
  const c = course === 'trapper' ? 'trapper' : 'escape';
  const n = Math.min(Math.max(Math.floor(level) || 1, 1), LEVEL_COUNT);
  const u = FEATURE_UNLOCKS[c];
  const dash = n >= u.dash;
  return {
    power: dash,
    dash,
    jump: n >= u.jump,
    storm: c === 'escape' && n >= u.storm,
  };
}

/**
 * The 20 levels of a course.
 * @param {'escape'|'trapper'} course
 * @returns {Level[]}
 */
export function getLevels(course) {
  return course === 'trapper' ? TRAPPER_LEVELS : ESCAPE_LEVELS;
}

/**
 * One level of a course; the level number is clamped to 1..20.
 * @param {'escape'|'trapper'} course
 * @param {number} level
 * @returns {Level}
 */
export function getLevel(course, level) {
  const n = Math.min(Math.max(Math.floor(level) || 1, 1), LEVEL_COUNT);
  return getLevels(course)[n - 1];
}

/**
 * The initial block count of a level for a play difficulty (14.6) and a
 * rules kind (18.1). The pre-18.1 shapes (a plain `{easy,normal,hard}`
 * object, or a plain number) are read for every rules kind, so old saves
 * and fixtures keep working; the nested `blocks[rules][difficulty]` shape
 * is what the current table uses.
 * @param {Level} lv
 * @param {'easy'|'normal'|'hard'} [difficulty='normal']
 * @param {'basic'|'gimmick'} [rules='gimmick']
 * @returns {number}
 */
export function blocksFor(lv, difficulty = 'normal', rules = 'gimmick') {
  const b = lv.blocks;
  if (b && typeof b === 'object') {
    const kind = b[rules] || b.basic || b.gimmick;
    if (kind && typeof kind === 'object') {
      const v = kind[difficulty];
      if (Number.isFinite(v)) return v;
      return Number.isFinite(kind.normal) ? kind.normal : 0;
    }
    const v = b[difficulty];
    if (Number.isFinite(v)) return v;
    return Number.isFinite(b.normal) ? b.normal : 0;
  }
  return Number.isFinite(b) ? b : 0;
}
