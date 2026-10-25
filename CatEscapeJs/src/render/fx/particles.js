/**
 * Procedural particle atlas + pooled particle effects (Rev. 6, spec
 * 17.1/17.3). One sprite sheet of eight `DynamicTexture` cells (soft dot,
 * star, confetti square, shard, heart, leaf, snowflake, ring) is drawn
 * once per scene; every effect reuses pooled `ParticleSystem`s and a few
 * pooled meshes (block shards, shockwave ring decals). The pool enforces
 * the quality budget and returns systems after their lifetime, so the
 * live count stays bounded across many games.
 *
 * Task 26 fix pass: the tree-shaken build needs the side-effect imports
 * below (engine extension + particle scene component + shader store),
 * every creation is wrapped fail-soft (logs once, disables the effect)
 * and the cells are **shared** textures — `DynamicTexture.clone()`
 * allocates a fresh empty canvas, so clones would draw nothing.
 */
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
// Tree-shaken side-effect imports (task 26): `dynamicTexture.js` and
// `particleSystem.js` import most of these themselves, but a bundler may
// drop side-effect-only imports, so we pin them next to the usage.
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture.js'; // engine.createDynamicTexture
import '@babylonjs/core/Particles/particleSystemComponent.js'; // engine.createEffectForParticles
import '@babylonjs/core/Shaders/particles.vertex.js'; // ShadersStore particles shaders
import '@babylonjs/core/Shaders/particles.fragment.js';
import { fxWarnOnce } from './fxLog.js';

/** Atlas cell indices (4 × 2 grid of 64 px cells). */
export const ATLAS = { dot: 0, star: 1, confetti: 2, shard: 3, heart: 4, leaf: 5, snow: 6, ring: 7 };
const CELL_PX = 64;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;

/** The categorical palette used by the confetti burst (spec 17.3). */
export const CONFETTI_COLORS = ['#ff6fb5', '#2ec4b6', '#ffd23f', '#66d9ff', '#b06cff', '#7cc576'];

/** @param {string} hex @returns {Color4} */
function c4(hex) {
  const c = Color3.FromHexString(hex);
  return new Color4(c.r, c.g, c.b, 1);
}

/**
 * Draw the 8 sprite cells as 8 small textures (called once per pool).
 * The cells are shared between systems — never cloned, never disposed
 * while the pool lives.
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @returns {Array<DynamicTexture|null>} one entry per ATLAS index
 */
function buildAtlasCells(scene) {
  /** @type {Array<DynamicTexture|null>} */
  const cells = new Array(ATLAS_COLS * ATLAS_ROWS).fill(null);

  /** @param {number} idx @param {(c: CanvasRenderingContext2D) => void} draw */
  const makeCell = (idx, draw) => {
    try {
      const tex = new DynamicTexture(
        `fxAtlas-${idx}`,
        { width: CELL_PX, height: CELL_PX },
        scene,
        false,
      );
      /** @type {CanvasRenderingContext2D} */
      const ctx = tex.getContext();
      const size = tex.getSize();
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.save();
      ctx.translate(CELL_PX / 2, CELL_PX / 2);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ffffff';
      draw(ctx);
      ctx.restore();
      tex.update(false);
      tex.hasAlpha = true;
      cells[idx] = tex;
    } catch (err) {
      fxWarnOnce(`particles.atlas.${idx}`, err);
      cells[idx] = null;
    }
  };

  // 0 soft dot
  makeCell(ATLAS.dot, (c) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, CELL_PX / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, CELL_PX / 2, 0, Math.PI * 2);
    c.fill();
  });
  // 1 star
  makeCell(ATLAS.star, (c) => {
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 26 : 11;
      const a = (Math.PI / 5) * k - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (k === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
  });
  // 2 confetti square
  makeCell(ATLAS.confetti, (c) => {
    c.rotate(0.4);
    c.fillRect(-14, -18, 28, 36);
  });
  // 3 shard
  makeCell(ATLAS.shard, (c) => {
    c.beginPath();
    c.moveTo(0, -24);
    c.lineTo(18, 20);
    c.lineTo(-16, 14);
    c.closePath();
    c.fill();
  });
  // 4 heart
  makeCell(ATLAS.heart, (c) => {
    c.beginPath();
    c.moveTo(0, 20);
    c.bezierCurveTo(-30, -2, -14, -24, 0, -10);
    c.bezierCurveTo(14, -24, 30, -2, 0, 20);
    c.closePath();
    c.fill();
  });
  // 5 leaf
  makeCell(ATLAS.leaf, (c) => {
    c.beginPath();
    c.ellipse(0, 0, 22, 10, -0.5, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-18, 8);
    c.lineTo(18, -8);
    c.stroke();
  });
  // 6 snowflake
  makeCell(ATLAS.snow, (c) => {
    c.lineWidth = 4;
    c.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k;
      const dx = Math.cos(a) * 22;
      const dy = Math.sin(a) * 22;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(dx, dy);
      c.stroke();
      const bx = Math.cos(a) * 12;
      const by = Math.sin(a) * 12;
      for (const s of [-0.5, 0.5]) {
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(bx + Math.cos(a + s) * 8, by + Math.sin(a + s) * 8);
        c.stroke();
      }
    }
  });
  // 7 ring
  makeCell(ATLAS.ring, (c) => {
    c.lineWidth = 8;
    c.beginPath();
    c.arc(0, 0, 24, 0, Math.PI * 2);
    c.stroke();
  });

  return cells;
}

/** @param {number} n @param {number} min @param {number} max */
function rand(min, max, rng) {
  return min + (max - min) * rng();
}

/**
 * Point the system at one shared atlas cell (never cloned).
 * @param {ParticleSystem} ps
 * @param {Array<DynamicTexture|null>} cells
 * @param {number} cellIndex
 */
function useCell(ps, cells, cellIndex) {
  const tex = cells[cellIndex];
  if (tex) ps.particleTexture = tex;
}

/**
 * The pool: pooled `ParticleSystem`s per effect kind, pooled shard/ring
 * meshes, emitter-path movers and the budget guard. Every construction
 * step is fail-soft: a broken piece logs once and disables only the
 * effects that need it.
 *
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {{budget?: number, rng?: () => number}} [opts]
 */
export function createParticlePool(scene, opts = {}) {
  const rng = opts.rng || Math.random;
  let budget = Math.max(1, opts.budget || 2000);
  /** @type {Array<DynamicTexture|null>} */
  let cells = [];
  try {
    cells = buildAtlasCells(scene);
  } catch (err) {
    fxWarnOnce('particles.atlas', err);
    cells = [];
  }
  /** @type {Map<string, {free: ParticleSystem[], busy: ParticleSystem[]}>} */
  const pools = new Map();
  /** @type {Array<{ps: ParticleSystem, endAt: number, planned: number}>} */
  let returns = [];
  /** @type {Array<{t:number, dur:number, fn:(t:number)=>void}>} */
  let movers = [];
  /** @type {Array<{mesh: any, vel: Vector3, spin: Vector3, life:number, age:number}>} */
  let debris = [];
  /** live estimate: pending particle counts + active debris */
  let live = 0;

  /* ---------------------------------------------------------- mesh pools */

  /** @type {StandardMaterial|null} */
  let shardMat = null;
  const shardFree = [];
  /** @type {any[]} */
  const shardBusy = [];
  /** @type {StandardMaterial|null} */
  let ringMat = null;
  const ringFree = [];
  /** @type {any[]} */
  const ringBusy = [];
  try {
    shardMat = new StandardMaterial('fxShard', scene);
    shardMat.diffuseColor = Color3.FromHexString('#8d99a6');
    shardMat.emissiveColor = Color3.FromHexString('#8d99a6').scale(0.25);
    shardMat.specularColor = Color3.Black();
    for (let k = 0; k < 24; k++) {
      const m = CreateBox(`fxShard-${k}`, { size: 0.14 }, scene);
      m.material = shardMat;
      m.isPickable = false;
      m.setEnabled(false);
      shardFree.push(m);
    }
  } catch (err) {
    fxWarnOnce('particles.shards', err);
  }
  try {
    ringMat = new StandardMaterial('fxRing', scene);
    ringMat.emissiveColor = Color3.FromHexString('#9fd8ff');
    ringMat.diffuseColor = Color3.Black();
    ringMat.specularColor = Color3.Black();
    ringMat.alpha = 0.8;
    for (let k = 0; k < 6; k++) {
      const m = CreateTorus(
        `fxRing-${k}`,
        { diameter: 1, thickness: 0.08, tessellation: 24 },
        scene,
      );
      m.material = ringMat;
      m.isPickable = false;
      m.setEnabled(false);
      ringFree.push(m);
    }
  } catch (err) {
    fxWarnOnce('particles.rings', err);
  }

  /* --------------------------------------------------- particle system pool */

  /**
   * @param {string} kind
   * @param {number} capacity
   * @returns {ParticleSystem|null} null when the engine cannot build one
   */
  function takeSystem(kind, capacity) {
    let entry = pools.get(kind);
    if (!entry) {
      entry = { free: [], busy: [] };
      pools.set(kind, entry);
    }
    const ps = entry.free.pop();
    if (ps) {
      entry.busy.push(ps);
      ps._fxCapacity = Math.max(ps._fxCapacity || 0, capacity);
      return ps;
    }
    try {
      const made = new ParticleSystem(
        `fx-${kind}-${entry.busy.length}`,
        Math.max(8, capacity),
        scene,
      );
      made._fxCapacity = capacity;
      entry.busy.push(made);
      return made;
    } catch (err) {
      fxWarnOnce(`particles.system.${kind}`, err);
      return null;
    }
  }

  /**
   * @param {ParticleSystem} ps
   * @param {number} planned
   * @param {number} lifeMs
   */
  function scheduleReturn(ps, planned, lifeMs) {
    const endAt = performanceNow() + lifeMs;
    returns.push({ ps, endAt, planned });
    live += planned;
  }

  function releaseDue() {
    const now = performanceNow();
    if (returns.length === 0) return;
    const keep = [];
    for (const r of returns) {
      if (r.endAt <= now) {
        try {
          r.ps.stop();
          r.ps.reset();
        } catch (err) {
          fxWarnOnce('particles.release', err);
        }
        // the atlas cell is shared — never dispose it here
        const kind = String(r.ps.name).replace(/^fx-/, '').replace(/-\d+$/, '');
        const entry = pools.get(kind);
        if (entry) {
          const at = entry.busy.indexOf(r.ps);
          if (at >= 0) entry.busy.splice(at, 1);
          entry.free.push(r.ps);
        }
        live = Math.max(0, live - r.planned);
      } else {
        keep.push(r);
      }
    }
    returns = keep;
  }

  /* ------------------------------------------------------------- effects */

  /**
   * Base look of a soft-dot puff/ring system.
   * @param {ParticleSystem} ps
   * @param {Vector3} at
   * @param {{count:number, lifeMs:number, color:Color4, size:[number,number],
   *          speed:[number,number], gravity?:number, cell?:number,
   *          blend?:number, up?:number}} cfg
   */
  function configureDot(ps, at, cfg) {
    useCell(ps, cells, cfg.cell ?? ATLAS.dot);
    ps.emitter = at;
    ps.createSphereEmitter(0.35);
    ps.color1 = cfg.color;
    const faded = new Color4(cfg.color.r, cfg.color.g, cfg.color.b, 0);
    ps.color2 = cfg.color;
    ps.colorDead = faded;
    ps.minSize = cfg.size[0];
    ps.maxSize = cfg.size[1];
    ps.minLifeTime = (cfg.lifeMs / 1000) * 0.6;
    ps.maxLifeTime = cfg.lifeMs / 1000;
    ps.emitRate = 1000;
    ps.minEmitPower = cfg.speed[0];
    ps.maxEmitPower = cfg.speed[1];
    ps.gravity = new Vector3(0, cfg.gravity ?? 0, 0);
    ps.direction1 = new Vector3(-1, cfg.up ?? 0.4, -1);
    ps.direction2 = new Vector3(1, cfg.up ?? 0.9, 1);
    ps.blendMode = cfg.blend ?? ParticleSystem.BLENDMODE_STANDARD;
    ps.updateSpeed = 0.01;
    ps.manualEmitCount = Math.min(cfg.count, ps._fxCapacity || cfg.count);
    ps.start();
    scheduleReturn(ps, ps.manualEmitCount, cfg.lifeMs + 100);
  }

  /**
   * Moving-emitter effect: `mover(t)` positions the emitter over `durMs`.
   * @param {ParticleSystem} ps
   * @param {(t:number)=>void} mover
   * @param {number} durMs
   */
  function addMover(ps, mover, durMs) {
    movers.push({ t: 0, dur: durMs, fn: mover });
  }

  /**
   * @param {Vector3} at
   * @param {number} count
   * @param {number} small
   */
  function fireShards(at, count, small) {
    if (shardFree.length === 0) return;
    const n = Math.min(count, shardFree.length, Math.max(0, budget - live));
    for (let k = 0; k < n; k++) {
      const mesh = shardFree.pop();
      if (!mesh) break;
      mesh.setEnabled(true);
      mesh.position.copyFrom(at);
      const s = small ? 0.6 : 1;
      mesh.scaling.set(s, s, s);
      mesh.visibility = 1;
      const a = rng() * Math.PI * 2;
      const sp = rand(1.2, 2.6, rng);
      debris.push({
        mesh,
        vel: new Vector3(Math.cos(a) * sp, rand(1.5, 3.2, rng), Math.sin(a) * sp),
        spin: new Vector3(rng() * 8 - 4, rng() * 8 - 4, rng() * 8 - 4),
        life: 0.9,
        age: 0,
      });
      live += 1;
    }
  }

  /**
   * Expanding ring decal (shockwave / spring / crumble glow).
   * @param {Vector3} at
   * @param {number} durMs
   * @param {string} [hex]
   */
  function fireRing(at, durMs, hex) {
    if (live >= budget) return;
    const mesh = ringFree.pop();
    if (!mesh) return;
    if (hex && ringMat) {
      const c = Color3.FromHexString(hex);
      ringMat.emissiveColor = c;
    }
    mesh.setEnabled(true);
    mesh.position.copyFrom(at);
    mesh.position.y += 0.02;
    mesh.scaling.set(0.4, 1, 0.4);
    mesh.visibility = 1;
    // reuse the debris scheduler with a ring flag
    debris.push({
      mesh,
      vel: Vector3.Zero(),
      spin: Vector3.Zero(),
      life: durMs / 1000,
      age: 0,
      ring: true,
      ringDur: durMs / 1000,
    });
    live += 1;
  }

  function updateDebris(dtSec) {
    if (debris.length === 0) return;
    const keep = [];
    for (const d of debris) {
      d.age += dtSec;
      const t = d.age / d.life;
      if (t >= 1) {
        d.mesh.setEnabled(false);
        live = Math.max(0, live - 1);
        if (d.ring) ringFree.push(d.mesh);
        else shardFree.push(d.mesh);
        continue;
      }
      if (d.ring) {
        const s = 0.4 + 2.4 * t;
        d.mesh.scaling.set(s, 1, s);
        d.mesh.visibility = 1 - t;
      } else {
        d.vel.y -= 9 * dtSec;
        d.mesh.position.addInPlace(d.vel.scale(dtSec));
        d.mesh.rotation.x += d.spin.x * dtSec;
        d.mesh.rotation.y += d.spin.y * dtSec;
        d.mesh.rotation.z += d.spin.z * dtSec;
        if (d.mesh.position.y < -0.2) {
          d.mesh.position.y = -0.2;
          d.vel.y = Math.abs(d.vel.y) * 0.3;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
        }
        d.mesh.visibility = t > 0.6 ? (1 - t) / 0.4 : 1;
      }
      keep.push(d);
    }
    debris = keep;
  }

  function updateMovers(dtMs) {
    if (movers.length === 0) return;
    const keep = [];
    for (const m of movers) {
      m.t += dtMs;
      const t = Math.min(1, m.t / Math.max(1, m.dur));
      m.fn(t);
      if (t < 1) keep.push(m);
    }
    movers = keep;
  }

  /**
   * Fire one effect descriptor (from `fxPlan`) at a world position.
   * Fail-soft: any error logs once under `particles.fire.<fx>` and only
   * that shot is lost.
   * @param {{fx:string, count?:number, dur?:number, small?:boolean}} desc
   * @param {Vector3} at
   * @param {{to?: Vector3, path?: Vector3[]}} [extra]
   */
  function fire(desc, at, extra = {}) {
    try {
      fireInner(desc, at, extra);
    } catch (err) {
      fxWarnOnce(`particles.fire.${desc && desc.fx}`, err);
    }
  }

  /**
   * @param {{fx:string, count?:number, dur?:number, small?:boolean}} desc
   * @param {Vector3} at
   * @param {{to?: Vector3, path?: Vector3[]}} extra
   */
  function fireInner(desc, at, extra) {
    const count = Math.max(0, Math.floor(desc.count || 0));
    if (count > budget) return;
    switch (desc.fx) {
      case 'dustRing': {
        const ps = takeSystem('dustRing', 32);
        if (!ps) break;
        configureDot(ps, at, {
          count: Math.min(count, 24),
          lifeMs: desc.dur || 500,
          color: c4('#c9b28a'),
          size: [0.1, 0.22],
          speed: [0.9, 1.6],
          up: 0.15,
        });
        fireRing(at, 420, '#d8c49a');
        break;
      }
      case 'dustPuff': {
        const ps = takeSystem('dustPuff', 12);
        if (!ps) break;
        configureDot(ps, at, {
          count: Math.min(count, 10),
          lifeMs: desc.dur || 420,
          color: c4('#d9cbb0'),
          size: [0.08, 0.18],
          speed: [0.5, 1.1],
          up: 0.5,
        });
        break;
      }
      case 'confetti': {
        const ps = takeSystem('confetti', 320);
        if (!ps) break;
        useCell(ps, cells, ATLAS.confetti);
        ps.emitter = at;
        ps.createSphereEmitter(0.5);
        ps.color1 = c4(CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)]);
        ps.color2 = c4(CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)]);
        ps.colorDead = new Color4(1, 1, 1, 0);
        ps.minSize = 0.07;
        ps.maxSize = 0.14;
        ps.minLifeTime = 1.4;
        ps.maxLifeTime = 2.4;
        ps.emitRate = 1000;
        ps.minEmitPower = 2.5;
        ps.maxEmitPower = 6;
        ps.gravity = new Vector3(0, -9, 0);
        ps.direction1 = new Vector3(-1, 1.4, -1);
        ps.direction2 = new Vector3(1, 2.4, 1);
        ps.minAngularSpeed = -4;
        ps.maxAngularSpeed = 4;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.updateSpeed = 0.01;
        ps.manualEmitCount = Math.min(count, ps._fxCapacity || count);
        ps.start();
        scheduleReturn(ps, ps.manualEmitCount, 2600);
        break;
      }
      case 'starSpiral': {
        const ps = takeSystem('starSpiral', 24);
        if (!ps) break;
        useCell(ps, cells, ATLAS.star);
        ps.emitter = at;
        ps.createSphereEmitter(0.2);
        ps.color1 = c4('#ffe066');
        ps.color2 = c4('#ffd23f');
        ps.colorDead = new Color4(1, 0.84, 0.24, 0);
        ps.minSize = 0.07;
        ps.maxSize = 0.13;
        ps.minLifeTime = 0.35;
        ps.maxLifeTime = 0.6;
        const spiralDur = desc.dur || 700;
        const plannedSpiral = Math.min(count || 20, ps._fxCapacity || 20);
        ps.emitRate = Math.max(1, plannedSpiral / (spiralDur / 1000));
        ps.minEmitPower = 0.4;
        ps.maxEmitPower = 1.0;
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.updateSpeed = 0.01;
        ps.start();
        addMover(
          ps,
          (t) => {
            const a = t * Math.PI * 4;
            ps.emitter = new Vector3(
              at.x + Math.cos(a) * 0.35,
              at.y + t * 1.1,
              at.z + Math.sin(a) * 0.35,
            );
          },
          spiralDur,
        );
        scheduleReturn(ps, plannedSpiral, spiralDur + 700);
        break;
      }
      case 'burstOut':
      case 'apexSparkle': {
        const ps = takeSystem('burst', 32);
        if (!ps) break;
        configureDot(ps, at, {
          cell: ATLAS.star,
          count: Math.min(count, 28),
          lifeMs: desc.dur || 420,
          color: c4(desc.fx === 'burstOut' ? '#b06cff' : '#ffe066'),
          size: [0.06, 0.12],
          speed: [1.4, 2.8],
          blend: ParticleSystem.BLENDMODE_ADD,
          up: 0.8,
        });
        break;
      }
      case 'snowTrail': {
        const path = extra.path && extra.path.length > 0 ? extra.path : [at];
        const ps = takeSystem('snowTrail', 48);
        if (!ps) break;
        useCell(ps, cells, ATLAS.snow);
        ps.emitter = path[0];
        ps.createSphereEmitter(0.25);
        ps.color1 = c4('#e8f6ff');
        ps.color2 = c4('#bfe9ff');
        ps.colorDead = new Color4(0.75, 0.91, 1, 0);
        ps.minSize = 0.05;
        ps.maxSize = 0.11;
        ps.minLifeTime = 0.3;
        ps.maxLifeTime = 0.55;
        const snowDur = desc.dur || 500;
        const plannedSnow = Math.min(count || 40, ps._fxCapacity || 40);
        ps.emitRate = Math.max(1, plannedSnow / (snowDur / 1000));
        ps.minEmitPower = 0.1;
        ps.maxEmitPower = 0.4;
        ps.direction1 = new Vector3(-0.4, 0.2, -0.4);
        ps.direction2 = new Vector3(0.4, 0.6, 0.4);
        ps.minAngularSpeed = -2;
        ps.maxAngularSpeed = 2;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.updateSpeed = 0.01;
        ps.start();
        addMover(
          ps,
          (t) => {
            const idx = Math.min(path.length - 1, t * (path.length - 1));
            const k = Math.floor(idx);
            const f = idx - k;
            const a = path[k];
            const b = path[Math.min(path.length - 1, k + 1)];
            ps.emitter = new Vector3(
              a.x + (b.x - a.x) * f,
              a.y + 0.1,
              a.z + (b.z - a.z) * f,
            );
          },
          snowDur,
        );
        scheduleReturn(ps, plannedSnow, snowDur + 700);
        break;
      }
      case 'tunnelVortex': {
        const ps = takeSystem('tunnelVortex', 40);
        if (!ps) break;
        const vortexDur = desc.dur || 300;
        useCell(ps, cells, ATLAS.star);
        ps.emitter = at;
        ps.createSphereEmitter(0.2);
        ps.color1 = c4('#b06cff');
        ps.color2 = c4('#2ec4b6');
        ps.colorDead = new Color4(0.69, 0.42, 1, 0);
        ps.minSize = 0.05;
        ps.maxSize = 0.1;
        ps.minLifeTime = 0.2;
        ps.maxLifeTime = 0.4;
        const plannedVortex = 28;
        ps.emitRate = Math.max(1, plannedVortex / (vortexDur / 1000));
        ps.minEmitPower = 0.3;
        ps.maxEmitPower = 0.8;
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.updateSpeed = 0.01;
        ps.start();
        const base = at.clone();
        addMover(
          ps,
          (t) => {
            const a = t * Math.PI * 5;
            ps.emitter = new Vector3(
              base.x + Math.cos(a) * 0.55,
              base.y + 0.15,
              base.z + Math.sin(a) * 0.55,
            );
          },
          vortexDur,
        );
        scheduleReturn(ps, plannedVortex, vortexDur + 400);
        break;
      }
      case 'hearts': {
        const ps = takeSystem('hearts', 16);
        if (!ps) break;
        useCell(ps, cells, ATLAS.heart);
        ps.emitter = at;
        ps.createSphereEmitter(0.25);
        ps.color1 = c4('#ff8fb8');
        ps.color2 = c4('#ffb3d1');
        ps.colorDead = new Color4(1, 0.56, 0.72, 0);
        ps.minSize = 0.1;
        ps.maxSize = 0.18;
        ps.minLifeTime = 0.6;
        ps.maxLifeTime = 1.0;
        ps.emitRate = 1000;
        ps.minEmitPower = 0.5;
        ps.maxEmitPower = 1.0;
        ps.gravity = new Vector3(0, 0.6, 0);
        ps.direction1 = new Vector3(-0.3, 0.8, -0.3);
        ps.direction2 = new Vector3(0.3, 1.4, 0.3);
        ps.minAngularSpeed = -0.8;
        ps.maxAngularSpeed = 0.8;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.updateSpeed = 0.01;
        ps.manualEmitCount = Math.min(count, ps._fxCapacity || count);
        ps.start();
        scheduleReturn(ps, ps.manualEmitCount, (desc.dur || 900) + 300);
        break;
      }
      case 'windStreaks': {
        const ps = takeSystem('windStreaks', 64);
        if (!ps) break;
        useCell(ps, cells, ATLAS.dot);
        ps.emitter = at;
        ps.createBoxEmitter(
          new Vector3(4.5, 0.1, 0),
          new Vector3(6, 0.4, 0),
          new Vector3(-9, 0.4, -7),
          new Vector3(-9, 2.4, 7),
        );
        ps.color1 = c4('#cfe3f5');
        ps.color2 = c4('#9fb3c8');
        ps.colorDead = new Color4(0.81, 0.89, 0.96, 0);
        ps.minSize = 0.06;
        ps.maxSize = 0.12;
        ps.minLifeTime = 0.5;
        ps.maxLifeTime = 0.9;
        ps.minEmitPower = 1;
        ps.maxEmitPower = 1;
        if ('minScaleX' in ps) {
          ps.minScaleX = 4;
          ps.maxScaleX = 9;
          ps.minScaleY = 0.4;
          ps.maxScaleY = 0.8;
        }
        ps.blendMode = ParticleSystem.BLENDMODE_ADD;
        ps.updateSpeed = 0.01;
        const dur = desc.dur || 1000;
        const planned = 48;
        ps.emitRate = Math.max(1, planned / (dur / 1000));
        ps.start();
        scheduleReturn(ps, planned, dur + 900);
        addMover(ps, () => {}, dur); // keep the system referenced until the wind ends
        break;
      }
      case 'leaves': {
        const ps = takeSystem('leaves', 40);
        if (!ps) break;
        useCell(ps, cells, ATLAS.leaf);
        ps.emitter = at;
        ps.createSphereEmitter(6);
        ps.color1 = c4('#8fbf5a');
        ps.color2 = c4('#c9a24b');
        ps.colorDead = new Color4(0.56, 0.75, 0.35, 0);
        ps.minSize = 0.08;
        ps.maxSize = 0.16;
        ps.minLifeTime = 0.8;
        ps.maxLifeTime = 1.4;
        ps.emitRate = 1000;
        ps.minEmitPower = 0.8;
        ps.maxEmitPower = 1.8;
        ps.gravity = new Vector3(1.5, -2.5, 0);
        ps.direction1 = new Vector3(0.4, 0.6, -0.6);
        ps.direction2 = new Vector3(1.4, 1.4, 0.6);
        ps.minAngularSpeed = -6;
        ps.maxAngularSpeed = 6;
        ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
        ps.updateSpeed = 0.01;
        ps.manualEmitCount = Math.min(count, ps._fxCapacity || count);
        ps.start();
        scheduleReturn(ps, ps.manualEmitCount, (desc.dur || 1200) + 400);
        break;
      }
      case 'sweatDrops': {
        const ps = takeSystem('sweatDrops', 14);
        if (!ps) break;
        configureDot(ps, at, {
          cell: ATLAS.dot,
          count: Math.min(count, 12),
          lifeMs: desc.dur || 900,
          color: c4('#9fd8ff'),
          size: [0.05, 0.09],
          speed: [0.6, 1.2],
          gravity: -4,
          up: 1.2,
        });
        break;
      }
      case 'shockwaveRing': {
        fireRing(at, desc.dur || 420, '#9fd8ff');
        break;
      }
      case 'crumbleGlow': {
        fireRing(at, desc.dur || 450, '#ff9d66');
        break;
      }
      default:
        break;
    }
  }

  /**
   * @param {number} dtMs
   */
  function update(dtMs) {
    try {
      updateMovers(dtMs);
      updateDebris(dtMs / 1000);
      releaseDue();
    } catch (err) {
      fxWarnOnce('particles.update', err);
    }
  }

  function dispose() {
    for (const entry of pools.values()) {
      for (const ps of [...entry.free, ...entry.busy]) {
        try {
          ps.dispose();
        } catch (err) {
          fxWarnOnce('particles.disposeSystem', err);
        }
      }
      entry.free.length = 0;
      entry.busy.length = 0;
    }
    pools.clear();
    returns = [];
    movers = [];
    for (const d of debris) {
      try {
        d.mesh.dispose();
      } catch (err) {
        fxWarnOnce('particles.disposeDebris', err);
      }
    }
    debris = [];
    for (const m of shardFree) m.dispose();
    for (const m of ringFree) m.dispose();
    shardFree.length = 0;
    ringFree.length = 0;
    if (shardMat) shardMat.dispose();
    if (ringMat) ringMat.dispose();
    for (const tex of cells) {
      if (tex) tex.dispose();
    }
    cells = [];
  }

  return {
    fire,
    update,
    dispose,
    /** @returns {number} rough live-particle estimate */
    get live() {
      return live;
    },
    get budget() {
      return budget;
    },
    /**
     * @param {number} value
     */
    setBudget(value) {
      budget = Math.max(1, value);
    },
    /** Test helper: systems currently checked out of the pools. */
    get busySystems() {
      let n = 0;
      for (const entry of pools.values()) n += entry.busy.length;
      return n;
    },
  };
}

/** Monotonic-ish clock that also works in Node tests. */
function performanceNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
