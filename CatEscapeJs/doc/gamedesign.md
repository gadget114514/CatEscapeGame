# Cat Escape: Trap the Cat played both ways, detailed design

## Context
`CatEscapeJs` is an empty repo (only LICENSE and a Node .gitignore). The goal is a hex-board game that
implements the classic "Trap the Cat" (Chat Noir) and also its reverse, where the player is the cat and escapes.
- Modes: **Trapper mode** (the player places blocks, the AI moves the cat) and **Escape mode** (the player moves the cat, the AI places blocks)
- Babylon.js 3D rendering. Packaged with Electron, and the same build also runs on **GitHub Pages**
- AI difficulty can be set to Easy / Normal / Hard

## Division of work
- **Design: Claude Opus.** This document (`doc/gamedesign.md`) and `AGENTS.md`
- **Implementation: opencode.** Works through the tasks in section 10 of this document in order, following the spec in sections 1–9.
  Where the spec is ambiguous, keep the module boundaries and APIs in this document, and add the decision to the "Implementation notes" at the end.

---

## 1. Game rules

| Item | Spec |
|---|---|
| Board | 11 × 11 hex grid, pointy-top, **odd-r offset** (odd rows are shifted half a cell to the right) |
| Cat's start | Center `(r=5, c=5)` |
| Initial blocks | Number set by mode and difficulty in the table below, placed at random. Never on the cat's cell. Generation retries until the cat has at least one route to the edge. Up to 100 retries, then the block count is reduced by 1 |
| One trapper action | Block one empty cell that is not the cat's cell |
| One cat action | Move to one empty neighboring cell (6 directions) |
| Cat wins | **The cat reaches an edge cell** (r=0, r=H-1, c=0 or c=W-1). In the original the cat steps off the board from the edge, but that step can't be stopped, so reaching the edge counts as the win |
| Trapper wins | At the start of the cat's turn, the cat has no empty neighbor |
| First move | Trapper mode: the trapper (player) goes first. Escape mode: the cat (player) goes first, to keep it fair |

Number of initial blocks (`INITIAL_BLOCKS[mode][difficulty]`):

| | Easy | Normal | Hard |
|---|---|---|---|
| trapper (player traps) | 15 | 11 | 7 |
| escape (player escapes) | 5 | 8 | 11 |

The random number generator is seeded (`mulberry32`), so tests and replays are reproducible. The HUD shows the seed.

## 2. Coordinate system (`src/game/hex.js`)
- Cell index `i = r * W + c`. Everything is handled as an index internally.
- Neighbors (odd-r):
  - even row r: `(r,c-1) (r,c+1) (r-1,c-1) (r-1,c) (r+1,c-1) (r+1,c)`
  - odd row r: `(r,c-1) (r,c+1) (r-1,c) (r-1,c+1) (r+1,c) (r+1,c+1)`
- Precompute the neighbor table at board creation: `neighbors: Int16Array[]` (out-of-board cells excluded).

```js
export function toIndex(r, c, W)            // → number
export function toRC(i, W)                  // → {r, c}
export function inBounds(r, c, W, H)        // → boolean
export function buildNeighborTable(W, H)    // → Int16Array[] (length W*H)
export function isBorder(i, W, H)           // → boolean
export function cellCenter(r, c, size, gap) // → {x, z}   for rendering (pure math, no Babylon dependency)
//   x = (size*√3 + gap) * (c + 0.5*(r&1)) - offsetX
//   z = -(size*1.5 + gap*0.866) * r + offsetZ  (offsets center the board on the origin)
```

## 3. Board state (`src/game/board.js`)
```js
/** @typedef {{ W:number, H:number, blocked:Uint8Array, cat:number,
 *              nbr:Int16Array[], border:Uint8Array }} Board */
export function createBoard(W = 11, H = 11)          // empty board, cat at center
export function cloneBoard(b)                         // copies blocked only (nbr/border are shared)
export function isEmpty(b, i)                         // !blocked && i !== cat
export function emptyNeighbors(b, i)                  // → number[]
export function distanceMap(b)                        // see below
export function catDistanceMap(b)                     // BFS distances from the cat (through empty cells)
export function reachableArea(b)                      // number of cells the cat can reach (flood fill)
```
**distanceMap(b)** → `{ dist: Int16Array, paths: Float64Array }`
- Multi-source BFS starting from every empty edge cell (the cat's cell counts as empty), dist = 0 there. Blocked cells and unreachable cells get `-1`.
- `paths[v]` = number of shortest routes from v to the edge. Edge cells = 1, otherwise the sum of `paths[u]` over neighbors u with `dist[u] == dist[v]-1`.
- The cat needs `dist[cat]` moves to escape. `dist[cat] == -1` means the cat is enclosed.

## 4. Rules (`src/game/rules.js`)
```js
/** @typedef {'trapper'|'escape'} Mode  @typedef {'easy'|'normal'|'hard'} Difficulty
 *  @typedef {'trapper'|'cat'} Side
 *  @typedef {{ board:Board, mode:Mode, difficulty:Difficulty, turn:Side,
 *              status:'playing'|'catWin'|'trapperWin', moveCount:number, seed:number,
 *              history:Array<{side:Side, index:number}> }} GameState */
export const INITIAL_BLOCKS = {...}                   // table in section 1
export function newGame({ mode, difficulty, seed = Date.now()>>>0, W = 11, H = 11 }) // → GameState
export function legalBlocks(state)                    // → number[] (all empty cells)
export function legalCatMoves(state)                  // → number[]
export function applyBlock(state, i)                  // mutates; throws on an illegal move; turn → 'cat'; recomputes status
export function applyCatMove(state, i)                // mutates; throws on an illegal move; turn → 'trapper'; recomputes status
export function evaluateStatus(state)                 // cat on edge → catWin / cat's turn with no moves → trapperWin
```
- `src/game/rng.js`: `mulberry32(seed)` → `() => [0,1)`. `pick(rng, arr)`, `shuffle(rng, arr)`.
- `history` is used for the move counter and debugging. There is no undo.

## 5. AI

Shared rules: the AI is a **pure function** taking `(state, rng)` and returning a move index. It must never modify `state`; it works on `cloneBoard`.

### 5.1 Cat AI (`src/game/catAI.js`): `chooseCatMove(state, rng) → index`
Common first step: `moves = legalCatMoves`. If a move lands on an edge cell, take it immediately.
**If the cat is already enclosed** (`dist[cat]==-1`), every level picks the move with the largest `reachableArea` after moving, to survive as long as possible.
The area is measured **with the cat's old cell treated as blocked** (so stepping into a dead-end pocket scores lower than staying in the big region); ties are broken by more `emptyNeighbors` of the destination, then at random. (Rev. 2: measuring with the old cell passable gives the same value for every move.)

| Level | Algorithm |
|---|---|
| Easy | 30% chance of a random legal move. Otherwise the neighbor with the smallest `dist`, ties broken at random |
| Normal | Smallest `dist`, then the largest `paths`, then random |
| Hard | Alpha-beta search, 4 plies deep (cat → trapper → cat → trapper), evaluation function `evalForCat` |

### 5.2 Trapper AI (`src/game/trapperAI.js`): `chooseBlock(state, rng) → index`
**Candidate generation** `trapperCandidates(board, K)`:
1. `d = distanceMap`, `g = catDistanceMap`, `D = d.dist[cat]`
2. Cells with `g[v] + d.dist[v] == D` (empty cells on a shortest route), plus the cat's empty neighbors
3. Sort by ascending `g[v]` (closer to the cat first), then descending `paths[v]`, and keep the top K (K=12)
4. If the cat is already enclosed: candidates = the cat's empty neighbors. Pick the one that minimizes the cat's `reachableArea` after blocking (shared by every level, finishes the game)

| Level | Algorithm |
|---|---|
| Easy | 50% chance of a random empty cell within distance 3 of the cat. Otherwise Normal |
| Normal | For each candidate, simulate the block and score it as `(newDist, -newPaths)`, higher is better (newDist = -1 counts as +∞). Ties broken at random |
| Hard | Alpha-beta search, 4 plies deep (trapper → cat → trapper → cat). Candidates K=10 |

### 5.3 Search (`src/game/search.js`), shared by both sides
```js
export function evalForCat(board)  // higher is better for the cat
//  cat on edge             → +10000
//  cat has no moves        → -10000
//  dist[cat] == -1         → -5000 + reachableArea*10
//  otherwise                → -100*dist + 15*min(paths,20) + 5*emptyNeighbors(cat).length
export function alphaBeta(board, depth, alpha, beta, sideToMove, K) // → {score, move}
```
- Cat's turn: maximize over `emptyNeighbors(cat)`. Trapper's turn: minimize over `trapperCandidates(board, K)`.
- A terminal state or depth 0 returns `evalForCat`. Add a depth bonus to win scores (`±(10000 + depth)`) so faster wins are preferred.
- Move ordering: the cat's moves in ascending dist; the trapper's moves in candidate order. Target performance: Hard under 100 ms per move on 11×11.

## 6. Controller (`src/game/controller.js`)
The turn state machine. It has no Babylon or DOM dependency. The view is injected, so tests can drive it with a stub.

```js
export class GameController {
  constructor({ view, hud, aiDelayMs = 350, rngFactory = mulberry32 })
  start({ mode, difficulty, seed })   // newGame → view.rebuild(state) → enter the first turn
  onCellClicked(index)                // input from picking. Ignored unless phase === 'player'
  get state()                          // current GameState (read-only use)
  get phase()                          // 'player' | 'ai' | 'animating' | 'over'
}
```
**Phase transitions**
```
start → (whose turn?) ─ player's side → phase='player', view.setHighlights(legal moves)
                     └ AI's side     → phase='ai'
player: onCellClicked(i) legal → phase='animating' → apply* → await view.animate*() → next()
ai:     setTimeout(aiDelayMs) → choose* → phase='animating' → apply* → await view.animate*() → next()
next(): status !== 'playing' → phase='over', await view.animateResult(status), hud.showResult(status)
        otherwise → enter the next turn
```
- Ignore illegal clicks (optionally `view.flashInvalid(i)`).
- `start()` during play: increment a generation token, so pending setTimeout callbacks and promises are discarded when the token doesn't match.
- Player side: trapper mode → `'trapper'`, escape mode → `'cat'`.

**View interface** (implemented by `render/` and stubbed in tests)
```js
rebuild(state)                       // rebuild every cell and the cat
setHighlights(indices)               // highlight candidates (escape mode: cat moves; trapper mode: none)
setHint(pathIndices|null)            // "Show path hint": the cat's shortest route
animateBlock(i): Promise<void>       // cell rises, ~200ms
animateCatMove(from, to): Promise<void> // hop, ~250ms
animateResult(status): Promise<void> // catWin: runs off the board / trapperWin: the cat shakes and sits down
flashInvalid(i)
```
**HUD interface**: `setStatus(text)`, `setTurn(side, isPlayer)`, `showResult(status, moveCount)`, `setSeed(seed)`

## 7. Rendering (`src/render/`): `@babylonjs/core` ^8 (ES modules, tree-shaken)
- **scene.js**: `createScene(canvas)` → `{engine, scene, camera}`.
  `new Engine(canvas, true, {adaptToDeviceRatio:true})`, background `#1e2a38`.
  `ArcRotateCamera(alpha=-π/2, beta=0.85, radius=22)`, panning off, beta limited to 0.5–1.1, radius limited to 15–35.
  `HemisphericLight(0,1,0)` intensity 0.8 + `DirectionalLight(-1,-2,-1)` intensity 0.5.
  `window.resize → engine.resize()`.
- **boardView.js**: one mesh per cell (121 meshes, simple picking).
  `MeshBuilder.CreateCylinder({diameter: 2*size, height: 0.3, tessellation: 6})`, `rotation.y = π/6` (pointy-top).
  size=1, gap=0.1. `mesh.metadata = {index}`. Shared materials (StandardMaterial):
  `empty #8fd18b`, `border #a8e0a0` (edge cells lighter), `blocked #3b4a5a` (height scaled to 2.5× via scaling.y, raised),
  `hover #ffe066`, `highlight #66d9ff`, `hint #ff9f43`.
  Animate blocks with `Animation.CreateAndStartAnimation` on scaling.y 1→2.5 and resolve the Promise with onAnimationEnd.
- **catView.js**: a procedural model (no external assets, so it works with file:// and on Pages).
  Body: ellipsoid sphere. Head: sphere. Ears: 2 cones. Tail: a thin cylinder. Color `#f39c34`, eyes black. Combined under a `TransformNode`.
  Hop: lerp x/z over 250 ms, y = `0.8*sin(πt)`, yaw turns toward the direction of travel. Driven by `scene.onBeforeRenderObservable`, resolved by a Promise.
  catWin: moves 3 cells outward from the edge while fading (`visibility` 1→0). trapperWin: shakes side to side 3 times, then scaling.y 0.8.
- **picking.js**: `scene.onPointerObservable`
  `POINTERMOVE` → `scene.pick` → hover highlight on an empty cell (only during the player's turn).
  `POINTERTAP` → `controller.onCellClicked(index)`. Ignore drags (camera rotation). Works for both touch and mouse.
- **view.js**: brings the above together into the View interface.

### 7.1 Rev. 3: fixes from the designer's browser test
- **Camera auto-fit** (`fitCamera(camera, engine, boardExtent)` in scene.js). The fixed radius=22 cuts off the board at 4:3 and
  shows only a third of it at phone width (375×812). On startup and on every resize:
  compute the board's half-width `hx` and half-depth `hz` from `cellCenter` (+1 cell of margin), then
  `vFov = camera.fov`, `hFov = 2*atan(tan(vFov/2)*aspect)`, and
  `radius = max(hz / sin(vFov/2) , hx / sin(hFov/2)) * 1.05` (tilt is ignored; the factor covers it).
  Set `lowerRadiusLimit = radius*0.7`, `upperRadiusLimit = radius*1.6`. Account for the HUD: shift `camera.target.z`
  so the board is centered in the area below the top bar (approximation is fine).
- **Lighting is blown out** (edge cells render white, the hint looks yellow like hover). `HemisphericLight` intensity 0.55 with
  `groundColor #404850`, `DirectionalLight` intensity 0.35. All cell materials: `specularColor` black, `emissiveColor = diffuse*0.15`.
  Colors: `empty #7cc576`, `border #b5dba8`, `hint #ff7a1a` (clearly orange), `hover #ffe066` unchanged.
  When a hint cell is also a highlight cell, show the highlight color (the cell can be clicked) with the hint as a thin orange
  outline ring (a slightly larger flat cylinder under the cell is fine).
- **Cat is too small**: the whole cat TransformNode is scaled 1.4×; it must stay within one cell.
- **Japanese strings**: mode label "ねこににげる" is wrong. Use "ねこをつかまえる" / "ねことしてにげる".
- **Accessibility**: every form control has a `<label for>` (the hint checkbox currently reads as "on").
- **Dev hook**: when `import.meta.env.DEV`, expose `window.__catescape = { controller, view }` for automated play-testing.

## 8. HUD / UI (`src/ui/hud.js`, `src/ui/strings.js`, `index.html`, `src/style.css`)
- DOM overlay on top of a full-screen canvas.
  - Top bar: Mode `<select>` (Trap the Cat / Cat Escape), Difficulty `<select>`, `New Game` button, "Show path hint" checkbox
  - Status line: whose turn it is, move count, seed
  - Result modal: "You trapped the cat!" / "The cat escaped!" / "You escaped!" / "You were caught!", move count, `Play again`
- `strings.js`: Japanese and English. Switches on `navigator.language`, defaulting to ja.
- Settings (mode, difficulty, hint) are saved to `localStorage`, wrapped in try/catch.
- Phone width (≥360px): the top bar wraps onto two lines.

## 9. Directory layout and configuration
All project files live in the repository's `CatEscapeJs/` folder (paths below are relative to it). Only `LICENSE`, `.gitignore` and `.github/workflows/` sit at the repository root; the workflow runs with `working-directory: CatEscapeJs`.
```
package.json          "type":"module", "main":"electron/main.cjs"
vite.config.js        base:'./', build.outDir:'dist', test:{environment:'node'}
index.html
src/main.js           createScene → createView → GameController → bindHud → controller.start(saved settings)
src/style.css
src/game/{hex,board,rules,rng,catAI,trapperAI,search,controller}.js
src/render/{scene,boardView,catView,picking,view}.js
src/ui/{hud,strings}.js
electron/main.cjs
test/{hex,board,rules,catAI,trapperAI,search,controller}.test.js
.github/workflows/pages.yml
doc/gamedesign.md  AGENTS.md  README.md
```
**package.json scripts**
```
dev            vite
build          vite build
preview        vite preview
test           vitest run
electron:dev   concurrently -k "vite --port 5173 --strictPort" "wait-on tcp:5173 && cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron ."
electron       vite build && electron .
electron:build vite build && electron-builder --win
```
dependencies: `@babylonjs/core`. devDependencies: `vite`, `vitest`, `electron`, `electron-builder`, `concurrently`, `wait-on`, `cross-env`.

**electron/main.cjs**: `BrowserWindow({width:1100, height:800, webPreferences:{contextIsolation:true, nodeIntegration:false}})`.
`process.env.VITE_DEV_SERVER_URL` set → `loadURL`, otherwise → `loadFile(path.join(__dirname,'../dist/index.html'))`. Menu bar hidden.
electron-builder: `appId: com.gadget114514.catescape`, `productName: CatEscape`, `files: ["dist/**","electron/**"]`, win target `nsis`.

**.github/workflows/pages.yml**: manual trigger (`workflow_dispatch`) → Node 20, `npm ci`, `npm test`, `npm run build`,
`actions/upload-pages-artifact@v3 (path: dist)` → `actions/deploy-pages@v4`. permissions `pages: write, id-token: write`.
(Pages source must be set to "GitHub Actions" in the repo settings. Note this in the README.)

**AGENTS.md main rules**: `src/game/**` must not import Babylon or the DOM. Write tests for each module first and keep `npm test` green.
ES modules, 2-space indent, JSDoc types, no TypeScript. No external asset files (everything procedural).

## 10. Task breakdown (opencode works through these in order)
| # | Task | Files | Acceptance criteria |
|---|---|---|---|
| 1 | Scaffold | package.json, vite.config.js, index.html, src/main.js, AGENTS.md | `npm run dev` shows a blank canvas, `npm test` runs (0 tests is fine) |
| 2 | hex + rng | src/game/hex.js, rng.js, test/hex.test.js | Neighbors of (0,0), (5,5), (6,5) and (10,10) match expected values, isBorder, same seed gives the same sequence |
| 3 | board | board.js, test/board.test.js | distanceMap: dist=5 on an empty board from the center, paths>0; dist=-1 when walled in; reachableArea |
| 4 | rules | rules.js, test/rules.test.js | Initial block counts, cat cell not blocked, route guaranteed, illegal moves throw, catWin/trapperWin detected |
| 5 | Cat AI | catAI.js, search.js, test/catAI.test.js, search.test.js | Normal takes the shortest route; enclosed cat maximizes area; Hard reaches a 2-move escape fixture; Hard under 100 ms |
| 6 | Trapper AI | trapperAI.js, test/trapperAI.test.js | Candidates include the cat's neighbors; Normal/Hard win a "1-move trap" fixture; Hard under 100 ms |
| 7 | Controller | controller.js, test/controller.test.js | With a stub view and fake timers: both modes run to the end, clicks ignored during AI turn and animations, start() during play doesn't leak |
| 8 | Rendering | src/render/* | Board and cat appear, hover/tap work, block/hop/result animations |
| 9 | HUD | src/ui/*, style.css | Mode/difficulty switching, New Game, hint, result modal, localStorage, phone width |
| 10 | Electron | electron/main.cjs, package.json | `npm run electron` and `electron:dev` run the game |
| 11 | Pages | .github/workflows/pages.yml, README.md | `npm run build && npm run preview` runs fine with relative paths |
| 12 | Gimmick rules | src/game/gimmick/gimmickRules.js, test/gimmickRules.test.js | Item/stone cells can't be blocked, pickup, hammer break, double, new trapperWin rule, seeded setup |
| 13 | Gimmick AI | src/game/gimmick/{gimmickAI,gimmickSearch}.js, test/gimmickAI.test.js | Candidates exclude item/stone cells; enclosed cat with hammer breaks out; trapper uses double at the 12.5 thresholds; Hard < 100 ms |
| 14 | Play styles | src/game/play/{levels,progress,setup}.js, test/progress.test.js, test/setup.test.js | Level tables match 12.6 exactly; level 1 open, 3 wins unlock the next (per rules); streak current/best; inventory rules and cap 9; basic rules never touch the inventory; load/save round trip; bad data → defaults |
| 15 | Rulesets + controller | src/game/rulesets.js, controller.js, new test/controllerRuleset.test.js | Existing controller tests pass **unchanged**; useItem/showHint flows; hint cleared on the next move; double keeps the player's turn; AI uses items; onGameOver fires once |
| 16 | Rendering + ortho camera | src/render/*, fit.js, test/fit.test.js | Item/stone cells, pickup/break animations, breakable highlight, perspective ⇄ ortho without restart, picking in both |
| 17 | UI | src/ui/*, index.html, style.css, main.js | Four-axis selects, level select screen, item bar and toasts, route button, streak line, result modals, persistence, phone width |
| 18 | Gimmick registry + graph + unlocks | src/game/gimmick/{registry,graph,hexDir}.js, kinds/{item,stone}.js, play/levels.js, play/progress.js (`seenIntro`), play/setup.js | Graph equivalence with board.js; item/stone behavior unchanged; unlock order from **14.2**; tables from **14.3**; gimmicks only at or after their unlock level; streak play keeps only unlocked gimmicks |
| 19 | New gimmicks + new hammer | kinds/{tunnel,ice,arrow,brittle,spring}.js, hammer per **14.1**, gimmickAI/gimmickSearch updates, bug **14.4-1** | Every rule test in 13.6 and 14.1; the chooseBlock regression test; Hard < 100 ms on an L20 board |
| 20 | Multiple cats | gimmickRules, gimmickAI, gimmickSearch, graph (`catIndex`) | Every test in 13.7, both goals |
| 21 | Comeback gimmicks | kinds/{power,fish,storm}.js (power = gauge + dash + jump), AI support | Every test in 14.5 |
| 22 | Level difficulty + stats + scripts | levels.js `blocks:{easy,normal,hard}`, progress `stats`, `scripts/balance.mjs`, `scripts/calibrate.mjs`, `npm run balance` / `npm run calibrate` | Tests in 13.8 and 14.6 for the pure parts; both scripts run (`--games 20` smoke run in a test or a documented manual check) |
| 23 | Rendering + UI for 13–14 | src/render/gimmicks/*.js, view/catView (multi-cat, `animateCatPath`, `animateCrumble`, `animateStorm`), hud/levelSelect (intro cards, gimmick icons, cat selection, goal line, power gauge, dash/jump, difficulty in level play), bugs **14.4-2** and **14.4-3** | All gimmicks visible and animated; every UI flow in 13–14; result modal lists picked-up and reward items |
| 24 | Difficulty chart + localization | src/ui/difficultyChart.js (13.8 with the **14.6** line spec), src/ui/i18n/*.js (13.9) | Tests in 13.8 / 14.6 / 13.9; no hard-coded strings left; six languages fit at 360 px |

## 11. Verification
- **Implementation (opencode)**:
  1. `npm test` passes the tests in section 10
  2. `npm run dev` → play both modes at all 3 difficulties in the built-in browser pane (win/lose, animations, hints, phone width)
  3. `npm run build && npm run preview` → check it runs on relative paths (simulating Pages)
  4. `npm run electron` → the same play works in the desktop app

## 12. Rev. 4: rules × play style, gimmicks and items, route button, camera select

A game is chosen on **four independent axes**:

| Axis | Values | Notes |
|---|---|---|
| Rules (`rules`) | `basic` (基本) / `gimmick` (ギミック) | Items and gimmick cells exist **only** with `gimmick`. |
| Play style (`play`) | `streak` (連勝) / `level` (レベル攻略) | `streak`: play repeatedly and count consecutive wins. `level`: 20 levels per course, 3 wins unlock the next. |
| Role (`role`) | `trapper` (つかまえる) / `escape` (にげる) | Same as the old `mode`. |
| Difficulty | `easy` / `normal` / `hard` | Chosen only in `streak`. In `level` the level defines it. |

Basic + streak with the old settings is exactly the game in sections 1–11.

### 12.1 Module boundaries (basic-rules code stays untouched)
- `src/game/{rules,catAI,trapperAI,search,candidates}.js` **must not change**. All 121 existing tests must keep passing without edits.
- New folder `src/game/gimmick/` for the gimmick rules. Pure logic, no Babylon or DOM. It reuses `board.js` and `hex.js`.
  - `gimmickRules.js`: the gimmick rules
  - `gimmickAI.js`: `chooseCatMove`, `chooseBlock` and `shouldUseItem` for gimmick rules
  - `gimmickSearch.js`: item-aware evaluation and alpha-beta
- New folder `src/game/play/` for play styles. Pure logic.
  - `levels.js`: the tables in 12.6
  - `progress.js`: level wins, unlocks, streaks and the item inventory. Pure functions; storage goes through an injected `storage`.
- `src/game/rulesets.js` exports `basicRuleset` and `gimmickRuleset`, objects with the same shape:
  ```js
  { kind:'basic'|'gimmick',
    newGame({role, ai, blocks, gimmick?, playerItems?, seed}) → state,
    legalBlocks(state), legalCatMoves(state), applyBlock(state,i), applyCatMove(state,i),
    chooseCatMove(state,rng), chooseBlock(state,rng),
    canUseItem(state, side) → boolean, armItem(state), disarmItem(state), shouldUseItem(state, rng) → boolean }
  ```
  - `basicRuleset` only wraps the existing modules: `canUseItem` → false, `shouldUseItem` → false.
  - `blocks` overrides the initial block count. When it's omitted, `INITIAL_BLOCKS` applies, so the old behavior is unchanged.
- **Game setup** (`src/game/play/setup.js`, pure): `resolveGame({rules, play, role, difficulty, course, level})` → `{ruleset, newGameOpts}`.
  - `streak`: `ai = difficulty`. In gimmick rules, the gimmick parameters come from a representative level of the same course: easy → L3, normal → L10, hard → L17.
  - `level`: `ai`, `blocks` and the gimmick parameters come from the level table. In basic rules, only `ai` and `blocks` are used.
- **`GameController`**
  - The constructor gains `ruleset = basicRuleset`. `start({ruleset?, ...opts})` passes `opts` to `ruleset.newGame`.
  - New methods: `useItem()` toggles the arm; the phase must be `'player'` and `canUseItem` must be true. `showHint()` calls `view.setHint(shortestPathToEdge(board))`.
  - The hint is cleared (`view.setHint(null)`) whenever any move is applied.
  - When an item is used, `hud.notify(key)` is called. `hud.setInventory(inv, playerSide, armed)` is called after every change.
  - These new hud/view calls are optional-chained, so the old stubs keep working.
  - On game over: `hud.showResult(status, moveCount)` as before, plus a new optional `onGameOver(result)` callback. `main.js` uses it to update progress.

### 12.2 Gimmick state
- `state.cells: Uint8Array(W*H)`. Each cell is `0` normal, `1` item (`?`), or `2` stone (no-build, no item). The array is copied when the state is cloned.
- The cat can walk on item and stone cells, but neither can be blocked. `distanceMap` and `catDistanceMap` are unchanged.
- `state.items = { trapper: {double:n}, cat: {hammer:n} }` holds the items each side has **in this game**.
  - The player's side starts from the saved inventory (`playerItems`).
  - The AI's side starts from `aiItems`.
- `state.armed: boolean` and `state.blocksLeft: 1|2`.
- `history` entries get a `kind`: `'block'`, `'move'`, `'break'`, `'pickup'` or `'arm'`.

### 12.3 Gimmick rules
- **Pickup**: when the cat moves onto an item cell, `cat.hammer += 1` and the cell becomes `0`.
- **Double** (trapper):
  - `armItem` on the trapper's turn sets `double -= 1` and `blocksLeft = 2`.
  - After the first block, `evaluateStatus` runs. If the game is still on, the turn stays with the trapper.
  - After the second block, the turn passes to the cat.
- **Hammer** (cat):
  - `armItem` on the cat's turn sets `armed = true`. While armed, `legalCatMoves` = empty neighbors + blocked neighbors.
  - Moving onto a blocked neighbor unblocks it, moves the cat there, sets `hammer -= 1` and `armed = false`.
  - Moving onto an empty cell sets `armed = false` without spending the hammer.
  - `disarmItem` sets `armed = false`.
- **Trapper wins** at the start of the cat's turn when the cat has no empty neighbor **and** `cat.hammer == 0`.
- **Cat wins** on an edge cell, as before.
- **Setup**:
  - Place the blocks first, as in section 1. Then place `itemCells` item cells and `noBuildExtra` stone cells.
  - None of them may go on the cat, a block or an edge cell.
  - Item cells go at cat distance 2–4. If there aren't enough such cells, use any free inner cell.
  - Retry until the cat has a route to the edge (same retry rule as section 1). Placement is seeded.

### 12.4 Progress, streaks and inventory (`progress.js`)
- **Saved shape**: localStorage key `catescape.progress.v1`, read and written with try/catch. A bad value is replaced with the defaults.
  ```js
  { version:1,
    level: { basic:{trapper:number[20], escape:number[20]}, gimmick:{trapper:number[20], escape:number[20]} },  // wins per level
    streak: { "<rules>.<role>.<difficulty>": { current:number, best:number } },
    inventory: { hammer:number, double:number } }
  ```
- **Unlocks**: `isUnlocked(p, rules, course, level)`. Level 1 is always open. Level n+1 opens when `wins[n] >= 3`. Level progress is separate for basic and gimmick rules.
- **`recordResult(p, ctx, result)`** → `{progress, rewards, unlockedNext, streak}`. It is pure.
  - **Level play**: on a win with `wins < 3`, `wins += 1`.
  - **Streak play**: a win does `current += 1` and `best = max(best, current)`. A loss sets `current = 0`.
  - **Inventory**: only with gimmick rules, in either play style.
    - The player's side of `state.items` at game end is written back, win or lose. This includes hammers the player picked up and items the player spent.
    - On a win, the role's item gets +1 (escape → hammer, trapper → double). In level play this applies only while that level has fewer than 3 wins. In streak play it applies every 3rd consecutive win.
    - Each item is capped at 9.
- Basic rules never read or write the inventory.

### 12.5 Gimmick AI
- **Trapper candidates**: run the basic `trapperCandidates`, then drop item and stone cells. If nothing is left, use the legal block closest to the cat.
- **Evaluation**: `gimmickEval = evalForCat(board) + 60*catHammers + 25*(an item cell is reachable within 2 moves ? 1 : 0)`.
  - If the cat has no empty neighbor but `hammers > 0`, the position is not terminal. The cat's only moves there are hammer breaks.
  - Search depth and K are the same as in basic rules.
- **When the cat AI uses the hammer**:
  - The cat is enclosed (`dist == -1`) or has no empty move.
  - Or breaking into some blocked neighbor gives a `dist` at least 2 smaller than the best normal move.
  - Easy uses only the "no empty move" condition.
  - Break target: the blocked neighbor that gives the smallest `dist` after breaking. Ties are broken by `paths`.
- **When the trapper AI uses a double**: when `dist[cat] <= {easy:1, normal:2, hard:3}`. Each of the two blocks is chosen by `chooseBlock` on the current state.
- **Moving toward items**: Normal and Hard prefer, among moves with equal `dist`, the one closer to an item cell. The search gets this through `gimmickEval`.
- Hard stays under 100 ms per move. Test it on a realistic mid-game board.

### 12.6 Level tables (`levels.js`)
Each level is `{ id, course, ai, blocks, itemCells, aiItems, noBuildExtra }`. With basic rules only `ai` and `blocks` are used.
- Escape course: the player is the cat, and `aiItems` are the AI trapper's doubles.
- Trapper course: the player is the trapper, and `aiItems` are the AI cat's hammers.

**Escape course.** The stone cells in L6–15 soften the step where the AI starts using doubles. They go away later, so the last levels are harder.

| L | AI | blocks | itemCells | aiItems (double) | noBuildExtra |
|---|---|---|---|---|---|
| 1 | easy | 5 | 4 | 0 | 0 |
| 2 | easy | 5 | 4 | 0 | 0 |
| 3 | easy | 6 | 4 | 0 | 0 |
| 4 | easy | 6 | 4 | 0 | 0 |
| 5 | easy | 7 | 3 | 0 | 0 |
| 6 | easy | 7 | 3 | 1 | 2 |
| 7 | normal | 8 | 3 | 1 | 2 |
| 8 | normal | 8 | 3 | 1 | 2 |
| 9 | normal | 9 | 3 | 1 | 2 |
| 10 | normal | 9 | 3 | 1 | 2 |
| 11 | normal | 10 | 2 | 1 | 1 |
| 12 | normal | 10 | 2 | 1 | 1 |
| 13 | normal | 11 | 2 | 1 | 1 |
| 14 | hard | 11 | 2 | 1 | 1 |
| 15 | hard | 12 | 2 | 2 | 1 |
| 16 | hard | 12 | 2 | 2 | 0 |
| 17 | hard | 13 | 1 | 2 | 0 |
| 18 | hard | 13 | 1 | 2 | 0 |
| 19 | hard | 14 | 1 | 2 | 0 |
| 20 | hard | 14 | 1 | 2 | 0 |

**Trapper course.** Item cells are hammers the AI cat can grab, so the player has to guard them.

| L | AI | blocks | itemCells | aiItems (hammer) | noBuildExtra |
|---|---|---|---|---|---|
| 1 | easy | 15 | 1 | 0 | 0 |
| 2 | easy | 15 | 1 | 0 | 0 |
| 3 | easy | 14 | 1 | 0 | 0 |
| 4 | easy | 14 | 1 | 0 | 0 |
| 5 | easy | 13 | 2 | 0 | 0 |
| 6 | easy | 13 | 2 | 0 | 0 |
| 7 | normal | 12 | 2 | 1 | 0 |
| 8 | normal | 12 | 2 | 1 | 0 |
| 9 | normal | 11 | 2 | 1 | 0 |
| 10 | normal | 11 | 2 | 1 | 0 |
| 11 | normal | 10 | 3 | 1 | 1 |
| 12 | normal | 10 | 3 | 1 | 1 |
| 13 | normal | 9 | 3 | 1 | 1 |
| 14 | hard | 9 | 3 | 2 | 1 |
| 15 | hard | 8 | 3 | 2 | 2 |
| 16 | hard | 8 | 3 | 2 | 2 |
| 17 | hard | 7 | 4 | 2 | 2 |
| 18 | hard | 7 | 4 | 2 | 3 |
| 19 | hard | 6 | 4 | 2 | 3 |
| 20 | hard | 6 | 4 | 2 | 3 |

Every game uses a random seed, which the HUD shows, so replays differ.

### 12.7 Rendering additions
- **Item cell**: the hex tile keeps the normal color.
  - A yellow `#ffd23f` octahedron floats above it at y = 0.9, bobbing by ±0.1 and rotating. Build it with `CreatePolyhedron` type 1 or a sphere with tessellation 4.
  - `animatePickup(i)` shrinks it to 0 over 200 ms, then disposes it.
- **Stone cell**: color `#8a8f99`, height 0.15 (lower than a normal cell). Clicking it to place a block is ignored with `flashInvalid`.
- **Breakable highlight** (while the cat is armed): blocked neighbors get the `breakable #ff5a5a` material.
- **Break animation**: `animateBreak(i)` sinks scaling.y from 2.5 to 1 over 200 ms, then sets the cell to the empty material.
- `view.rebuild(state)` reads `state.cells` when it is present. Basic-rules states don't have it.
- **Camera** (`scene.js`): `setCameraMode(mode)`.
  - `'perspective'`: the current camera and fit.
  - `'ortho'`: set `camera.mode = Camera.ORTHOGRAPHIC_CAMERA`, `alpha = -π/2`, `beta = 0.0001`, and detach the inputs (no rotation, no zoom).
  - The ortho bounds (`orthoLeft`, `orthoRight`, `orthoTop`, `orthoBottom`) come from a pure function in `fit.js`: `computeOrthoBounds({aspect, hx, hz, hudFrac})`. The whole board plus one cell of margin must fit, shifted down by the HUD fraction.
  - Recompute on every resize. Switching the camera does not restart the game.
  - Picking must work in both modes.

### 12.8 UI
- **Top bar**
  - Selects for rules (基本 / ギミック), play style (連勝 / レベル攻略), role, camera (3D / 真上), and difficulty (streak only).
  - Level play also shows a `レベル選択` button and a label like `L7 ●●○`.
  - In streak play the status line shows `連勝 n（最高 m）`.
  - The New game button reads `やりなおし` in level play.
  - **`ルートを表示` button**: calls `controller.showHint()`. The route stays visible until the next move. The button is disabled when it isn't the player's turn.
  - The old hint checkbox and its saved setting are removed.
- **Level select screen** (`src/ui/levelSelect.js`, a full-screen DOM overlay)
  - A heading showing the current rules.
  - Course tabs: にげる / つかまえる.
  - A 5×4 grid of level cards. Each card shows the level number, wins as `●●○`, a lock icon (a CSS shape, no asset files) and the AI strength.
  - The saved inventory (`ハンマー ×n  ダブル ×n`), shown only with gimmick rules.
  - A close button.
  - It opens when the play style switches to レベル攻略, and from the `レベル選択` button.
  - On startup the app restores the last rules, play style, role, difficulty, course and level.
- **Item bar** (gimmick rules only, next to the status line)
  - The player's item button: `ハンマーを使う (n)` or `ダブルを使う (n)`.
    - It sets `aria-pressed` while armed.
    - It is disabled when n = 0 or when it isn't the player's turn.
  - The AI's item count.
  - A toast area for `hud.notify`, for messages like `AIがダブルを使った！` and `ハンマーを手に入れた！`. Each toast hides itself after 1.5 s.
- **Result modal**
  - Streak play: the result, the current and best streak, and any items gained.
  - Level play: the result, `勝ち n/3` and any items gained. Buttons: `もういちど`, `レベル選択`, and `次のレベル` (shown when the next level is unlocked).
  - Basic rules + streak play look the same as the old modal, plus the streak line.
- Changing the rules, play style, role or difficulty starts a new game. Changing the camera does not.
- **Strings**: every new string goes in `strings.js`, in both ja and en.
- **Phone width (360 px)**: the top bar may wrap to three lines, and the level grid becomes 4 columns.

### 12.9 Dev hook
`window.__catescape` (DEV only) also exposes `{ rulesets, setup: resolveGame, progress: {load, save, reset} }`. The designer uses it to automate play-tests across levels and streaks.

## 13. Rev. 5: Gimmick registry, unlock schedule, and new gimmicks

Gimmicks are **unlocked by level**. Each gimmick is an independent module, so a new gimmick means one logic file, one render file and one row in the unlock table. Rules, AI and UI pick it up without other changes.

### 13.1 Gimmick modules (`src/game/gimmick/kinds/<id>.js`, pure)
Each module default-exports an object of this shape. Every hook is optional, and the default is shown in the comment.
```js
{ id: 'tunnel',                       // 'item' | 'stone' | 'tunnel' | 'ice' | 'arrow' | 'brittle' | 'spring'
  unlock: 8,                          // first level (both courses) where it appears; 13.4
  place(state, count, rng) → boolean, // put `count` cells/pairs; false → setup retries
  blockable(state, i) → boolean,      // default true. false = the trapper can't block i
  canEnter(state, from, to, dir) → boolean,  // default true
  resolve(state, from, to, dir) → number,    // landing cell when the cat enters `to`; default `to`
  onLand(state, i, events),           // after the cat lands (pickup etc.)
  afterBlock(state, i),               // after the trapper blocks i
  onTrapperTurnEnd(state, events) }   // timers (brittle)
```
- `src/game/gimmick/registry.js` lists the modules in unlock order. It exports `KINDS` and these composed helpers:
  - `isBlockable(state, i)`: not blocked, not the cat, and every module allows it.
  - `canEnter(state, from, to, dir)`
  - `landing(state, from, to, dir)`: applies **one** `resolve`, the module that owns cell `to`. The landing cell's own gimmick does **not** trigger again, so chains and loops are impossible. The only exception is ice, whose slide is a single `resolve`.
- Per-cell data lives in `state.g`, which is shared by reference except where noted:
  - `kind: Uint8Array` (cell type)
  - `partner: Int16Array` (tunnel)
  - `dir: Int8Array` (arrow)
  - `ttl: Int8Array` (brittle blocks; **copied** in clones because it changes)
- The existing item and stone logic moves into `kinds/item.js` and `kinds/stone.js`, with behavior unchanged. The hammer and double items stay in `gimmickRules.js`; the double unlocks at L4 (13.4).
- **Directions**: `src/game/gimmick/hexDir.js` provides `step(i, dir, W, H)` for the 6 odd-r directions, with `dir` 0–5 = E, NE, NW, W, SW, SE. It returns -1 off the board. `hex.js` stays unchanged.

### 13.2 Gimmick-aware graph (`src/game/gimmick/graph.js`, pure)
- **Moves**: from position `v`, for each `dir` with `u = step(v, dir)`, a move is legal if `u` is on the board, not blocked, and `canEnter(v, u, dir)`. Hammer breaks follow 12.3. The move lands on `landing(v, u, dir)`.
- **Functions**:
  - `gDistanceMap(state)` → `{dist, paths}`
    - `dist` is the moves-to-edge distance over these moves: a reverse BFS from the empty edge cells, with predecessor lists built per call.
    - `paths` counts shortest routes, the same way as 3.
  - `gCatDistanceMap(state)`, `gReachableArea(state)`, `gShortestPathToEdge(state)`
    - The path lists every cell the cat passes over in order: the entry `u`, the cells of an ice slide, and the landing cell.
- **Equivalence**: with no gimmick cells, every function returns exactly what `board.js` returns. Test this on 50 seeded random boards.
- **Who uses it**: all gimmick code (rules, AI, search, the trapper candidate filter, hint) uses these maps instead of the `board.js` ones.
  - Trapper candidates: `g[v] + d[v] == D` computed with these maps. Then drop the cells where `isBlockable` is false.

### 13.3 The gimmicks
| id | Unlock | Cell look | Rule | Blockable |
|---|---|---|---|---|
| item | L2 | Floating yellow octahedron | Landing on it gives the cat 1 hammer, and the cell becomes normal (12.3). | no |
| double | L4 | — (item) | The trapper's double item can be used from this level on (12.3). | — |
| stone | L6 | Low grey tile `#8a8f99` | No-build cell. | no |
| tunnel | L8 | Dark disc + glowing torus ring in the pair color (`#b06cff`, `#2ec4b6`, `#ff6fb5`) | Entering either end lands the cat on the partner end, in the same move. The cat rests on the exit. `count` = pairs. | no |
| ice | L10 | Pale blue `#bfe9ff`, glossy | Entering ice slides the cat on in the same `dir`. It stops on the first non-ice cell, or on the last ice cell when the next step is off-board, blocked or not enterable. An edge cell reached at any point ends the slide there (cat wins). Ice cells are placed as one connected patch. | **yes** (a block on ice is a normal block) |
| arrow | L12 | Normal tile with a raised arrow pointing along `dir` | The cat can enter only while moving in the arrow's direction. Leaving an arrow cell is free. Arrows are never on edge cells, and never point so that the cell is unreachable from every neighbor. | no |
| brittle | L14 | Cracked tile (darker lines) | A block placed on it gets `ttl = 3`. Each time the trapper's turn ends, every brittle block's `ttl` goes down by 1, and at 0 the block crumbles (the cell is empty again; it stays brittle). | yes |
| spring | L16 | Coil with a red pad | Entering it in `dir` makes the cat jump to `step(step(spring, dir), dir)`, landing 2 cells further on. It jumps over anything in between. If the landing cell is off-board, blocked or not enterable, the cat stays on the spring. A spring is never on an edge cell. | no |

- **Placement**:
  - All cells go on free inner cells (not the cat, not blocks, not edges unless the table says otherwise), and never adjacent to the cat's start.
  - Each module's `place` handles its own extra constraints: tunnel ends at hex distance ≥ 4, ice as one connected patch, arrow reachability.
  - Placement is seeded, and the cat-route guarantee and retry rule from section 1 still apply.
- **AI**:
  - The search and evaluation use `graph.js`, so tunnels, ice, arrows and springs are understood automatically.
  - Brittle: Normal and Hard trapper AIs treat a block on a brittle cell as worth less. In the Normal score, a brittle candidate is used only if it gives `newDist == -1` or the cat's `dist ≤ 1`. In the search, brittle blocks count as permanent (the depth is small).
  - Hard stays under 100 ms per move with every gimmick active (L20 board).

### 13.4 Unlock schedule and level tables
- A level contains a gimmick only if `level >= unlock`. A test enforces this against the tables.
- **Intro card**: the first time the player starts a level whose `new` column is set, show a card with an icon, the name and a one-line rule (ja and en in `strings.js`).
  - The card is remembered in progress as `seenIntro: string[]`.
- **Level select**: each card shows small icons of the gimmicks present.
- **Streak play with gimmick rules**: the representative levels (L3, L10, L17) are used, but only gimmicks whose `unlock` is at or below the **highest unlocked level** of that course are kept. Hammer and double follow the same rule (unlock 2 and 4).
  - When nothing is unlocked yet, show `レベル攻略でギミックを解放しよう`.
- **Escape course** (aiItems = the AI trapper's doubles):

| L | AI | blocks | aiItems | item | stone | tunnel | ice | arrow | brittle | spring | new |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | easy | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| 2 | easy | 5 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | item |
| 3 | easy | 6 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| 4 | easy | 6 | 1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | double |
| 5 | easy | 7 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| 6 | easy | 7 | 1 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | stone |
| 7 | normal | 8 | 1 | 3 | 2 | 0 | 0 | 0 | 0 | 0 |  |
| 8 | normal | 8 | 1 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | tunnel |
| 9 | normal | 9 | 1 | 3 | 2 | 1 | 0 | 0 | 0 | 0 |  |
| 10 | normal | 9 | 1 | 3 | 2 | 1 | 3 | 0 | 0 | 0 | ice |
| 11 | normal | 10 | 1 | 2 | 1 | 1 | 3 | 0 | 0 | 0 |  |
| 12 | normal | 10 | 1 | 2 | 1 | 1 | 3 | 3 | 0 | 0 | arrow |
| 13 | normal | 11 | 1 | 2 | 1 | 1 | 3 | 3 | 0 | 0 |  |
| 14 | hard | 11 | 1 | 2 | 1 | 1 | 4 | 3 | 6 | 0 | brittle |
| 15 | hard | 12 | 2 | 2 | 1 | 1 | 4 | 3 | 6 | 0 |  |
| 16 | hard | 12 | 2 | 2 | 0 | 2 | 4 | 4 | 6 | 2 | spring |
| 17 | hard | 13 | 2 | 1 | 0 | 2 | 4 | 4 | 6 | 2 |  |
| 18 | hard | 13 | 2 | 1 | 0 | 2 | 4 | 4 | 8 | 3 |  |
| 19 | hard | 14 | 2 | 1 | 0 | 2 | 4 | 4 | 8 | 3 |  |
| 20 | hard | 14 | 2 | 1 | 0 | 2 | 4 | 4 | 8 | 3 |  |

- **Trapper course** (aiItems = the AI cat's hammers; the player's double unlocks at L4):

| L | AI | blocks | aiItems | item | stone | tunnel | ice | arrow | brittle | spring | new |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | easy | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| 2 | easy | 15 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | item |
| 3 | easy | 14 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| 4 | easy | 14 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | double |
| 5 | easy | 13 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |  |
| 6 | easy | 13 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | stone |
| 7 | normal | 12 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 0 |  |
| 8 | normal | 12 | 1 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | tunnel |
| 9 | normal | 11 | 1 | 2 | 1 | 1 | 0 | 0 | 0 | 0 |  |
| 10 | normal | 11 | 1 | 2 | 1 | 1 | 3 | 0 | 0 | 0 | ice |
| 11 | normal | 10 | 1 | 3 | 1 | 1 | 3 | 0 | 0 | 0 |  |
| 12 | normal | 10 | 1 | 3 | 1 | 1 | 3 | 3 | 0 | 0 | arrow |
| 13 | normal | 9 | 1 | 3 | 1 | 1 | 3 | 3 | 0 | 0 |  |
| 14 | hard | 9 | 2 | 3 | 1 | 1 | 4 | 3 | 6 | 0 | brittle |
| 15 | hard | 8 | 2 | 3 | 2 | 1 | 4 | 3 | 6 | 0 |  |
| 16 | hard | 8 | 2 | 3 | 2 | 2 | 4 | 4 | 6 | 2 | spring |
| 17 | hard | 7 | 2 | 4 | 2 | 2 | 4 | 4 | 6 | 2 |  |
| 18 | hard | 7 | 2 | 4 | 3 | 2 | 4 | 4 | 8 | 3 |  |
| 19 | hard | 6 | 2 | 4 | 3 | 2 | 4 | 4 | 8 | 3 |  |
| 20 | hard | 6 | 2 | 4 | 3 | 2 | 4 | 4 | 8 | 3 |  |

These tables **replace** the ones in 12.6 (`itemCells` → `item`, `noBuildExtra` → `stone`). Level entries become `{ id, course, ai, blocks, aiItems, gimmicks:{item, stone, tunnel, ice, arrow, brittle, spring}, intro }`.

### 13.5 Rendering (`src/render/gimmicks/<id>.js`)
- Each gimmick has a render module: `{ id, build(scene, i, state, ctx), update?(state), dispose(i) }`. `view.rebuild` loops over the registry.
- Shapes are procedural only, with no asset files.
- Animations:
  - `animateCatPath(cells)`: hop along the cells the move passes over. For a tunnel: hop to the entry, shrink, appear at the exit and grow. For ice: a quick slide with no hop. For a spring: one high arc.
  - `animateCrumble(i)`: a brittle block shakes, then sinks.
- **Controller**: after a cat move, ask the ruleset for the move's path (`ruleset.lastMovePath(state)`) and call `view.animateCatPath?.(path)`. Fall back to `animateCatMove(from, to)`.
  - After a trapper turn ends, `events` may contain crumbles; animate each one, then continue.
- **Toasts**: `tunnel`, `ice`, `spring`, `crumble`, in ja and en.

### 13.6 Tests (minimum)
- **Graph**: equivalence with `board.js` on plain boards.
- **Tunnel**: lands on the partner.
- **Ice**: the slide stops on a non-ice cell, before a block, and on an edge (the cat wins).
- **Arrow**: entering against the arrow is illegal; entering along it is legal.
- **Brittle**: crumbles after exactly 3 trapper turns.
- **Spring**: jumps 2 cells; a blocked landing keeps the cat on the spring.
- **Blockability**: the trapper can't block item, stone, tunnel, arrow or spring cells.
- **Tables**: the level tables match 13.4 row by row, and every gimmick appears only at or after its unlock level.
- **Streak**: only unlocked gimmicks are used.
- **Intro card**: `seenIntro` is recorded.
- **Hint**: the path includes tunnel, ice and spring cells.
- **Performance**: Hard < 100 ms on an L20 board.
- **Controller**: `animateCatPath` is called for gimmick moves, and crumble events are animated.

### 13.7 Multiple cats (gimmick `cats`: 2–3 cats with a goal)
A level can have 2 or 3 cats and one of two goals (`catsGoal`):

| catsGoal | Cat side wins | Trapper wins |
|---|---|---|
| `anyEscape` (どれか逃げる) | as soon as **any** cat reaches an edge cell (the game ends at once) | at the start of the cat side's turn, **no** cat has a legal move and the cat side has no hammer |
| `anyCatch` (どれか捕まえる) | when **every** cat has escaped. A cat that reaches an edge runs off the board and is removed; the others play on. | at the start of the cat side's turn, **any** remaining cat has no legal move and the cat side has no hammer |

**Unlock schedule** (both courses; it replaces the `new` column for L17–20 in 13.4):

| L | cats | catsGoal | new |
|---|---|---|---|
| 17 | 2 | anyEscape | cats2Escape |
| 18 | 2 | anyCatch | cats2Catch |
| 19 | 3 | anyEscape | cats3Escape |
| 20 | 3 | anyCatch | cats3Catch |

L1–16 have 1 cat. L17–20 keep the other gimmick counts from 13.4. Starting block counts per variant come from a balance simulation of greedy AIs, 300 games per setting. Relative to 1 cat, `anyEscape` needs about +6 blocks for 2 cats and +9 for 3 cats. `anyCatch` needs about -6 and -9 (minimum 1):

| Course | L17 (2, anyEscape) | L18 (2, anyCatch) | L19 (3, anyEscape) | L20 (3, anyCatch) |
|---|---|---|---|---|
| escape: blocks / aiItems | 19 / 2 | 7 / 2 | 23 / 2 | 5 / 2 |
| trapper: blocks / aiItems | 13 / 2 | 1 / 2 | 15 / 2 | 1 / 2 |

These are starting values. After implementation, `npm run balance` (task 21) replays each of L17–20 with the real AIs, and the designer tunes the blocks so that each new variant feels about as hard as the level before it.

**Rules common to both goals**
- On its turn the cat side moves **exactly one** cat, its choice. A cat that can't move is skipped, unless the goal makes that a loss.
- **State**: `state.cats: number[]` (remaining cats, 1–3) and `state.escaped: number` (the count, used for `anyCatch`). `board.cat` stays as the **selected / last moved** cat, so single-cat code keeps working.
- **Cats block each other**: a cat's cell is never empty, blockable or enterable for another cat. Tunnel exits, spring landings and ice slides stop **before** another cat, as they would before a block.
- Items picked up by any cat go to the shared cat-side inventory. The hammer applies to the selected cat.
- **Start cells**: 2 cats at (5,3) and (5,7); 3 cats at (4,4), (4,6) and (6,5). The route guarantee applies to every cat.
- **Graph**: `graph.js` functions take an optional `catIndex` (default: the selected cat). While one cat moves, the other cats count as blocked.

**AI**
- **Cat side**: score each cat's best move with the single-cat logic.
  - `anyEscape`: move the cat with the best (highest) score. The evaluation is `max over cats of the single-cat eval + 10 × (free cats - 1)`.
  - `anyCatch`: move the **most endangered** cat: the smallest `reachableArea`, then the fewest empty neighbors. A cat that can escape this move always takes it. The evaluation is the `min over remaining cats of the single-cat eval`.
- **Trapper**:
  - `anyEscape`: candidates are the union of the candidate lists for the two most urgent cats (smallest `dist`), ordered by urgency.
  - `anyCatch`: target the **easiest cat to trap** (smallest `reachableArea`, then fewest empty neighbors). Its empty neighbors come first, then its shortest-route cells. The candidate list is truncated to K.
- **Hard search**: generate cat-side moves only for the two most relevant cats. Hard stays under 100 ms with 3 cats on an L20 board. If it can't, drop the depth to 3 when there are 3 cats and record that in the notes.

**Player as the cat side**
- Click a cat to select it (it glows, and its moves are highlighted), then click a destination.
- When only one cat can move, it is selected automatically. Clicking another cat switches the selection.

**UI**
- The status line shows the goal and the counts: `どれか逃げればOK・3匹` or `ぜんぶ逃がそう・逃げた 1/3`.
- Result strings (ja + en):
  - `ねこがにげた！`
  - `ぜんぶつかまえた！`
  - `1匹つかまった…`
  - `ぜんぶにげきった！`
  - The player-perspective variants for both courses.
- The intro cards for `cats2Escape`, `cats2Catch`, `cats3Escape` and `cats3Catch` explain the goal.
- **Hint**: `anyEscape` shows the route of the cat with the smallest `dist`. `anyCatch` shows the route of the most endangered cat.

**Rendering**
- One `catView` per cat, with colors `#f39c34`, `#9aa5b1` (grey) and `#ffffff` (white).
- The selected cat gets a soft ring under it.
- An escaped cat (`anyCatch`) plays the run-off animation and is removed.

**Streak play**: always 1 cat, since the representative levels are L3, L10 and L17. L17 counts as 1 cat for streak play.

**Tests**
- `anyEscape`: any cat escaping wins; the trapper wins only when every cat is stuck.
- `anyCatch`: any stuck cat makes the trapper win; an escaped cat is removed and the game goes on; all cats escaping makes the cat side win.
- Rules: one cat moves per turn; cats block each other, including tunnel exits and slides.
- AI target choice for both goals.
- The player's select-then-move flow.
- Hard < 100 ms with 3 cats.

### 13.8 Level difficulty chart (in the game)
The level select screen shows each course's **estimated win rate per level**. The x axis is the level (1–20) and the y axis is the estimated player win rate (0–100 %).

**Data: `src/game/play/levelStats.json`**, generated, committed and never computed at runtime.
```json
{ "generatedAt": "2026-10-23", "games": 200, "rules": "gimmick",
  "courses": { "escape":  { "strong": [0.98, ...20], "weak": [0.71, ...20], "avgMoves": [12.3, ...20] },
               "trapper": { "strong": [...], "weak": [...], "avgMoves": [...] } } }
```
- **`strong`**: the player side is played by the Hard AI. **`weak`**: the player side is played by the Easy AI. The opponent always plays the level's `ai`.
- The player starts with 1 of the role's item once it is unlocked (hammer from L2, double from L4), standing in for the carry-over inventory.
- Every gimmick in the level table is active, including multiple cats.
- There is one file for gimmick rules. Basic rules get a second file, `levelStats.basic.json`, made the same way with gimmicks off.

**Generator: `scripts/balance.mjs`** (`npm run balance`, Node only, no Babylon).
- It plays N games per level, course and profile, with seeded and reproducible results (default N = 200; `--games` overrides it).
- It spreads the work over `os.cpus().length - 1` worker threads.
- It prints a table, and with `--write` it writes both JSON files.
- It replaces the task-21 balance script and covers both of its jobs.

**Chart UI** (`src/ui/difficultyChart.js`, built as **inline SVG with DOM calls**: no chart library, nothing inline that the CSP blocks)
- The level select screen gets a `難易度グラフ` toggle above the grid. The chart shows the selected course tab.
- **Lines**:
  - Two lines: `上級プレイヤー` (strong, solid) and `初級プレイヤー` (weak, dashed), with a legend.
  - The y axis has gridlines at 0, 25, 50, 75 and 100 %.
  - The x axis has ticks at 1, 5, 10, 15 and 20.
- **Markers**:
  - Every level where a new gimmick unlocks gets a small icon marker on the x axis.
  - The **current level** gets a vertical highlight band.
  - **Locked levels** are drawn faded.
- **Interaction**: hovering or tapping a level shows a tooltip: `L12 上級 64% / 初級 21% · 平均 18手 · 新: 矢印`. Clicking a point of an unlocked level selects that level.
- **Colors**: strong `#3987e5` (blue, solid 2 px line, 8 px markers) and weak `#d95926` (orange, dashed 2 px line, 8 px markers). Validated on the `#1e2a38` surface: CVD ΔE 26.8, normal-vision ΔE 31.8, both ≥ 3:1 contrast.
  - Text uses the HUD text colors, never the series colors.
  - The 50 % gridline is slightly stronger than the others.
- **Size**: it fits the overlay at phone width (360 px). The SVG uses a `viewBox` and scales.
- **Strings**: every label in `strings.js`, ja and en.
- **Tests**:
  - A pure helper `chartModel(stats, course, progress)` returns the points, the locked flags, the current level and the unlock markers. Test it without the DOM.
  - The UI test checks that the SVG has 20 points per line and that clicking an unlocked point selects that level.

**The player's own results on the chart**
- **progress.js** gets per-level play statistics with no cap, separate from the unlock wins (which stay capped at 3):
  `stats: { basic:{trapper:[{played,won}×20], escape:[...]}, gimmick:{...} }`.
  - `recordResult` increments `played` on every finished level game and `won` on a win.
  - Old saves without `stats` load as zeros.
  - Streak games are not counted here.
- **Chart**: a third series, `あなた`.
  - Mark: aqua `#199e70` **filled dots only, no line**. The different mark type is the secondary encoding next to the two estimate lines.
  - Each dot is at `won / played` for every level with `played >= 1`.
  - Dot radius grows with the sample size: 4 px for 1–2 games, 6 px for 3–9, 8 px for 10 or more. This makes it visible that a single game is noisy.
  - Validated with the two lines on `#1e2a38`, all pairs: worst CVD ΔE 9.4, normal-vision ΔE 20.9, contrast ≥ 3:1.
- **Tooltip**: `L12 上級 64% / 初級 21% · あなた 3勝/5戦 (60%) · 新: 矢印`.
- **Legend**: three entries (上級プレイヤー solid line, 初級プレイヤー dashed line, あなた dot).
- **Summary line under the chart**: `あなたの勝率は見積もりの「上級」と「初級」の間です`. This is a pure helper: compare the player's overall rate on played levels with the two lines, using level-weighted means.
- **Tests**: `chartModel` includes the player points and radius buckets; `recordResult` updates `stats` for wins and losses; an old save without `stats` loads.

### 13.9 Localization: ja, en, es, fr, de, ru
- **Files**: `src/ui/i18n/{ja,en,es,fr,de,ru}.js`. Each exports one flat object with identical keys.
  - `strings.js` becomes the loader: `getStrings(lang)`, `fmt(str, vars)`, `plural(lang, n, forms)`, `detectLang(navigator.language)`.
  - `en` is the key reference.
- **Plurals**: use `Intl.PluralRules(lang)`. Russian needs the one/few/many forms (e.g. `1 ход / 2 хода / 5 ходов`), so a counted string is `{one, few?, many?, other}`, picked by `plural()`. Japanese uses `other` only.
- **Detection**:
  - Startup uses the saved language first.
  - Otherwise it uses the `navigator.language` prefix if that language is supported.
  - Otherwise it falls back to **ja** (unchanged default).
  - `<html lang>` is set to match.
- **UI**: a language `<select>` in the top bar, with a label. Each option shows its own name: 日本語 / English / Español / Français / Deutsch / Русский.
  - Switching applies at once: the HUD, the level select, the chart, toasts, the result modal and intro cards.
  - Switching does **not** restart the game. The choice is saved with the settings.
- **Coverage**: every visible string goes through the table. That includes the gimmick names and intro texts, chart labels and tooltips, the lock aria-labels and the Electron window title. No hard-coded text stays in render or UI code.
- **Layout**: German and Russian strings run long. Buttons and selects may wrap or shrink, but nothing may overflow at 360 px. Check the longest language in every control.
- **Fonts**: system UI fonts only. They already cover Cyrillic and Latin accents; no web fonts.
- **Translation quality**: natural game UI wording, not literal. Keep the playful tone of the Japanese (ねこ = the cat, a friendly word). Use the same term for each gimmick everywhere, as a glossary at the top of each file:

| key | ja | en | es | fr | de | ru |
|---|---|---|---|---|---|---|
| cat | ねこ | cat | gato | chat | Katze | кот |
| trapper | つかまえる | Trap the cat | Atrapa al gato | Piège le chat | Fang die Katze | Поймай кота |
| escape | にげる | Escape | Escapa | Évade-toi | Entkomme | Убеги |
| hammer | ハンマー | hammer | martillo | marteau | Hammer | молот |
| double | ダブル | double | doble | double | Doppel | двойной ход |
| tunnel | トンネル | tunnel | túnel | tunnel | Tunnel | туннель |
| ice | 氷 | ice | hielo | glace | Eis | лёд |
| arrow | 矢印 | arrow | flecha | flèche | Pfeil | стрелка |
| brittle | もろいブロック | brittle block | bloque frágil | bloc fragile | brüchiger Block | хрупкий блок |
| spring | バネ | spring | muelle | ressort | Feder | пружина |
| stone | 石畳 | stone tile | losa | dalle | Steinplatte | брусчатка |

- **Tests**:
  - Every language has exactly the en key set.
  - Every `{placeholder}` in en appears in every language.
  - `plural('ru', n)` picks the right form for 1, 2, 5, 11, 21 and 22.
  - `detectLang` maps `es-MX` → es, `pt-BR` → ja (unsupported), `ru` → ru.
  - Switching the language never restarts the game.

## 14. Rev. 5.1: balance fixes from the difficulty simulation

> **Precedence**: section 14 overrides sections 12 and 13 where they conflict (hammer rule, trapper-win rule, unlock order, level tables, chart lines).


The simulation in 13.8 (200 games per level, Hard/Easy AI as the player) showed two problems:
- The **trapper course collapses at the first AI hammer**. At L7, with 1 AI hammer, the strong player's win rate fell from 84 % to 2 %.
- The **escape course is too easy**: the strong player won about 90 % even at L20.

Both come from the hammer letting an enclosed cat break straight out. The rules below **replace** 12.3 (hammer and the trapper-win rule) and the tables in 13.4 and 13.7.

### 14.1 New hammer rule (break a non-adjacent block, then move)
- **Target**: the hammer destroys **one block at hex distance 2 or 3 from the selected cat**. Blocks **adjacent to any cat can't be broken**.
- **Using it**: a free action **before** the cat side's move in the same turn. The cat side then moves one cat normally. This was decided with the user: a hammer that cost the whole turn would be too weak.
  - `armItem` on the cat side's turn arms it, and the legal targets are highlighted (the breakable highlight). `disarmItem` cancels without spending it.
  - Clicking a target breaks it: `hammer -= 1`, history kind `'break'`. The turn **stays** with the cat side, which must now make its normal move.
  - At most one hammer per turn.
  - If, after the break, no cat has a legal move, the turn passes without a move. (The trapper-win check happens only at the start of a turn, so this can't happen from a stuck position.)
- **Trapper win**: back to the plain rule. At the start of the cat side's turn a cat is stuck when it has no legal move; the hammer never changes that, because adjacent walls can't be broken. For multiple cats, 13.7 applies with "stuck" meaning exactly this.
- **Cat AI**: for each target, simulate the break and then the best move. Use the hammer when one of these holds:
  - The cat is enclosed (`dist == -1`) and the break plus the move reconnects it (`dist != -1` afterwards).
  - The break plus the move gives a `dist` at least 2 less than the best move alone.

  Pick the target and move pair with the smallest resulting `dist`, ties broken by `paths`. Easy uses only the "enclosed" condition.
- **Search**: a hammer turn is a compound cat-side move `(target, move)`.
  - It is generated only when `hammers > 0`, at the top 3 targets (ordered by the `dist` after the break), each with the cat's top 3 moves.
  - Evaluation: `+25 × hammers` (was `+60`).
- **Distance helper**: `hexDistance(a, b)` goes in `gimmick/hexDir.js`.

### 14.2 New unlock order
Hammer and item cells move to L16. The other gimmicks move earlier:

| L | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| new | stone | double | tunnel | ice | arrow | brittle | spring | hammer (item cells + hammer) | cats2Escape | cats2Catch | cats3Escape | cats3Catch |

- The player's carry-over hammers can be used only on levels ≥ 16 (and in streak play only once L16 is unlocked).
- The player's carry-over doubles can be used on levels ≥ 4.
- `unlock` values in the kind modules and in `setup.js` change to match this order.

### 14.3 Level tables (replace 13.4 and the 13.7 overrides)
**Escape course** (aiItems = the AI trapper's doubles):

| L | AI | blocks | aiItems | stone | tunnel | ice | arrow | brittle | spring | item | cats | new |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | easy | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 2 | easy | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | stone |
| 3 | easy | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 4 | easy | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | double |
| 5 | easy | 7 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 6 | easy | 7 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | tunnel |
| 7 | normal | 8 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 8 | normal | 8 | 1 | 2 | 1 | 3 | 0 | 0 | 0 | 0 | 1 | ice |
| 9 | normal | 9 | 1 | 2 | 1 | 3 | 0 | 0 | 0 | 0 | 1 |  |
| 10 | normal | 9 | 1 | 1 | 1 | 3 | 3 | 0 | 0 | 0 | 1 | arrow |
| 11 | normal | 10 | 1 | 1 | 1 | 3 | 3 | 0 | 0 | 0 | 1 |  |
| 12 | normal | 10 | 1 | 1 | 1 | 4 | 3 | 6 | 0 | 0 | 1 | brittle |
| 13 | normal | 11 | 1 | 1 | 1 | 4 | 3 | 6 | 0 | 0 | 1 |  |
| 14 | hard | 11 | 2 | 1 | 2 | 4 | 4 | 6 | 2 | 0 | 1 | spring |
| 15 | hard | 12 | 2 | 1 | 2 | 4 | 4 | 6 | 2 | 0 | 1 |  |
| 16 | hard | 12 | 2 | 0 | 2 | 4 | 4 | 8 | 2 | 2 | 1 | hammer |
| 17 | hard | 19 | 2 | 0 | 2 | 4 | 4 | 8 | 2 | 2 | 2 / anyEscape | cats2Escape |
| 18 | hard | 7 | 2 | 0 | 2 | 4 | 4 | 8 | 3 | 2 | 2 / anyCatch | cats2Catch |
| 19 | hard | 23 | 2 | 0 | 2 | 4 | 4 | 8 | 3 | 2 | 3 / anyEscape | cats3Escape |
| 20 | hard | 5 | 2 | 0 | 2 | 4 | 4 | 8 | 3 | 2 | 3 / anyCatch | cats3Catch |

**Trapper course** (aiItems = the AI cat's hammers):

| L | AI | blocks | aiItems | stone | tunnel | ice | arrow | brittle | spring | item | cats | new |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | easy | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 2 | easy | 15 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | stone |
| 3 | easy | 14 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 4 | easy | 14 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | double |
| 5 | easy | 13 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 6 | easy | 13 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | tunnel |
| 7 | normal | 12 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |  |
| 8 | normal | 12 | 0 | 1 | 1 | 3 | 0 | 0 | 0 | 0 | 1 | ice |
| 9 | normal | 11 | 0 | 1 | 1 | 3 | 0 | 0 | 0 | 0 | 1 |  |
| 10 | normal | 11 | 0 | 2 | 1 | 3 | 3 | 0 | 0 | 0 | 1 | arrow |
| 11 | normal | 10 | 0 | 2 | 1 | 3 | 3 | 0 | 0 | 0 | 1 |  |
| 12 | normal | 10 | 0 | 2 | 1 | 4 | 3 | 6 | 0 | 0 | 1 | brittle |
| 13 | normal | 9 | 0 | 2 | 1 | 4 | 3 | 6 | 0 | 0 | 1 |  |
| 14 | hard | 9 | 0 | 2 | 2 | 4 | 4 | 6 | 2 | 0 | 1 | spring |
| 15 | hard | 8 | 0 | 2 | 2 | 4 | 4 | 6 | 2 | 0 | 1 |  |
| 16 | hard | 8 | 1 | 3 | 2 | 4 | 4 | 8 | 2 | 2 | 1 | hammer |
| 17 | hard | 13 | 1 | 3 | 2 | 4 | 4 | 8 | 2 | 2 | 2 / anyEscape | cats2Escape |
| 18 | hard | 1 | 1 | 3 | 2 | 4 | 4 | 8 | 3 | 2 | 2 / anyCatch | cats2Catch |
| 19 | hard | 15 | 1 | 3 | 2 | 4 | 4 | 8 | 3 | 2 | 3 / anyEscape | cats3Escape |
| 20 | hard | 1 | 1 | 3 | 2 | 4 | 4 | 8 | 3 | 2 | 3 / anyCatch | cats3Catch |

- The `item` column is the number of item (`?`) cells.
- These numbers are a starting point. The designer re-runs `npm run balance` after this revision and tunes the blocks.
- **Target curve**: the `normal` profile (typical human) falls smoothly from about 85 % (L1) to about 40 % (L20) in both courses; the strong player stays above it and the weak player below it. No step between two levels may be larger than 15 points.

### 14.4 Bugs found
1. **`chooseBlock` returns `-1`** (gimmick rules, Easy AI, escape course around L7). `applyBlock` then throws "illegal move index: -1".
   - The trapper AI must always return a legal block while any blockable cell exists.
   - Add a regression test: a seeded board where the filtered candidates are empty → the fallback picks the blockable cell closest to the cat.
2. **The result modal lists only win rewards** and leaves out hammers picked up from item cells. Show both, as `+1 ハンマー（ひろった） / +1 ハンマー（ほうび）`.
3. At 800×600 the bottom row of the board is slightly cut off in the 3D camera when the HUD takes two lines. Include the HUD height in `fitCamera` the same way as in the ortho fit.
4. **Re-run the simulation** after 14.1–14.3 and check the hammer level (L16) against the 15-point step limit in 14.3.

### 14.5 Comeback gimmicks for the cat side (player feedback: the escape course is too hard for humans)
The simulation's "strong" profile is the Hard AI, which reads 4 plies; a human doesn't. The balance runs gain a third profile, **`normal` (Normal AI = a typical human)**, and the escape course is tuned against it. The gimmicks below give a cornered cat a way back.

**Power gauge (`power`, per cat side, 0–6 pips, this game only, not carried over)**
- **Gaining pips**:
  - +1 for every cat-side move.
  - +1 more when the moved cat started the turn with ≤ 2 empty neighbors (running under pressure).
  - +2 when the trapper uses a double.
- **Dash (大ダッシュ), costs 4**: in one turn, the selected cat makes up to **3** consecutive legal moves.
  - Every step triggers gimmicks normally (tunnel, ice, spring, item pickup).
  - The dash ends at once if a step lands on an edge (the cat wins).
  - The player clicks each step; a `ここで止める` button ends the dash early.
- **Corner jump (窮鼠ジャンプ), costs 6 (full)**: only while the selected cat has ≤ 2 empty neighbors.
  - The cat jumps **over exactly one adjacent block** in a straight line (`step(step(cat, dir), dir)`). The landing cell must be on the board, empty and enterable.
  - The landing cell's gimmick triggers normally. Landing on an edge wins.
- **Trapper-win exception**: a cat with no legal move is **not** stuck while `power == 6` and a corner jump is possible. This is the comeback: the trapper has to build a double wall or finish before the gauge fills.
- **UI**:
  - A 6-pip gauge next to the item bar, plus `ダッシュ` / `ジャンプ` buttons, enabled when affordable and legal.
  - Using one arms it, like the hammer; the legal cells are highlighted.
  - A toast for each use.
- **Cat AI**:
  - Dash when the dash reaches an edge, or when it lowers `dist` by ≥ 2 more than a normal move.
  - Jump whenever the cat is stuck or enclosed and the jump reconnects it to a route.
  - Easy AI never dashes, only jumps when stuck.
- **Trapper AI**: in the search, a cat with `power >= 4` (or `6`) also has its dash and jump moves (top 3 only). Normal and Hard prefer double walls next to a cat whose gauge is ≥ 5.

**Dried fish (にぼし) cells**
- Like item cells: they can't be blocked.
- When a cat lands on one, the trapper **skips its next turn**: the cat side moves twice in a row. The cell becomes normal.
- The trapper AI guards them like item cells.

**Storm (あらし)**
- A level event, once per game. The first time any cat becomes enclosed (`dist == -1` for that cat), a storm blows away **3 random blocks** (seeded), never ones adjacent to a cat.
- Toast `あらしだ！`, then the blocks fly off (an `animateStorm(indices)` spin-and-fade).
- Shown in the level's gimmick icons, so the player knows it's coming.

**Unlocks** (odd levels, so the even-level schedule in 14.2 stays):

| Course | L3 | L5 | L7 | L9 | L11 | L13 | L15 |
|---|---|---|---|---|---|---|---|
| escape (player cat) | power: dash only | — | power: jump | dried fish ×2 | storm | — | dried fish ×3 |
| trapper (AI cat) | — | — | — | — | — | AI power: dash only | AI power: dash + jump, dried fish ×1 |

- From its unlock level on, a feature stays active in every later level of that course.
- Escape course: the power gauge stays on from L3, the jump from L7, dried fish from L9 (×2, then ×3 from L15), and storm from L11.
- Trapper course: the AI's dash from L13, the jump from L15, dried fish ×1 from L15. No storm.

**Escape-course retune target**: the `normal` profile should get about 85 % at L1 → about 40 % at L20, with no step between levels over 15 points. The strong (Hard) profile may stay high. The designer re-tunes the blocks after the next simulation.

**Tests**:
- Pip gain (move, pressure bonus, double bonus).
- A dash of 3 steps with tunnel/ice inside; a dash ends on an edge.
- A corner jump over a block, and refused onto a blocked or off-board cell.
- The trapper-win exception with a full gauge.
- Dried fish skips the trapper's turn.
- The storm fires exactly once and never removes a block next to a cat.
- The AI uses dash and jump.
- The balance script's `normal` profile.

### 14.6 Difficulty in level play, calibrated by initial blocks (user requirement)
- **Difficulty select**: level play gets the same difficulty select as streak play: `easy` / `normal` / `hard`.
  - Difficulty changes **only the initial block count** (`blocks[difficulty]` per level). The AI strength and gimmicks stay as the level defines them.
  - A win at any difficulty counts toward the 3 wins that unlock the next level.
  - Level stats (13.8) are kept per difficulty: `stats[rules][course][level][difficulty] = {played, won}`.
- **Target win rates** for a typical human, measured with the `normal` player profile (Normal AI) against the level's AI. Targets are linear in the level between the two ends, in both courses:

| Difficulty | L1 | L20 |
|---|---|---|
| easy | **95 %** | **40 %** |
| normal | **80 %** | 25 % |
| hard | **65 %** | **10 %** |

- **Calibration: `scripts/calibrate.mjs`** (`npm run calibrate`)
  - For each course, level and difficulty, it searches the integer block count (0–40) whose simulated win rate is closest to the target.
  - It uses a binary search over the block count, 200 seeded games per probe. More blocks make the escape course harder (the player is the cat) and the trapper course easier (the player is the trapper).
  - It then makes the results monotone, so a harder difficulty or a later level never gets an easier block count. Pick the nearest monotone value.
  - It writes `blocks: {easy, normal, hard}` into `levels.js`, keeping a `// calibrated <date>` comment, and regenerates `levelStats.json`.
  - It prints the achieved rate next to the target. If a level can't come within ±7 points of its target at any block count, it is reported as `UNREACHABLE` for the designer to rethink that level's gimmicks.
  - The `blocks` values in the 14.3 tables become the starting point for the search only.
- **Chart update (replaces the line spec in 13.8)**
  - The chart shows **three estimated lines**, one per difficulty, for a typical human:
    - easy: aqua `#199e70`, dotted
    - normal: blue `#3987e5`, solid
    - hard: orange `#d95926`, dashed
  - The palette is validated on `#1e2a38`; all checks pass.
  - The player's results are **neutral dots** (ring in the HUD primary text color, filled per the selected difficulty's line color at 40 % opacity). One dot per level for the difficulty selected in the chart's own `易/普/難` toggle; it defaults to the current difficulty.
  - The tooltip shows all three estimates and the player's record for that level.
  - `levelStats.json` changes to: `courses[course][difficulty] = {rate:[20], blocks:[20], avgMoves:[20]}`.
- **Balance report**: `npm run balance` prints, for each course and difficulty, the per-level rate of the `normal`, `strong` (Hard AI) and `weak` (Easy AI) profiles, so the designer can see the human-proxy line next to the extremes.

## 15. Rev. 5.2: dash nerf and calibration fix

### 15.1 Dash (replaces the dash rule in 14.5; decided with the user)
- **Cost and length**: dash costs **6 pips (a full gauge)** and moves **up to 2 steps** (was 4 pips and 3 steps).
- **Why**: in the simulation, escape L3 (dash unlocked) with 30 blocks went from 82 % to 100 % cat wins. In 40 games the AI cat dashed 46 times, typically on move 3 from 3 cells off the edge. That skipped the trapper's critical opening.
- **Unchanged**: everything else in 14.5 (the step rules, ending on an edge, `ここで止める`, AI conditions). The UI labels and the toast show `2マス`.
- **Shared gauge**: dash and corner jump now both cost 6. The player chooses which one to spend the full gauge on.
- **Tests**:
  - Dash needs 6 pips.
  - Dash moves at most 2 steps.
  - After a dash the gauge is 0.
  - AI timing in `test/perf` still passes.

### 15.2 Calibration / balance script bug
`npm run calibrate --games 200` produced results inconsistent with direct `simulate()` calls for the same setting.
- **Example**: escape-easy-L8 at 39 blocks was reported as 0.5 %, while `simulate()` directly gives about 93–100 % for escape L8 at 30–40 blocks.
- **Symptoms**: neighboring probes jump between ~0 % and ~100 %. 105 of 120 settings ended up `UNREACHABLE` and pinned at 0 or 40 blocks.
- **Likely cause**: results returned from the worker pool are matched to the wrong setting (an ordering or id mismatch), or a probe reuses another setting's options.
- **Fix**: every job carries its full setting key, and every result echoes that key back. The aggregator asserts that the keys match.
- **Tests**:
  - For 3 settings × 3 block counts × 10 games, the pool (2 workers) returns exactly the same `{wins, draws, avgMoves}` as calling `simulate()` in-process.
  - The binary search sees a monotone response on a synthetic monotone `simulate` stub and finds the right block count.
- **Logging**: also print `draws` per probe. A draw (the move cap or no legal move) must be visible in the report, never silently counted as a loss.

## 16. Rev. 6: block-count range per difficulty (user requirement)

### 16.1 Escape course gets harder through more initial blocks
- The calibration search range becomes **0–60** blocks (was 0–40), for both courses.
- **Escape course** (the player is the cat): difficulty rises with **more** initial blocks. After the 15.1 dash nerf, re-calibrate so the curve in 14.6 is met mainly through blocks.
- `newGame` already retries placement until every cat has a route, and lowers the count by 1 after 100 failed tries. Calibration must record the count **actually placed** (`state.placedBlocks`). The report and `levelStats.json` use that number, not the requested one.

### 16.2 Block count means opposite things in the two courses
| Course | Player | More initial blocks → | Range order by block count |
|---|---|---|---|
| escape | cat | fewer routes → **harder** | easy < normal < hard |
| trapper | trapper | easier to enclose → **easier** | hard < normal < easy |

- Every piece of code that reasons about "harder" must go through one helper: `hardnessDirection(course)` → `+1` for escape (more blocks = harder), `-1` for trapper. That covers calibration, range building, monotone smoothing, the slider and the chart. Never hard-code a direction.
- **Monotone smoothing per course**: for a fixed (rules, course, level, profile), the win rate must be non-increasing in hardness. In escape, the rate goes down as blocks increase. In trapper, the rate goes up as blocks increase.
- **Ranges per difficulty**: each level stores `blocks:{easy,normal,hard}` (centers) and `range:{easy:[min,max], ...}` in block counts.
  - Each range is centered on its center.
  - Its half-width reaches halfway to the neighboring center, at least ±2 and at most ±5.
  - Ranges never overlap, and they follow the order in the table above.

### 16.3 Player-adjustable block count (UI)
- **Slider** `むずかしさの微調整`, next to the difficulty select, in level play and in streak play.
  - **Right is always harder**, in both courses.
  - The escape course maps right to more blocks; the trapper course maps right to fewer blocks.
  - The label shows the actual count and the estimate, e.g. `ブロック 17個 · 見積もり 58%`.
  - It defaults to the center. Changing it starts a new game.
  - The value is saved per (rules, play, course, level, difficulty).
- **Tooltips and help text** explain the meaning per course: `ブロックが多いほどむずかしい（にげる）` / `ブロックが多いほどやさしい（つかまえる）`. Translate both into all 6 languages.
- **Unlocks and stats**:
  - A win at any count in any range counts toward the 3 wins.
  - Stats record the count: `stats[...][difficulty][blocks] = {played, won}`.
  - The chart dots aggregate over counts.
  - Streak keys add `@n` when the count is not the center.
- **Basic rules** use the same mechanism. In streak play the center is `INITIAL_BLOCKS`.

### 16.4 Full sweep: measure every pattern (user requirement)
Calibration no longer binary-searches. It reads a **full measured sweep**.
- **`npm run sweep`** (`scripts/sweep.mjs`, worker pool) measures every combination of:
  - rules {basic, gimmick} × course {escape, trapper} × level 1–20
  - × block count 0–60 (the count actually placed is recorded, 16.1)
  - × profile {weak, normal, strong} (Easy/Normal/Hard AI as the player)
  - The opponent is always the level's `ai`.
- **Two passes**:
  1. **Coarse**: every even block count, 100 games each. That is 2 × 2 × 20 × 31 × 3 = 7,440 probes, about 3 h on 11 workers by the last run's speed.
  2. **Fine**: every integer inside each final range (after 16.2), 200 games each.
- **Output**: `scripts/out/sweep.json` (not bundled): `{rules, course, level, profile, blocks, placed, games, wins, draws, avgMoves}` per probe.
  - It is resumable: completed probes are skipped on restart, saved as JSON lines.
  - A progress line with an ETA every 30 s.
- **`npm run calibrate`** reads the sweep:
  - It applies the monotone smoothing (isotonic regression, in the course's hardness direction) to the `normal` profile.
  - It picks the center whose smoothed rate is closest to each 14.6 target.
  - It builds the ranges (16.2) and writes `levels.js`.
  - It writes `levelStats.json` / `.basic.json`, with the curves for all three profiles over all measured counts, so the chart and the slider estimate can use them.
  - It prints `UNREACHABLE` where no count comes within ±7 points.
- **`npm run sweep -- --report`** prints a compact matrix per (rules, course, profile): levels as rows and block counts as columns, rates in %. The designer reviews it and shows it to the user as a chart.

## 17. Rev. 6: juice — animation, particles and shaders (user requirement)

The game works but feels flat. This section adds feedback to every action. Everything stays **procedural** (no image or sound files) and **tree-shaken** (`@babylonjs/core` deep imports only), and must keep the CSP: GLSL source goes in JS strings and is passed to `ShaderMaterial` / `Effect.ShadersStore`, with no `eval`.

### 17.1 Architecture
- `src/render/fx/` holds `fxManager.js` (one instance per scene), `particles.js`, `shaders.js`, `post.js`, `tween.js` and `shake.js`.
- **The controller never calls fx directly.** The view turns the existing view calls (`animateBlock`, `animateCatPath`, `animatePickup`, `animateBreak`, `animateCrumble`, `animateStorm`, `animateResult`, `setHighlights`, `setHover`) into fx events. **No game-logic change.**
- **Quality setting** `fx: 'high'|'medium'|'low'`:
  - A top-bar select `演出`, saved.
  - Defaults to `high` on desktop and `medium` when `navigator.maxTouchPoints > 0`.
  - `prefers-reduced-motion: reduce` forces **no screen shake and no camera punch**, and caps the setting at `medium`.
- **Particle textures**: generated once into one `DynamicTexture` atlas: a soft dot, a star, a confetti square, a shard, a heart, a leaf, a snowflake.
- **Budget**:
  - `high`: up to 2,000 live particles, the post pipeline, and the glow layer.
  - `medium`: 800 particles, glow, no post.
  - `low`: 250 particles, no glow, no post, no custom tile shader (StandardMaterial fallback).
  - Target 60 fps desktop / high, ≥ 45 fps at the phone emulation / medium.

### 17.2 Animation polish (`tween.js` easing helpers on `scene.onBeforeRenderObservable`)
- **Cat hop**:
  - anticipation squash before takeoff (scale y 0.85, 60 ms)
  - stretch in the air (y 1.15)
  - landing squash (y 0.8 → 1, elastic, 180 ms)
- **Cat idle**: breathing (scale y ±2 %, 2.4 s), a tail sway, an ear twitch every 3–6 s (seeded jitter), and the head turning toward the hovered cell.
- **Block placement**: the block drops from y + 3 with a bounce ease (300 ms), plus a small dust ring on impact. A block placed next to a cat adds a 120 ms camera shake (amplitude 0.08).
- **Hover**: the tile lifts by 0.08 with an emissive pulse. Highlighted cells breathe (emissive 0.15 ↔ 0.35, 1.2 s).
- **Results**:
  - Escape: the cat does a happy hop and runs off with a speed-line trail (`TrailMesh`), followed by confetti and a camera punch-in.
  - Trapped: the cat droops (ears down, scale y 0.8), with sweat-drop particles and a desaturation fade (post) over 600 ms.
- **UI**: buttons get a press scale (0.96) and a hover lift in CSS. The power gauge pips pop in (scale 0 → 1.2 → 1) when filled, and the full gauge pulses.
- **Toasts** slide in from the top with an ease-out-back curve.

### 17.3 Particles (`particles.js`, pooled `ParticleSystem`s; under `low` also `ParticleHelper`-free)

| Event | Effect |
|---|---|
| block placed | dust ring (soft dots, 24, outward, gravity 0) |
| cat lands | small dust puff (8) |
| cat escapes | confetti burst (high 300 / medium 120), the 6 categorical colors, gravity −9 |
| item pickup | star sparkles spiralling up (20), yellow |
| hammer break | block shards (12 small box instances with velocity + gravity, fading), plus dust |
| brittle crumble | cracks glow, then pebbles fall (shards, smaller) |
| tunnel | vortex swirl at the entry (particles orbit inward, 300 ms), then a burst at the exit |
| ice slide | snowflake trail along the slide path |
| spring | coil squash on the spring mesh, a shockwave ring decal, a dust puff at the landing |
| storm | wind streaks across the board for 1 s, leaves tumbling, then the 3 blocks spin up and fade |
| dried fish | hearts float up from the cat |
| power full | a soft glowing aura ring under the cat (glow layer) and orbiting sparkles while full |
| dash | an afterimage trail (2 fading cat ghosts) |
| corner jump | a high arc with a sparkle burst at the apex |
| double armed | a pulsing ring on the board edge |

### 17.4 Shaders (`shaders.js`, `ShaderMaterial` with GLSL in strings)
- **Tile shader** (`high`/`medium`):
  - A grass gradient by world position plus slight noise variation per cell (hash of the cell index).
  - A rim light on the hex edge.
  - Exit (edge) cells pulse a faint emissive "exit" glow.
  - Uniforms: `time`, `baseColor`, `highlight`, `hover`.
  - Replaces the StandardMaterial tiles. The colors from 7.1 stay the base colors.
- **Move ripple**: when highlights appear, a ring ripple travels outward from the cat over the highlighted cells (uniform `rippleOrigin`, `rippleTime`).
- **Ice**: fresnel + a moving specular streak.
- **Tunnel portal**: a polar-UV swirl with time, in the pair color, additive.
- **Item**: an emissive rim, picked up by bloom.
- **Post pipeline** (`post.js`, `high` only):
  - `DefaultRenderingPipeline`: bloom (threshold 0.8, weight 0.35), FXAA and a subtle vignette.
  - One custom `PostProcess` "shockwave" (a radial distortion ring) fired on the escape/trap moment and on a corner jump.
- **Glow layer** (`high`/`medium`) for emissive items, portals, the power aura and the selected-cat ring.

### 17.5 Tests and checks
- **Pure parts**:
  - `fxPlan(viewCall, args, quality)` → a list of effect descriptors (which effects, their counts and durations). Test it for every view call and every quality level.
  - Easing functions.
  - Reduced motion disables shake.
- **The designer checks in the browser**:
  - Every effect fires once per event.
  - No console errors.
  - fps via `engine.getFps()` at `high` desktop and at `medium` with the mobile preset.
  - Particle systems are disposed or returned to their pools (no leak after 20 games: `scene.particleSystems.length` stays bounded).
- `npm run build` still succeeds, and the bundle grows by ≤ 250 KB gzip.

## 18. Rev. 7: balance changes from the full sweep (decided with the user)

The coarse sweep (16.4; 7,440 probes) showed:
- **Basic rules**: smooth, monotone curves in both courses. Every 14.6 target can be reached by block count alone.
- **Gimmick rules**:
  - Escape course from L7 on: the cat stays at 54–84 % even with 60 blocks (jump at L7, fish at L9, storm at L11).
  - L17 and L19 (several cats, `anyEscape`): about 100 % for the cat at every block count.
  - Trapper course: the player trapper is near 0 % from L15 on (AI jump + fish), and about 0 % at L17 and L19.

### 18.1 Separate block tables per rules kind
- Each level now stores `blocks` and `range` **per rules kind**: `blocks: {basic:{easy,normal,hard}, gimmick:{easy,normal,hard}}`, and `range` likewise.
  - `resolveGame`, the slider, `levelStats` and the chart read the entry for the active rules.
  - Old saves are unaffected: the slider values are already keyed by rules.
- `calibrate.mjs --rules basic|gimmick` writes **only** that rules kind's entries and leaves the other untouched.
- Until a rules kind is calibrated, it keeps the 14.3 table values as centers.

### 18.2 One block per free cat
- With several cats, the trapper places **as many blocks per turn as there are cats that can still move**: 2 cats → 2, 3 cats → 3.
  - A cat with no legal move doesn't count.
  - In `anyCatch`, escaped (removed) cats don't count.
- `state.blocksLeft` is set at the start of each trapper turn: `freeCats + (double armed ? 1 : 0)`.
  - The status check runs after every block, as with a double.
  - The turn passes to the cat side when `blocksLeft` reaches 0.
- **AI**: each block is chosen with `chooseBlock` on the current state (the same as the double).
- **UI**: the status line shows `あと 2 個置ける`. The double button adds one more.
- The 13.7 / 14.3 block overrides for L17–20 are dropped. Calibration sets them.

### 18.3 Power gauge fills only under pressure
- **Gaining pips**: +1 per cat-side move **only when the moved cat started the turn with ≤ 3 empty neighbors**. The flat +1 per move and the old ≤ 2 pressure bonus are removed. +2 when the trapper uses a double stays.
- **Unchanged**: costs (dash 6 / jump 6), the 2-step dash, the jump rule, the trapper-win exception.

### 18.4 Dried fish is weaker
- When a cat lands on a fish cell, **the trapper's most recently placed block that is not adjacent to any cat is removed** (with the crumble animation). This replaces the trapper skipping its next turn.
- If there is no such block, nothing happens.
- The toast `にぼしで ブロックが ひとつ くずれた！` (all 6 languages). The AI still values fish cells as before.

### 18.5 Re-measure
- After 18.1–18.4: run `npm run calibrate -- --rules basic` from the existing sweep. Basic rules are unaffected by 18.2–18.4.
- Then re-run the coarse sweep **for gimmick rules only**: `npm run sweep -- --rules gimmick --pass coarse --out scripts/out/sweep-gimmick.json`.
- The sweep script needs a `--rules` filter if it doesn't have one.

### 18.6 Calibration fix: monotone in the win rate, not in the block count
- 14.6 said that a later level must never get an easier block count. That was wrong for this game: the level's AI gets stronger at L7 and L14, so the block count has to move the **other** way there to keep the target curve.
- **New rule**: inside one level, the centers must follow the difficulty order of 16.2 (easy → normal → hard in the course's hardness direction), and the ranges must not overlap.
- **Across levels** there is no block-count constraint. Instead, the **achieved rate** for each difficulty should be non-increasing from L1 to L20. A step up of more than 3 points is reported as `NON-MONOTONE`, for the designer to look at.

## 19. Rev. 8: late-level balance fixes (decided with the user)

The gimmick re-sweep after Rev. 7 showed:
- **Escape L14–19**: the cat still wins 59–74 % with ~60 blocks. L14 jumps by +19 points (spring + Hard AI).
- **L17 / L19** (several cats, `anyEscape`): the cat wins 71–74 % at every block count.
- **Trapper L20** (3 cats, `anyCatch`): the player wins 88 % even with 0 blocks.
- **L19**: 13–21 of 100 games end as draws (the move cap).

### 19.1 One block per free cat only for `anyEscape`
- 18.2 applies to `catsGoal: 'anyEscape'` only.
- With `anyCatch` (the trapper only needs one cat), the trapper places **1 block per turn** (+1 with a double), as with a single cat.

### 19.2 Spring can't jump over blocks
- A spring jump needs **both** cells along `dir` to be free: the middle cell `step(spring, dir)` must be empty and not blocked, and the landing cell must be enterable.
- If either one fails, the cat stays on the spring.
- Update `kinds/spring.js`, `graph.js` (through the kind's `resolve`), the AI tests and the 13.6 spring tests.
- The intro text in all 6 languages says it: `あいだが空いていれば 2マス とぶ`.

### 19.3 Multi-cat start cells move toward the center
- **2 cats**: (5,4) and (5,6).
- **3 cats**: (4,5), (5,4) and (6,6) in odd-r coordinates. If two of them are adjacent, that is fine.
- The route guarantee still applies to every cat.

### 19.4 Investigate and fix the draws
- In L19 (3 cats, `anyEscape`), 13–21 % of the simulated games hit `MAX_STEPS`.
- Find out why: log the move sequence of the first 3 draws (seed, cats, history tail) into a test fixture. Then fix the root cause in rules or AI. Likely causes:
  - the cat AI oscillating between two cells while a cat is selected that can't progress
  - the trapper running out of blockable cells
  - turns passing without a move (18.2: an empty block budget plus a cat side with no legal move)
- **Rule backstop**: if the cat side has had no legal move for 2 consecutive cat turns (all cats stuck, no jump available), the trapper wins. If the trapper has no legal block, its turn is skipped.
- A regression test replays the logged seeds, and each game must end with a result before `MAX_STEPS`.
- The balance report must show `draws = 0` for L17–20 at 20 games per setting.

### 19.5 Re-measure
After 19.1–19.4, the designer re-runs the gimmick coarse sweep and calibration (18.5). Basic rules are unaffected.

## Implementation notes
Decisions made by opencode while implementing tasks 1–7 (not covered, or only
partially covered, by the spec above):

- **Candidate module** — `trapperCandidates(board, K)` lives in
  `src/game/candidates.js` and is re-exported from `src/game/trapperAI.js`.
  `search.js` imports it from `candidates.js`, so there is no
  `search.js ↔ trapperAI.js` circular import.
- **cellCenter offsets** — `cellCenter(r, c, size, gap, offsetX = 0, offsetZ = 0)`
  keeps the documented 4-argument call working and accepts optional offsets.
  The spec formula cannot center a board without knowing W/H, so the renderer
  (task 8) computes them: `offsetX = (size*√3 + gap) * (W - 0.5) / 2`,
  `offsetZ = (size*1.5 + gap*0.866) * (H - 1) / 2`.
- **alphaBeta K for Hard** — the cat's Hard search passes `K = 10` for the
  trapper side too (the spec only fixes K=10 for the trapper Hard search).
- **Controller highlights** — `view.setHighlights(legalCatMoves)` in escape
  mode, `view.setHighlights([])` in trapper mode (per the view interface in
  section 6), so the view never needs to know the mode.
- **hud.setStatus text** — the controller passes plain English strings
  (`'Your turn'`, `'Thinking...'`); `strings.js` localization is the HUD's
  job via `setTurn`/`showResult` (or it may ignore `setStatus`).
- **AI edge cases** — `chooseCatMove` returns `-1` when the cat has no legal
  move and `chooseBlock` returns `-1` when there is nothing to block; the
  controller only invokes the AIs while `status === 'playing'`.
- **RNG streams** — `newGame` uses its own `mulberry32(seed)` for initial
  block placement; the controller creates `rngFactory(state.seed)` once per
  game for AI decisions. Both are reproducible from the seed shown in the HUD.
- **moveCount** — always `history.length` (one increment per action, either side).
- **Enclosed cat (section 5.1, Rev. 2)** — when `dist[cat] == -1`,
  `chooseCatMove` scores each move by `reachableArea` computed on a clone
  where the cat's OLD cell is blocked (so stepping into a dead-end pocket
  scores lower); ties are broken by more `emptyNeighbors` of the
  destination, then at random. `evalForCat` (section 5.3) still uses the
  plain `reachableArea` (the spec did not change there). Background: with
  the old cell passable every legal move yields the same area, which is why
  Rev. 2 measures with the old cell blocked.
- **Initial block generation** — every one of the 100 retries re-randomizes
  the whole placement; after 100 failed attempts the block count is reduced
  by 1 (floor 0) and it retries.
- **distanceMap details** — sources are edge cells that are not blocked (the
  cat's cell counts as empty because it is never blocked); BFS traverses
  non-blocked cells, so the cat's own cell is passable. Blocked and
  unreachable cells → `dist = -1`, `paths = 0`.
- **Vitest config** — `test.passWithNoTests: true` so `npm test` is green
  during the scaffold task (0 tests).
- **Alpha-beta win bonus** — terminal nodes return `±(10000 + depth)` where
  `depth` is the remaining ply count, checked before the depth-0 base
  evaluation; internal nodes only run the cheap terminal checks (cat on edge /
  no cat moves) and a full `evalForCat` at leaves. Hard < 100 ms is asserted
  in `test/catAI.test.js` and `test/trapperAI.test.js` on realistic mid-game
  boards (initial Hard blocks + 20 more, escape route preserved).
- **apply\* guards** — `applyBlock`/`applyCatMove` also throw when
  `status !== 'playing'` (moves after game over are illegal), and validate
  the index range before touching the typed array.
- **First move** — as specified in section 1, the player always moves first
  (trapper in trapper mode, cat in escape mode), so `start()` enters phase
  `'player'` in both modes; the `'ai'` branch of the start diagram remains in
  the controller for generality.
- **catAI Easy** — "smallest dist, ties broken at random" only (the `paths`
  tie-break belongs to Normal); the 30% random roll happens before that.

Decisions made by opencode while implementing tasks 8–11 (rendering, HUD,
Electron, Pages):

- **Tree-shaking side-effect imports** — the render layer uses per-module
  `@babylonjs/core/...` imports (no barrel) plus the side effects Babylon
  needs in tree-shaken bundles: `@babylonjs/core/Culling/ray.js`
  (`scene.pick`), `@babylonjs/core/Animations/animatable.js`
  (`Animation.CreateAndStartAnimation`), and
  `@babylonjs/core/Events/pointerEvents.js` (`onPointerObservable` /
  `PointerEventTypes`). Meshes are built with direct builder imports
  (`Meshes/Builders/sphereBuilder.js`, `Meshes/Builders/cylinderBuilder.js`)
  instead of the `MeshBuilder` barrel (which drags in every builder); the
  spec's `MeshBuilder.CreateCylinder` calls are equivalent `CreateCylinder`
  calls with an explicit `scene`. All lights/cameras/materials/TransformNode
  get real `Vector3`/`Color3`/`Color4` instances and an explicit `scene`
  argument (plain `{x,y,z}` objects break lights — `direction.scale` at the
  first render). The cat's ears are cones built as
  `CreateCylinder({diameterTop: 0, ...})` — Babylon has no `CreateCone`.
- **Materials** — every shared `StandardMaterial` gets a small emissive
  component (0.15–0.7 × the diffuse color) so the palette stays readable
  under the two spec lights; `specularColor` is black. Blocked cells are
  raised to `y = 0.225` (half the extra height) so their base stays on the
  board plane while `scaling.y` goes 1 → 2.5.
- **catView** — the cat root sits at `y = 0.1` (body rests on the 0.15-high
  cell top); hop (250 ms), catWin run-off (700 ms, 3 cells outward from the
  edge while fading) and trapperWin sit (shake 3×, then `scaling.y = 0.8`)
  share one `scene.onBeforeRenderObservable` driver using
  `engine.getDeltaTime()`. All cat meshes are `isPickable = false` so taps
  fall through to the cells.
- **Picking** — hover highlights empty cells only while `phase === 'player'`;
  taps ignore drags that moved more than 10 px (camera rotation), and illegal
  taps are reported through the controller's `flashInvalid`. A shared red
  material flashes for 150 ms.
- **Hint wiring** — `view.setHintEnabled(on)` is an extra (non-injected)
  method: while enabled the view recomputes `shortestPathToEdge(state.board)`
  after every move animation and clears the hint on game result. The
  controller API is unchanged; the HUD checkbox only calls
  `view.setHintEnabled`.
- **shortestPathToEdge(board)** — pure helper in `src/game/board.js`; walks
  the distance map greedily (first neighbor with `dist-1`, deterministic),
  returns `null` when the cat is enclosed.
- **HUD texts** — built from `setTurn` + `controller.state.moveCount` +
  seed and localized via `strings.js` (ja default, en when
  `navigator.language` starts with `en`); the controller's English
  `setStatus` text is intentionally ignored (API kept for compatibility).
  `showResult` maps `(status, mode)` to the four result strings from
  section 8. Settings are stored under the `catescape.settings` key.
- **HUD controls** — mode/difficulty changes, New Game and Play again all
  call `controller.start` with a fresh seed (`Date.now()` default); the
  result modal is hidden on start.
- **index.html / style.css** — the HUD container is `pointer-events: none`
  (only the controls capture events, so drags elsewhere rotate the camera);
  `#top-bar` uses `flex-wrap`, and the ≤480 px media query keeps the bar
  usable (wraps onto two lines) down to 360 px phone width.
- **Electron** — the application menu is hidden
  (`Menu.setApplicationMenu(null)`); on macOS the `activate` hook recreates
  the window. electron-builder config lives in the `build` section of
  package.json (appId `com.gadget114514.catescape`, nsis).
- **Pages workflow** — `pages.yml` runs manually (`workflow_dispatch`; changed from push-to-main because the repo is private and Pages is unavailable on the current plan): checkout@v4,
  setup-node@v4 (Node 20, npm cache), `npm ci`, `npm test`,
  `npm run build`, `upload-pages-artifact@v3 (path: dist)`,
  `deploy-pages@v4`, with `pages: write` / `id-token: write` permissions and
  the `github-pages` environment. README notes that the Pages source must be
  set to "GitHub Actions".

Decisions made by opencode while implementing section 7.1 (Rev. 3):

- **fitCamera split** — the pure math lives in `src/render/fit.js`
  (`boardExtent(W,H,size,gap)` from `cellCenter` + one cell of margin, and
  `computeCameraFit({aspect, vFov, hx, hz, hudHeightPx, canvasHeightPx})` →
  `{radius, lowerRadiusLimit, upperRadiusLimit, targetZ}`); it imports no
  Babylon code and is covered by `test/fit.test.js`. The impure
  `fitCamera(camera, engine, extent)` in `scene.js` measures `#hud`'s live
  height and is called by `main.js` on startup **and** on every resize (which
  also resets `camera.radius` to the new fit — user zoom is reset on window
  resize, per "auto-fit on every resize"). The refit listener calls
  `engine.resize()` first so the aspect uses fresh dimensions.
- **HUD shift sign** — with `alpha=-π/2` the camera looks from −z toward +z,
  so world +z is screen-up; `target.z = visibleHalfDepth * (hudPx/canvasPx)`
  moves the target "up" on screen, which renders the board below screen
  center — i.e. centered in the area under the top bar.
- **Cat scale** — `root.scaling = 1.4` at all times; the trapperWin squash is
  now `1.4 * 0.8` (relative to the base scale), reset restores 1.4. Head/eyes/
  ears moved slightly toward the cat's center and the tail shortened (0.55
  long at z −0.44, was 0.7 at −0.55) so the 1.4× footprint stays within a
  single cell for every yaw direction.
- **Hint ∩ highlight ring** — pooled per-cell flat cylinders
  (`diameter 2.3, height 0.06, y = −0.11`, `isPickable = false`, shared hint
  material) created lazily under cells that are both hinted and highlighted;
  such cells keep the highlight (clickable) color. Hint-only cells keep the
  orange cell color. Rings are disposed on rebuild/dispose. (Picking filters
  on `metadata.index`, and the rings' `hintRing` metadata has none, so they
  are never picked.)
- **Cell materials** — uniform `emissive = diffuse * 0.15` and black
  specular for every cell material (was 0.15–0.7 per material); cat materials
  kept as-is (Rev. 3 only covers cell materials). New palette: empty
  `#7cc576`, border `#b5dba8`, hint `#ff7a1a`; hover/highlight/blocked/flash
  unchanged.
- **Hint checkbox label** — restructured to an explicit
  `<label id="hint-label" for="hint-checkbox">` sibling of the input (the
  previous label both wrapped the input and carried `for`, which the
  accessibility audit flagged as reading "on"); `hud.js` keeps writing to the
  same id, which is now the `<label>` itself. All three form controls
  (`mode-select`, `difficulty-select`, `hint-checkbox`) now have an explicit
  `<label for>`.
- **Dev hook** — `window.__catescape = { controller, view }` only under
  `import.meta.env.DEV`, so production/Pages builds tree-shake it away.
- **Result message mode** — `hud.showResult` picks the message from
  `controller.state.mode` (the game that just ended) with `settings.mode`
  only as a fallback; previously the mode *select* was used, which produced
  the wrong text when the player switched modes before pressing "Play
  again". `hud.js` is unit-testable without a real DOM (it only needs
  `document.getElementById` plus plain element objects), so
  `test/hud.test.js` covers all four (status, mode) mappings and the
  select-vs-game divergence regression.
- **CSP** — `index.html` carries the Electron-recommended meta CSP
  (`default-src/script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'
  ws://localhost:5173 http://localhost:5173`). The built `dist/index.html`
  contains no inline scripts (only `src=` assets), so `script-src 'self'`
  is safe for Pages/Electron; Vite dev mode is covered because the Vite
  client is loaded from a same-origin `src` URL, HMR uses
  `ws://localhost:5173` (explicitly in `connect-src`) and dev CSS is
  injected as `<style>` (allowed by `'unsafe-inline'`).

Decisions made by opencode while implementing tasks 12–15 (Rev. 4, gimmick
rules, play styles, rulesets + controller):

- **role vs side** — `role`/`mode` values are `'trapper'|'escape'`, but
  `canUseItem(state, side)`, `hud.setInventory(..., playerSide, ...)` and the
  controller's highlights work on the player's *side*
  (`'trapper'|'cat'`): `controller.start` maps `role 'escape' → 'cat'`
  (the legacy `{mode, difficulty}` option names are still accepted and
  mapped to `{role, ai}`).
- **gimmick state copies** — the gimmick state also carries `mode: role` and
  `difficulty: ai` so the existing HUD (`state.mode`, `state.difficulty`
  reads) works unchanged on gimmick games; `armItem` is the only writer of
  `armed`/`blocksLeft`.
- **`blocksLeft` / `armed` bookkeeping** — `blocksLeft` is the number of
  blocks remaining in the current trapper action (1 normally, 2 while a
  double is armed); after the second block it resets to 1 and `armed`
  clears. `armItem` sets `armed = true` for **both** sides (the spec has one
  `armed` flag), and `disarmItem` resets `blocksLeft` to 1 for the trapper,
  so a cancelled double's pending block passes the turn as usual.
  The trapper's double is spent at arm time (no refund on disarm), which
  also makes `shouldUseItem` return `false` while a double is in progress —
  the AI cannot chain-arm mid-double.
- **history kinds** — `armItem` pushes `{side, index:-1, kind:'arm'}`, so
  `moveCount` (= `history.length`, as before) counts an arm as one action.
  `disarmItem` is not a history entry (the spec's kind list has no
  `'disarm'`); it only mutates `armed`/`blocksLeft`.
- **trapperWin while the cat holds a hammer** — the spec (no empty neighbor
  **and** `hammer == 0`) is extended so the game cannot stall: with a hammer
  in hand and at least one blocked neighbor the cat can still arm and break,
  so the trapper only wins when the cat has *no* move at all (no empty
  neighbor and nothing breakable).
- **where the block-count default lives** — `gimmickRules.newGame` requires
  an explicit `blocks` number and throws otherwise; the `INITIAL_BLOCKS`
  default (when `resolveGame` omits `blocks`, i.e. streak play) is applied
  by `gimmickRuleset.newGame` in `rulesets.js`. `basicRuleset.newGame`
  without `blocks` calls `rules.newGame` verbatim (bit-identical boards for
  a given seed — asserted in `test/setup.test.js`); with `blocks` it runs
  the same seeded generation loop as rules.js inside `rulesets.js`, so
  rules.js itself stays untouched.
- **playerItems / aiItems shapes** — `newGame` accepts `playerItems` as
  either the full saved inventory `{hammer, double}` (only the field matching
  the player's role is read) or a plain number for that side's item; counts
  clamp to 0..9 at game start. `gimmick.aiItems` is a count for the AI's
  side (doubles for an AI trapper, hammers for an AI cat).
- **gimmick cell placement** — blocks first with section 1's retry rule;
  item cells then prefer `catDistanceMap` 2–4 (seeded shuffle order), falling
  back to any free inner cell (including unreachable ones) when the band is
  too small; stones fill the remaining free inner cells. Only blocks take
  part in the route retry — item/stone cells are walkable, so they can never
  break the route.
- **gimmickCandidates** — basic `trapperCandidates` filtered to
  `cells === 0`; if nothing remains, the legal block closest to the cat
  (ties broken by the rng when one is given, else the first), returned as a
  single candidate. `gimmickSearch.js` hosts it and `gimmickAI.js`
  re-exports it (same non-circular pattern as `candidates.js`/`trapperAI.js`).
- **gimmickEval** — equals `evalForCat(board) + 60*hammers +
  25*(item cell within 2 moves)`, with one deviation: the −10000 "no moves"
  term applies only when the cat cannot act at all (no empty neighbor and,
  while holding a hammer, no breakable neighbor); an enclosed cat with break
  potential scores the enclosed formula (`-5000 + area*10`) plus the hammer
  and item terms. Mobility stays the plain `emptyNeighbors` count from
  `evalForCat` (break mobility comes in via the 60×hammers term). "Within 2
  moves" is `catDistanceMap <= 2` for any remaining item cell.
- **search semantics** — the gimmick alpha-beta models pickups in child
  nodes (item cell → normal, cat hammers +1) and breaks (unblock, hammers
  −1); trapper children never modify `cells`. The cat's move list at a node
  is `emptyNeighbors` plus blocked neighbors when `hammers > 0`, which is
  exactly the spec's "not terminal while the cat holds a hammer".
- **Normal's item tie-break** — key order `dist → paths → item distance →
  random` (basic Normal's `paths` second key is kept; "closer to an item"
  only breaks the remaining ties). Item distance is a multi-source BFS
  distance to the nearest remaining item cell.
- **shouldUseItem details** — deterministic (the `rng` parameter is unused);
  returns `false` whenever `state.armed` (mid-double / already armed). The
  trapper threshold is the literal `dist[cat] <= {easy:1, normal:2, hard:3}`,
  which is also true for `dist == -1` (enclosed cat about to break out —
  reachable only while it still holds a hammer, otherwise the game is
  already over). The cat's "dist at least 2 smaller" test maps `dist == -1`
  to +∞ on both sides, so any break that restores a route beats a fully
  pocketed best normal move.
- **hard cat move validation** — the hard search may evaluate breaks that
  the current state has not armed (arming is `shouldUseItem`'s decision);
  `chooseCatMove` only returns moves present in `legalCatMoves` and falls
  back to smallest-`dist` otherwise, so `applyCatMove` can never throw on an
  AI move.
- **break target choice** — shared by every level when armed: smallest
  `dist` after breaking, then `paths`, then random (the edge-move shortcut
  still applies first).
- **controller ruleset wiring** — `start({ruleset, ...})` defaults to the
  last ruleset used (constructor default `basicRuleset`), so the old
  `start({mode, difficulty, seed})` callers in `main.js`/`hud.js` keep
  working; `_enterTurn` highlights `ruleset.legalCatMoves` when the player
  is the cat (an armed cat also sees its break targets) and `[]` otherwise.
  The hint is cleared with `view.setHint(null)` on every applied move —
  player and AI alike.
- **notify keys** — `doubleArmed`/`hammerArmed` (player arms), `aiDouble`/
  `aiHammer` (AI arms), `pickup` (cat picks an item up). `hud.setInventory`
  is pushed after start and after every change as
  `(state.items, playerSide, armed)`; both calls are optional-chained, and
  both are skipped entirely for basic states (no `items` field).
- **onGameOver(result)** — called once per game after `hud.showResult`, with
  `{status, moveCount, state}`; a per-game flag (reset in `start()`) guards
  double firing, and a generation change during the result animation skips it
  for the abandoned game.
- **showHint** — allowed whenever `status === 'playing'` (the phase guard
  lives in the UI, which disables the button); it uses
  `shortestPathToEdge(state.board)` from board.js and returns early when
  there is no state or the game is over.
- **progress data** — streak key format `<rules>.<role>.<difficulty>`;
  `recordResult` returns `streak: null` in level play and `unlockedNext:
  false` in streak play. In level play the +1 item reward applies exactly
  when the win incremented the count (wins < 3 before it, so the third win
  still pays out); in streak play every 3rd consecutive win pays out. The
  player write-back overwrites only the *player's own* item type (the other
  one stays at its saved value), and `rewards` reports the **actual** gain,
  so a cap-at-9 write yields `rewards: 0`. On load, wins clamp to 0..3,
  inventories to 0..9, malformed streak keys are dropped and bad fields fall
  back to the defaults field-by-field (bad `version` → all defaults).
- **setup defaults** — `resolveGame` defaults to `rules:'basic'`,
  `play:'streak'`, `difficulty:'normal'`, `course = role`, level clamped to
  1..20 by `getLevel`. In streak play only `ai` (and, with gimmick rules,
  the gimmick parameters from L3/L10/L17) come from the tables — `blocks` is
  left unset so `INITIAL_BLOCKS` applies, because the spec lists "ai, blocks
  and the gimmick parameters" as table-driven only for level play.

Decisions made by opencode while implementing tasks 16–17 (Rev. 4, rendering,
ortho camera, UI):

- **computeOrthoBounds math** — vertical half-extent
  `H = max(hz, hx/aspect) * margin / (1-hudFrac)`, half-width `H*aspect`,
  window center `+H*hudFrac` (screen-up), i.e. the board renders `hudFrac/2`
  of the screen height below the center — the exact ortho twin of the
  perspective `targetZ = visibleHalfDepth * hudFraction`. The `1/(1-hudFrac)`
  inflation is required so the upward shift never crops the bottom of the
  board out of view; `hudFrac` clamps to `[0, 0.9]`. Default `margin` 1.05,
  matching `computeCameraFit`.
- **setCameraMode** — exported from `createScene` as a closure over the
  canvas/camera, so callers see the spec's `setCameraMode(mode)` arity.
  Ortho sets `Camera.ORTHOGRAPHIC_CAMERA` (constant from
  `Cameras/camera.js`), `alpha=-π/2`, `beta=0.0001`, **lowerBetaLimit=0**
  (the usual 0.5 floor would force the flat beta back up per frame), zeros
  the target (the bounds carry the HUD shift) and detaches the inputs;
  perspective re-attaches and clamps beta into `[0.5, 1.1]` again. main.js
  tracks the current mode and its `refit()` picks `fitCamera` vs
  `fitOrthoCamera` (both read the live `#hud` height). The camera mode is
  *not* persisted — 12.8's restore list doesn't mention it, so a session
  always starts in 3D.
- **breakable highlight** — carried by the highlight set, not a separate
  flag: a *blocked* cell that is also highlighted renders with the
  `breakable #ff5a5a` material. `controller.useItem` now re-applies the
  player's highlights after arm/disarm, so a hammer-armed cat immediately
  sees its break targets (the trapper player's highlights stay `[]`, as
  before).
- **item octahedra** — one `CreatePolyhedron({type:1, size:0.32})` per item
  cell, `isPickable=false` (the pick predicate only accepts
  `metadata.index`, so taps already fell through). Bob + spin run from a
  single `scene.onBeforeRenderObservable` callback (phase in `metadata.bob`),
  removed in `boardView.dispose`. `animatePickup` animates `scaling` with
  VECTOR3 keys and disposes in `onComplete` through `releaseItem(i, mesh)`,
  which only disposes when that exact mesh is still live — a pending pickup
  from an abandoned game must not eat the rebuilt item of the next one
  (rebuild deliberately does *not* stop the animable: letting it finish
  keeps the awaited promise resolving).
- **stone look** — `scaling.y = 0.5` (0.15-high tile) with
  `position.y = -0.075` keeps the tile's base on the board plane. Stone is
  the *base* look only: highlight / hint / hover override it (the cat can
  walk stones, and the shortest-route hint may run across one).
- **break / pickup sequencing** — the controller plays break-sink → hop →
  (nothing) for a break and hop → pickup-shrink for a pickup, on both the
  player and AI paths, keyed off the applied history entry's `kind`. Both
  calls are optional-chained (`view.animateBreak?.()`), so the Rev. 3 test
  stubs keep working and basic games (no `kind`) behave exactly as before.
  `animateBreak` finishes with `applyLook(i)` so the cell returns to its
  exact normal/stone look, and animates `scaling.y` + `position.y`
  (mirroring `animateBlock`) so the block does not jump while sinking.
- **hint ownership** — with the checkbox gone, `view.setHintEnabled` and the
  view's refresh-after-move machinery were removed; the controller now fully
  owns the hint (`showHint` draws, `setHint(null)` fires on every applied
  move, `animateResult`/`rebuild` clear it). `showHint` itself stays
  guarded only by `status === 'playing'` (rev4a) — the *button*'s
  player-turn-only state is the UI's job.
- **settings shape** — `{rules, play, role, difficulty, course, level}`
  under the old `catescape.settings` key; `saveSettings` writes only these
  fields, so the old `hint`/`mode` keys disappear on the next save, and
  `loadSettings` migrates a legacy `mode` into `role`. `course` persists the
  level-select *tab* (12.8 restores it), while the game always resolves
  `course = role`: picking a level sets `role` to that tab's course, so a
  course is always played by its own side.
- **`getSettings().mode`** — kept as a read-only alias of `role` (the old
  settings key). This keeps the hud.test case that reads
  `getSettings().mode` verbatim and matches `state.mode` consumers.
- **HUD ↔ main wiring** — `hud.attach({controller, levelSelect, getProgress,
  onStart, onCameraMode})`; select changes do settings → persist →
  updateControls → `onStart()` (main's `startGame`: `resolveGame` →
  `controller.start({ruleset, ...newGameOpts, playerItems:
  progress.inventory})`, seed omitted → fresh random). The camera select
  only calls `onCameraMode` (→ `setCameraMode` + refit, never a restart).
  `onGameOver` (controller, same tick as `hud.showResult`) runs
  `recordResult` → `saveProgress` → `hud.showResultInfo({play, streak,
  rewards, unlockedNext, wins})`, which fills the modal extras and refreshes
  the status line's streak.
- **notify/toast split** — toasts exist for `aiDouble`/`aiHammer`/`pickup`
  only; the player's `doubleArmed`/`hammerArmed` keys are silent because the
  item button already reflects them through `aria-pressed`.
- **item bar visibility** — derived from `state.items` inside
  `setSeed`/`setTurn` (the controller only calls `setInventory` for gimmick
  states), so starting a basic game after a gimmick one hides the bar
  without an extra callback.
- **result modal layout** — streak play: message + moves + `連勝 n（最高 m）`
  (from `showResultInfo`, hidden until it arrives — the controller fires
  `showResult` first, so both land in the same tick); level play: `勝ち n/3`
  + `レベル選択` + `次のレベル` (only when `recordResult.unlockedNext` and
  `level < 20`), and the rewards line lists the *actual* gains (`+1 ハンマー`
  …, absent when capped).
- **levelSelect.js** — built with `createElement` and appended to
  `document.body`, keeping `hud.js` getElementById-only so hud.test's stub
  document stays sufficient. Cards are `disabled` + a two-piece CSS padlock
  (`.lv-lock`, no assets); the current level gets a `.current` ring; tabs
  only re-render, the game starts on card click via
  `hud.setLevelAndStart(level, course)`.
- **`[hidden] { display: none !important }`** — `#item-bar` and
  `#difficulty-control` use `display:flex`, which would otherwise beat the
  user-agent `[hidden]` rule (the level overlay got its own `[hidden]` rule).
- **test changes (disclosure)** — `test/hud.test.js`: only the element-ID
  list tracks index.html (hint checkbox/label removed, new bar/modal ids
  added) and the stub element gained inert `hidden`/`disabled`/`setAttribute`
  props; **the three test cases are unchanged** and pass as written.
  `test/fit.test.js`: the import line gained `computeOrthoBounds` and a new
  `describe` was appended (instructed by the task list); the pre-existing
  tests are untouched. New file `test/ui.test.js` covers strings parity,
  settings persistence (hint dropped, mode→role migration), the streak line,
  `L7 ●●○`, item bar + toasts, result extras and the start-vs-camera split.
- **dev hook (12.9)** — `window.__catescape = {controller, view,
  rulesets:{basic, gimmick}, setup: resolveGame, progress:{load, save,
  reset}}`; `load`/`reset` also re-sync main's in-memory progress so the
  designer's automation sees the fresh data.

### Tasks 18-19: gimmick registry, graph, new kinds, new hammer (Rev. 5)

- **kind numbering**  item=1 and stone=2 kept from the old cells array so
  the view's item/stone handling keeps working; tunnel=3, ice=4, arrow=5,
  brittle=6, spring=7. state.cells is an alias of state.g.kind (one
  Uint8Array, no copy). Per-cell data is state.g = {kind, partner, dir,
  ttl}; only 	tl needs copying in search clones (and the search treats
  brittle blocks as permanent, so even that is shared there).
- **registry layering**  kinds/*.js import only board/hex/hexDir and each
  other's absence; ice and spring import canEnter from 
egistry.js
  (call-time only, the ESM cycle never evaluates at module load).
  
egistry.KINDS is the unlock order of 14.2 and drives both placement
  order and hook composition; UNLOCKS also lists the carried items
  (double:4, hammer:16) for the level test and the setup filter.
- **dirOrder**  a constant [W,E,NW,NE,SW,SE] for both row parities — that
  is exactly oard.nbr's order (hex.js lists NW before NE and SW before
  SE on both parities), which lets gShortestPathToEdge reproduce
  oard.js#shortestPathToEdge cell-for-cell on plain boards (the 50-seed
  equivalence test checks dist, paths, catDist, area and the path).
- **setup retry**  blocks are still placed with the section-1 retry
  (plain distanceMap), then the kinds place themselves; the whole
  sequence retries up to 30× until gDistanceMap keeps the cat connected
  (arrows restrict entry, so the gimmick-aware check is the real guarantee).
- **new hammer (14.1) through the unmodified controller**  while armed,
  legalCatMoves = the cat's legal move entries plus the break targets
  (blocked cells at hex distance 2-3; adjacency can never be broken).
  pplyCatMove on a break target unblocks it, spends one hammer, sets
  hammerUsed and **keeps the turn**, so the existing
  arm→choose→apply flow simply runs again for the follow-up move; the
  AI-side second step is suppressed by hammerUsed (at most one hammer per
  turn, also gated in canUseItem/rmItem). evaluateStatus is the
  plain rule over gMoves (arrow-aware), no hammer exception.
  state.lastPath (via moveCells) carries the cells of a gimmick move and
  state.crumbles the brittle cells that just crumbled — the data the
  nimateCatPath/nimateCrumble view hooks of task 23 will consume.
- **brittle timers**  	tl = 3 at block time and **every** trapper turn end
  ticks every brittle block — including the placement turn's own end, so a
  singly placed block has an effective remaining life of 2 further trapper
  turns and crumbles at the 3rd turn end overall (matches "exactly 3
  trapper turns").
- **one resolve per move**  landing() applies only the module that owns
  the entered cell; a landing cell's own gimmick never triggers (an ice
  slide that stops on a spring/tunnel/item rests there; the pickup hook
  still runs via onLand). Ice slide legality re-checks canEnter for
  every step, so a wrong-way arrow stops the slide.
- **AI/search on the graph**  evaluation is evalForCat + 25*hammers +
  25*(item within 2) (14.1); a stuck cat is terminal even with hammers.
  A hammer turn is the compound (break, move) over the top 3 targets
  ordered by the dist after the break × the top 3 moves. The normal trapper
  score discounts brittle candidates (used only when they give 
ewDist ==
  -1 or the cat's dist <= 1; when the discounted pool is empty the best
  brittle cell is used anyway, and gimmickCandidates's closest-blockable
  fallback guarantees chooseBlock never returns -1 while a blockable cell
  exists — bug 14.4-1).
- **hard < 100 ms**  the gimmick graph maps cost several times the plain
  ones, so the Hard search runs **3 plies** (basic uses 4, K stays 10).
  graph.js got fast paths (NORMAL cells skip the module loop), a reused
  scratch predecessor table and a depth-2 itemWithin2 flood; measured
  worst case ~40 ms on L16 boards with hammers active.
- **levels/progress/setup**  14.3 tables are plain data
  (gimmicks:{stone..item}, cats, catsGoal, intro); cats/catsGoal
  are stored but the rules are still single-cat (13.7 arrives with the
  multi-cat task). progress gained seenIntro (+ 
ecordIntroSeen /
  hasSeenIntro) and highestUnlocked. 
esolveGame now takes
  progress and playerItems: it filters the streak rep level's gimmicks
  to unlock <= highestUnlocked, drops gimmicks above level defensively,
  gates carry-over hammers to L16+ and doubles to L4+, and returns the
  gated playerItems inside 
ewGameOpts (main.js passes them through
  resolveGame instead of straight to the controller).
- **test disclosure**  gimmick-mode tests were updated to the new rules
  (hammer fixtures moved to distance-2/3 breaks, eval +25, tables 14.3,
  brittle placement-turn tick); basic tests (hex, board, rules, catAI,
  trapperAI, search, controller) are untouched. New: gimmickGraph.test.js
  (hexDir, registry, 50-board equivalence) and gimmickKinds.test.js
  (tunnel/ice/arrow/brittle/spring behavior, blockability, hint paths,
  brittle AI discount, L16 perf, controller data hooks).

### Task 20: multiple cats with goals (13.7) — Rev. 6

- **state shape**  `state.cats` (remaining cat cells, 1–3, always
  present), `state.escaped`, `state.catTotal`, `state.catsGoal`
  (`anyEscape`/`anyCatch`, null for 1 cat) and `state.selectedCat`.
  `board.cat` always mirrors `cats[selectedCat]` — the selected / last
  moved cat — so every single-cat helper (hammerTargets, isBorder checks,
  item placement, the view) keeps working unchanged. Start cells come
  from the 13.7 table (2: (5,3)/(5,7); 3: (4,4)/(4,6)/(6,5)); the setup
  retry now guarantees **every** cat a gimmick-aware route, and
  placeCommon.freeCells keeps gimmick cells off all cats and away from
  all their starts.
- **cats block each other**  `registry.catInWay(state, cell)` treats the
  other cats exactly like blocks (a cell of another cat is never
  enterable and never blockable — `isBlockable` also excludes all cats
  when there are 2+). graph.js functions take an optional `catIndex`
  (default `state.selectedCat`) and run on a `forCat` shallow view;
  tunnel resolves stay on the entry end when the exit is occupied, ice
  slides stop on the last cell before another cat, and springs refuse a
  landing on another cat — all through catInWay inside the kinds.
  Single-cat states short-circuit (catInWay is false under 2 cats, forCat
  repairs a direct-set board.cat), so every pre-existing fixture and the
  50-seed graph equivalence tests pass byte-for-byte.
- **goals**  evaluateStatus implements both 13.7 rows with the 14.1
  override (a stuck cat has no legal move — the hammer never matters):
  `anyEscape` ends at once when any cat reaches an edge and the trapper
  wins only when no cat can move; `anyCatch` removes an escaping cat
  (`cats.splice`, `escaped += 1`, selection re-clamped, play continues),
  the cat side wins when `cats` empties, and the trapper wins when any
  remaining cat is stuck at the start of the cat turn. `syncSelection`
  (auto-select the only movable cat; keep the selection when it can
  still move) runs at newGame and whenever applyBlock passes the turn.
  applyCatMove resolves the mover as selected-first, else the lowest
  index that reaches the entry (two cats reaching the same cell produce
  an identical position either way).
- **AI**  `chooseAICat(state, rng)` (pure) returns which cat moves —
  escaper first, then an enclosed cat with a hammer rescue plan, then
  most-endangered (`anyCatch`) / best single-cat eval (`anyEscape`) — and
  the controller applies it with `selectCat` before the unchanged
  single-cat `shouldUseItem`/`chooseCatMove` run on the selected cat.
  chooseCatMove additionally takes any in-one-move escape immediately
  for any cat, and Hard runs `multiCatAlphaBeta` (moves generated only
  for the two most relevant cats; the search's action is played only
  when the selected cat can make it). Trapper: `multiCatCandidates`
  builds the goal's list — `anyEscape` the union for the two smallest-dist
  cats, `anyCatch` the easiest-to-trap cat's empty neighbors then its
  shortest-route cells — truncated to K for both goals (the union cap
  keeps Hard inside its budget), scored against the target cat with the
  existing normalChoice/brittle discount; `shouldUseItem` arms the double
  against the goal-relevant cat's dist.
- **hard depth fallback**  measured over L17–20 (both courses, 3 cats on
  L19/L20): 2-cat Hard stays at depth 3; with 3 cats the tree is ~3×
  wider, so Hard drops to **depth 2** (`HARD_DEPTH_3CATS`) and every
  measured move (cat and trapper) answers in well under 100 ms. The
  budget test warms up the JIT first and best-of-retries, because vitest
  runs the test files in parallel and wall-clock spikes on scheduler
  noise, not on the AI's cost.
- **controller**  the cat player now selects-then-moves: clicking a cat
  cell calls `ruleset.selectCat` and re-highlights that cat's moves
  (cat cells are never legal move entries, so the flows cannot
  collide); clicking a destination applies through the existing path.
  The AI cat turn calls `ruleset.chooseAICat`+`selectCat` before arming
  / moving, and `showHint` prefers `ruleset.hintPath` (the gimmick-aware
  route of the goal's relevant cat: smallest dist for anyEscape, most
  endangered for anyCatch). basicRuleset stays byte-identical (no
  selectCat/chooseAICat/hintPath).
- **play layer**  `resolveGame` level play passes `cats`/`catsGoal` from
  the 14.3 tables into the gimmick options; streak play forces `cats: 1`
  (the rep levels are L3/L10/L17 — L17 counts as one cat, 13.7).
  `npm run balance` (scripts/balance.mjs) replays L17–20 of both courses
  with the greedy AIs and prints catWin rates / average moves for the
  designer's block tuning.
- **UI/rendering not in this task**  the status-line goal text
  (`どれか逃げればOK・3匹` …), result strings, intro cards and the
  one-catView-per-cat rendering (colors `#f39c34`/`#9aa5b1`/`#ffffff`,
  selection ring, run-off animation) belong to the follow-up UI/render
  task; the game logic, AI and controller flow are complete and tested
  headlessly.
- **test disclosure**  new `test/gimmickCats.test.js` (31 cases: setup,
  mutual blocking incl. tunnel/ice/spring, both goals, selection,
  AI target choice, Hard <100 ms on L17–20, a full greedy L20 game) and
  a `multi-cat play (13.7)` describe in controllerRuleset.test.js
  (select-then-move, anyCatch flow, AI cat choice, auto-select,
  hintPath). setup.test.js expectations gained `cats`/`catsGoal` (level
  play) and `cats: 1` (streak). All basic tests and the pre-existing
  gimmick tests pass unchanged.


### Tasks 21-22: 14.5 comeback gimmicks + 14.6 level difficulty
- **power gauge**  `state.power` (0-6) is per cat side, per game, and only
  exists where the level table switches it on. Pips: +1 per cat-side
  move (+1 more when *that move* started with <= 2 empty neighbors — for
  dash steps each step reads its own start cell), +2 the moment the
  trapper arms a double. Spending happens **at use**, not at arm time:
  the dash pays 4 on its first step and the jump pays 6 on the jump, so
  arming/cancelling is free exactly like the hammer (14.1).
- **dash**  armed with `armKind:'dash'` + `dashLeft: 3`; every step is a
  normal move (tunnels/ice/springs/items/fish all trigger), the turn
  stays with the cat while steps remain and the mover still has a move,
  and the dash ends at once on an edge (catWin), via the `stopDash`
  (ここで止める) action, or when the steps run out. `disarmItem` ignores a
  dash in motion (it could otherwise rewind the turn for free).
- **corner jump**  `jumpTargets` allows the jump only with the feature,
  the full/pending 6 pips and <= 2 empty neighbors (other cats count as
  occupied); the middle cell must be a **block** (not a cat) and the
  landing must be on-board, empty and `canEnter`-legal. History kind is
  `jump` (or `pickup`/`fish` when the landing cell pays out). While the
  jump is armed the normal moves stay legal — clicking one cancels the
  jump for free, mirroring the armed-hammer move.
- **trapper-win exception**  `evaluateStatus` (single and both multi
  goals) treats a cat with no legal move as alive while `jumpRescue`
  holds (feature + power 6 + a landing). The AI then *must* jump;
  `chooseAICat` also selects a stuck-but-rescuable cat.
- **features**  come from `levels.js#levelFeatures(course, level)`:
  escape L3 dash / L7 jump / L11 storm, trapper L13 dash / L15 jump,
  never a storm in the trapper course — and stay on for later levels.
  Only level play passes them (streak uses the representative level
  gated by the highest unlocked level, like the gimmick counts); without
  the option every flag is off, so all pre-14.5 fixtures behave exactly
  as before.
- **dried fish**  new kind `KIND_FISH = 8`, placed between ice and arrow
  (unlock 9, `UNLOCKS.fish = 9`), not blockable, counts as an item for
  the eval's "item within 2" so the trapper guards it the same way. The
  skip is a `state.trapperSkips` flag consumed at the next
  cat -> trapper turn transition, so a fish landed *during* a dash
  still skips the trapper's turn after the dash ends. A skipped trapper
  turn runs no brittle timers and does not reset `hammerUsed` (at most
  one hammer per double-turn).
- **storm**  fires inside applyBlock/applyCatMove (before
  evaluateStatus, so a rescued cat keeps playing) the first time any cat
  has `dist == -1`; removes 3 seeded blocks (`state.seed` +
  `moveCount`-mixed mulberry32) that are never next to any cat, stores
  the indices in the transient `state.storm` and sets `stormUsed`. The
  controller toasts `storm` and awaits `view.animateStorm?.(indices)` —
  both optional-chained, so the render/UI task wires the toast text and
  the spin-and-fade.
- **search**  cloneNode copies power/features; the cat side of both
  alpha-betas gains dash actions (a greedy <= 3-step rollout per first
  move, top 3 by edge/dist) and jump actions (top 3 landings), and a
  stuck cat is only terminal when no full-gauge jump can save it
  (`gimmickEval` scores the best jump landing instead of -10000). Fish
  cells clear on pickup in the search but the trapper skip is not
  modelled (accepted approximation).
- **AI**  `shouldUsePower` returns 'jump' whenever the cat is stuck or
  (normal/hard) enclosed and a landing reconnects it — a stuck cat jumps
  even into another pocket, because that is the only way the game can
  continue (the status is "playing" thanks to the rescue exception);
  easy only jumps when stuck and never dashes. A dash is taken when its
  rollout reaches an edge or ends >= 2 `dist` below the best single
  move. The trapper arms a double next to a gauge >= 5 cat on
  normal/hard. The controller arms power before items, exposes
  `usePower('dash'|'jump')` / `stopDash()` and feeds the hud through
  `hud.setPower(power, features, armKind, dashLeft)`; the gauge and the
  ダッシュ/ジャンプ/ここで止める buttons themselves belong to the UI task.
- **progress**  `stats[rules][course][level][difficulty] = {played, won}`
  (20 rows per course, every finished level game, no cap — the unlock
  wins keep their cap of 3); old saves without `stats` load as zeros.
- **balance/calibrate**  `scripts/sim.mjs` plays full level games: the
  opponent always plays the level's `ai`, the player side is the profile
  (weak = Easy, normal = Normal, strong = Hard) by swapping
  `state.difficulty` per turn, and both sides arm items and use the 14.5
  powers exactly like the controller flow. The player's stand-in
  inventory follows 13.8 verbatim (hammer from L2, double from L4) —
  note that the current unlock table still says hammer L16, so the
  designer may want to revisit that line. `npm run balance` fans the
  jobs over `os.cpus().length - 1` workers and `--write` emits both
  levelStats files (14.6 shape: `courses[course][difficulty] =
  {rate, blocks, avgMoves}` with the normal profile as `rate`, plus the
  three profile lines under `profiles`). `npm run calibrate` binary
  searches 0-40 blocks per setting with block-independent seeds
  (200 games/probe), makes the tables monotone (escape non-decreasing
  over level and difficulty, trapper non-increasing, clamped to the
  neighbour), rewrites levels.js with a `// calibrated <date>` comment
  per table and regenerates both stats files; `--dry-run` prints the
  targets/achieved table (UNREACHABLE beyond +-7 points) without
  writing. The committed levelStats files come from the `--games 10`
  smoke run — the designer re-runs both scripts at their defaults.
- **flaky timing tests**  `test/aiTiming.js` warms up once, measures
  several moves and asserts median < 100 ms + max < 250 ms on **CPU
  time** (`process.cpuUsage` deltas): wall-clock medians of the Hard
  multi-cat search genuinely exceed 100 ms while the other test files
  grind their own Hard searches in parallel, but the AI's per-move
  compute stays inside the 100 ms budget.

## Implementation notes (tasks 23 + 24 — rendering/UI + i18n + chart)

- **AI-timing isolation**: every AI-timing assertion now lives in
  `test/perf/aiTiming.perf.test.js` (basic cat/trapper Hard, gimmick
  mid-game, L16 every gimmick, L17-20 multi-cat). `npm test` excludes
  `test/perf/**` (vite.config.js; the exclude lifts itself when the CLI
  filter mentions `test/perf`, so the spec's exact command works).
  `npm run test:perf` runs the folder with
  `--no-file-parallelism --pool forks --poolOptions.forks.singleFork`
  and asserts **wall-clock** median < 100 ms / max < 250 ms
  (`timeMoves` in test/aiTiming.js now returns `{wall, cpu}` and
  `expectFast` asserts the wall times). The timing `it` blocks in
  catAI/trapperAI/gimmickAI/gimmickKinds/gimmickCats keep their legality
  assertions but no longer measure time.
- **Bug 14.4-3**: `computeCameraFit` now inflates the radius by
  `1/(1-hudFrac)` and derives `targetZ` from the inflated visible half
  depth — the same formula as `computeOrthoBounds`. The old fit.test.js
  assertion `targetZ ∝ hudFrac` (linear) was replaced by the geometric
  one: `targetZ + hz ≈ radius·sin(vFov/2)` at 800×600 HUD heights.
- **animateCatPath**: `view.animateCatPath(cells, from?)` — the extra
  `from` argument (after the spec's `cells`) exists because
  `state.lastPath` never contains the origin cell; the controller passes
  it. Views without `animateCatPath` keep the `animateCatMove(from, to)`
  hop (old stubs/tests unchanged). A hammer break has an empty path and
  animates nothing (the old code hopped the cat onto the broken block).
  Tunnels = hop → shrink → appear at exit → grow; ice = a low slide over
  every traversed cell; springs = one high arc; everything else = hop.
- **Crumbles/storm**: `state.crumbles` is consumed after the trapper's
  block animation (`view.animateCrumble(i)`, toast `crumble`) and
  `state.storm` after every rules call (`view.animateStorm(indices)`).
  Both draw the already-removed blocks temporarily (shake/sink; spin/fade).
- **Gimmick render modules** (`src/render/gimmicks/*.js`): each is
  `{id, build(scene,i,state,ctx), update?(state), dispose(i)}`; the ctx
  adds `setCellStyle(i,{material,scaleY,y})` so stone/ice/brittle style
  the cell itself under the interactive overrides, while tunnel/fish/
  arrow/spring/item build decoration meshes. The item octahedron, its
  bobbing and the pickup animation moved from boardView into the item
  module (`boardView.animatePickup` delegates). Tunnel pair colors cycle
  `#b06cff/#2ec4b6/#ff6fb5` by `min(i, partner) % 3`.
- **Multi-cat views**: one `catView` per cat (colors `#f39c34`, `#9aa5b1`,
  `#ffffff`), a soft cyan ring under the selected cat, `view.syncCats`
  reconciles positions/hides escaped cats after selection changes and at
  every turn start. The controller calls `syncCats` after `selectCat`
  clicks and AI cat choices.
- **Multi-cat result strings** (both courses, ja/en/es/fr/de/ru):
  anyEscape → trapper course `mcEscaped`/`mcCaughtAll`, escape course
  keeps `catWinEscape`/`trapperWinEscape`; anyCatch → catWin
  `mcAllEscaped`, trapperWin `mcCaughtAll` (trapper course) or
  `mcStuck` with the stuck count (escape course).
- **Bug 14.4-2**: the result modal shows both sources as
  `+n ハンマー（ひろった）` and `+n ハンマー（ほうび）`; the picked count
  comes from the finished game's `history.filter(kind==='pickup')`
  (escape course only — the trapper's inventory never grows mid-game).
- **Difficulty select in level play** (14.6): the HUD no longer hides
  `#difficulty-control` for level play; it changes only the initial
  blocks (the AI/gimmicks come from the level table).
- **Power gauge** (14.5): `#power-bar` (6 pips, ダッシュ/ジャンプ/
  ここで止める) renders from `controller.state`; the buttons use the new
  `controller.canUsePower(kind)` so they are enabled only when
  affordable **and** legal. The stop button appears while a dash is
  armed.
- **Intro cards** (`src/ui/introCard.js`): shown from main.js the first
  time a level with `intro` starts (`hasSeenIntro`/`recordIntroSeen`);
  the OK button reuses the `close` string. Level cards show small SVG
  icons for every gimmick present plus the storm feature and the cats
  count; the chart markers use the same icon set on the `intro` levels.
- **streakUnlockHint** (`レベル攻略でギミックを解放しよう`) is appended to
  the level-select inventory line while the browsed course's highest
  unlocked level is below the first gimmick unlock.
- **Difficulty chart** (`src/ui/difficultyChart.js`): inline SVG via DOM
  calls. `chartModel(stats, course, progress, opts)` is pure; `opts` is
  `{rules, current, playerDifficulty}` (the UI adds a `getCourse` hook
  so the chart follows the browsed course tab, and the 易/普/難 toggle
  defaults to the settings' difficulty). Lines: easy dotted `#199e70`,
  normal solid `#3987e5`, hard dashed `#d95926`; the player's dots are
  neutral (ring in the HUD text color, filled with the toggle's line
  color at 40 %) with radius 4/6/8 by sample size. The tooltip joins
  `chartTooltip` + moves + `chartTooltipYou` + `chartTooltipNew` with
  `・`; the summary helper compares the level-weighted player mean with
  the easy/hard means (above/between/below). Clicking an unlocked
  column selects that level; locked levels do nothing.
- **i18n** (13.9): `src/ui/i18n/{ja,en,es,fr,de,ru}.js` are flat tables
  with identical keys (glossary comment at the top of each). strings.js
  is now the loader: `STRINGS`, `LANGS`, `LANG_NAMES`, `getStrings`,
  `detectStrings` (kept), `detectLang` (prefix, fallback ja), `fmt`,
  `plural` (Intl.PluralRules), `formatEntry` (plural-aware fmt),
  `getLang`/`setLang`/`onLangChange` and a live `strings` Proxy. Russian
  counted strings (`winCount`, `mcStuck`, `rewardPicked`,
  `rewardBonus`, `goalAnyEscape`, `chartTooltipMoves`) are
  `{one, few, many, other}` objects. Settings gained `lang` (saved,
  navigator-first detection, ja fallback); the language select in the
  top bar switches every label at once, updates `<html lang>` and the
  level select, and never restarts the game.
- **Tests added/updated**: `test/viewIntegration.test.js` (path
  animation, break-without-move, tunnel path + toast, ice toast,
  crumbles, syncCats, canUsePower), `test/i18n.test.js` (key/placeholder
  parity, ru plurals, detectLang, switching without restart),
  `test/chart.test.js` (chartModel + fake-DOM SVG: 20 points/line,
  click-to-select, toggle/summary), `test/introCard.test.js`; ui.test.js
  gained the power gauge / goal line / multi-cat result / picked-reward
  cases and was updated for the lang setting, the six languages and the
  visible level-play difficulty select; fit.test.js updated for 14.4-3;
  hud.test.js's element stub grew the new IDs.


## Implementation notes (Rev. 5.2 — dash nerf + calibration pool fix, 15.1 / 15.2)

- **Dash (15.1)**: `DASH_COST` 4 → 6 and `DASH_STEPS` 3 → 2 in
  `src/game/gimmick/gimmickRules.js`. Everything else in 14.5 is
  untouched: the dash still pays on its first step, keeps the turn while
  steps remain, and ends at once on an edge / a dead end /
  `ここで止める`. Dash and corner jump now both cost the full 6-pip
  gauge, so the player (and the AI) choose which one to spend a full
  gauge on. The AI conditions are unchanged (`shouldUsePower`: jump for
  a stuck/enclosed cat first, then a dash whose plan reaches an edge or
  ends ≥ 2 `dist` below the best single move); with only 2 steps the
  "gains ≥ 2 dist" branch is practically reachable only through
  gimmick teleports — a 2-step dash can improve `dist` by at most 1 over
  a single move on a plain board. UI: the `dash` label and the dash
  toasts show the step count in all six languages (`ダッシュ（2マス）`,
  `Dash (2 cells)`, …) and `index.html`'s fallback label matches.
- **The pool bug (15.2)**: `scripts/pool.mjs` fanned the jobs out
  round-robin over the workers and then flattened the per-worker result
  chunks, so `calibrate.mjs` — which matched `results[i]` to `owners[i]`
  — fed the binary search a *permutation* of the probe results.
  Neighbouring probes therefore reported unrelated rates (0 % next to
  100 %) and the search wandered off the monotone response (105/120
  settings UNREACHABLE, pinned at 0 or 40 blocks). `simulate()` itself
  was always correct and deterministic; only the job↔result matching was
  broken. Fix: every job carries its full setting key (`jobKey` in
  `pool.mjs`), the worker echoes `key` and `index` back, `runJobs`
  rebuilds the result list in job order and asserts the echoed keys, and
  the batched search matches results **by key** in the new
  `calibrateLib.batchedSearch` (a missing, duplicated or foreign key
  throws). `calibrate.mjs` is now a thin wrapper around it.
- **Draws**: every calibrate probe prints `draws n/games` and the final
  table gained a `draws` column (the best probe's count); the balance
  report prints the normal profile's draw count per level. A draw (move
  cap or no legal move) is visible everywhere and never silently counted
  as a loss.
- **Tests**: `test/gimmickPower.test.js` (dash needs the full 6 pips, at
  most 2 steps, drains the gauge on its first step; tunnel / ice / fish /
  `ここで止める` / AI cases retimed to 2 steps, AI dashes only from 2
  cells off the edge), `test/viewIntegration.test.js` (arm with 6, 2
  steps), `test/balance.test.js` (the pool with 2 workers returns exactly
  the `{wins, draws, avgMoves}` of in-process `simulate()` for 3 settings
  × 3 block counts × 10 games; `batchedSearch` finds the right blocks on
   a monotone synthetic stub, still matches by key when the probe returns
   shuffled results, and rejects foreign keys). `npm test` (428 tests) and
   `npm run test:perf` pass; `node scripts/calibrate.mjs --games 5
   --dry-run` now agrees with direct `simulate()` calls.

## Implementation notes (task 25)

- **`hardnessDirection(course)`** lives in `src/game/play/blocks.js` and
  is the only place that decides "more blocks = harder" (+1 escape, -1
  trapper). `calibrateLib.monotoneize`/`increasingFor`, `buildRanges`,
  `isotonicBlocks`, the slider and the chart all call it; no course
  direction is hard-coded anywhere else.
- **`state.placedBlocks`** (16.1): `gimmickRules.newGame` records the
  `count` it ends with (the retries lower it by 1), and both basic paths
  in `rulesets.js` do the same — the explicit-blocks loop records the
  lowered `count`, the legacy `rules.js` path counts the blocked cells,
  so `rules.js` stays untouched. `playGame`/`simulate` expose it as
  `placed` (a mean over the games) and the sweep stores it per probe;
  `levelStats.courses[...].blocks` reports that placed mean.
- **Sweep** (`scripts/sweep.mjs`, `npm run sweep`): coarse = every even
  count 0–60 × 100 games, fine = every integer inside the calibrated
  ranges × 200 games (`--pass fine`, the ranges are read from `levels.js`
  with a center ±2 fallback while it is uncalibrated). Output is JSON
  lines in `scripts/out/sweep.json` (gitignored, not bundled), appended
  batch by batch so a killed run resumes; the probe key includes
  rules/course/level/profile/blocks/games/seed, so `--games` changes the
  key and a smoke run never shadows a real one. `--report` prints the
  levels × counts matrix in %, `--levels 1-2`, `--max-blocks` and `--out`
  make smoke runs cheap, and an ETA prints every 30 s. Importing the
  module has no side effects (`main()` only runs when executed directly),
  which is what the resume test drives. The sweep passes `difficulty:
  'normal'` on every job: it varies the block count itself, and
  `difficulty` only takes part in the seed key.
- **Calibration** (`scripts/calibrate.mjs`) no longer simulates: it reads
  the sweep, isotonic-smooths the `normal` profile per (course, level) in
  the course's direction, picks the center whose smoothed rate is closest
  to the 14.6 target, makes the table monotone (14.6 behavior, now
  direction-driven) and builds the ranges. `--games N` is now a **minimum
  games-per-probe filter** (default 1), `--sweep <file>` picks the input,
  `--rules gimmick|basic` picks whose data calibrates the table
  (gimmick by default) and `--dry-run` is unchanged. Levels without sweep
  data keep their table centers and the report says `no data`; the
  ±7-point UNREACHABLE test uses the smoothed curve's best deviation.
- **Ranges** (16.2): half-width = round(gap to the nearest center / 2),
  clamped to ±2..±5, then each adjacent pair is shrunk so the two ranges
  can only meet at most — non-overlap wins over the ±2 minimum when the
  centers are closer than 4 blocks (a tie then yields a zero-width
  range). The order follows the table: escape `easy < normal < hard`,
  trapper `hard < normal < easy`, both ascending in block counts.
- **`levels.js`** keeps its `B(n)` helper until the first real
  `npm run calibrate`; `rewriteLevels` understands both `B(n)` and the
  expanded object form and inserts (or replaces, never stacks) the
  `range: {…}` object next to `blocks`. Until a calibration is committed
  the ranges are absent and the game falls back to center ±2, which is
  also the streak range around `INITIAL_BLOCKS`.
- **`levelStats.json` / `.basic.json`** gained
  `curves[course][profile] = [{blocks, rate, avgMoves, games} ×20]` (every
  measured count of the sweep); `courses`/`profiles` keep the 14.6 shape
  at the calibrated centers, and centers without sweep data carry the
  previous file's numbers over.
- **Slider** (16.3): `#blocks-control` in `index.html`, wiring in
  `hud.js` on top of the pure mapping in `blocks.js` (`sliderBlocks` /
  `sliderPosition`, right = harder in both courses: escape → more blocks,
  trapper → fewer). The counts live in their own localStorage key
  (`catescape.blocks`, one slot per `rules.play.course.level.difficulty`),
  so the settings round-trip is untouched; the effective count travels as
  `blocks` on `hud.getSettings()` into `resolveGame` (new optional
  `blocks` override — center behavior is unchanged when it is absent) and
  into `recordResult`. Dragging updates the label, releasing starts a new
  game. The label shows `ブロック n個 · 見積もり r%`; the estimate
  interpolates the level's `normal` curve and falls back to the three
  difficulty rates at their centers while no sweep has been run (streak
  play uses its representative level, `STREAK_LEVEL`).
- **Stats** (16.3): `stats[rules][course][level][difficulty]` is now a map
  of block count → `{played, won}`; old saves migrate onto the level's
  center on load, the chart dots aggregate over the buckets
  (`sumStatCell`), and a win at any count still counts toward the 3
  unlocks. Streak keys append `@n` when the count is not the center, and
  `sanitize` accepts the suffix.
- **Chart** (16.2): the tooltip gained the three block ranges
  (`chartTooltipBlocks`, translated in all 6 languages), built from
  `levelRange` (the calibrated range, or center ±2).
- **`npm run balance`** is unchanged — it still measures at the current
  table centers; the sweep + calibrate pair replaces only the calibration
  path, and the old binary-search helpers stay in `calibrateLib.mjs`
  (still covered by `test/balance.test.js`) with `BLOCKS_MAX` raised to60.
- **Tests**: `test/blocks.test.js` (direction, level/streak ranges,
  slider mapping in both courses, the settings key),
  `test/calibrateSweep.test.js` (isotonic smoothing in both directions,
  `pickCenter`, ranges: order per course / no overlap / ±2..±5, the
  `levels.js` rewrite incl. stale-range replacement),
  `test/sweep.test.js` (coarse and fine count lists, resume: finished
  probes are skipped, broken lines are dropped, the strongest record
  wins, the report matrix, `assembleSweepStats` curves), plus 16.3 cases
  in `test/balance.test.js` (per-count buckets, `@n` streak keys,
  `placedBlocks`) and `test/ui.test.js` (slider defaults, right-is-harder
  per course, per-setting persistence). `npm test` (467 tests) and
  `npm run test:perf` pass; smoke: `node scripts/sweep.mjs --games 2
  --levels 1-2 --out scripts/out/smoke.json` followed by
  `node scripts/calibrate.mjs --sweep scripts/out/smoke.json --dry-run`
  (a full write was also verified against a backup copy of `levels.js`
  and both stats files, then restored).

## Implementation notes (task 26)

Rev. 6 (spec 17) — juice: animation, particles, shaders + the three UI
fixes. Rendering/UI only; `src/game/**`, `scripts/`, `levels.js` and the
`levelStats*.json` files were not touched (the balance sweep owns them).

- **fx architecture**: `src/render/fx/` holds `fxManager.js` (one
  instance per scene, created inside `createView`), `particles.js`,
  `shaders.js`, `post.js`, `tween.js`, `shake.js` and the pure
  `fxPlan.js`. The controller still only sees the view interface: every
  view call (`animateBlock`, `animateCatPath`/`animateCatMove`,
  `animatePickup`, `animateBreak`, `animateCrumble`, `animateStorm`,
  `animateResult`, `setHighlights`, `setHover`) turns into
  `fx.onViewCall(name, args, {board})`, which plays the `fxPlan`
  descriptors (counts and durations per quality, spec 17.5).
- **Quality setting**: the top-bar select `演出` (fxLabel/fxHigh/
  fxMedium/fxLow, translated in all 6 languages) is saved in the
  `catescape.settings` key as `fx`; the default is `high` on desktop and
  `medium` when `navigator.maxTouchPoints > 0`. `prefers-reduced-motion:
  reduce` is detected once in `fxManager` (matchMedia): it disables
  shake + camera punch (`isShakeAllowed`, tested) and caps the quality
  at `medium` (`clampFxQuality`, tested). Changing the select never
  restarts the game; it flips the glow/post/tile-shader features live.
- **Budgets** (17.1): high = 2,000 live particles + post + glow; medium
  = 800 + glow, no post; low = 250, no glow/post/custom tile shader
  (StandardMaterial tiles). `scaleCount` shrinks every nominal count
  (×0.4 medium / ×0.2 low). The particle pool returns systems to their
  pools after their lifetime (`scene.particleSystems.length` stays
  bounded); shards and shockwave rings are small mesh pools with a
  hand-rolled gravity/fade in the pool update.
- **Particle atlas**: one 256×128 `DynamicTexture` (soft dot, star,
  confetti square, shard, heart, leaf, snowflake, ring) drawn once per
  pool; each pooled `ParticleSystem` gets a UV-offset `clone()` of it
  (disposed back on release). The full 17.3 table is implemented;
  `afterimages`/`ripple`/`blockLift` are mesh-level effects owned by the
  cat/board views, so their descriptors are intentionally no-ops in the
  manager.
- **Animation polish** (17.2): hops gained anticipation squash (y 0.85),
  air stretch (1.15/1.18) and a 180 ms elastic landing settle
  (`easeOutElastic`); idle cats breathe (±2 %, 2.4 s), sway the tail,
  twitch an ear every 3–6 s (seeded per cat index) and turn the head
  toward the hovered cell (`view.setHover` feeds `setLookTarget`).
  Blocks now drop from y+3 with `BounceEase` (~300 ms) instead of
  rising, and a placement next to any cat adds the 120 ms / 0.08 shake.
  Hovered tiles lift by 0.08; highlighted cells breathe 0.15 ↔ 0.35 via
  the shader uniform (or the shared material on low). Escape plays a
  happy hop + `TrailMesh` speed lines + confetti + camera punch-in;
  trapped cats droop their ears, sweat and desaturate (custom post).
- **Shaders** (17.4, GLSL in JS strings, no eval — CSP intact):
  `FxTile` (grass gradient + per-cell hash noise + rim light + exit
  pulse + highlight/hover uniforms + `rippleOrigin`/`rippleTime` ring),
  `FxIce` (fresnel + moving specular streak, applied by the ice
  renderer at high/medium), `FxPortal` (polar-UV swirl on the tunnel
  disc, additive, in the pair color) and the two post shaders
  `FxShockwave` (radial distortion, fired on the result moment and the
  corner jump, high only) and `FxDesat` (trapped fade). Items keep a
  `FresnelParameters` emissive rim for the glow layer.
- **Post/glow** (post.js): `DefaultRenderingPipeline` (bloom threshold
  0.8 / weight 0.35, FXAA, vignette) at high; `GlowLayer` at high and
  medium; the shockwave post attaches per shot and detaches when idle.
- **Double-armed ring / power aura**: the HUD pushes them through two
  new optional callbacks (`onDoubleArmed` in `attach`, fired from
  `setInventory` and from the `aiDouble` toast; `onFxQuality`) — the
  controller is still fx-free. The power-full aura (emissive ring +
  orbiting sparkles) follows `state.power` via `view.syncCats`.
- **Small UI fixes**: (1) the difficulty-chart legend is now a wrapping
  flex row (`#chart-legend`) above the plot instead of an in-SVG row —
  no overlap for `むずかしい`/`あなた` at 360 px or 800 px in any
  language; (2) level cards use the dark HUD surface (`#223244`) with
  primary/secondary tokens (≥ 4.5:1), the current card keeps the accent
  border and locked cards are dimmed; overlay buttons (tabs, close,
  chart) got the same dark treatment (the UA white buttons were
  unreadable); (3) the game-number label: ru `Сид` → `Номер партии`, fr
  `Graine` → `Numéro de partie` (ja `シード`, de `Seed`, es `Semilla`
  are the conventional terms in those languages and stay).
- **UI juice** (CSS): buttons press to 0.96 and lift 1 px on hover
  (disabled under reduced motion), power pips pop in 0 → 1.2 → 1, the
  full gauge pulses (`#power-gauge.full`), and toasts slide in from the
  top with an ease-out-back curve.
- **Tests**: `test/fxPlan.test.js` covers fxPlan for every view call ×
  every quality (including the reduced-motion omissions), the quality
  helpers/budgets, every easing function (endpoints + overshoot), the
  tween list (delay/complete) and the shake envelope; `test/chart.test.js`
  gained the legend-row layout case; `test/ui.test.js` settings
  persistence now includes `fx`. `npm test` (486 tests) and the build
  pass; the main bundle grew 299.68 → 378.47 kB gzip (+78.8 kB, budget
  ≤ 250 KB). `npm run test:perf` measures only `src/game/**` (untouched
  here) and fails its 100 ms wall-clock budget on this machine while the
  balance sweep is running — unrelated to this change.

### Fix pass after the designer's browser check

The designer's browser test found the game dead on load:
`engine.createDynamicTexture is not a function` at `buildAtlas`
(particles.js), then `tex.getWidth is not a function`. Audit result —
two bug classes, all fixed:

- **Missing side-effect imports (tree-shaken build)** — the class
  modules import most of these themselves, but a bundler may drop
  side-effect-only imports, so they are now pinned next to the usage:
  - `particles.js`: `Engines/Extensions/engine.dynamicTexture.js`
    (the reported crash), `Particles/particleSystemComponent.js`
    (`engine.createEffectForParticles`), `Shaders/particles.vertex.js`
    and `Shaders/particles.fragment.js`.
  - `post.js`: `Engines/Extensions/engine.renderTarget.js`
    (`engine.createRenderTargetTexture` for the glow/bloom/post targets),
    `Layers/effectLayerSceneComponent.js` and
    `PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent.js`.
  - No shader-store imports were needed for the post pipeline, glow or
    particles beyond the above: Babylon 8's `Thin*` classes load their
    shaders through `_gatherImports` dynamic imports (bundler chunks).
- **Nonexistent / removed Babylon APIs** — checked against the
  installed `.d.ts` and the runtime prototypes:
  - `DynamicTexture.getWidth()/getHeight()` do not exist → the atlas
    clear uses `tex.getSize()`; also `DynamicTexture.clone()` allocates
    a fresh *empty* canvas, so the per-system texture clones would have
    drawn nothing → the atlas is now 8 shared cell textures, never
    cloned, never disposed mid-game.
  - `PostProcessRenderPipeline.setEnabled()` and
    `EffectLayer.setEnabled()` do not exist in Babylon 8 → quality
    changes dispose the pipeline/glow and recreate them on demand.
  - `imageProcessing.vignetteCameraMode` does not exist → dropped
    (the vignette is enabled + weighted instead).
  - `createDesatPost.fade()` re-attached a non-reusable `PostProcess` →
    detach-then-attach, like the shockwave.
- **Fail-soft everywhere**: `createView` wraps `createFxManager` and
  falls back to a no-op fx stub; the pool, the atlas cells, the shard /
  ring meshes, the aura rings, the post pipeline / glow / shockwave /
  desat, the tile-shader materials (`makeTileMat` → null →
  StandardMaterial fallback), the ice / portal shaders, the cat trail,
  the dash ghosts and the spring coil squash all log **once** through
  `fx/fxLog.js` (`fxWarnOnce`) and disable only themselves. Every
  render-loop observer (fx manager, board view uniforms, cat tick) runs
  inside try/catch so a broken effect can never stop the render loop or
  the game from starting.
- **Tests**: `test/fxImports.test.js` imports every `src/render/fx`
  module on Node and asserts the pinned side-effect import list
  (engine dynamicTexture extension, particle component + shaders,
  render-target extension, scene components) and the absence of the
  removed APIs. `npm test` 493/493 and `npm run build` pass (main
  bundle 386.51 kB gzip after the pins, +86.8 kB vs the pre-task-26
  baseline, budget ≤ 250 KB); the built bundle was verified to contain
  all three engine patches.

## Implementation notes (task 27)

Rev. 7 (18.1–18.5) decisions that the spec text left open:

- **18.1 shape/migration**: every level now stores
  `blocks: { basic: {easy,normal,hard}, gimmick: {…} }` (the `BB(n)`
  helper seeds both kinds from the same 14.3 value) and, once
  calibrated, `range` with the same nesting. `blocksFor(lv, difficulty,
  rules)` and `levelRange(lv, difficulty, course, rules)` default to
  `gimmick` and still read the pre-18.1 shared shapes (`{easy,…}`,
  `B(n)`, plain number), so old fixtures keep working. `resolveGame`, the
  HUD slider, the chart tooltip/estimate, `progress`'s per-count stat
  buckets and every script now pass the active rules kind.
- **18.1 L17–20**: the multi-cat levels keep their current table numbers
  (migrated into both kinds). The "block overrides are dropped" bullet is
  satisfied by letting `npm run calibrate --rules <kind>` set L17–20
  from the fresh sweeps instead of hand-tuning; no sweep or calibration
  ran in this task.
- **18.1 calibrate/sweep**: `calibrate.mjs --rules` rewrites only that
  kind's `blocks`/`range` — the other kind is parsed out of the existing
  line and written back verbatim, and a kind without its own `range`
  entry keeps falling back to center ± 2 (`rewriteLevels` gained a `rules`
  argument plus line parsers for all shapes). The regenerated
  `levelStats` files read the calibrated kind's fresh centers and the
  other kind's untouched table entries. `sweep.mjs` gained
  `--rules gimmick|basic|both` (exported `parseRules`); `planProbes'`
  `countsOf` now receives `(rules, course, level)` and `fineCounts`
  reads the per-rules ranges.
- **18.2 zero-free-cat turns**: when the trapper's turn would start with
  no movable cat (the mover jumped/slid itself into a dead pocket), the
  empty turn passes straight back to the cat side, where the status
  check ends the game exactly as before (`beginTrapperTurn` →
  `endTrapperTurn`, brittle timers included). The budget counts cats
  with **legal moves only** — a full-gauge corner-jump rescue does not
  count as free.
- **18.2 the double**: arming mid-turn recomputes `blocksLeft` from the
  *current* free cats + 1, so the double always adds exactly one block;
  cancelling restores the free-cat budget (the item stays spent). The
  controller needed no change — its per-turn re-entry already handles
  multi-block turns (like the old double). The HUD status line shows
  `あと {n} 個置ける` (`blocksLeftLine`, all 6 languages, ru with plural
  forms) while the trapper player has budget left.
- **18.3 search model**: the alpha-beta power projection charges every
  normal step, dash step and jump with the real ≤ 3-empty-neighbor rule
  (it used to grant a flat +1 per dash step and +2 per jump), so the AI
  prices the slower recharge correctly.
- **18.4 adjacency**: "not adjacent to any cat" is judged by the
  **post-move** positions — the mover counts from the fish cell it
  landed on, and under `anyCatch` an already-escaped cat never counts.
  The crumbled index rides the existing `state.crumbles` list, so the
  view's `animateCrumble` plays unchanged; the controller toasts the new
  `toastFish` (`にぼしで ブロックが ひとつ くずれた！`, 6 languages) only
  when a block actually crumbled, and the old trapper-skip state
  (`trapperSkips`) is gone. The intro card text (`introRuleFish`)
  describes the new effect; the AI still values fish cells as before.
- **Tests**: `npm test` 514/514, `npm run test:perf` 6/6 and
  `npm run build` pass.

## Implementation notes (task 28)

- **18.6 monotone fix** — `calibrateLib.monotoneize` became `orderCenters`:
  it only orders the three centers *inside* one level (easy → normal →
  hard in the course's hardness direction) and no longer touches the
  across-level axis, so a best block count that drops at L7/L14 (the AI
  step) survives into `levels.js`. The across-level check moved to the
  achieved rate: `nonMonotoneRises(rates)` flags any step up of more
  than `RATE_RISE_TOL` (3 points) between consecutive levels (skipping
  levels without data), and `calibrate.mjs` prints those as
  `NON-MONOTONE` — reported for the designer, never clamped. Range
  building (`buildRanges`) already guaranteed non-overlapping ranges in
  the 16.2 order and is unchanged. No sweep or calibration ran in this
  task; `npm test` 516/516.

## Implementation notes (task 29)

Rev. 8 (19.1-19.4). The designer's draw report was reproduced first with
`scripts/sim.mjs` (L19 escape + trapper, gimmick rules, 20 games per
setting) and the root causes were recorded before any fix:

- **`trapper -1` draws**: the board had run out of blockable cells while
  enclosed cats still paced pockets of unblockable gimmick cells
  (springs/tunnels/stones) — the sim's `break` on `-1` scored a draw.
- **`MAX_STEPS` draws**: (a) brittle blocks ON the only route crumble
  after 3 trapper turns and the trapper re-seals them forever
  (brittle-enclosure recycling); (b) pockets made entirely of
  unblockable cells can never make a cat stuck, so the game could not
  end; (c) the trapper AI kept aiming at already-stuck cats
  (`urgencyOrder` sorted only by `dist` = infinity, i.e. by index) and
  at brittle cells that tie with permanent ones; (d) the cat AI never
  took a corner jump that reaches the edge (only stuck/enclosed cats
  jumped) and never walked to a hammer item inside its pocket.

**19.1** `trapperBlocksLeft`: `anyEscape` keeps one block per free cat;
`anyCatch` places 1 block per turn (+1 with a double), like a
single-cat game. **19.2** the spring `resolve` now also refuses the
jump when the middle cell `step(spring, dir)` is off-board, blocked or
occupied by another cat; the 6-language intro texts
(`introRuleSpring`) say the gap must be open. **19.3** `CAT_STARTS`:
2 cats (5,4)/(5,6), 3 cats (4,5)/(5,4)/(6,6).

**19.4 rule backstops** (all in `gimmickRules.js`):
- the trapper's turn is skipped at once when nothing is blockable
  (`beginTrapperTurn`, after every `applyBlock`, and the opening turn);
  `canUseItem`/`shouldUseItem` refuse a double in that state;
- `state.catStuckTurns` counts consecutive cat turns that began with
  no legal cat move; two in a row end the game for the trapper (a
  backstop beside the existing immediate stuck check, which still
  fires first);
- **sealed dead end** (the root-cause completion): when every remaining
  cat is enclosed and *nothing* can ever reconnect any of them to the
  edge, the trapper wins — no hammer break reconnects (hammers in
  inventory or gained later from an unpicked pocket item; every
  blocked cell at distance 2-3 from a pocket cell simulated one at a
  time), no full-gauge jump landing reconnects, and no pending
  brittle crumble reconnects (timers tick first, so a crumble that
  opens a route gets its chance). Chains of two dependent crumbles and
  fish-crumble targets are not modelled (documented approximation);
  the storm has always fired before this check runs.

**19.4 AI fixes**: `urgencyOrder` ranks cats with a legal move ahead
of stuck ones (the trapper stops aiming at finished cats);
`normalChoice`/`enclosedChoice` break equal-score ties in favour of
permanent (non-brittle) blocks so the brittle re-seal loop dies; the
cat side always takes a corner jump that reaches an edge
(`shouldUsePower`, plus `chooseAICat` selects that cat); an enclosed
cat first walks to a reachable hammer item (`bestAreaMove` via
`itemDistanceMap`) so its break plan can fire.

**Verification**: `test/rev8Draws.test.js` replays 11 logged draw
seeds (course/level/difficulty/profile/game) — every one now ends with
a result. A 20-games-per-setting probe of L17-L20 (both courses, three
difficulties, three profiles, 1440 games) shows **draws = 0**. The
calibration-fallout tests that pre-dated this task (setup, blocks,
chart, sweep, ui, balance, controllerRuleset) were updated to read the
calibrated centers/ranges dynamically instead of the old hard-coded
B(5)-era values. `npm test` 537/537, `npm run test:perf` 6/6,
`npm run build` pass.

## Implementation notes (Rev. 9 — play-flow UI)

The user's rule: **once a game has started, mode / play style / rules /
difficulty must not be changeable**, and the old top-bar-first UI is
debug-only, not the play flow.

- **Play bar** (`#top-bar`) — in-game controls only: level label
  (read-only), route button, camera / fx / language selects, the menu
  button and the debug toggle. None of these restart the game (camera
  and language already never did; menu opens the start wizard).
- **Debug bar** (`#debug-bar`, hidden by default) — the old axis
  selects (rules / play / mode / difficulty), the 16.3 block slider, the
  level-select button and あたらしいゲーム, moved out of the play bar.
  Toggled by `#debug-toggle` (always visible, `aria-expanded` +
  `aria-controls`); changing a select there still restarts the game —
  debug convenience, decided with the user (always-available toggle,
  not DEV-gated). The slider is debug-only now; the play flow uses the
  saved / center count.
- **Start wizard = the single entry** — no game starts behind the
  wizard anymore (the boot `startGame()` is gone; the DEV hook
  `window.__catescape` stays). The wizard seeds its defaults from
  `loadSettings()` on every root open and shows a one-line summary of
  the saved settings above つづき. The old L1-20 level dropdown became
  a 「レベルを選ぶ」 button that closes the wizard and opens the level
  select (`onOpenLevels(cfg)`); dismissing the level select without a
  pick returns to the wizard's setup step. Picking a level applies the
  wizard's pending config (rules / play / difficulty) together with the
  course + level.
- **`hud.applySettings(patch)`** — the missing piece behind the old
  wizard bug: `getSettings()` returns a copy, so `main.js` writing that
  copy to localStorage never reached the live settings until reload.
  `applySettings` merges a validated patch into the live settings
  (course follows role), persists, syncs the select values and refreshes
  the controls. The wizard's only settings path now.
- **Menu** (`#menu-btn` in the play bar, `#result-menu-btn` in the
  result modal) opens the start wizard (`hud.attach({onMenu})`); the
  in-play あたらしいゲーム button is gone (re-merge via つづき).
- **CSS restored** — commit `f208c85` had accidentally replaced
  `src/style.css` (727 lines of HUD / level-select / result / intro /
  chart styles) with only the wizard block; the full sheet was restored
  from `f208c85^` and extended with the debug bar, the menu buttons and
  the wizard summary/level-pick styles.
- **i18n** — new keys `menu`, `debugToggle`, `levelsPick` in all six
  languages; `de`/`fr`/`ru` were also missing the earlier wiz keys
  (`wizTitle`…`start`), which made the key-parity test fail — filled in.
- **Tests** — `test/ui.test.js` covers the debug toggle, the menu
  buttons and `applySettings` (values, persistence, ignore-unknown);
  new `test/startWizard.test.js` (minimal DOM stub) covers つづき
  enablement, seeding from saved settings, the level-pick button /
  `onOpenLevels(cfg)` payload, はじめる → `onNewGame(cfg)` and the
  root summary. `npm test` passes except a pre-existing wall-clock
  perf flake under the git-ignored `.claude/worktrees/` copy.

## Implementation notes (Bengal cat GLB)

- The cat visual is now `3d/bengal_cat_non_commercial.glb` (CC BY 4.0,
  osmanarici2004_1). It is loaded with `@babylonjs/loaders` and inlined
  (`?inline`) so the Electron `file://` build can load it without XHR.
- The export contains one merged 10.07 s clip rather than named clips.
  We use **8.00-10.05 s as the idle loop** and **1.55-7.98 s as the walk
  loop** (the author baked a walk around a circle). The root
  translation / yaw tracks are dropped so the walk plays in place;
  `catView` still owns the hop / slide / arc / tunnel / run-off transform.
- Movement uses the walk clip at a move-dependent speed. `catWin` plays
  the walk clip fast for the celebration + run-off; `trapperWin` plays
  the idle clip slowly with a sad forward tilt. The old procedural cat
  remains only as the fail-soft stand-in until the GLB has loaded (or if
  loading fails).

## Implementation notes (cat model options / animation)

- The cat visual is selectable in the play bar: `bengal` (the GLB) or
  `classic` (the original procedural cat). The choice is stored as
  `catModel` in `catescape.settings` and applied without restarting the
  game (`view.setCatModel` rebuilds the current cat roots).
- `catAnim` (on by default) turns the cats' idle / skeletal animation on
  or off from the play bar; gameplay transforms (hop arc, slide, tunnel
  scale, run-off) still play so moves stay readable.
- The Bengal is normalised to `TARGET_LENGTH = 1.7` (2× the previous
  0.85 footprint).
- The idle clip is not looped directly (that snapped back to frame 0 at
  the seam, and YOYO did not blend it either). Two idle instances play
  the clip; `SEAM_MS` (450 ms) before the end, the other instance starts
  at the first frame and the two cross-fade by animatable weight, so the
  end pose slowly blends into the start pose. `SEAM_MARGIN_MS` (100 ms)
  finishes the blend before the clip loops.
- Idle and walk cross-fade over 180 ms by animatable weight; the walk
  clip is the only movement clip in the GLB, so hop maps to `walk` and
  spring/arc/jump map to `jump` (same clip, faster speed ratio).
- All Bengal clips use `SPEED_SCALE = 0.5`.
- The Bengal cat casts a soft blob shadow (a radial-gradient `DynamicTexture`
  disc on the cell top). It only appears once the GLB has loaded, tracks the
  cat's position / yaw, shrinks and fades while the cat is airborne, and is
  disposed with the cat view. The classic procedural cat has no shadow.
