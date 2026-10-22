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
(opencode adds any decisions not covered by the spec here)
