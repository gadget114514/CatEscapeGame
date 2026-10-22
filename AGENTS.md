# AGENTS.md — CatEscape

Trap the Cat (Chat Noir) + its reverse "Cat Escape". Babylon.js + Vite, packaged with Electron, deployed to GitHub Pages.

## Read this first
- **Spec: [doc/gamedesign.md](doc/gamedesign.md)**. Implement the tasks in section 10 in order, one at a time.
- Keep the module boundaries, function signatures, and data shapes from the spec.
- Record any decisions not covered by the spec under "Implementation notes" at the end of doc/gamedesign.md.

## Commands
```
npm install
npm test          # vitest run (must always pass)
npm run dev       # Vite dev server
npm run build     # dist/ (relative paths, base:'./')
npm run preview
npm run electron  # build, then launch Electron
```

## Rules
- `src/game/**` must not import Babylon.js or the DOM (pure logic, testable on Node).
- AI functions are pure functions of `(state, rng)` and never modify `state`. Randomness always goes through `src/game/rng.js` (seeded).
- Write tests in `test/` alongside each task. Don't move on to the next task until `npm test` passes.
- ES modules, 2-space indent, JSDoc types. No TypeScript.
- No external asset files (models, textures, fonts). Build everything procedurally so it works on file:// (Electron) and on GitHub Pages.
- Electron: `contextIsolation: true`, `nodeIntegration: false`. The main process is `electron/main.cjs`.
- Use only `@babylonjs/core` (ES module imports, so tree-shaking works).
