/**
 * Task 26 fix-pass test: every `src/render/fx` module must import
 * cleanly on Node (no DOM needed at import time), and the source of the
 * Babylon-touching modules must pin the side-effect imports a
 * tree-shaken build needs — most importantly the engine extension that
 * adds `createDynamicTexture` (the console error the designer saw), plus
 * the particle scene component, the render-target extension and the
 * scene components. It also guards against the two Babylon-8 API bugs we
 * fixed: `DynamicTexture.getWidth` (removed) and
 * `pipeline.setEnabled` / `glow.setEnabled` (never existed).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const fxDir = new URL('../src/render/fx/', import.meta.url);
const FX_FILES = fs
  .readdirSync(fileURLToPath(fxDir))
  .filter((f) => f.endsWith('.js'))
  .sort();

/**
 * @param {string} file
 * @returns {string} the module source
 */
function readFx(file) {
  return fs.readFileSync(new URL(file, fxDir), 'utf8');
}

/**
 * Every side-effect-only import specifier (`import 'x';`) in a source.
 * @param {string} src
 * @returns {string[]}
 */
function sideEffectImports(src) {
  return [...src.matchAll(/^\s*import\s+['"]([^'"]+)['"];\s*(?:\/\/.*)?$/gm)].map((m) => m[1]);
}

describe('fx modules import cleanly on node (task 26)', () => {
  it('imports every src/render/fx module', async () => {
    expect(FX_FILES.length).toBeGreaterThanOrEqual(7);
    for (const f of FX_FILES) {
      await import(new URL(f, fxDir).href);
    }
  });
});

describe('fx side-effect imports for the tree-shaken build (task 26)', () => {
  it('particles.js pins the engine dynamicTexture extension', () => {
    const imports = sideEffectImports(readFx('particles.js'));
    expect(imports).toContain('@babylonjs/core/Engines/Extensions/engine.dynamicTexture.js');
  });

  it('particles.js pins the particle scene component and its shaders', () => {
    const imports = sideEffectImports(readFx('particles.js'));
    expect(imports).toContain('@babylonjs/core/Particles/particleSystemComponent.js');
    expect(imports).toContain('@babylonjs/core/Shaders/particles.vertex.js');
    expect(imports).toContain('@babylonjs/core/Shaders/particles.fragment.js');
  });

  it('post.js pins the render-target extension and the scene components', () => {
    const imports = sideEffectImports(readFx('post.js'));
    expect(imports).toContain('@babylonjs/core/Engines/Extensions/engine.renderTarget.js');
    expect(imports).toContain('@babylonjs/core/Layers/effectLayerSceneComponent.js');
    expect(imports).toContain(
      '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent.js',
    );
  });
});

describe('fx modules avoid removed / nonexistent Babylon APIs (task 26)', () => {
  it('no fx module calls DynamicTexture.getWidth / getHeight', () => {
    for (const f of FX_FILES) {
      const src = readFx(f);
      expect(src, f).not.toMatch(/\.getWidth\s*\(/);
      expect(src, f).not.toMatch(/\.getHeight\s*\(/);
    }
  });

  it('no fx module calls pipeline.setEnabled / glow.setEnabled (absent in Babylon 8)', () => {
    for (const f of FX_FILES) {
      const src = readFx(f);
      expect(src, f).not.toMatch(/\bpipeline\.setEnabled\s*\(/);
      expect(src, f).not.toMatch(/\bglow\.setEnabled\s*\(/);
    }
  });

  it('the render modules avoid the same removed APIs', () => {
    const renderDir = new URL('../src/render/', import.meta.url);
    const files = [
      'boardView.js',
      'catView.js',
      'view.js',
      'gimmicks/ice.js',
      'gimmicks/tunnel.js',
      'gimmicks/spring.js',
      'gimmicks/item.js',
    ];
    for (const f of files) {
      const src = fs.readFileSync(new URL(f, renderDir), 'utf8');
      expect(src, f).not.toMatch(/\.getWidth\s*\(/);
      expect(src, f).not.toMatch(/\.getHeight\s*\(/);
      expect(src, f).not.toMatch(/\bpipeline\.setEnabled\s*\(/);
      expect(src, f).not.toMatch(/\bglow\.setEnabled\s*\(/);
    }
  });
});
