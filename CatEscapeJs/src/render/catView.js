/**
 * The cat: a small procedural model (no external assets) with hop / slide /
 * arc / tunnel (shrink+grow) / escape / caught animations, driven by
 * `scene.onBeforeRenderObservable`. One instance per cat (spec 13.7):
 * the fur color distinguishes the cats (`#f39c34`, grey, white).
 *
 * Rev. 6 (spec 17.2): anticipation squash + air stretch + elastic landing
 * on every hop, idle life (breathing, tail sway, seeded ear twitches,
 * head turning toward the hovered cell), a speed-line `TrailMesh` and
 * fading ghosts on the escape run, and ear-droop when trapped.
 */
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { TrailMesh } from '@babylonjs/core/Meshes/trailMesh.js';
import { cellPos, CELL_SIZE, CELL_GAP } from './boardView.js';
import { easeOutElastic, lerp } from './fx/tween.js';
import { fxWarnOnce } from './fx/fxLog.js';

const BASE_Y = 0.1; // body rests on the cell top (height 0.3 → top at 0.15)
const BASE_SCALE = 1.4; // Rev. 3: the cat was too small (must stay in one cell)
const HOP_MS = 250;
const HOP_HEIGHT = 0.8;
const SLIDE_MS = 160; // ice: a quick slide with no hop (spec 13.5)
const ARC_MS = 300; // spring: one high arc
const ARC_HEIGHT = 1.6;
const TUNNEL_MS = 160; // shrink / grow
const WIN_MS = 700;
const WIN_CELLS = 3;
const SIT_MS = 600;
const SHAKE_COUNT = 3;
const SETTLE_MS = 180; // elastic landing (17.2)
const BREATH_MS = 2400; // idle breathing period (17.2)
const TWITCH_MIN_MS = 3000; // ear twitch interval (17.2)
const TWITCH_MAX_MS = 6000;
const TWITCH_MS = 180;
const HAPPY_HOP_MS = 320; // the escape celebration hop (17.2)
const GHOST_MS = 320; // dash afterimage lifetime (17.2)

/** Fur colors for the 1–3 cats (spec 13.7). */
export const CAT_COLORS = ['#f39c34', '#9aa5b1', '#ffffff'];

function makeMaterial(scene, name, hex, emissive = 0.35) {
  const mat = new StandardMaterial(name, scene);
  const color = Color3.FromHexString(hex);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(emissive);
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {string} [colorHex] fur color (default: the first cat color)
 * @param {number} [index] cat index, used in mesh names
 */
export function createCatView(scene, colorHex = CAT_COLORS[0], index = 0) {
  const fur = makeMaterial(scene, `catFur-${index}`, colorHex);
  const black = makeMaterial(scene, `catBlack-${index}`, '#1a1a1a', 0.1);

  const root = new TransformNode(`cat-${index}`, scene);
  root.scaling.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
  const parts = [];

  function part(mesh, mat) {
    mesh.material = mat;
    mesh.parent = root;
    mesh.isPickable = false;
    parts.push(mesh);
    return mesh;
  }

  // body: ellipsoid
  const body = part(CreateSphere(`catBody-${index}`, { diameter: 1, segments: 10 }, scene), fur);
  body.scaling.set(0.8, 0.6, 1.1);
  body.position.set(0, 0.35, 0);
  // head (z pulled in so head+tail stay within one cell at 1.4×)
  const head = part(CreateSphere(`catHead-${index}`, { diameter: 0.55, segments: 8 }, scene), fur);
  head.position.set(0, 0.65, 0.42);
  // ears: cones (there is no CreateCone — a cone is a cylinder with diameterTop 0)
  /** @type {import('@babylonjs/core/Meshes/Builders/cylinderBuilder.js').Mesh[]} */
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = part(
      CreateCylinder(
        `catEar-${index}-${side}`,
        { diameterTop: 0, diameterBottom: 0.22, height: 0.3, tessellation: 6 },
        scene,
      ),
      fur,
    );
    ear.position.set(side * 0.17, 0.93, 0.42);
    ear.rotation.z = side * -0.25;
    ears.push(ear);
  }
  // tail (shortened vs. the original so the 1.4× footprint stays in one cell)
  const tail = part(
    CreateCylinder(`catTail-${index}`, { diameter: 0.12, height: 0.55, tessellation: 8 }, scene),
    fur,
  );
  tail.position.set(0, 0.45, -0.44);
  tail.rotation.x = -0.95;
  // eyes
  for (const side of [-1, 1]) {
    const eye = part(
      CreateSphere(`catEye-${index}-${side}`, { diameter: 0.09, segments: 6 }, scene),
      black,
    );
    eye.position.set(side * 0.12, 0.7, 0.65);
  }

  /** @type {{kind:string, t:number, dur:number, from?:any, to?:any, yaw?:number,
   *           dir?:any, cells?:number[], points?:any[], done?:Function,
   *           squash?:number}|null} */
  let anim = null;
  /** Squash factor kept between animations (1 = normal, 0.8 after a sit). */
  let baseSquash = 1;
  let idleClock = index * 977; // per-cat phase so the cats do not breathe in sync
  let nextTwitchAt = TWITCH_MIN_MS + ((index * 1237) % (TWITCH_MAX_MS - TWITCH_MIN_MS));
  let twitchLeft = 0;
  /** @type {{x:number, z:number}|null} hovered cell for the head turn (17.2) */
  let lookTarget = null;
  let lookYaw = 0;
  /** @type {TrailMesh|null} speed-line trail for the escape run (17.2) */
  let trail = null;
  /** @type {Array<{root: TransformNode, mat: StandardMaterial, parts: any[], age: number}>} */
  const ghosts = [];

  /** Squash/stretch of the whole cat around the hop timeline (17.2). */
  function hopScaleY(t, stretch) {
    if (t < 0.18) return lerp(1, 0.85, t / 0.18); // anticipation squash
    if (t < 0.32) return lerp(0.85, stretch, (t - 0.18) / 0.14); // take-off stretch
    if (t < 0.82) return lerp(stretch, 1.05, (t - 0.32) / 0.5);
    return lerp(1.05, 0.85, (t - 0.82) / 0.18); // pre-landing squash
  }

  /** Idle life + ghost fade; runs every frame while nothing is animating. */
  function idleTick(dt) {
    idleClock += dt;
    // breathing (scale y ±2 %, 2.4 s)
    const breath = 1 + 0.02 * Math.sin((idleClock / BREATH_MS) * Math.PI * 2);
    root.scaling.y = BASE_SCALE * baseSquash * breath;
    // tail sway
    tail.rotation.z = 0.28 * Math.sin(idleClock * 0.0022);
    // ear twitch every 3–6 s (seeded)
    if (twitchLeft > 0) {
      twitchLeft = Math.max(0, twitchLeft - dt);
      const k = 1 - twitchLeft / TWITCH_MS;
      for (let e = 0; e < ears.length; e++) {
        const side = e === 0 ? -1 : 1;
        ears[e].rotation.z = side * (-0.25 - 0.45 * Math.sin(Math.PI * k));
      }
      if (twitchLeft === 0) {
        ears[0].rotation.z = 0.25;
        ears[1].rotation.z = -0.25;
      }
    } else if (idleClock >= nextTwitchAt) {
      nextTwitchAt = idleClock + TWITCH_MIN_MS + (idleClock * 13) % (TWITCH_MAX_MS - TWITCH_MIN_MS);
      twitchLeft = TWITCH_MS;
    }
    // head turns toward the hovered cell
    if (lookTarget) {
      const want = Math.atan2(lookTarget.x - root.position.x, lookTarget.z - root.position.z);
      let delta = want - root.rotation.y;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const clamped = Math.max(-0.75, Math.min(0.75, delta));
      lookYaw += (clamped - lookYaw) * Math.min(1, dt / 120);
      head.rotation.y = lookYaw;
    } else {
      lookYaw += (0 - lookYaw) * Math.min(1, dt / 150);
      head.rotation.y = lookYaw;
    }
  }

  function ghostTick(dt) {
    if (ghosts.length === 0) return;
    const keep = [];
    for (const g of ghosts) {
      g.age += dt;
      const k = g.age / GHOST_MS;
      if (k >= 1) {
        for (const p of g.parts) p.dispose();
        g.root.dispose();
        g.mat.dispose();
        continue;
      }
      g.mat.alpha = 0.45 * (1 - k);
      keep.push(g);
    }
    ghosts.length = 0;
    for (const g of keep) ghosts.push(g);
  }

  scene.onBeforeRenderObservable.add(() => {
    // Fail-soft (task 26): an error in one cat's tick must never stop
    // the render loop or the other cats — it logs once and that tick is
    // skipped (the animation's `t` just doesn't advance for one frame).
    try {
      const dt = scene.getEngine().getDeltaTime();
      ghostTick(dt);
      if (!anim) {
        idleTick(dt);
        return;
      }
      anim.t = Math.min(1, anim.t + dt / anim.dur);
      const t = anim.t;
      if (anim.kind === 'hop' || anim.kind === 'arc') {
        const h = anim.kind === 'arc' ? ARC_HEIGHT : HOP_HEIGHT;
        root.position.x = anim.from.x + (anim.to.x - anim.from.x) * t;
        root.position.z = anim.from.z + (anim.to.z - anim.from.z) * t;
        root.position.y = BASE_Y + h * Math.sin(Math.PI * t);
        root.rotation.y = anim.yaw;
        root.scaling.y = BASE_SCALE * hopScaleY(t, anim.kind === 'arc' ? 1.18 : 1.15);
      } else if (anim.kind === 'settle') {
        // elastic landing squash recovery (17.2)
        root.scaling.y = BASE_SCALE * lerp(0.85, 1, easeOutElastic(t));
      } else if (anim.kind === 'happy') {
        // celebration hop: two small bounces in place (17.2)
        root.position.y = BASE_Y + 0.35 * Math.abs(Math.sin(Math.PI * t * 2));
        root.scaling.y = BASE_SCALE * hopScaleY(t, 1.1);
      } else if (anim.kind === 'slide') {
        // ice: glide low over the cells (spec 13.5)
        const cells = anim.cells;
        const idx = Math.min(cells.length - 1, t * (cells.length - 1));
        const k = Math.floor(idx);
        const f = idx - k;
        const a = anim.points[k];
        const b = anim.points[Math.min(cells.length - 1, k + 1)];
        root.position.x = a.x + (b.x - a.x) * f;
        root.position.z = a.z + (b.z - a.z) * f;
        root.position.y = BASE_Y;
        root.rotation.y = anim.yaw;
      } else if (anim.kind === 'scale') {
        const s = BASE_SCALE * (anim.from + (anim.to - anim.from) * t);
        root.scaling.set(s, s, s);
      } else if (anim.kind === 'win') {
        const d = WIN_CELLS * (CELL_SIZE * Math.sqrt(3) + CELL_GAP);
        root.position.x = anim.from.x + anim.dir.x * d * t;
        root.position.z = anim.from.z + anim.dir.z * d * t;
        root.position.y = BASE_Y + 0.2 * t + 0.15 * Math.abs(Math.sin(Math.PI * t * 4));
        root.rotation.y = anim.yaw;
        root.scaling.y = BASE_SCALE * (1 + 0.08 * Math.sin(Math.PI * t * 4));
        const v = 1 - t;
        for (const p of parts) p.visibility = v;
      } else if (anim.kind === 'sit') {
        root.rotation.z = 0.25 * Math.sin(Math.PI * 2 * SHAKE_COUNT * t) * (1 - t);
      }
      if (t >= 1) {
        const kind = anim.kind;
        const done = anim.done;
        anim = null;
        root.rotation.z = 0;
        if (kind === 'happy' && done) {
          // flow into the run-off
          done();
          return;
        }
        if ((kind === 'hop' || kind === 'arc') && done) {
          // elastic landing settle before the promise resolves (17.2)
          root.position.y = BASE_Y;
          anim = {
            kind: 'settle',
            t: 0,
            dur: SETTLE_MS,
            done,
          };
          return;
        }
        if (done) done();
      }
    } catch (err) {
      fxWarnOnce('catView.tick', err);
    }
  });

  /**
   * @param {import('../game/board.js').Board} board
   * @param {number} index
   */
  function cellWorld(board, index) {
    const p = cellPos(board, index);
    return { x: p.x, y: BASE_Y, z: p.z };
  }

  /** @param {{x:number, z:number}} a @param {{x:number, z:number}} b */
  function yawBetween(a, b) {
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  return {
    root,

    /**
     * Place the cat without animation.
     * @param {import('../game/board.js').Board} board
     * @param {number} index
     */
    place(board, index) {
      anim = null;
      baseSquash = 1;
      root.scaling.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
      root.rotation.set(0, 0, 0);
      lookTarget = null;
      const p = cellWorld(board, index);
      root.position.set(p.x, p.y, p.z);
    },

    /** Reset appearance after a finished game (fade / squash). */
    reset() {
      anim = null;
      baseSquash = 1;
      root.rotation.set(0, 0, 0);
      root.scaling.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
      for (const p of parts) p.visibility = 1;
    },

    /**
     * Rev. 6 (17.2): the head follows the hovered cell while idle.
     * @param {{x:number, z:number}|null} target world position, or null
     */
    setLookTarget(target) {
      lookTarget = target || null;
    },

    /**
     * Rev. 6 (17.2): two small celebration bounces in place.
     * @returns {Promise<void>}
     */
    happyHop() {
      return new Promise((resolve) => {
        anim = { kind: 'happy', t: 0, dur: HAPPY_HOP_MS, done: resolve };
      });
    },

    /**
     * Rev. 6 (17.2): spawn `count` fading body ghosts at the cat's
     * current pose (the dash afterimage trail). Fail-soft (task 26):
     * a broken ghost never blocks the move — it just doesn't appear.
     * @param {number} [count]
     */
    spawnGhosts(count = 2) {
      try {
        const mat = new StandardMaterial(`catGhostMat-${index}-${ghosts.length}`, scene);
        mat.diffuseColor = Color3.FromHexString('#66d9ff');
        mat.emissiveColor = Color3.FromHexString('#66d9ff').scale(0.5);
        mat.specularColor = Color3.Black();
        mat.alpha = 0.45;
        mat.disableLighting = true;
        const gRoot = new TransformNode(`catGhost-${index}-${ghosts.length}`, scene);
        gRoot.position.copyFrom(root.position);
        gRoot.rotation.copyFrom(root.rotation);
        gRoot.scaling.copyFrom(root.scaling);
        const gBody = body.clone(`catGhostBody-${index}-${ghosts.length}`);
        gBody.material = mat;
        gBody.parent = gRoot;
        gBody.visibility = 1;
        const gHead = head.clone(`catGhostHead-${index}-${ghosts.length}`);
        gHead.material = mat;
        gHead.parent = gRoot;
        gHead.visibility = 1;
        ghosts.push({ root: gRoot, mat, parts: [gBody, gHead], age: 0 });
      } catch (err) {
        fxWarnOnce('catView.ghosts', err);
      }
    },

    /**
     * @param {boolean} visible escaped cats are hidden (spec 13.7)
     */
    setVisible(visible) {
      root.setEnabled(visible);
    },

    /**
     * Hop from one cell to another (~250 ms, parabolic arc).
     * @param {import('../game/board.js').Board} board
     * @param {number} from
     * @param {number} to
     * @returns {Promise<void>}
     */
    hop(board, from, to) {
      return new Promise((resolve) => {
        const a = cellWorld(board, from);
        const b = cellWorld(board, to);
        anim = {
          kind: 'hop',
          t: 0,
          dur: HOP_MS,
          from: a,
          to: b,
          yaw: yawBetween(a, b),
          done: () => {
            root.position.set(b.x, BASE_Y, b.z);
            resolve();
          },
        };
      });
    },

    /**
     * Spring jump (spec 13.5): one high arc from `from` to `to`.
     * @param {import('../game/board.js').Board} board
     * @param {number} from
     * @param {number} to
     * @returns {Promise<void>}
     */
    arcHop(board, from, to) {
      return new Promise((resolve) => {
        const a = cellWorld(board, from);
        const b = cellWorld(board, to);
        anim = {
          kind: 'arc',
          t: 0,
          dur: ARC_MS,
          from: a,
          to: b,
          yaw: yawBetween(a, b),
          done: () => {
            root.position.set(b.x, BASE_Y, b.z);
            resolve();
          },
        };
      });
    },

    /**
     * Ice slide (spec 13.5): glide along `cells` (starting from the first)
     * with no hop; the caller places the cat at `cells[0]`'s predecessor
     * beforehand, so `cells` includes every cell the slide passes over.
     * @param {import('../game/board.js').Board} board
     * @param {number[]} cells every cell of the slide, in order
     * @returns {Promise<void>}
     */
    slidePath(board, cells) {
      return new Promise((resolve) => {
        if (!cells || cells.length === 0) {
          resolve();
          return;
        }
        const points = cells.map((c) => cellWorld(board, c));
        const last = points[points.length - 1];
        anim = {
          kind: 'slide',
          t: 0,
          dur: SLIDE_MS + 60 * (cells.length - 1),
          cells,
          points,
          yaw: yawBetween(points[0], last),
          done: () => {
            root.position.set(last.x, BASE_Y, last.z);
            resolve();
          },
        };
      });
    },

    /**
     * Tunnel (spec 13.5): shrink in place.
     * @returns {Promise<void>}
     */
    shrink() {
      return new Promise((resolve) => {
        anim = {
          kind: 'scale',
          t: 0,
          dur: TUNNEL_MS,
          from: 1,
          to: 0.01,
          done: () => {
            root.scaling.set(0.01, 0.01, 0.01);
            resolve();
          },
        };
      });
    },

    /**
     * Tunnel (spec 13.5): grow back at the exit.
     * @returns {Promise<void>}
     */
    grow() {
      return new Promise((resolve) => {
        anim = {
          kind: 'scale',
          t: 0,
          dur: TUNNEL_MS,
          from: 0.01,
          to: 1,
          done: () => {
            root.scaling.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
            resolve();
          },
        };
      });
    },

    /**
     * catWin: run off the board — 3 cells outward from the edge while fading,
     * leaving a speed-line trail behind (spec 17.2).
     * @param {import('../game/board.js').Board} board
     * @returns {Promise<void>}
     */
    runOff(board) {
      return new Promise((resolve) => {
        const p = root.position;
        let dx = p.x;
        let dz = p.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        // Fail-soft (task 26): a broken trail only loses the speed lines,
        // never the escape run-off itself.
        try {
          if (!trail) {
            trail = new TrailMesh(`catTrail-${index}`, body, scene, 0.22, 40, false);
            const trailMat = new StandardMaterial(`catTrailMat-${index}`, scene);
            trailMat.emissiveColor = Color3.FromHexString('#9fd8ff');
            trailMat.diffuseColor = Color3.Black();
            trailMat.specularColor = Color3.Black();
            trailMat.alpha = 0.55;
            trailMat.disableLighting = true;
            trailMat.backFaceCulling = false;
            trail.material = trailMat;
          }
          trail.start();
        } catch (err) {
          fxWarnOnce('catView.trail', err);
          trail = null;
        }
        anim = {
          kind: 'win',
          t: 0,
          dur: WIN_MS,
          from: { x: p.x, y: p.y, z: p.z },
          dir: { x: dx, z: dz },
          yaw: Math.atan2(dx, dz),
          done: () => {
            if (trail) {
              try {
                trail.stop();
              } catch (err) {
                fxWarnOnce('catView.trailStop', err);
              }
            }
            resolve();
          },
        };
      });
    },

    /**
     * trapperWin: shake side to side 3 times, then sit (squash to 0.8
     * height, ears drooping — spec 17.2).
     * @returns {Promise<void>}
     */
    sit() {
      return new Promise((resolve) => {
        anim = {
          kind: 'sit',
          t: 0,
          dur: SIT_MS,
          done: () => {
            baseSquash = 0.8; // squash relative to the base scale
            root.scaling.y = BASE_SCALE * 0.8;
            // ears down (17.2)
            ears[0].rotation.z = 0.85;
            ears[0].rotation.x = 0.5;
            ears[1].rotation.z = -0.85;
            ears[1].rotation.x = 0.5;
            resolve();
          },
        };
      });
    },

    dispose() {
      anim = null;
      if (trail) {
        trail.dispose();
        trail = null;
      }
      for (const g of ghosts) {
        for (const p of g.parts) p.dispose();
        g.root.dispose();
        g.mat.dispose();
      }
      ghosts.length = 0;
      for (const m of parts) m.dispose();
      root.dispose();
      fur.dispose();
      black.dispose();
    },
  };
}
