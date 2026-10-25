/**
 * Difficulty chart tests (spec 13.8 / 14.6): the pure `chartModel` on
 * Node and a DOM-light check of the SVG (20 points per line, clicking an
 * unlocked level selects it).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  chartModel,
  createDifficultyChart,
  statsFor,
  playerRadius,
  estimateRate,
  LINE_COLORS,
} from '../src/ui/difficultyChart.js';
import { defaultProgress, recordResult } from '../src/game/play/progress.js';
import { getLevel, blocksFor } from '../src/game/play/levels.js';
import { levelRange } from '../src/game/play/blocks.js';
import { STRINGS } from '../src/ui/strings.js';

/** Synthetic stats file: known rates per course/difficulty. */
function fakeStats(course = 'escape') {
  const row = (base) => ({
    rate: Array.from({ length: 20 }, (_, i) => Math.max(0, base - i * 0.03)),
    blocks: new Array(20).fill(5),
    avgMoves: Array.from({ length: 20 }, (_, i) => 10 + i * 0.5),
  });
  return {
    generatedAt: '2026-10-23',
    games: 200,
    rules: 'gimmick',
    courses: {
      [course]: { easy: row(0.95), normal: row(0.8), hard: row(0.65) },
    },
  };
}

/** A progress with `wins` unlocks per course (3 wins open the next level). */
function progressWithWins(course, wins) {
  const p = defaultProgress();
  p.level.gimmick[course] = wins.slice();
  return p;
}

describe('chartModel (pure, 13.8/14.6)', () => {
  it('returns 20 points per line with the palette and locked flags', () => {
    const stats = fakeStats('escape');
    const progress = progressWithWins('escape', [3, 3, 3, ...new Array(17).fill(0)]);
    const m = chartModel(stats, 'escape', progress, { current: 3 });
    expect(m.current).toBe(3);
    expect(m.lines.easy.color).toBe(LINE_COLORS.easy);
    expect(m.lines.normal.dash).toBe('');
    expect(m.lines.hard.dash).not.toBe('');
    for (const d of ['easy', 'normal', 'hard']) {
      expect(m.lines[d].points.length).toBe(20);
      expect(m.lines[d].points[0].rate).toBeCloseTo(stats.courses.escape[d].rate[0], 10);
      expect(m.lines[d].points[4].moves).toBeCloseTo(12, 10);
    }
    // L1-L4 unlocked (three wins on L3 open L4), the rest locked
    expect(m.locked.slice(0, 4)).toEqual([false, false, false, false]);
    expect(m.locked[4]).toBe(true);
    expect(m.lines.easy.points[4].locked).toBe(true);
  });

  it('unlock markers follow the level intro column', () => {
    const m = chartModel(fakeStats('escape'), 'escape', defaultProgress(), {});
    const levels = m.markers.map((mk) => mk.level);
    // the escape course's `intro` levels (levels.js 14.3 table)
    expect(levels).toContain(2); // stone
    expect(levels).toContain(6); // tunnel
    expect(levels).toContain(14); // spring
    expect(levels).toContain(17); // cats2Escape
    const ids = m.markers.map((mk) => mk.id);
    expect(ids).toContain('stone');
    expect(ids).toContain('tunnel');
  });

  it('player points: radius buckets and the selected difficulty', () => {
    const progress = progressWithWins('escape', new Array(20).fill(3));
    // two played levels: noisy (2 games) and solid (12 games)
    progress.stats.gimmick.escape[1].normal = { played: 2, won: 1 }; // 50%
    progress.stats.gimmick.escape[4].normal = { played: 12, won: 6 }; // 50%
    const m = chartModel(fakeStats('escape'), 'escape', progress, {
      current: 1,
      playerDifficulty: 'normal',
    });
    expect(m.player.points.length).toBe(2);
    expect(m.player.points[0].radius).toBe(4);
    expect(m.player.points[1].radius).toBe(8);
    expect(m.player.points[0].rate).toBeCloseTo(0.5, 10);
    expect(playerRadius(3)).toBe(6);
    expect(playerRadius(9)).toBe(6);

    // a different difficulty sees different dots
    const hard = chartModel(fakeStats('escape'), 'escape', progress, {
      playerDifficulty: 'hard',
    });
    expect(hard.player.points.length).toBe(0);
  });

  it('classifies the summary against the easy/hard means', () => {
    const progress = progressWithWins('escape', new Array(20).fill(3));
    // 100% on every played level → above the easy line (max ~95%)
    progress.stats.gimmick.escape[0].normal = { played: 5, won: 5 };
    let m = chartModel(fakeStats('escape'), 'escape', progress, {});
    expect(m.summary).toBe('above');

    // 0% → below the hard line
    progress.stats.gimmick.escape[0].normal = { played: 5, won: 0 };
    m = chartModel(fakeStats('escape'), 'escape', progress, {});
    expect(m.summary).toBe('below');

    // around 80% → between easy (95%) and hard (65%)
    progress.stats.gimmick.escape[0].normal = { played: 5, won: 4 };
    m = chartModel(fakeStats('escape'), 'escape', progress, {});
    expect(m.summary).toBe('between');

    // nothing played → no summary
    const fresh = defaultProgress();
    m = chartModel(fakeStats('escape'), 'escape', fresh, {});
    expect(m.summary).toBeNull();
  });

  it('the committed levelStats files load for both rules kinds', () => {
    for (const rules of ['gimmick', 'basic']) {
      const stats = statsFor(rules);
      expect(stats.courses.escape.easy.rate.length).toBe(20);
      expect(stats.courses.trapper.hard.rate.length).toBe(20);
    }
  });

  it('estimateRate interpolates the sweep curve, else the difficulty points (16.3)', () => {
    const stats = fakeStats('escape');
    stats.curves = {
      escape: {
        normal: [
          { blocks: [0, 4, 8], rate: [0.9, 0.5, 0.1], avgMoves: [], games: [] },
        ],
      },
    };
    expect(estimateRate(stats, 'escape', 1, 6)).toBeCloseTo(0.3, 10); // between 4 and 8
    expect(estimateRate(stats, 'escape', 1, 0)).toBeCloseTo(0.9, 10); // clamped left
    expect(estimateRate(stats, 'escape', 1, 99)).toBeCloseTo(0.1, 10); // clamped right
    // level 2 has no curve → the three difficulty rates at their centers
    expect(estimateRate(stats, 'escape', 2, 3)).toBeCloseTo(0.92, 10);
    expect(estimateRate({}, 'escape', 1, 5)).toBeNull();
  });

  it('player stats survive recordResult (14.6 per-difficulty)', () => {
    let p = defaultProgress();
    const ctx = {
      rules: 'gimmick',
      play: 'level',
      role: 'escape',
      difficulty: 'hard',
      course: 'escape',
      level: 5,
      items: { cat: { hammer: 0 }, trapper: { double: 0 } },
    };
    p = recordResult(p, ctx, 'catWin').progress;
    p = recordResult(p, ctx, 'trapperWin').progress;
    // 16.3: one bucket per block count; no count given → the L5 hard center
    const center = String(blocksFor(getLevel('escape', 5), 'hard', 'gimmick'));
    expect(p.stats.gimmick.escape[4].hard).toEqual({ [center]: { played: 2, won: 1 } });
  });
});

/* ------------------------------------------------------------- SVG (DOM) */

function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    attributes: {},
    children: [],
    style: {},
    textContent: '',
    listeners: {},
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return k in this.attributes ? this.attributes[k] : null;
    },
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    getBoundingClientRect() {
      return { width: 360, height: 216, left: 0, top: 0 };
    },
  };
}

function stubSvgDocument() {
  globalThis.document = {
    createElement: (tag) => makeNode(tag),
    createElementNS: (_ns, tag) => makeNode(tag),
  };
}

/** Depth-first walk of the fake DOM tree. */
function walk(node, fn) {
  fn(node);
  for (const c of node.children || []) walk(c, fn);
}

function findAll(root, pred) {
  const out = [];
  walk(root, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
}

describe('difficulty chart SVG (13.8/14.6)', () => {
  afterEach(() => {
    delete globalThis.document;
  });

  function makeChart({ unlockedTo = 3, played = null } = {}) {
    stubSvgDocument();
    const wins = Array.from({ length: 20 }, (_, i) => (i < unlockedTo ? 3 : 0));
    const progress = progressWithWins('escape', wins);
    if (played) {
      progress.stats.gimmick.escape[played.level - 1][played.difficulty || 'normal'] = {
        played: played.played,
        won: played.won,
      };
    }
    const onSelect = vi.fn();
    const chart = createDifficultyChart({
      getStats: () => fakeStats('escape'),
      getSettings: () => ({ rules: 'gimmick', course: 'escape', level: 2, difficulty: 'normal' }),
      getProgress: () => progress,
      onSelect,
      strings: STRINGS.ja,
    });
    chart.init(); // builds the SVG
    return { chart, onSelect };
  }

  it('draws 20 points per line (60 markers total)', () => {
    const { chart } = makeChart();
    const svg = findAll(chart.panel, (n) => n.tagName === 'SVG')[0];
    expect(svg).toBeTruthy();
    const circles = findAll(svg, (n) => n.tagName === 'CIRCLE');
    // line markers carry the series color and no stroke (the legend's
    // player dot has a stroke and is excluded)
    const byColor = (color) =>
      circles.filter((c) => c.getAttribute('fill') === color && !c.getAttribute('stroke'));
    expect(byColor(LINE_COLORS.easy).length).toBe(20);
    expect(byColor(LINE_COLORS.normal).length).toBe(20);
    expect(byColor(LINE_COLORS.hard).length).toBe(20);
    // gridlines at 0/25/50/75/100 %
    const lines = findAll(svg, (n) => n.tagName === 'LINE');
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  it('the legend is a wrapping DOM row above the plot (task 26)', () => {
    const { chart } = makeChart();
    const legend = findAll(chart.panel, (n) => n.id === 'chart-legend')[0];
    expect(legend).toBeTruthy();
    // it sits above the plot holder inside the panel
    const holder = findAll(chart.panel, (n) => n.id === 'chart-holder')[0];
    const legendAt = chart.panel.children.indexOf(legend);
    const holderAt = chart.panel.children.indexOf(holder);
    expect(legendAt).toBeGreaterThanOrEqual(0);
    expect(holderAt).toBeGreaterThan(legendAt);
    // four items (easy/normal/hard/you), each sample next to its label
    expect(legend.children.length).toBe(4);
    const labels = [];
    for (const item of legend.children) {
      expect(item.children.length).toBe(2);
      expect(String(item.children[0].className)).toContain('legend-');
      labels.push(item.children[1].textContent);
    }
    expect(labels).toEqual([
      STRINGS.ja.easy,
      STRINGS.ja.normal,
      STRINGS.ja.hard,
      STRINGS.ja.chartYou,
    ]);
    // the old in-SVG legend is gone: only the 5 + 5 axis labels remain
    const svg = findAll(chart.panel, (n) => n.tagName === 'SVG')[0];
    const texts = findAll(svg, (n) => n.tagName === 'TEXT');
    expect(texts.length).toBe(10);
  });

  it('clicking an unlocked level selects it; locked levels do nothing', () => {
    const { chart, onSelect } = makeChart({ unlockedTo: 3 });
    const svg = findAll(chart.panel, (n) => n.tagName === 'SVG')[0];
    // the per-level hover columns are the last 20 transparent rects
    const rects = findAll(svg, (n) => n.tagName === 'RECT');
    const columns = rects.filter((r) => r.getAttribute('fill') === 'transparent');
    expect(columns.length).toBe(20);
    columns[1].listeners.click(); // L2 (unlocked)
    expect(onSelect).toHaveBeenCalledWith(2, 'escape');
    columns[9].listeners.click(); // L10 (locked)
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('the toggle opens the panel and the summary line appears', () => {
    const { chart } = makeChart({ played: { level: 2, played: 5, won: 3 } });
    expect(chart.panel.hidden).toBe(true);
    chart.toggleBtn.listeners.click();
    expect(chart.panel.hidden).toBe(false);
    expect(chart.toggleBtn.getAttribute('aria-expanded')).toBe('true');
    const summary = findAll(chart.panel, (n) => n.tagName === 'P' && n.id === 'chart-summary')[0];
    expect(summary.hidden).toBe(false);
    expect(typeof summary.textContent).toBe('string');
  });

  it('the tooltip lists the three estimates and the three block ranges (16.2)', () => {
    const { chart } = makeChart();
    const svg = findAll(chart.panel, (n) => n.tagName === 'SVG')[0];
    const columns = findAll(svg, (n) => n.tagName === 'RECT').filter(
      (r) => r.getAttribute('fill') === 'transparent',
    );
    columns[0].listeners.pointerenter(); // L1
    const tip = findAll(chart.panel, (n) => n.id === 'chart-tooltip')[0];
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('L1');
    expect(tip.textContent).toContain('95%');
    // escape L1: the calibrated per-difficulty ranges of the gimmick kind
    for (const d of ['easy', 'normal', 'hard']) {
      const r = levelRange(getLevel('escape', 1), d, 'escape', 'gimmick');
      expect(tip.textContent).toContain(`${r.min}–${r.max}`);
    }
  });
});
