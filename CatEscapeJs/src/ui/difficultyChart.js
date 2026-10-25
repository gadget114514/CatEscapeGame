/**
 * Level difficulty chart (spec 13.8, updated by 14.6): an inline SVG
 * built with DOM calls only — no chart library, nothing inline that the
 * CSP blocks. Three estimated lines (easy/normal/hard, calibrated per
 * level, `src/game/play/levelStats*.json`) plus the player's own neutral
 * dots for one difficulty (the `易/普/難` toggle). Hovering a level shows
 * a tooltip; clicking an unlocked level selects it.
 *
 * `chartModel(stats, course, progress, opts)` is pure (no DOM) and holds
 * every number the SVG draws, so it is unit-testable on Node.
 */
import levelStats from '../game/play/levelStats.json';
import levelStatsBasic from '../game/play/levelStats.basic.json';
import { getLevel, blocksFor } from '../game/play/levels.js';
import { levelRange } from '../game/play/blocks.js';
import { isUnlocked, sumStatCell } from '../game/play/progress.js';
import { fmt, strings as liveStrings, formatEntry, getLang } from './strings.js';
import { gimmickIcon, ICON_NAME_KEY } from './gimmickIcons.js';

/** Line colors (14.6, validated on the #1e2a38 surface). */
export const LINE_COLORS = {
  easy: '#199e70', // aqua, dotted
  normal: '#3987e5', // blue, solid
  hard: '#d95926', // orange, dashed
};
const LINE_DASH = { easy: '2 4', normal: '', hard: '7 4' };
const TEXT_COLOR = '#cfe3f5';
const TEXT_COLOR_STRONG = '#eaf2f8';
const BAND_COLOR = 'rgba(102, 217, 255, 0.10)';
const GRID_COLOR = 'rgba(207, 227, 245, 0.25)';
const GRID_COLOR_STRONG = 'rgba(207, 227, 245, 0.45)';
const DIFFS = ['easy', 'normal', 'hard'];

/** The generated stats file for a rules kind (gimmick by default). */
export function statsFor(rules) {
  return rules === 'basic' ? levelStatsBasic : levelStats;
}

/**
 * Linear interpolation over ascending `xs`, clamped at both ends.
 * @param {number[]} xs
 * @param {number[]} ys
 * @param {number} x
 * @returns {number}
 */
function interpolate(xs, ys, x) {
  if (xs.length === 0) return NaN;
  if (xs.length === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const span = xs[i] - xs[i - 1];
      if (span <= 0) return ys[i];
      const t = (x - xs[i - 1]) / span;
      return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
    }
  }
  return ys[ys.length - 1];
}

/**
 * The slider's win-rate **estimate** (16.3) for a block count: the
 * measured `normal`-profile curve of the level when the sweep wrote one
 * (`stats.curves`), else a linear interpolation between the three
 * difficulty rates at their centers (the pre-sweep fallback, so the label
 * always shows a number).
 * @param {object} stats a `levelStats` body
 * @param {'escape'|'trapper'} course
 * @param {number} level 1..20
 * @param {number} blocks the count to estimate
 * @param {{profile?:'weak'|'normal'|'strong'}} [opts]
 * @returns {number|null} win rate 0..1, `null` when nothing is measured
 */
export function estimateRate(stats, course, level, blocks, opts = {}) {
  const profile = opts.profile || 'normal';
  const n = Math.min(Math.max(Math.floor(level) || 1, 1), 20);
  const curves = stats && stats.curves && stats.curves[course];
  const curve = curves && curves[profile] && curves[profile][n - 1];
  if (curve && Array.isArray(curve.blocks) && curve.blocks.length > 0) {
    const v = interpolate(curve.blocks, curve.rate, Number(blocks));
    return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : null;
  }
  // pre-sweep fallback: the three difficulty points of this level
  const table = (stats && stats.courses && stats.courses[course]) || {};
  const lv = getLevel(course, n);
  const rules = stats && stats.rules === 'basic' ? 'basic' : 'gimmick'; // 18.1
  const pts = [];
  for (const d of DIFFS) {
    const row = table[d];
    const rate = row && Number(row.rate && row.rate[n - 1]);
    if (Number.isFinite(rate)) pts.push({ blocks: blocksFor(lv, d, rules), rate });
  }
  if (pts.length === 0) return null;
  pts.sort((a, b) => a.blocks - b.blocks);
  const v = interpolate(
    pts.map((p) => p.blocks),
    pts.map((p) => p.rate),
    Number(blocks),
  );
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : null;
}

/**
 * Dot radius bucket by sample size (13.8): 4 px for 1–2 games, 6 px for
 * 3–9, 8 px for 10 or more.
 * @param {number} played
 * @returns {number}
 */
export function playerRadius(played) {
  if (played >= 10) return 8;
  if (played >= 3) return 6;
  return 4;
}

/**
 * Pure chart model (spec 13.8/14.6): points per line, the player's dots,
 * the locked flags, the current level, the unlock markers and the
 * summary classification.
 * @param {{courses:Record<string, Record<string, {rate:number[], avgMoves:number[]}>>}} stats
 * @param {'escape'|'trapper'} course
 * @param {import('../game/play/progress.js').Progress|null} progress
 * @param {{rules?:'basic'|'gimmick', current?:number, playerDifficulty?:string}} [opts]
 */
export function chartModel(stats, course, progress, opts = {}) {
  const rules = opts.rules === 'basic' ? 'basic' : 'gimmick';
  const current = Math.min(Math.max(Math.floor(opts.current) || 1, 1), 20);
  const playerDifficulty = DIFFS.includes(opts.playerDifficulty) ? opts.playerDifficulty : 'normal';
  const table = (stats && stats.courses && stats.courses[course]) || {};
  const n = 20;

  const locked = [];
  for (let level = 1; level <= n; level++) {
    locked.push(!isUnlocked(progress, rules, course, level));
  }

  /** @type {Record<string, {color:string, dash:string, points:Array<object>}>} */
  const lines = {};
  for (const d of DIFFS) {
    const row = table[d] || { rate: [], avgMoves: [] };
    const points = [];
    for (let level = 1; level <= n; level++) {
      const rate = Number(row.rate && row.rate[level - 1]);
      const moves = Number(row.avgMoves && row.avgMoves[level - 1]);
      points.push({
        level,
        rate: Number.isFinite(rate) ? rate : 0,
        moves: Number.isFinite(moves) ? moves : null,
        locked: locked[level - 1],
      });
    }
    lines[d] = { color: LINE_COLORS[d], dash: LINE_DASH[d], points };
  }

  // the player's own results for the toggle's difficulty (dots only).
  // 16.3: one cell holds one bucket per block count — the dots aggregate
  // over every count the level was played at.
  const playerPoints = [];
  const statsTable = progress && progress.stats && progress.stats[rules] && progress.stats[rules][course];
  let playedSum = 0;
  let wonSum = 0;
  for (let level = 1; level <= n; level++) {
    const cell = statsTable && statsTable[level - 1] && statsTable[level - 1][playerDifficulty];
    const { played, won } = sumStatCell(cell);
    if (played >= 1) {
      playedSum += played;
      wonSum += won;
      playerPoints.push({
        level,
        rate: won / played,
        won,
        played,
        radius: playerRadius(played),
        locked: locked[level - 1],
      });
    }
  }

  // unlock markers: every level whose `intro` announces something new
  const markers = [];
  for (let level = 1; level <= n; level++) {
    const lv = getLevel(course, level);
    if (lv.intro) markers.push({ level, id: lv.intro });
  }

  // summary: the player's overall rate vs the level-weighted means of the
  // easy (high) and hard (low) estimates on the played levels (13.8)
  let summary = null;
  if (playedSum > 0) {
    const playerRate = wonSum / playedSum;
    const mean = (d) => {
      let sum = 0;
      let count = 0;
      for (const p of playerPoints) {
        sum += lines[d].points[p.level - 1].rate;
        count++;
      }
      return count > 0 ? sum / count : 0;
    };
    const easyMean = mean('easy');
    const hardMean = mean('hard');
    if (playerRate > easyMean) summary = 'above';
    else if (playerRate < hardMean) summary = 'below';
    else summary = 'between';
  }

  return {
    rules,
    course,
    current,
    locked,
    lines,
    player: { difficulty: playerDifficulty, points: playerPoints },
    markers,
    summary,
  };
}

/* ------------------------------------------------------------------ SVG UI */

const NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 360;
const VIEW_H = 216;
const M = { left: 36, right: 12, top: 30, bottom: 26 };

/**
 * @param {string} name
 * @param {Record<string, string|number>} [attrs]
 * @returns {SVGElement}
 */
function svgEl(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * @param {number} level 1..20
 * @returns {number} svg x
 */
function xOf(level) {
  return M.left + ((level - 1) / 19) * (VIEW_W - M.left - M.right);
}

/**
 * @param {number} rate 0..1
 * @returns {number} svg y
 */
function yOf(rate) {
  return M.top + (1 - rate) * (VIEW_H - M.top - M.bottom);
}

/**
 * Create the chart UI: a `難易度グラフ` toggle button plus the (hidden)
 * chart panel. `render()` fills the SVG from `chartModel`.
 * @param {{getStats:()=>object, getSettings:()=>{rules?:string, course?:string,
 *          level?:number, difficulty?:string},
 *          getCourse?:()=>('escape'|'trapper'),
 *          getProgress:()=>import('../game/play/progress.js').Progress|null,
 *          onSelect:(level:number, course:'escape'|'trapper')=>void,
 *          strings?:Record<string, any>}} opts
 */
export function createDifficultyChart(opts) {
  const getStrings = () => opts.strings || liveStrings;
  /** @type {'easy'|'normal'|'hard'|null} null → follow the settings' difficulty */
  let playerDiff = null;
  let inited = false;

  /** The chart's 易/普/難 toggle: the settings' difficulty until clicked. */
  function activeDiff() {
    if (playerDiff) return playerDiff;
    const d = opts.getSettings().difficulty;
    return DIFFS.includes(d) ? /** @type {any} */ (d) : 'normal';
  }

  const wrap = document.createElement('div');
  wrap.id = 'chart-wrap';
  wrap.hidden = true;

  const diffBar = document.createElement('div');
  diffBar.id = 'chart-diff';
  diffBar.setAttribute('role', 'group');
  /** @type {Array<{btn:HTMLElement, diff:string}>} */
  const diffBtns = [];
  for (const d of DIFFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chart-diff-btn';
    btn.setAttribute('data-diff', d);
    btn.addEventListener('click', () => {
      playerDiff = /** @type {any} */ (d);
      render();
    });
    diffBar.appendChild(btn);
    diffBtns.push({ btn, diff: d });
  }

  // UI fix (task 26): the legend lives above the plot as a wrapping flex
  // row — the old in-SVG row overlapped the labels at small widths
  const legendEl = document.createElement('div');
  legendEl.id = 'chart-legend';
  legendEl.setAttribute('role', 'list');

  const holder = document.createElement('div');
  holder.id = 'chart-holder';
  const summaryEl = document.createElement('p');
  summaryEl.id = 'chart-summary';
  const tooltip = document.createElement('div');
  tooltip.id = 'chart-tooltip';
  tooltip.hidden = true;

  wrap.appendChild(diffBar);
  wrap.appendChild(legendEl);
  wrap.appendChild(holder);
  wrap.appendChild(summaryEl);
  wrap.appendChild(tooltip);

  function model() {
    const s = opts.getSettings();
    const course = opts.getCourse
      ? opts.getCourse()
      : s.course === 'trapper'
        ? 'trapper'
        : 'escape';
    return chartModel(opts.getStats(), course, opts.getProgress(), {
      rules: s.rules,
      current: s.level,
      playerDifficulty: activeDiff(),
    });
  }

  /** Tooltip text for a level (14.6/16.2): three estimates + the three
   *  block ranges + you + new. */
  function tooltipText(m, level) {
    const t = getStrings();
    const easy = Math.round(m.lines.easy.points[level - 1].rate * 100);
    const normal = Math.round(m.lines.normal.points[level - 1].rate * 100);
    const hard = Math.round(m.lines.hard.points[level - 1].rate * 100);
    const parts = [fmt(t.chartTooltip, { level, easy, normal, hard })];
    const lv = getLevel(m.course, level);
    const rangeOf = (d) => {
      const r = levelRange(lv, d, m.course, m.rules); // 18.1: per rules kind
      return `${r.min}–${r.max}`;
    };
    if (t.chartTooltipBlocks) {
      parts.push(
        fmt(t.chartTooltipBlocks, {
          easy: rangeOf('easy'),
          normal: rangeOf('normal'),
          hard: rangeOf('hard'),
        }),
      );
    }
    const moves = m.lines.normal.points[level - 1].moves;
    if (moves != null) {
      parts.push(formatEntry(getLang(), t.chartTooltipMoves, { n: Math.round(moves) }));
    }
    const you = m.player.points.find((p) => p.level === level);
    if (you) {
      parts.push(
        fmt(t.chartTooltipYou, {
          won: you.won,
          played: you.played,
          rate: Math.round(you.rate * 100),
        }),
      );
    }
    const marker = m.markers.find((mk) => mk.level === level);
    if (marker) {
      parts.push(fmt(t.chartTooltipNew, { name: t[ICON_NAME_KEY[marker.id]] || marker.id }));
    }
    return parts.join(' · ');
  }

  function showTooltip(level, clientX) {
    const m = model();
    tooltip.textContent = tooltipText(m, level);
    tooltip.hidden = false;
    const rect = holder.getBoundingClientRect();
    const px = rect.width ? ((xOf(level) - M.left) / (VIEW_W - M.left - M.right)) * rect.width : 0;
    const clamped = Math.max(8, Math.min(rect.width - 8, px));
    tooltip.style.left = `${clamped}px`;
    void clientX;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function render() {
    const t = getStrings();
    const m = model();
    const diff = activeDiff();
    for (const { btn, diff: d } of diffBtns) {
      btn.textContent = t[d] || d;
      btn.setAttribute('aria-pressed', String(d === diff));
    }
    diffBar.setAttribute('aria-label', t.difficulty);

    const svg = svgEl('svg', {
      id: 'chart-svg',
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      role: 'img',
      'aria-label': t.chartTitle,
    });

    // current level band
    svg.appendChild(
      svgEl('rect', {
        x: xOf(m.current) - 7,
        y: M.top - 4,
        width: 14,
        height: VIEW_H - M.top - M.bottom + 8,
        fill: BAND_COLOR,
      }),
    );

    // y gridlines + labels (0/25/50/75/100 %)
    for (const pct of [0, 25, 50, 75, 100]) {
      const y = yOf(pct / 100);
      svg.appendChild(
        svgEl('line', {
          x1: M.left,
          x2: VIEW_W - M.right,
          y1: y,
          y2: y,
          stroke: pct === 50 ? GRID_COLOR_STRONG : GRID_COLOR,
          'stroke-width': 1,
        }),
      );
      const label = svgEl('text', {
        x: M.left - 5,
        y: y + 3,
        'text-anchor': 'end',
        fill: TEXT_COLOR,
        'font-size': 9,
      });
      label.textContent = `${pct}%`;
      svg.appendChild(label);
    }

    // x ticks at 1, 5, 10, 15, 20
    for (const level of [1, 5, 10, 15, 20]) {
      const label = svgEl('text', {
        x: xOf(level),
        y: VIEW_H - M.bottom + 14,
        'text-anchor': 'middle',
        fill: TEXT_COLOR,
        'font-size': 9,
      });
      label.textContent = String(level);
      svg.appendChild(label);
    }

    // the three estimate lines + their markers
    for (const d of DIFFS) {
      const line = m.lines[d];
      const pts = line.points.map((p) => `${xOf(p.level)},${yOf(p.rate)}`).join(' ');
      svg.appendChild(
        svgEl('polyline', {
          points: pts,
          fill: 'none',
          stroke: line.color,
          'stroke-width': 2,
          'stroke-dasharray': line.dash || '',
          'stroke-linejoin': 'round',
        }),
      );
      for (const p of line.points) {
        svg.appendChild(
          svgEl('circle', {
            cx: xOf(p.level),
            cy: yOf(p.rate),
            r: 4,
            fill: line.color,
            opacity: p.locked ? 0.3 : 1,
          }),
        );
      }
    }

    // the player's neutral dots (13.8/14.6)
    const dotColor = LINE_COLORS[diff];
    for (const p of m.player.points) {
      svg.appendChild(
        svgEl('circle', {
          cx: xOf(p.level),
          cy: yOf(p.rate),
          r: p.radius,
          fill: dotColor,
          'fill-opacity': 0.4,
          stroke: TEXT_COLOR_STRONG,
          'stroke-width': 1.5,
        }),
      );
    }

    // unlock markers on the x axis
    for (const mk of m.markers) {
      const g = svgEl('g', { transform: `translate(${xOf(mk.level) - 6}, ${VIEW_H - M.bottom + 2})` });
      const foreign = document.createElementNS(NS, 'foreignObject');
      foreign.setAttribute('width', '12');
      foreign.setAttribute('height', '12');
      const box = document.createElement('div');
      box.style.width = '12px';
      box.style.height = '12px';
      box.style.lineHeight = '12px';
      box.appendChild(gimmickIcon(mk.id === 'cats2Escape' || mk.id === 'cats2Catch' ? 'cats2' : mk.id === 'cats3Escape' || mk.id === 'cats3Catch' ? 'cats3' : mk.id === 'hammer' ? 'hammer' : mk.id));
      foreign.appendChild(box);
      g.appendChild(foreign);
      svg.appendChild(g);
    }

    // legend (UI fix, task 26): a wrapping DOM row above the plot, each
    // label next to its line/dot sample — no overlap in any language
    legendEl.textContent = '';
    const legendEntries = [
      { label: t.easy, color: LINE_COLORS.easy, cls: 'easy' },
      { label: t.normal, color: LINE_COLORS.normal, cls: 'normal' },
      { label: t.hard, color: LINE_COLORS.hard, cls: 'hard' },
    ];
    for (const e of legendEntries) {
      const item = document.createElement('span');
      item.className = 'legend-item';
      item.setAttribute('role', 'listitem');
      const sample = document.createElement('span');
      sample.className = `legend-sample ${e.cls}`;
      sample.style.borderTopColor = e.color;
      sample.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = e.label;
      item.appendChild(sample);
      item.appendChild(label);
      legendEl.appendChild(item);
    }
    const youItem = document.createElement('span');
    youItem.className = 'legend-item';
    youItem.setAttribute('role', 'listitem');
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = dotColor;
    dot.setAttribute('aria-hidden', 'true');
    const youLabel = document.createElement('span');
    youLabel.textContent = t.chartYou;
    youItem.appendChild(dot);
    youItem.appendChild(youLabel);
    legendEl.appendChild(youItem);

    // per-level hover/click columns (tooltip + select)
    for (let level = 1; level <= 20; level++) {
      const colW = (VIEW_W - M.left - M.right) / 19;
      const rect = svgEl('rect', {
        x: xOf(level) - colW / 2,
        y: M.top - 6,
        width: colW,
        height: VIEW_H - M.top - M.bottom + 12,
        fill: 'transparent',
        style: 'cursor: pointer',
      });
      rect.addEventListener('pointerenter', () => showTooltip(level));
      rect.addEventListener('pointerleave', hideTooltip);
      rect.addEventListener('click', () => {
        if (m.locked[level - 1]) return;
        const course = m.course;
        hideTooltip();
        opts.onSelect(level, course);
      });
      svg.appendChild(rect);
    }

    holder.textContent = '';
    holder.appendChild(svg);

    const t2 = getStrings();
    summaryEl.hidden = !m.summary;
    if (m.summary) {
      summaryEl.textContent =
        m.summary === 'above'
          ? t2.chartSummaryAbove
          : m.summary === 'below'
            ? t2.chartSummaryBelow
            : t2.chartSummaryBetween;
    }
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.id = 'chart-toggle';
  const toggle = () => {
    wrap.hidden = !wrap.hidden;
    toggleBtn.setAttribute('aria-expanded', String(!wrap.hidden));
    if (!wrap.hidden) render();
  };
  toggleBtn.addEventListener('click', toggle);

  return {
    /** The `難易度グラフ` button (place it above the level grid). */
    toggleBtn,
    /** The chart panel (hidden until toggled). */
    panel: wrap,
    /** Re-render with fresh strings/data (open overlay, language switch). */
    refresh() {
      if (!wrap.hidden) render();
    },
    isOpen() {
      return !wrap.hidden;
    },
    /** Test/DOM-ready helper: render now (builds the SVG). */
    init() {
      if (!inited) {
        inited = true;
      }
      render();
    },
    /** @returns {ReturnType<typeof chartModel>} the current pure model */
    model() {
      return model();
    },
  };
}
