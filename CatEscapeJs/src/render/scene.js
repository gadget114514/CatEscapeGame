/**
 * Scene, engine, camera and lights.
 * `@babylonjs/core` deep imports only (tree-shaken).
 */
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
// side effects needed for tree-shaken builds:
import '@babylonjs/core/Culling/ray.js'; // enables scene.pick
import '@babylonjs/core/Events/pointerEvents.js'; // enables onPointerObservable
import { computeCameraFit, computeOrthoBounds } from './fit.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{engine: Engine, scene: Scene, camera: ArcRotateCamera,
 *            setCameraMode(mode:'perspective'|'ortho'):void}}
 */
export function createScene(canvas) {
  const engine = new Engine(canvas, true, { adaptToDeviceRatio: true });
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.118, 0.165, 0.22, 1); // #1e2a38

  const camera = new ArcRotateCamera(
    'camera',
    -Math.PI / 2, // alpha
    0.85, // beta
    22, // radius
    Vector3.Zero(), // target — the board is centered on the origin
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerBetaLimit = 0.5;
  camera.upperBetaLimit = 1.1;
  camera.lowerRadiusLimit = 15;
  camera.upperRadiusLimit = 35;
  camera.panningSensibility = 0; // panning off

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.55; // Rev. 3: 0.8 blew the colors out
  hemi.groundColor = Color3.FromHexString('#404850');
  const dir = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
  dir.intensity = 0.35; // Rev. 3: 0.5 blew the colors out

  window.addEventListener('resize', () => engine.resize());

  /**
   * Switch between the tilted 3D camera and the straight top-down
   * orthographic view (section 12.7). Input is detached in ortho mode (no
   * rotation, no zoom); switching does not restart the game. Callers should
   * re-fit afterwards (`fitCamera` / `fitOrthoCamera`).
   * @param {'perspective'|'ortho'} mode
   */
  function setCameraMode(mode) {
    if (mode === 'ortho') {
      camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
      camera.alpha = -Math.PI / 2;
      camera.beta = 0.0001; // (almost) straight from above
      camera.lowerBetaLimit = 0; // the usual 0.5 floor would force beta up
      camera.target.set(0, 0, 0); // the ortho bounds carry the HUD shift
      camera.detachControl();
    } else {
      camera.mode = Camera.PERSPECTIVE_CAMERA;
      camera.lowerBetaLimit = 0.5;
      camera.upperBetaLimit = 1.1;
      camera.beta = Math.min(Math.max(camera.beta, 0.5), 1.1); // leave ortho's flat beta
      camera.attachControl(canvas, true);
    }
  }

  return { engine, scene, camera, setCameraMode };
}

/**
 * Camera auto-fit (section 7.1 Rev. 3): fit the whole board, set the radius
 * limits and shift the target so the board is centered below the HUD.
 * Call on startup and on every resize.
 * @param {ArcRotateCamera} camera
 * @param {Engine} engine
 * @param {{hx:number, hz:number}} extent board half-extents (see fit.js)
 */
export function fitCamera(camera, engine, extent) {
  const width = engine.getRenderWidth();
  const height = Math.max(1, engine.getRenderHeight());
  const hud = document.getElementById('hud');
  const hudHeightPx = hud ? hud.getBoundingClientRect().height : 0;
  const fit = computeCameraFit({
    aspect: width / height,
    vFov: camera.fov,
    hx: extent.hx,
    hz: extent.hz,
    hudHeightPx,
    canvasHeightPx: height,
  });
  camera.lowerRadiusLimit = fit.lowerRadiusLimit;
  camera.upperRadiusLimit = fit.upperRadiusLimit;
  camera.radius = fit.radius;
  camera.target.z = fit.targetZ;
}

/**
 * Ortho counterpart of `fitCamera` (section 12.7): recompute the
 * orthographic bounds from the canvas aspect and the HUD fraction.
 * Call on startup, on every resize and after switching the camera mode.
 * @param {ArcRotateCamera} camera
 * @param {Engine} engine
 * @param {{hx:number, hz:number}} extent board half-extents (see fit.js)
 */
export function fitOrthoCamera(camera, engine, extent) {
  const width = engine.getRenderWidth();
  const height = Math.max(1, engine.getRenderHeight());
  const hud = document.getElementById('hud');
  const hudHeightPx = hud ? hud.getBoundingClientRect().height : 0;
  const bounds = computeOrthoBounds({
    aspect: width / height,
    hx: extent.hx,
    hz: extent.hz,
    hudFrac: height > 0 ? hudHeightPx / height : 0,
  });
  camera.orthoLeft = bounds.left;
  camera.orthoRight = bounds.right;
  camera.orthoTop = bounds.top;
  camera.orthoBottom = bounds.bottom;
}
