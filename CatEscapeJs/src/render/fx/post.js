/**
 * Post-processing and glow (Rev. 6, spec 17.4): the `high` pipeline
 * (bloom / FXAA / vignette), the custom "shockwave" radial-distortion
 * post fired on the escape/trap moment and on a corner jump, the
 * desaturation fade for the trapped moment, and the glow layer for
 * emissive items / portals / the power aura (high + medium).
 */
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';
// Tree-shaken side-effect imports (task 26 fix pass): the engine
// extension that allocates every post-process / glow render target and
// the scene components the pipeline and the glow layer register into.
// (The bloom / FXAA / imageProcessing shaders load themselves through
// the Thin* `_gatherImports` dynamic imports, so they need no pinning.)
import '@babylonjs/core/Engines/Extensions/engine.renderTarget.js'; // engine.createRenderTargetTexture
import '@babylonjs/core/Layers/effectLayerSceneComponent.js'; // glow layer scene wiring
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent.js';
import { registerFxShaders } from './shaders.js';

let shadersRegistered = false;

/** Register the fx shader sources once per process. */
function ensureShaders() {
  if (shadersRegistered) return;
  registerFxShaders(Effect);
  shadersRegistered = true;
}

/**
 * The `high`-only bloom / FXAA / vignette pipeline.
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @returns {DefaultRenderingPipeline}
 */
export function createFxPipeline(scene) {
  ensureShaders();
  const pipeline = new DefaultRenderingPipeline('fxPipeline', true, scene, [scene.activeCamera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.8;
  pipeline.bloomWeight = 0.35;
  pipeline.bloomKernel = 48;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 1.6;
  // (Babylon 8 dropped `vignetteCameraMode`; the default distance-style
  // vignette comes from `vignetteEnabled` + `vignetteWeight`.)
  pipeline.imageProcessing.toneMappingEnabled = false;
  return pipeline;
}

/**
 * The emissive glow layer (high + medium).
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @returns {GlowLayer}
 */
export function createFxGlow(scene) {
  const glow = new GlowLayer('fxGlow', scene, {
    mainTextureRatio: 0.5,
    blurKernelSize: 32,
  });
  glow.intensity = 0.65;
  return glow;
}

/**
 * The reusable shockwave post-process (radial distortion). It is created
 * once and attached / detached per shot so the pass costs nothing while
 * idle.
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {import('@babylonjs/core/Cameras/camera.js').Camera} camera
 * @returns {{fire(at:{x:number,y:number}, durMs:number):void,
 *            update(dtMs:number):void, dispose():void}}
 */
export function createShockwavePost(scene, camera) {
  ensureShaders();
  /** @type {PostProcess|null} */
  let pp = null;
  let active = 0;
  let dur = 1;
  let t = 0;
  let centerX = 0.5;
  let centerY = 0.5;

  function ensure() {
    if (pp) return pp;
    pp = new PostProcess('fxShockwave', 'FxShockwave', ['time', 'center', 'strength'], null, 1.0, camera);
    pp.onApply = (effect) => {
      effect.setFloat('time', t);
      effect.setFloat2('center', centerX, centerY);
      effect.setFloat('strength', 1.0);
    };
    return pp;
  }

  return {
    /**
     * @param {{x:number, y:number}} center normalized 0..1 screen point
     * @param {number} [durMs]
     */
    fire(center, durMs = 450) {
      centerX = center.x;
      centerY = center.y;
      dur = Math.max(1, durMs);
      t = 0;
      active = dur;
      const proc = ensure();
      if (camera && camera.detachPostProcess) camera.detachPostProcess(proc);
      camera.attachPostProcess(proc);
    },

    /**
     * @param {number} dtMs
     */
    update(dtMs) {
      if (active <= 0 || !pp) return;
      active = Math.max(0, active - dtMs);
      t = Math.min(1, t + dtMs / dur);
      if (active <= 0 && camera && camera.detachPostProcess) {
        camera.detachPostProcess(pp);
      }
    },

    dispose() {
      if (pp) {
        if (camera && camera.detachPostProcess) camera.detachPostProcess(pp);
        pp.dispose();
        pp = null;
      }
      active = 0;
    },
  };
}

/**
 * The desaturation fade for the trapped moment (spec 17.2): attach,
 * animate `amount` 0 → 1 over the duration, then leave it applied until
 * `reset()` (the next rebuild clears the mood).
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {import('@babylonjs/core/Cameras/camera.js').Camera} camera
 * @returns {{fade(durMs:number):void, reset():void, update(dtMs:number):void,
 *            dispose():void}}
 */
export function createDesatPost(scene, camera) {
  ensureShaders();
  /** @type {PostProcess|null} */
  let pp = null;
  let amount = 0;
  let animating = 0;
  let dur = 1;

  function ensure() {
    if (pp) return pp;
    pp = new PostProcess('fxDesat', 'FxDesat', ['amount'], null, 1.0, camera);
    pp.onApply = (effect) => {
      effect.setFloat('amount', amount);
    };
    return pp;
  }

  return {
    /**
     * @param {number} [durMs]
     */
    fade(durMs = 600) {
      dur = Math.max(1, durMs);
      animating = dur;
      const proc = ensure();
      // a non-reusable PostProcess must not be attached twice (task 26)
      if (camera && camera.detachPostProcess) camera.detachPostProcess(proc);
      camera.attachPostProcess(proc);
    },

    reset() {
      amount = 0;
      animating = 0;
      if (pp && camera && camera.detachPostProcess) camera.detachPostProcess(pp);
    },

    /**
     * @param {number} dtMs
     */
    update(dtMs) {
      if (animating <= 0) return;
      animating = Math.max(0, animating - dtMs);
      amount = Math.min(1, amount + dtMs / dur);
      if (animating <= 0) amount = 1;
    },

    dispose() {
      if (pp) {
        if (camera && camera.detachPostProcess) camera.detachPostProcess(pp);
        pp.dispose();
        pp = null;
      }
      animating = 0;
      amount = 0;
    },
  };
}
