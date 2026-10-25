/**
 * Gimmick render registry (spec 13.5): the render modules in unlock
 * order; `view.rebuild` (via boardView) loops over them. Each module is
 * `{ id, build(scene, i, state, ctx), update?(state), dispose(i) }`.
 * The cell-kind numbers come from the pure game modules (no logic is
 * duplicated here).
 */
import { KIND_STONE, KIND_TUNNEL, KIND_ICE, KIND_FISH, KIND_ARROW, KIND_BRITTLE, KIND_SPRING, KIND_ITEM } from '../../game/gimmick/registry.js';
import stone from './stone.js';
import tunnel from './tunnel.js';
import ice from './ice.js';
import fish from './fish.js';
import arrow from './arrow.js';
import brittle from './brittle.js';
import spring from './spring.js';
import item from './item.js';

/** Modules in unlock order (13.4/14.2). */
export const GIMMICK_RENDERERS = [stone, tunnel, ice, fish, arrow, brittle, spring, item];

/** Fast lookup by cell kind (state.g.kind / state.cells numbering). */
export const RENDER_BY_KIND = [];
RENDER_BY_KIND[KIND_STONE] = stone;
RENDER_BY_KIND[KIND_TUNNEL] = tunnel;
RENDER_BY_KIND[KIND_ICE] = ice;
RENDER_BY_KIND[KIND_FISH] = fish;
RENDER_BY_KIND[KIND_ARROW] = arrow;
RENDER_BY_KIND[KIND_BRITTLE] = brittle;
RENDER_BY_KIND[KIND_SPRING] = spring;
RENDER_BY_KIND[KIND_ITEM] = item;

/** Module lookup by gimmick id (`item`, `tunnel`, …). */
export const RENDER_BY_ID = {};
for (const m of GIMMICK_RENDERERS) RENDER_BY_ID[m.id] = m;
