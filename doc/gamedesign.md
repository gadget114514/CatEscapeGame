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

**.github/workflows/pages.yml**: on push to main → Node 20, `npm ci`, `npm test`, `npm run build`,
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

## 11. Verification
- **Implementation (opencode)**:
  1. `npm test` passes the tests in section 10
  2. `npm run dev` → play both modes at all 3 difficulties in the built-in browser pane (win/lose, animations, hints, phone width)
  3. `npm run build && npm run preview` → check it runs on relative paths (simulating Pages)
  4. `npm run electron` → the same play works in the desktop app

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
- **Pages workflow** — `pages.yml` runs on push to `main`: checkout@v4,
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
