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
const TARGET_LENGTH = 0.85; // keeps the cat inside one hex cell (CELL_SIZE 1.0)

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
  const idle = base.clone(`catModelIdle-${index}`);
  const walk = base.clone(`catModelWalk-${index}`);
  const groups = [base, idle, walk];

  let state = 'none';
  let sad = false;
  let lookYaw = 0;

  function stopAll() {
    for (const group of groups) group.stop();
  }

  function startIdle(speed = 1) {
    stopAll();
    state = 'idle';
    idle.start(true, speed, frames(IDLE_RANGE[0]), frames(IDLE_RANGE[1]));
  }

  function startWalk(speed) {
    stopAll();
    state = 'walk';
    walk.start(true, speed, frames(WALK_RANGE[0]), frames(WALK_RANGE[1]));
  }

  function applyLook() {
    wrapper.rotation.y = lookYaw;
    wrapper.rotation.x = sad ? -0.16 : 0;
  }

  return {
    wrapper,
    meshes,

    /** Loop the idle clip (idempotent). */
    playIdle() {
      if (state !== 'idle') startIdle(1);
    },

    /**
     * Walking / running loop for a gameplay move.
     * @param {string} kind hop | arc | slide | tunnel | dash | run | happy
     */
    playMove(kind) {
      const speed =
        kind === 'dash'
          ? 5
          : kind === 'arc' || kind === 'happy'
            ? 4
            : kind === 'slide'
              ? 1.8
              : kind === 'tunnel'
                ? 1
                : kind === 'run'
                  ? 2.2
                  : 3.2;
      startWalk(speed);
    },

    /** Slow idle = the cat is caught (trapperWin). */
    playLose() {
      sad = true;
      applyLook();
      stopAll();
      state = 'lose';
      idle.start(true, 0.35, frames(IDLE_RANGE[0]), frames(IDLE_RANGE[1]));
    },

    /** The cat calms down again after a result / rebuild. */
    resetMood() {
      sad = false;
      lookYaw = 0;
      applyLook();
      state = 'none';
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
