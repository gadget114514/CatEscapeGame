/**
 * The Bengal cat GLB (CC-BY-4.0, osmanarici2004_1 / Sketchfab).
 *
 * The Sketchfab export contains a single merged 10.07 s timeline:
 *   0.00-1.40 s  idle
 *   1.55-7.98 s  walking (the author also baked a walk around a circle)
 *   8.00-10.07 s idle
 * We split that timeline into an idle loop and a walk loop. The root
 * translation / yaw is removed so the cat walks in place; catView keeps
 * driving the gameplay transform (hop / slide / arc / run-off).
 *
 * The idle clip is looped by overlapping two idle instances: shortly
 * before one instance reaches its end, the other starts at the first
 * frame and the two cross-fade, so the end pose blends into the start
 * pose instead of snapping back to index 0 (YOYO did not blend the seam).
 * Idle and walk are also cross-faded by animatable weight over FADE_MS,
 * so every move blends back into the idle pose. All clips run at
 * SPEED_SCALE (half speed).
 *
 * The GLB is inlined (`?inline`) so the model also loads from file:// in
 * the Electron build, where XHR to a local asset URL is blocked.
 */
import catModelUrl from '../../3d/bengal_cat_non_commercial.glb?inline';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { fxWarnOnce } from './fx/fxLog.js';

const ROOT_BONE = 'Root_M_2_6';
const IDLE_RANGE = [8.0, 10.05];
const WALK_RANGE = [1.55, 7.98];
const TARGET_LENGTH = 1.7; // 2× the old footprint
const SPEED_SCALE = 0.5; // all clips play at half speed
const FADE_MS = 180; // idle ↔ walk cross-fade
const SEAM_MS = 450; // idle end → first-frame blend
const SEAM_MARGIN_MS = 100; // finish the seam blend before the clip loops

/** @type {WeakMap<import('@babylonjs/core/scene.js').Scene, Promise<any>>} */
const templates = new WeakMap();

/** Load and cache the GLB template for a scene. */
function templateFor(scene) {
  let pending = templates.get(scene);
  if (!pending) {
    pending = LoadAssetContainerAsync(catModelUrl, scene).catch((err) => {
      fxWarnOnce('catModel.load', err);
      return null;
    });
    templates.set(scene, pending);
  }
  return pending;
}

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {import('@babylonjs/core/assetContainer.js').AssetContainer} container
 * @param {number} index
 * @param {TransformNode} parent catView's gameplay root
 * @param {number} baseScale catView's BASE_SCALE
 * @param {number} footLocalY wrapper y in the parent's local space
 */
function instantiate(scene, container, index, parent, baseScale, footLocalY) {
  const entries = container.instantiateModelsToScene(
    (name) => `catModel-${index}-${name}`,
    false,
  );
  if (!entries || !entries.rootNodes || entries.rootNodes.length === 0) return null;

  const wrapper = new TransformNode(`catModelWrap-${index}`, scene);
  const modelRoot = new TransformNode(`catModelRoot-${index}`, scene);
  modelRoot.parent = wrapper;
  for (const node of entries.rootNodes) node.parent = modelRoot;

  // Measure the bind pose (wrapper is at the origin, unscaled) so the
  // model can be normalised to one cell regardless of the export units.
  let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  const meshes = wrapper.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
  for (const mesh of meshes) {
    mesh.isPickable = false;
    mesh.computeWorldMatrix(true);
    const bb = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, bb.minimumWorld);
    max = Vector3.Maximize(max, bb.maximumWorld);
  }
  const length = max.z - min.z;
  const netScale = length > 1e-4 ? TARGET_LENGTH / length : 1;
  wrapper.scaling.setAll(netScale / baseScale);
  wrapper.position.y = footLocalY;
  wrapper.parent = parent;
  // Centre the model on the player's root and put its feet on the cell.
  modelRoot.position.set(
    -(min.x + max.x) / 2,
    -min.y,
    -(min.z + max.z) / 2,
  );

  const base = entries.animationGroups && entries.animationGroups[0];
  if (!base) {
    disposeEntries(entries, wrapper);
    return null;
  }
  base.stop();

  // Drop the baked root motion so the walk cycle plays in place.
  for (let i = base.targetedAnimations.length - 1; i >= 0; i--) {
    const targeted = base.targetedAnimations[i];
    const prop = targeted.animation && targeted.animation.targetProperty;
    const isRoot = targeted.target && targeted.target.name === ROOT_BONE;
    if (isRoot && (prop === 'position' || prop === 'rotation' || prop === 'rotationQuaternion')) {
      base.removeTargetedAnimation(targeted.animation);
    }
  }

  const fps = base.targetedAnimations[0]
    ? base.targetedAnimations[0].animation.framePerSecond
    : 60;
  const frames = (seconds) => seconds * fps;
  // Two idle instances so the end of one can cross-fade into the start of
  // the other. Cloning the animations keeps both runtime timelines apart.
  const idleA = base.clone(`catModelIdleA-${index}`, undefined, true);
  const idleB = base.clone(`catModelIdleB-${index}`, undefined, true);
  const walk = base.clone(`catModelWalk-${index}`, undefined, true);
  const groups = [base, idleA, idleB, walk];

  let state = 'none';
  let sad = false;
  let lookYaw = 0;
  let enabled = true;
  /** @type {import('@babylonjs/core/Animations/animationGroup.js').AnimationGroup|null} */
  let current = null;
  /** @type {{from: any, to: any, t: number, dur: number}|null} */
  let fade = null;
  let idleSpeed = SPEED_SCALE;
  let idleDurationMs = 0;
  let idleTimer = Number.POSITIVE_INFINITY;

  function isIdle(group) {
    return group === idleA || group === idleB;
  }

  function nextIdle() {
    return current === idleA ? idleB : idleA;
  }

  /** Re-arm the seam timer for an idle instance starting now. */
  function setIdleTiming(speedRatio) {
    idleSpeed = speedRatio;
    idleDurationMs =
      ((IDLE_RANGE[1] - IDLE_RANGE[0]) * 1000) / Math.max(speedRatio, 1e-4);
    // Start the seam blend SEAM_MS before the end (plus a safety margin),
    // so the clip never visibly jumps back to frame 0 while at weight 1.
    idleTimer = Math.max(0, idleDurationMs - SEAM_MS - SEAM_MARGIN_MS);
  }

  function stopAll() {
    fade = null;
    current = null;
    state = 'none';
    idleTimer = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      group.stop();
      group.weight = 1;
    }
  }

  function startGroup(group, speedRatio, range) {
    group.stop();
    group.weight = 0;
    group.start(true, speedRatio, frames(range[0]), frames(range[1]));
    group.weight = 0;
  }

  function finishFade() {
    if (!fade) return;
    fade.from.stop();
    fade.from.weight = 1;
    fade.to.weight = 1;
    fade = null;
  }

  /**
   * Start `group` at weight 1 (no previous clip) or cross-fade into it
   * from the current group over FADE_MS. Both clips animate the same
   * skeleton, so Babylon combines them by animatable weight.
   */
  function fadeTo(group, speedRatio, range, nextState, fadeMs = FADE_MS) {
    if (!enabled) return;
    if (current === group && !fade) {
      group.speedRatio = speedRatio;
      state = nextState;
      return;
    }
    if (fade && fade.to === group) {
      group.speedRatio = speedRatio;
      state = nextState;
      return;
    }
    if (fade) finishFade();
    const prev = current;
    state = nextState;
    startGroup(group, speedRatio, range);
    current = group;
    if (isIdle(group)) setIdleTiming(speedRatio);
    if (!prev || prev === group) {
      group.weight = 1;
      return;
    }
    fade = { from: prev, to: group, t: 0, dur: fadeMs };
  }

  /** End-of-idle blend: the current idle → the other idle's first frame. */
  function seamIdle() {
    if (!enabled || !isIdle(current)) return;
    const prev = current;
    const next = prev === idleA ? idleB : idleA;
    startGroup(next, idleSpeed, IDLE_RANGE);
    current = next;
    state = 'idle';
    setIdleTiming(idleSpeed);
    fade = { from: prev, to: next, t: 0, dur: SEAM_MS };
  }

  function startIdle(speed = 1) {
    if (!enabled) return;
    stopAll();
    state = 'idle';
    current = idleA;
    startGroup(idleA, speed * SPEED_SCALE, IDLE_RANGE);
    setIdleTiming(speed * SPEED_SCALE);
    idleA.weight = 1;
  }

  function applyLook() {
    wrapper.rotation.y = lookYaw;
    wrapper.rotation.x = sad ? -0.16 : 0;
  }

  // Babylon blends weighted animatables when the scene renders; drive the
  // idle/walk cross-fades and the idle seam from the same frame loop.
  const fadeObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime();
    if (fade) {
      fade.t += dt;
      const k = Math.min(1, fade.t / fade.dur);
      const e = k * k * (3 - 2 * k);
      fade.from.weight = 1 - e;
      fade.to.weight = e;
      if (k >= 1) finishFade();
    }
    // Keep the seam timer running during an idle fade too, so the next
    // seam still lands just before the clip's own end.
    if (isIdle(current)) {
      idleTimer -= dt;
      if (!fade && idleTimer <= 0) seamIdle();
    }
  });

  return {
    wrapper,
    meshes,

    /** Blend back into the idle clip (idempotent). */
    playIdle() {
      if (!enabled) return;
      if (isIdle(current)) {
        state = 'idle';
        return;
      }
      idleSpeed = SPEED_SCALE;
      fadeTo(nextIdle(), idleSpeed, IDLE_RANGE, 'idle');
    },

    /**
     * Walking / running loop for a gameplay move. The GLB has only one
     * walk clip, so every movement kind (including jumps) uses it.
     * @param {string} kind walk | hop | jump | arc | slide | tunnel | dash | run | happy
     */
    playMove(kind) {
      const speed =
        kind === 'dash'
          ? 5
          : kind === 'jump' || kind === 'arc' || kind === 'happy'
            ? 4
            : kind === 'slide'
              ? 1.8
              : kind === 'tunnel'
                ? 1
                : kind === 'run'
                  ? 2.2
                  : 3.2;
      fadeTo(walk, speed * SPEED_SCALE, WALK_RANGE, 'walk');
    },

    /** Slow idle = the cat is caught (trapperWin). */
    playLose() {
      sad = true;
      applyLook();
      if (!enabled) return;
      const slow = 0.35 * SPEED_SCALE;
      if (isIdle(current)) {
        if (idleSpeed !== slow) {
          // Preserve the remaining clip frames when the speed changes.
          idleTimer *= idleSpeed / slow;
          idleSpeed = slow;
          current.speedRatio = slow;
        }
        state = 'lose';
        return;
      }
      fadeTo(nextIdle(), slow, IDLE_RANGE, 'lose');
    },

    /** The cat calms down again after a result / rebuild. */
    resetMood() {
      sad = false;
      lookYaw = 0;
      applyLook();
      startIdle(1);
    },

    /** Pause / resume the skeletal animation without affecting movement. */
    setAnimated(on) {
      enabled = !!on;
      if (!enabled) {
        stopAll();
        return;
      }
      startIdle(1);
    },

    /** Turn the whole model toward the hovered cell (±0.75 rad). */
    setLookYaw(yaw) {
      lookYaw = Math.max(-0.75, Math.min(0.75, yaw));
      applyLook();
    },

    setVisibility(v) {
      for (const mesh of meshes) mesh.visibility = v;
    },

    dispose() {
      if (fadeObserver) scene.onBeforeRenderObservable.remove(fadeObserver);
      stopAll();
      for (const group of groups) group.dispose();
      for (const skeleton of entries.skeletons || []) skeleton.dispose();
      disposeEntries(entries, wrapper);
    },
  };
}

function disposeEntries(entries, wrapper) {
  wrapper.dispose(false, false);
  for (const node of entries.rootNodes || []) {
    if (!node.isDisposed()) node.dispose(false, false);
  }
}

/**
 * Load (once) and instantiate the cat model for one catView.
 * @returns {Promise<ReturnType<typeof instantiate>|null>}
 */
export async function loadCatModel(scene, parent, index, baseScale, footLocalY) {
  const container = await templateFor(scene);
  if (!container) return null;
  return instantiate(scene, container, index, parent, baseScale, footLocalY);
}
