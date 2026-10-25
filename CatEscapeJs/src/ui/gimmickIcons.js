/**
 * Small procedural SVG icons for the gimmicks (spec 13.4/13.8): level
 * cards, intro cards and the difficulty chart markers. Built with DOM
 * calls only — nothing inline that the CSP would block, no asset files.
 */
const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} name
 * @param {Record<string, string|number>} [attrs]
 * @returns {Element}
 */
function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Shape per gimmick id (colors match the board render, spec 13.3). */
const SHAPES = {
  stone: () => [el('rect', { x: 2, y: 4, width: 12, height: 8, rx: 1.5, fill: '#8a8f99' })],
  tunnel: () => [
    el('circle', { cx: 8, cy: 8, r: 5.5, fill: '#26303c' }),
    el('circle', { cx: 8, cy: 8, r: 3.8, fill: 'none', stroke: '#b06cff', 'stroke-width': 1.6 }),
  ],
  ice: () => [el('polygon', { points: '8,1.5 14,8 8,14.5 2,8', fill: '#bfe9ff' })],
  fish: () => [
    el('ellipse', { cx: 7, cy: 8, rx: 4.2, ry: 2.3, fill: '#d9b38c' }),
    el('polygon', { points: '11,8 15,5.4 15,10.6', fill: '#d9b38c' }),
  ],
  arrow: () => [
    el('path', {
      d: 'M2.5 8h7.5M8 4.8 12.8 8 8 11.2',
      stroke: '#f0f4f8',
      'stroke-width': 1.8,
      fill: 'none',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  ],
  brittle: () => [
    el('rect', { x: 2, y: 2.5, width: 12, height: 11, rx: 1.5, fill: '#63a85c' }),
    el('path', { d: 'M5 4.5 7.5 8 5.5 11.5M9.5 4 11 7.5 13 8.5', stroke: '#3c6b38', 'stroke-width': 1, fill: 'none' }),
  ],
  spring: () => [
    el('path', { d: 'M4.5 10.5h7M5 8h6M5.5 5.5h5', stroke: '#b0b8c0', 'stroke-width': 1.4 }),
    el('circle', { cx: 8, cy: 12.2, r: 2.4, fill: '#e05545' }),
  ],
  item: () => [el('polygon', { points: '8,1.5 13,8 8,14.5 3,8', fill: '#ffd23f' })],
  hammer: () => [
    el('rect', { x: 3, y: 3, width: 8, height: 3.4, rx: 1, fill: '#9aa5b1' }),
    el('rect', { x: 6.2, y: 6, width: 2, height: 7.5, rx: 1, fill: '#8a6d3b' }),
  ],
  double: () => [
    el('rect', { x: 2, y: 2, width: 7.5, height: 7.5, rx: 1.5, fill: '#ffd23f', opacity: 0.75 }),
    el('rect', { x: 6.5, y: 6.5, width: 7.5, height: 7.5, rx: 1.5, fill: '#ffd23f' }),
  ],
  storm: () => [
    el('circle', { cx: 5.5, cy: 8.5, r: 3, fill: '#9fb3c8' }),
    el('circle', { cx: 9, cy: 7.2, r: 3.4, fill: '#9fb3c8' }),
    el('circle', { cx: 11.8, cy: 9, r: 2.4, fill: '#9fb3c8' }),
    el('rect', { x: 3.5, y: 9, width: 10, height: 2.8, rx: 1.4, fill: '#9fb3c8' }),
  ],
  cats2: () => [
    el('circle', { cx: 5, cy: 9, r: 3, fill: '#f39c34' }),
    el('circle', { cx: 11, cy: 9, r: 3, fill: '#9aa5b1' }),
  ],
  cats3: () => [
    el('circle', { cx: 3.6, cy: 9.4, r: 2.4, fill: '#f39c34' }),
    el('circle', { cx: 8, cy: 8.6, r: 2.4, fill: '#9aa5b1' }),
    el('circle', { cx: 12.4, cy: 9.4, r: 2.4, fill: '#ffffff' }),
  ],
};

/** String-table key of the gimmick's name (spec glossary). */
export const ICON_NAME_KEY = {
  stone: 'stone',
  tunnel: 'tunnel',
  ice: 'ice',
  fish: 'fish',
  arrow: 'arrow',
  brittle: 'brittle',
  spring: 'spring',
  item: 'itemHammer',
  hammer: 'hammer',
  double: 'double',
  storm: 'storm',
  cats2: 'cats2',
  cats3: 'cats3',
};

/**
 * Bare icon (decorative — wrap with `labeledGimmickIcon` for a name).
 * @param {string} id gimmick id (see SHAPES)
 * @returns {SVGElement}
 */
export function gimmickIcon(id) {
  const svg = el('svg', {
    viewBox: '0 0 16 16',
    width: 14,
    height: 14,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const build = SHAPES[id] || SHAPES.item;
  for (const node of build()) svg.appendChild(node);
  return svg;
}

/**
 * Icon with an accessible name (level cards, intro cards).
 * @param {string} id
 * @param {string} name localized gimmick name
 * @returns {HTMLElement}
 */
export function labeledGimmickIcon(id, name) {
  const span = document.createElement('span');
  span.className = 'gim-icon';
  span.setAttribute('role', 'img');
  span.setAttribute('aria-label', name);
  span.title = name;
  span.appendChild(gimmickIcon(id));
  return span;
}
