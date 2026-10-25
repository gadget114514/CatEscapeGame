/**
 * Entry point (Rev. 4): createScene → fitCamera → createView →
 * GameController → HUD + level select → resolveGame → start.
 * `onGameOver` records the result into the saved progress.
 */
import { createScene, fitCamera, fitOrthoCamera } from './render/scene.js';
import { createView } from './render/view.js';
import { setupPicking } from './render/picking.js';
import { boardExtent } from './render/fit.js';
import { CELL_SIZE, CELL_GAP } from './render/boardView.js';
import { createBoard } from './game/board.js';
import { GameController } from './game/controller.js';
import { resolveGame } from './game/play/setup.js';
import { getLevel } from './game/play/levels.js';
import {
  loadProgress,
  saveProgress,
  resetProgress,
  recordResult,
  hasSeenIntro,
  recordIntroSeen,
} from './game/play/progress.js';
import { basicRuleset, gimmickRuleset } from './game/rulesets.js';
import { createHud } from './ui/hud.js';
import { createLevelSelect } from './ui/levelSelect.js';
import { createIntroCard } from './ui/introCard.js';
import { getLang } from './ui/strings.js';
import { createStartWizard } from './ui/startWizard.js';

const canvas = document.getElementById('game-canvas');
const { engine, scene, camera, setCameraMode } = createScene(canvas);
const view = createView(scene);
const hud = createHud();
const introCard = createIntroCard();
const startWizard = createStartWizard({
  onNewGame(cfg) {
    const s = hud.getSettings();
    s.rules = cfg.rules;
    s.play = cfg.play;
    s.role = cfg.role;
    s.course = cfg.role;
    s.difficulty = cfg.difficulty;
    s.level = cfg.level || 1;
    try { localStorage.setItem('catescape.settings', JSON.stringify(s)); } catch {}
    startGame();
  },
  onContinue() {
    startGame();
  },
});
// Rev. 6: apply the saved 演出 quality before the first game (17.1)
view.setFxQuality(hud.getSettings().fx);

// progress storage: localStorage behind the injected interface (spec 12.4),
// wrapped in try/catch (private mode, quota, …)
const storage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* best-effort */
    }
  },
};
let progress = loadProgress(storage);

// the saved language first, else navigator, else ja (13.9); <html lang> follows
document.documentElement.lang = getLang();

/** Show a level's intro card the first time it is started (13.4). */
function maybeShowIntro(s) {
  if (s.rules !== 'gimmick' || s.play !== 'level') return;
  const lv = getLevel(s.course || s.role, s.level);
  if (!lv.intro || hasSeenIntro(progress, lv.intro)) return;
  introCard.show(lv.intro);
  progress = recordIntroSeen(progress, lv.intro);
  saveProgress(storage, progress);
}

/** Resolve the four-axis choice and start a fresh game. */
function startGame() {
  const s = hud.getSettings();
  const { ruleset, newGameOpts } = resolveGame({
    rules: s.rules,
    play: s.play,
    role: s.role,
    difficulty: s.difficulty,
    course: s.role, // the game always plays the player's own course
    level: s.level,
    // 16.3: the slider's fine-tuned block count (undefined → the center)
    blocks: s.blocks,
    progress,
    playerItems: progress.inventory,
  });
  controller.start({
    ruleset,
    ...newGameOpts,
    // seed omitted → a fresh random one (shown in the status line)
  });
  maybeShowIntro(s);
}

const controller = new GameController({
  view,
  hud,
  onGameOver(result) {
    // record → persist → fill the result modal (main.js job, spec 12.4/12.8)
    const s = hud.getSettings();
    const rec = recordResult(
      progress,
      {
        rules: s.rules,
        play: s.play,
        role: s.role,
        difficulty: s.difficulty,
        course: s.role,
        level: s.level,
        // 16.3: the stats/streak key carries the count the game was played at
        blocks: s.blocks,
        items: result.state.items,
      },
      result.status,
    );
    progress = rec.progress;
    saveProgress(storage, progress);
    // 14.4-2: hammers picked up from item cells, next to the win bonus
    const pickedUp =
      s.role === 'escape' && result.state.history
        ? result.state.history.filter((h) => h.kind === 'pickup').length
        : 0;
    hud.showResultInfo({
      play: s.play,
      streak: rec.streak,
      rewards: rec.rewards,
      picked: { hammer: pickedUp, double: 0 },
      unlockedNext: rec.unlockedNext,
      wins: progress.level[s.rules][s.role][s.level - 1],
    });
  },
});

const levelSelect = createLevelSelect({
  getSettings: () => hud.getSettings(),
  getProgress: () => progress,
  onSelect: (level, course) => hud.setLevelAndStart(level, course),
});

hud.attach({
  controller,
  levelSelect,
  getProgress: () => progress,
  onStart: startGame,
  onCameraMode,
  onFxQuality: (q) => view.setFxQuality(q), // Rev. 6 (17.1)
  onDoubleArmed: (on) => view.setDoubleArmed(on), // Rev. 6 (17.3)
});
setupPicking(scene, controller, view);

// camera auto-fit (Rev. 3) + ortho bounds (Rev. 4): startup and every resize
const board = createBoard();
const extent = boardExtent(board.W, board.H, CELL_SIZE, CELL_GAP);
let cameraMode = 'perspective';

function refit() {
  engine.resize();
  if (cameraMode === 'ortho') fitOrthoCamera(camera, engine, extent);
  else fitCamera(camera, engine, extent);
}

function onCameraMode(mode) {
  cameraMode = mode === 'ortho' ? 'ortho' : 'perspective';
  setCameraMode(cameraMode); // never restarts the game
  refit();
}

refit();
window.addEventListener('resize', refit);

// show start wizard on first load
startWizard.open();

if (import.meta.env.DEV) {
  // dev hook (Rev. 3 extended per 12.9) for automated play-tests
  window.__catescape = {
    controller,
    view,
    rulesets: { basic: basicRuleset, gimmick: gimmickRuleset },
    setup: resolveGame,
    progress: {
      load: () => {
        progress = loadProgress(storage);
        return progress;
      },
      save: (p) => saveProgress(storage, p),
      reset: () => {
        progress = resetProgress(storage);
        return progress;
      },
    },
  };
}

startGame();

engine.runRenderLoop(() => scene.render());
