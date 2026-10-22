import { describe, it, expect } from 'vitest';
import {
  createBoard,
  cloneBoard,
  isEmpty,
  emptyNeighbors,
  distanceMap,
  catDistanceMap,
  reachableArea,
  shortestPathToEdge,
} from '../src/game/board.js';
import { toIndex, isBorder } from '../src/game/hex.js';

const W = 11;
const H = 11;
const CENTER = toIndex(5, 5, W);

describe('createBoard', () => {
  it('creates an empty 11×11 board with the cat at the center', () => {
    const b = createBoard();
    expect(b.W).toBe(11);
    expect(b.H).toBe(11);
    expect(b.cat).toBe(CENTER);
    expect(b.blocked.length).toBe(121);
    expect(Array.from(b.blocked).every((v) => v === 0)).toBe(true);
    expect(b.nbr.length).toBe(121);
    expect(b.border.length).toBe(121);
    expect(b.border[CENTER]).toBe(0);
    expect(b.border[toIndex(0, 0, W)]).toBe(1);
  });

  it('respects custom sizes', () => {
    const b = createBoard(7, 5);
    expect(b.W).toBe(7);
    expect(b.H).toBe(5);
    expect(b.cat).toBe(toIndex(2, 3, 7));
    expect(b.blocked.length).toBe(35);
  });
});

describe('cloneBoard', () => {
  it('copies blocked only; nbr/border are shared', () => {
    const b = createBoard();
    b.blocked[10] = 1;
    const c = cloneBoard(b);
    expect(c.blocked).not.toBe(b.blocked);
    expect(Array.from(c.blocked)).toEqual(Array.from(b.blocked));
    expect(c.nbr).toBe(b.nbr);
    expect(c.border).toBe(b.border);
    c.blocked[20] = 1;
    expect(b.blocked[20]).toBe(0);
  });
});

describe('isEmpty / emptyNeighbors', () => {
  it('the cat cell is not empty; blocked cells are not empty', () => {
    const b = createBoard();
    expect(isEmpty(b, CENTER)).toBe(false);
    expect(isEmpty(b, 12)).toBe(true);
    b.blocked[12] = 1;
    expect(isEmpty(b, 12)).toBe(false);
  });

  it('emptyNeighbors of the center on an empty board has 6 entries', () => {
    const b = createBoard();
    const n = emptyNeighbors(b, CENTER);
    expect(n.length).toBe(6);
    for (const j of n) expect(isEmpty(b, j)).toBe(true);
  });

  it('emptyNeighbors excludes blocked cells and the cat cell', () => {
    const b = createBoard();
    const nbrs = Array.from(b.nbr[CENTER]);
    b.blocked[nbrs[0]] = 1;
    const n = emptyNeighbors(b, CENTER);
    expect(n).not.toContain(nbrs[0]);
    expect(n.length).toBe(5);
    // a neighbor of the cat that looks at the cat itself does not include it
    const back = emptyNeighbors(b, nbrs[1]);
    expect(back).not.toContain(CENTER);
  });
});

describe('distanceMap', () => {
  it('center of an empty board is dist=5 with paths>0', () => {
    const b = createBoard();
    const { dist, paths } = distanceMap(b);
    expect(dist[CENTER]).toBe(5);
    expect(paths[CENTER]).toBeGreaterThan(0);
    // edge cells are dist 0 with a single route
    for (let i = 0; i < 121; i++) {
      if (b.border[i]) {
        expect(dist[i]).toBe(0);
        expect(paths[i]).toBe(1);
      } else {
        expect(dist[i]).toBeGreaterThan(0);
        expect(paths[i]).toBeGreaterThan(0);
      }
    }
  });

  it('shortest-path counts grow away from the edge', () => {
    const b = createBoard();
    const { dist, paths } = distanceMap(b);
    expect(dist[toIndex(0, 5, W)]).toBe(0);
    expect(dist[toIndex(1, 5, W)]).toBe(1);
    expect(paths[toIndex(1, 5, W)]).toBeGreaterThan(1);
    expect(paths[CENTER]).toBeGreaterThan(paths[toIndex(4, 5, W)]);
  });

  it('blocked cells get dist=-1, paths=0', () => {
    const b = createBoard();
    b.blocked[0] = 1;
    b.blocked[5 * W + 5 - 1] = 1;
    const { dist, paths } = distanceMap(b);
    expect(dist[0]).toBe(-1);
    expect(paths[0]).toBe(0);
    expect(dist[59]).toBe(-1);
    expect(paths[59]).toBe(0);
  });

  it('dist=-1 when the cat is walled in', () => {
    const b = createBoard();
    for (const j of b.nbr[CENTER]) b.blocked[j] = 1;
    const { dist, paths } = distanceMap(b);
    expect(dist[CENTER]).toBe(-1);
    expect(paths[CENTER]).toBe(0);
    // the wall itself is blocked, the rest of the board is fine
    expect(dist[b.nbr[CENTER][0]]).toBe(-1);
    expect(dist[0]).toBe(0);
  });

  it('a partial wall raises but does not break the distance', () => {
    const b = createBoard();
    for (const j of b.nbr[CENTER]) b.blocked[j] = 1;
    const open = b.nbr[CENTER][0];
    b.blocked[open] = 0;
    const { dist } = distanceMap(b);
    expect(dist[CENTER]).toBeGreaterThanOrEqual(1);
    expect(dist[CENTER]).not.toBe(-1);
  });
});

describe('catDistanceMap', () => {
  it('distances radiate from the cat on an empty board', () => {
    const b = createBoard();
    const g = catDistanceMap(b);
    expect(g[CENTER]).toBe(0);
    for (const j of b.nbr[CENTER]) expect(g[j]).toBe(1);
    expect(g[toIndex(0, 0, W)]).toBeGreaterThan(1);
  });

  it('blocked cells are unreachable', () => {
    const b = createBoard();
    b.blocked[0] = 1;
    b.blocked[toIndex(0, 1, W)] = 1;
    const g = catDistanceMap(b);
    expect(g[0]).toBe(-1);
    expect(g[toIndex(0, 1, W)]).toBe(-1);
  });

  it('cannot cross a wall', () => {
    const b = createBoard();
    for (const j of b.nbr[CENTER]) b.blocked[j] = 1;
    const g = catDistanceMap(b);
    expect(g[CENTER]).toBe(0);
    for (const j of b.nbr[CENTER]) expect(g[j]).toBe(-1);
  });
});

describe('reachableArea', () => {
  it('an empty board is fully reachable', () => {
    const b = createBoard();
    expect(reachableArea(b)).toBe(121);
  });

  it('a walled-in cat can only reach itself', () => {
    const b = createBoard();
    for (const j of b.nbr[CENTER]) b.blocked[j] = 1;
    expect(reachableArea(b)).toBe(1);
  });

  it('counts only non-blocked reachable cells', () => {
    const b = createBoard();
    b.blocked[0] = 1;
    b.blocked[1] = 1;
    expect(reachableArea(b)).toBe(119);
  });

  it('a wall splitting the board limits the area', () => {
    const b = createBoard();
    // solid vertical wall at column 6
    for (let r = 0; r < H; r++) b.blocked[toIndex(r, 6, W)] = 1;
    const area = reachableArea(b);
    expect(area).toBe(11 * 6);
  });
});

describe('shortestPathToEdge', () => {
  it('empty board: a shortest route of length dist+1 to the border', () => {
    const b = createBoard();
    const path = shortestPathToEdge(b);
    expect(path).not.toBeNull();
    expect(path[0]).toBe(CENTER);
    const { dist } = distanceMap(b);
    expect(path.length).toBe(dist[CENTER] + 1);
    expect(isBorder(path[path.length - 1], W, H)).toBe(true);
    for (let k = 0; k + 1 < path.length; k++) {
      expect(Array.from(b.nbr[path[k]])).toContain(path[k + 1]);
      expect(b.blocked[path[k + 1]]).toBe(0);
      expect(dist[path[k + 1]]).toBe(dist[path[k]] - 1);
    }
  });

  it('skips blocked cells and stays deterministic', () => {
    const b = createBoard();
    // block some cells on the north side, keep a route
    for (let c = 0; c < W; c++) b.blocked[toIndex(1, c, W)] = 1;
    const p1 = shortestPathToEdge(b);
    const p2 = shortestPathToEdge(b);
    expect(p1).toEqual(p2);
    for (const i of p1) expect(b.blocked[i]).toBe(0);
    expect(isBorder(p1[p1.length - 1], W, H)).toBe(true);
    // route detours around row 1
    expect(p1.length).toBeGreaterThan(2);
  });

  it('returns null when the cat is enclosed', () => {
    const b = createBoard();
    for (const j of b.nbr[CENTER]) b.blocked[j] = 1;
    expect(shortestPathToEdge(b)).toBeNull();
  });

  it('cat already on an edge returns just the cat cell', () => {
    const b = createBoard();
    b.cat = toIndex(0, 5, W);
    expect(shortestPathToEdge(b)).toEqual([b.cat]);
  });
});
