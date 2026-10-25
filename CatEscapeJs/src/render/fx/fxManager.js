/**
 * Fx manager (Rev. 6, spec 17.1): one instance per scene. It owns the
 * quality setting (clamped by `prefers-reduced-motion`), the particle
 * pool, the tween list, the shake/punch shaker, the post pipeline and
 * the glow layer, plus the continuous auras (full power, double armed).
 * The **view** feeds it - the controller never calls fx directly. Every
 * one-shot effect comes in as descriptors from the pure `fxPlan`.
 */
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { cellPos, CELL_HEIGHT } from '../boardView.js';
import { createParticlePool } from './particles.js';
import { createTweenList } from './tween.js';
import { createShaker } from './shake.js';
import { fxWarnOnce } from './fxLog.js';
import {
  createFxPipeline,
  createFxGlow,
  createShockwavePost,
  createDesatPost,
} from './post.js';
import {
  fxPlan,
  clampFxQuality,
  defaultFxQuality,
  FX_BUDGETS,
  hasPostFx,
  hasGlowFx,
} from './fxPlan.js';

/**
 * Detect `prefers-reduced-motion: reduce` (safe in non-DOM contexts).
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {{quality?: string, reducedMotion?: boolean,
 *          camera?: import('@babylonjs/core/Cameras/arcRotateCamera.js').ArcRotateCamera}} [opts]
 */
export function createFxManager(scene, opts = {}) {
  const camera = opts.camera || scene.activeCamera;
  let reducedMotion = opts.reducedMotion ?? prefersReducedMotion();
  let quality = clampFxQuality(opts.quality || defaultFxQuality(), reducedMotion);
  const tweens = createTweenList();
  /** @type {ReturnType<typeof createParticlePool>|null} null when construction failed */
  let pool = null;
  try {
    pool = createParticlePool(scene, { budget: FX_BUDGETS[quality] });
  } catch (err) {
    fxWarnOnce('pool', err);
    pool = null;
  }
  const shaker = createShaker(camera, { reducedMotion });

  /** @type {ReturnType<typeof createFxPipeline>|null} */
  let pipeline = null;
  /** @type {ReturnType<typeof createFxGlow>|null} */
  let glow = null;
  /** @type {ReturnType<typeof createShockwavePost>|null} */
  let shockwave = null;
  /** @type {ReturnType<typeof createDesatPost>|null} */
  let desat = null;

  /* ------------------------------------------------------------- auras
   * Fail-soft (task 26): a broken aura mesh must never stop the game. */

  /** @type {StandardMaterial|null} */
  let auraMat = null;
  /** @type {import('@babylonjs/core/Meshes/mesh.js').Mesh|null} */
  let auraRing = null;
  /** @type {StandardMaterial|null} */
  let edgeMat = null;
  /** @type {import('@babylonjs/core/Meshes/mesh.js').Mesh|null} */
  let edgeRing = null;
  try {
    auraMat = new StandardMaterial('fxPowerAura', scene);
    auraMat.emissiveColor = Color3.FromHexString('#ffd23f');
    auraMat.diffuseColor = Color3.Black();
    auraMat.specularColor = Color3.Black();
    auraMat.alpha = 0.0;
    auraRing = CreateTorus(
      'fxPowerAura',
      { diameter: 1.9, thickness: 0.12, tessellation: 28 },
      scene,
    );
    auraRing.material = auraMat;
    auraRing.isPickable = false;
    auraRing.setEnabled(false);
    edgeMat = new StandardMaterial('fxEdgePulse', scene);
    edgeMat.emissiveColor = Color3.FromHexString('#ff9d66');
    edgeMat.diffuseColor = Color3.Black();
    edgeMat.specularColor = Color3.Black();
    edgeMat.alpha = 0.0;
  } catch (err) {
    fxWarnOnce('aura', err);
    auraMat = null;
    auraRing = null;
    edgeMat = null;
  }

  let auraOn = false;
  /** @type {{x:number, z:number}|null} */
  let auraCell = null;
  let auraSparkTimer = 0;
  let auraPhase = 0;

  /* --------------------------------------------------------------- loop */

  let lastNow = typeof performance !== 'undefined' ? performance.now() : 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = lastNow ? Math.min(64, now - lastNow) : 16;
    lastNow = now;
    update(dt);
  });

  /**
   * World position of a cell's top (particle anchor).
   * @param {import('../../game/board.js').Board} board
   * @param {number} i
   * @returns {Vector3}
   */
  function cellWorld(board, i) {
    const p = cellPos(board, i);
    return new Vector3(p.x, CELL_HEIGHT / 2 + 0.15, p.z);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {{x:number, y:number}} normalized screen point (0..1)
   */
  function toScreen(x, y, z) {
    const engine = scene.getEngine();
    const v = Vector3.Project(
      new Vector3(x, y, z),
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    return {
      x: Math.min(1, Math.max(0, v.x / Math.max(1, engine.getRenderWidth()))),
      y: Math.min(1, Math.max(0, 1 - v.y / Math.max(1, engine.getRenderHeight()))),
    };
  }

  /**
   * (Re)create the `high`-only pieces. Fail-soft (task 26): a broken
   * pipeline / glow / post logs once and stays off.
   */
  function ensurePost() {
    if (!hasPostFx(quality)) return;
    try {
      if (!pipeline) pipeline = createFxPipeline(scene);
    } catch (err) {
      fxWarnOnce('post.pipeline', err);
      pipeline = null;
    }
    try {
      if (!shockwave) shockwave = createShockwavePost(scene, camera);
    } catch (err) {
      fxWarnOnce('post.shockwave', err);
      shockwave = null;
    }
    try {
      if (!desat) desat = createDesatPost(scene, camera);
    } catch (err) {
      fxWarnOnce('post.desat', err);
      desat = null;
    }
  }

  function ensureGlow() {
    if (!hasGlowFx(quality)) return;
    try {
      if (!glow) glow = createFxGlow(scene);
    } catch (err) {
      fxWarnOnce('post.glow', err);
      glow = null;
    }
  }

  /**
   * Babylon 8 `PostProcessRenderPipeline` / `EffectLayer` have no
   * `setEnabled`, so "off" means dispose + recreate on demand (task 26).
   */
  function disposePost() {
    if (pipeline) {
      try {
        pipeline.dispose();
      } catch (err) {
        fxWarnOnce('post.pipeline.dispose', err);
      }
      pipeline = null;
    }
    if (shockwave) {
      shockwave.dispose();
      shockwave = null;
    }
    if (desat) {
      desat.dispose();
      desat = null;
    }
  }

  function disposeGlow() {
    if (glow) {
      try {
        glow.dispose();
      } catch (err) {
        fxWarnOnce('post.glow.dispose', err);
      }
      glow = null;
    }
  }

  function applyFeatureFlags() {
    if (pool) {
      try {
        pool.setBudget(FX_BUDGETS[quality] || FX_BUDGETS.low);
      } catch (err) {
        fxWarnOnce('pool.budget', err);
      }
    }
    if (hasPostFx(quality)) ensurePost();
    else disposePost();
    if (hasGlowFx(quality)) ensureGlow();
    else disposeGlow();
  }

  /**
   * Per-section fail-soft (task 26): one broken subsystem logs once and
   * only its own updates stop.
   * @param {number} dtMs
   */
  function update(dtMs) {
    try {
      tweens.update(dtMs);
    } catch (err) {
      fxWarnOnce('loop.tweens', err);
    }
    try {
      shaker.update(dtMs);
    } catch (err) {
      fxWarnOnce('loop.shaker', err);
    }
    if (pool) {
      try {
        pool.update(dtMs);
      } catch (err) {
        fxWarnOnce('loop.pool', err);
      }
    }
    if (shockwave) {
      try {
        shockwave.update(dtMs);
      } catch (err) {
        fxWarnOnce('loop.shockwave', err);
      }
    }
    if (desat) {
      try {
        desat.update(dtMs);
      } catch (err) {
        fxWarnOnce('loop.desat', err);
      }
    }

    // power aura pulse + orbiting sparkle
    try {
      if (auraOn && auraCell && auraRing && auraMat) {
        auraPhase += dtMs / 1000;
        auraRing.position.set(auraCell.x, CELL_HEIGHT / 2 + 0.03, auraCell.z);
        auraRing.setEnabled(true);
        auraMat.alpha = 0.35 + 0.2 * Math.sin(auraPhase * 3);
        const s = 1 + 0.05 * Math.sin(auraPhase * 3);
        auraRing.scaling.set(s, 1, s);
        auraSparkTimer += dtMs;
        if (auraSparkTimer > 1100 && pool) {
          auraSparkTimer = 0;
          pool.fire(
            { fx: 'starSpiral', count: 6, dur: 600 },
            new Vector3(auraCell.x, CELL_HEIGHT / 2 + 0.3, auraCell.z),
          );
        }
      } else {
        if (auraRing) auraRing.setEnabled(false);
        if (auraMat) auraMat.alpha = 0;
      }

      // double-armed pulse on the board edge
      if (edgeRing && edgeMat) {
        auraPhase += dtMs / 1000;
        edgeMat.alpha = 0.18 + 0.14 * Math.sin(auraPhase * 4);
      }
    } catch (err) {
      fxWarnOnce('loop.aura', err);
    }
  }

  /* ---------------------------------------------------------------- fire */

  /**
   * Play a list of `fxPlan` descriptors. Fail-soft (task 26): each
   * descriptor plays inside its own try/catch — one broken effect logs
   * once (`fire.<fx>`) and only that shot is lost.
   * @param {Array<{fx:string, [k:string]: any}>} descs
   * @param {{board?: import('../../game/board.js').Board|null}} [ctx]
   */
  function fire(descs, ctx = {}) {
    if (!Array.isArray(descs)) return;
    const board = ctx.board || null;
    for (const d of descs) {
      if (!d || typeof d.fx !== 'string') continue;
      try {
        fireOne(d, board);
      } catch (err) {
        fxWarnOnce(`fire.${d.fx}`, err);
      }
    }
  }

  /**
   * @param {{fx:string, [k:string]: any}} d
   * @param {import('../../game/board.js').Board|null} board
   */
  function fireOne(d, board) {
    switch (d.fx) {
      case 'shake': {
        shaker.punch(d.dur || 120, d.amp ?? 0.08);
        break;
      }
      case 'cameraPunch': {
        if (!camera) break;
        const base = camera.radius;
        const dur = d.dur || 380;
        tweens.add({
          dur,
          onUpdate: (t) => {
            camera.radius = base * (1 - 0.07 * Math.sin(Math.PI * t));
          },
          onDone: () => {
            camera.radius = base;
          },
        });
        break;
      }
      case 'shockwavePost': {
        if (!shockwave || !camera || !board) break;
        const cell = Number.isInteger(d.cell) ? d.cell : -1;
        const p = cell >= 0 && board ? cellWorld(board, cell) : new Vector3(0, 0.3, 0);
        shockwave.fire(toScreen(p.x, p.y, p.z), d.dur || 450);
        break;
      }
      case 'desaturate': {
        if (desat) desat.fade(d.dur || 600);
        break;
      }
      case 'afterimages':
      case 'ripple':
      case 'blockLift': {
        // handled by the cat view / board view (mesh animations)
        break;
      }
      default: {
        if (!board || !pool) break;
        const cells = Array.isArray(d.cells) ? d.cells : null;
        const at =
          cells && cells.length > 0
            ? cellWorld(board, cells[0])
            : Number.isInteger(d.cell) && d.cell >= 0
              ? cellWorld(board, d.cell)
              : new Vector3(0, CELL_HEIGHT / 2, 0);
        const extra = {};
        if (cells && cells.length > 1) {
          extra.path = cells.map((c) => cellWorld(board, c));
        }
        const delay = d.delay || 0;
        if (delay > 0) {
          const delayed = { ...d, delay: undefined };
          tweens.add({
            dur: delay,
            onUpdate: () => {},
            onDone: () => {
              if (pool) pool.fire(delayed, at, extra);
            },
          });
        } else {
          pool.fire(d, at, extra);
        }
        break;
      }
    }
  }

  return {
    get quality() {
      return quality;
    },

    get reducedMotion() {
      return reducedMotion;
    },

    /**
     * @param {string} next
     */
    setQuality(next) {
      quality = clampFxQuality(next, reducedMotion);
      applyFeatureFlags();
    },

    /**
     * @param {boolean} value
     */
    setReducedMotion(value) {
      reducedMotion = !!value;
      shaker.setReducedMotion(reducedMotion);
      quality = clampFxQuality(quality, reducedMotion);
      applyFeatureFlags();
    },

    /**
     * Plan + play one view call (the only entry the view needs).
     * @param {string} viewCall
     * @param {object} args
     * @param {{board?: import('../../game/board.js').Board|null}} [ctx]
     */
    onViewCall(viewCall, args, ctx = {}) {
      const descs = fxPlan(viewCall, args, quality, { reducedMotion });
      fire(descs, ctx);
    },

    fire,

    /**
     * The 14.5 power-full aura under the cat (spec 17.3).
     * @param {boolean} on
     * @param {import('../../game/board.js').Board|null} board
     * @param {number} [cell]
     */
    setPowerAura(on, board, cell) {
      auraOn = !!on && !!board && Number.isInteger(cell) && cell >= 0;
      if (auraOn && board) {
        const p = cellPos(board, cell);
        auraCell = { x: p.x, z: p.z };
      } else {
        auraCell = null;
        if (auraMat) auraMat.alpha = 0;
      }
    },

    /**
     * The double-armed pulsing ring on the board edge (spec 17.3).
     * Fail-soft (task 26): a broken ring just never appears.
     * @param {boolean} on
     * @param {import('../../game/board.js').Board|null} board
     */
    setDoubleArmed(on, board) {
      try {
        if (on && board) {
          if (!edgeRing && edgeMat) {
            edgeRing = CreateTorus(
              'fxEdgePulse',
              { diameter: 1, thickness: 0.18, tessellation: 6 },
              scene,
            );
            edgeRing.rotation.y = Math.PI / 6;
            edgeRing.material = edgeMat;
            edgeRing.isPickable = false;
          }
          if (!edgeRing || !edgeMat) return;
          const hx = ((Math.sqrt(3) + 0.1) * board.W) / 2 + 0.7;
          const hz = ((1.5 + 0.0866) * board.H) / 2 + 0.7;
          const d = Math.max(hx, hz) * 2;
          edgeRing.scaling.set(hx / (d / 2), 1, hz / (d / 2));
          edgeRing.position.y = -CELL_HEIGHT / 2 + 0.02;
          edgeRing.setEnabled(true);
          edgeMat.alpha = 0.25;
        } else if (edgeRing) {
          edgeRing.setEnabled(false);
          if (edgeMat) edgeMat.alpha = 0;
        }
      } catch (err) {
        fxWarnOnce('edgeRing', err);
      }
    },

    /**
     * Reset the result-mood effects when a new game rebuilds.
     */
    resetMood() {
      if (desat) desat.reset();
      this.setPowerAura(false, null);
      this.setDoubleArmed(false, null);
    },

    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      if (pool) {
        try {
          pool.dispose();
        } catch (err) {
          fxWarnOnce('dispose.pool', err);
        }
      }
      tweens.clear();
      shaker.dispose();
      disposePost();
      disposeGlow();
      if (auraRing) auraRing.dispose();
      if (auraMat) auraMat.dispose();
      if (edgeRing) edgeRing.dispose();
      if (edgeMat) edgeMat.dispose();
    },
  };
}
