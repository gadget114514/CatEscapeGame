/**
 * Shared helpers for the gimmick render modules (spec 13.5): cached
 * materials. Every module builds procedural shapes only — no asset files.
 */
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

/** scene → (cache key → material) cache, so modules share safely. */
const cache = new WeakMap();

/**
 * Cached StandardMaterial per (scene, name).
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {string} name
 * @param {string} hex
 * @param {{emissive?:number, specular?:string|null, gloss?:boolean}} [opts]
 * @returns {StandardMaterial}
 */
export function cachedMaterial(scene, name, hex, opts = {}) {
  let perScene = cache.get(scene);
  if (!perScene) {
    perScene = new Map();
    cache.set(scene, perScene);
  }
  const key = `${name}:${hex}:${opts.emissive ?? 0.15}:${opts.specular ?? ''}:${opts.gloss ? 1 : 0}`;
  let mat = perScene.get(key);
  if (!mat) {
    mat = new StandardMaterial(name, scene);
    const color = Color3.FromHexString(hex);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(opts.emissive ?? 0.15);
    mat.specularColor =
      opts.specular === null
        ? Color3.Black()
        : opts.specular
          ? Color3.FromHexString(opts.specular)
          : opts.gloss
            ? new Color3(0.6, 0.7, 0.8)
            : Color3.Black();
    perScene.set(key, mat);
  }
  return mat;
}

/** Height of a cell's top surface (CELL_HEIGHT / 2 in boardView.js). */
export const CELL_TOP = 0.15;
