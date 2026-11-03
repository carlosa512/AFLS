import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuirkId } from '../quirks';
import { Rng } from '../rng';
import { bodyOf } from './body';
import { contest } from './contest';
import { man, startOf, pinKnobs } from './fixtures';
import { MID } from './geometry';
import { FIELD_HABITS } from './habits';
import { runField } from './run';
import { STEP } from './tuning';
import type { FieldPlayer, FieldStart } from './types';

const SEEDS = 400;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const withHabit = (p: FieldPlayer, q: QuirkId | null): FieldPlayer =>
  q ? { ...p, s: { ...p.s, habits: [...(p.s.habits ?? []), q].sort() } } : p;

/** The same contest SEEDS times: the share ending each way. */
function contestShare(cp: FieldPlayer, dp: FieldPlayer, out: 'tackle' | 'size', room = false) {
  const start = startOf({ players: [cp, dp] });
  const rng = new Rng('habit-contest');
  let n = 0;
  for (let i = 0; i < SEEDS * 5; i++) {
    const r = contest(cp, bodyOf(cp, false), dp, bodyOf(dp, false), 0, 'side', start, rng, room);
    if (out === 'tackle' ? r.out === 'tackle' : r.out === 'broken') n++;
  }
  return n / (SEEDS * 5);
}

/** The same open field SEEDS times, with a measure read off each. */
function fieldMean(build: () => FieldStart, measure: (start: FieldStart, r: ReturnType<typeof runField>) => number) {
  const xs: number[] = [];
  for (let i = 0; i < SEEDS; i++) {
    const start = build();
    xs.push(measure(start, runField(start, new Rng(`habit:${i}`))));
  }
  return mean(xs.filter((x) => Number.isFinite(x)));
}

/** A back in the open against a linebacker and a safety. */
const openRun = (back: QuirkId | null, kind: FieldStart['kind'] = 'run', x = 40) =>
  startOf({
    kind,
    players: [
      withHabit(man(1, 0, kind === 'catch' ? 'WR' : 'RB', x, MID, { vx: 6, vy: 1.5 }), back),
      man(30, 1, 'LB', x + 9, MID - 4),
      man(31, 1, 'S', x + 20, MID + 3),
    ],
  });

/** When a blocked man first gets two yards off his blocker. */
const shedAt = (start: FieldStart, r: ReturnType<typeof runField>) => {
  const n = start.players.length;
  for (let s = 0; s < r.frames.length / (n * 2); s++) {
    const b = { x: r.frames[(s * n + 1) * 2], y: r.frames[(s * n + 1) * 2 + 1] };
    const d = { x: r.frames[(s * n + 2) * 2], y: r.frames[(s * n + 2) * 2 + 1] };
    if (Math.hypot(b.x - d.x, b.y - d.y) > 2) return s * STEP;
  }
  return Infinity;
};
const blocked = (q: QuirkId | null, tired = false) =>
  startOf({
    tired,
    players: [
      man(1, 0, 'RB', 48, MID + 4, { vx: 6 }),
      man(10, 0, 'OL', 50, MID),
      withHabit(man(30, 1, 'DT', 50.9, MID), q),
      man(31, 1, 'S', 80, MID + 10),
    ],
    blocks: [{ blocker: 10, defender: 30, holdFor: 0 }],
  });

/** Each habit's measure with it and without: the table's direction is `up` (with > without) or down. */
const TABLE: Record<string, { up: boolean; measure: (q: QuirkId | null) => number }> = {
  jumpCutter: {
    up: true,
    measure: (q) => {
      let cuts = 0;
      let all = 0;
      for (let i = 0; i < SEEDS; i++) {
        const r = runField(openRun(q), new Rng(`jc:${i}`));
        for (const m of r.misses) if (m.move) [all, cuts] = [all + 1, cuts + (m.move === 'jumpCut' ? 1 : 0)];
      }
      return all ? cuts / all : 0;
    },
  },
  highKnee: {
    up: false,
    measure: (q) =>
      contestShare(withHabit(man(1, 0, 'RB', 50, MID, { vx: 7 }), q), man(30, 1, 'LB', 51, MID), 'tackle'),
  },
  contactAverse: {
    up: false,
    measure: (q) =>
      contestShare(
        withHabit(man(1, 0, 'RB', 50, MID, { vx: 7, s: { power: 18 } }), q),
        man(30, 1, 'LB', 51, MID),
        'size',
        true,
      ),
  },
  yacSlasher: {
    up: true,
    measure: (q) =>
      fieldMean(
        () => openRun(q, 'catch'),
        (_, r) => r.yards,
      ),
  },
  runsEastWest: {
    up: false,
    measure: (q) =>
      fieldMean(
        () => openRun(q, 'catch'),
        (_, r) => r.yards,
      ),
  },
  softHands: {
    up: true,
    // Ground he makes in the first 0.6 s after the catch, in stride.
    measure: (q) =>
      fieldMean(
        () => openRun(q, 'catch'),
        (start, r) => r.frames[Math.round(0.6 / STEP) * start.players.length * 2] - start.players[0].x,
      ),
  },
  finishesForward: {
    up: true,
    measure: (q) =>
      fieldMean(
        () => openRun(q),
        (_, r) => (r.tackler !== null ? r.yards : NaN),
      ),
  },
  secondLevel: {
    up: true,
    measure: (q) =>
      fieldMean(
        () =>
          startOf({
            players: [
              man(1, 0, 'RB', 40, MID, { vx: 4 }),
              withHabit(man(10, 0, 'OL', 42, MID + 1), q),
              man(30, 1, 'LB', 52, MID + 2),
              man(31, 1, 'S', 70, MID - 3),
            ],
          }),
        (_, r) => r.yards,
      ),
  },
  unblockable: { up: false, measure: (q) => fieldMean(() => blocked(q), shedAt) },
  gassed: { up: true, measure: (q) => fieldMean(() => blocked(q, true), shedAt) },
  highMotor: {
    up: true,
    measure: (q) =>
      fieldMean(
        () =>
          startOf({
            players: [man(1, 0, 'RB', 60, MID, { vx: 8 }), withHabit(man(30, 1, 'DT', 45, MID), q)],
          }),
        (start, r) => {
          // How far he's run a second and a half in.
          const s = Math.round(1.5 / STEP);
          return r.frames.length / 4 > s ? r.frames[(s * 2 + 1) * 2] - start.players[1].x : NaN;
        },
      ),
  },
  armTackler: {
    up: false,
    measure: (q) =>
      contestShare(man(1, 0, 'RB', 50, MID, { vx: 7 }), withHabit(man(30, 1, 'LB', 51, MID), q), 'tackle'),
  },
  thumper: {
    up: false,
    measure: (q) =>
      fieldMean(
        () =>
          startOf({
            players: [man(1, 0, 'RB', 40, MID, { vx: 7 }), withHabit(man(30, 1, 'LB', 48, MID), q)],
          }),
        (_, r) => (r.tackler === 30 ? r.yards : NaN),
      ),
  },
  businessDecision: {
    up: false,
    measure: (q) =>
      contestShare(
        man(1, 0, 'WR', 50, MID, { vx: 7, s: { w: 232 } }),
        withHabit(man(30, 1, 'CB', 51, MID), q),
        'tackle',
      ),
  },
  stuckOnBlocks: {
    up: true,
    measure: (q) =>
      fieldMean(
        () =>
          startOf({
            players: [
              man(1, 0, 'RB', 48, MID + 4, { vx: 6 }),
              man(10, 0, 'OL', 50, MID),
              withHabit(man(30, 1, 'LB', 50.9, MID), q),
              man(31, 1, 'S', 80, MID + 10),
            ],
            blocks: [{ blocker: 10, defender: 30, holdFor: 0 }],
          }),
        shedAt,
      ),
  },
  slowFlow: { up: true, measure: (q) => bodyOf(withHabit(man(30, 1, 'LB', 50, MID), q), false).react },
  diagnoses: { up: false, measure: (q) => bodyOf(withHabit(man(30, 1, 'LB', 50, MID), q), false).react },
  alleyCrusher: {
    up: false,
    measure: (q) =>
      fieldMean(
        () =>
          startOf({
            players: [man(1, 0, 'RB', 40, 8, { vx: 7 }), withHabit(man(30, 1, 'S', 52, 22), q)],
          }),
        (_, r) => (r.tackler === 30 ? r.duration : NaN),
      ),
  },
  pancakePreacher: { up: true, measure: () => NaN },
};

describe('field habits', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = pinKnobs();
  });
  afterAll(() => restore());

  it('plays each field habit the way its table says', () => {
    expect(new Set(Object.keys(TABLE))).toEqual(new Set(FIELD_HABITS));
    for (const [q, { up, measure }] of Object.entries(TABLE)) {
      // pancakePreacher lives in the start's line blocks (Task 5's `fieldStart`): tested there.
      if (q === 'pancakePreacher') continue;
      const on = measure(q as QuirkId);
      const off = measure(null);
      if (up) expect(on, q).toBeGreaterThan(off);
      else expect(on, q).toBeLessThan(off);
    }
  });
});
