/**
 * Stone render module (spec 13.3): a low grey tile `#8a8f99`.
 * The cell itself is styled thinner and lower; highlights still override
 * the look through the boardView.
 */
import { cachedMaterial } from './common.js';

export const STONE_SCALE = 0.5;
const STONE_Y = (-0.3 * (1 - STONE_SCALE)) / 2; // keeps the base on the board plane

export default {
  id: 'stone',
  build(scene, i, _state, ctx) {
    ctx.setCellStyle(i, {
      material: cachedMaterial(scene, 'gimStone', '#8a8f99'),
      scaleY: STONE_SCALE,
      y: STONE_Y,
    });
  },
  dispose() {},
};
