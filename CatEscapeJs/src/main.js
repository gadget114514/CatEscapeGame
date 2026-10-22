/**
 * Entry point: createScene → fitCamera → createView → GameController →
 * bindHud → start.
 */
import { createScene, fitCamera } from './render/scene.js';
import { createView } from './render/view.js';
import { setupPicking } from './render/picking.js';
import { boardExtent } from './render/fit.js';
import { CELL_SIZE, CELL_GAP } from './render/boardView.js';
import { createBoard } from './game/board.js';
import { GameController } from './game/controller.js';
import { createHud } from './ui/hud.js';

const canvas = document.getElementById('game-canvas');
const { engine, scene, camera } = createScene(canvas);
const view = createView(scene);
const hud = createHud();
const controller = new GameController({ view, hud });

hud.attach({ controller, view });
setupPicking(scene, controller, view);

// camera auto-fit (Rev. 3): on startup and on every resize
const board = createBoard();
const extent = boardExtent(board.W, board.H, CELL_SIZE, CELL_GAP);
const refit = () => {
  engine.resize();
  fitCamera(camera, engine, extent);
};
refit();
window.addEventListener('resize', refit);

if (import.meta.env.DEV) {
  // dev hook for automated play-testing (Rev. 3)
  window.__catescape = { controller, view };
}

const settings = hud.getSettings();
controller.start({ mode: settings.mode, difficulty: settings.difficulty });

engine.runRenderLoop(() => scene.render());
