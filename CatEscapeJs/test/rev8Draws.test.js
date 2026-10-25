import { describe, it, expect } from 'vitest';
import { playGame, seedFor } from '../scripts/sim.mjs';
import { getLevel, blocksFor } from '../src/game/play/levels.js';

/**
 * Rev. 8/19.4 regression: before the fix, these seeded L17–20 games ended
 * as draws under the gimmick rules — either `trapper -1` (the board had no
 * blockable cell left while enclosed cats still shuffled in their pockets)
 * or `MAX_STEPS` (the trapper AI kept aiming at already-stuck cats while a
 * live cat paced its pocket forever). With the turn-skip backstop, the
 * spring nerf, the new starts and the free-cat targeting every game must
 * now end with a result before the move cap.
 *
 * Each case replays one logged (course, level, difficulty, profile, game)
 * seed of the balance runner (`seedFor`, seedBase 0).
 */
const DRAW_SEEDS = [
  // escape L19 (3 cats, anyEscape)
  { course: 'escape', level: 19, difficulty: 'easy', profile: 'weak', g: 5 },
  { course: 'escape', level: 19, difficulty: 'easy', profile: 'normal', g: 9 },
  { course: 'escape', level: 19, difficulty: 'easy', profile: 'normal', g: 18 },
  { course: 'escape', level: 19, difficulty: 'normal', profile: 'weak', g: 1 },
  { course: 'escape', level: 19, difficulty: 'normal', profile: 'strong', g: 12 },
  { course: 'escape', level: 19, difficulty: 'hard', profile: 'weak', g: 7 },
  { course: 'escape', level: 19, difficulty: 'hard', profile: 'normal', g: 11 },
  // trapper L19 (3 cats, anyCatch)
  { course: 'trapper', level: 19, difficulty: 'easy', profile: 'normal', g: 3 },
  { course: 'trapper', level: 19, difficulty: 'normal', profile: 'normal', g: 0 },
  { course: 'trapper', level: 19, difficulty: 'normal', profile: 'normal', g: 1 },
  { course: 'trapper', level: 19, difficulty: 'hard', profile: 'strong', g: 10 },
];

describe('Rev. 8/19.4: the logged L19 draw seeds end with a result', () => {
  for (const s of DRAW_SEEDS) {
    it(
      `${s.course} L${s.level} ${s.difficulty}/${s.profile} g=${s.g}`,
      () => {
        const lv = getLevel(s.course, s.level);
        const blocks = blocksFor(lv, s.difficulty, 'gimmick');
        const seed = seedFor(
          { rules: 'gimmick', course: s.course, level: s.level, difficulty: s.difficulty, profile: s.profile },
          s.g,
        );
        const r = playGame({
          rules: 'gimmick',
          course: s.course,
          level: s.level,
          difficulty: s.difficulty,
          blocks,
          profile: s.profile,
          seed,
        });
        expect(r.draw).toBe(false);
        expect(r.status === 'catWin' || r.status === 'trapperWin').toBe(true);
      },
      60000,
    );
  }
});
