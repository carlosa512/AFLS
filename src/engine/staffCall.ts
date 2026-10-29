/**
 * The front office's one-line call on a staff member whose deal is up (the staff contracts letter): is he worth his
 * ask? Read off his public ratings against the others in his chair around the league (above or below the middle), his
 * two-year ask against what he makes now, and whether the ask goes past our budget (the letter's own check). Every
 * sentence through `say`, so the same league reads the same.
 */
import type { League } from './types';
import { say, type Line } from './voice';

interface Fact {
  /** His ratings sit above the middle of his chair's around the league. */
  above: boolean;
  /** His ask against his pay now: 1 is the same money. */
  raise: number;
  overBudget: boolean;
}

const CALL: readonly Line<Fact>[] = [
  { when: (f) => f.overBudget, reads: 2, text: () => 'Over the budget at his ask.' },
  { when: (f) => f.overBudget, reads: 2, text: () => "We can't fit his ask without the owner's say." },
  { when: (f) => f.above && f.raise <= 1.35, reads: 2, text: () => 'Worth the raise.' },
  { when: (f) => f.above && f.raise <= 1.35, reads: 2, text: () => 'Keep him; good ones cost this.' },
  { when: (f) => f.above, reads: 1, text: () => "He's good, but that's a steep raise. Worth it if the budget allows." },
  { when: (f) => !f.above && f.raise > 1.25, reads: 2, text: () => 'We can do better for the money.' },
  { when: (f) => !f.above && f.raise > 1.25, reads: 2, text: () => 'There are better on the market at that price.' },
  { when: (f) => !f.above, reads: 1, text: () => 'Fair price for what he gives us.' },
  { text: () => 'Fair price for what he gives us.' },
];

const mean = (a: number, b: number) => (a + b) / 2;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

/** The two ratings the letter shows for him, and the same pair for everyone else in his chair. */
function standing(league: League, who: { kind: 'coach' | 'scout' | 'medic'; id: number }) {
  if (who.kind === 'coach') {
    const c = league.coaches[who.id];
    const peers = Object.values(league.coaches).filter((x) => x.role === c.role && x.teamId !== null);
    return {
      his: mean(c.youth, c.veterans),
      mid: median(peers.map((x) => mean(x.youth, x.veterans))),
      salary: c.contract?.salary ?? 0,
    };
  }
  if (who.kind === 'scout') {
    const s = league.staff[who.id];
    const peers = Object.values(league.staff).filter((x) => x.role === s.role && x.teamId !== null);
    return {
      his: mean(s.evaluation, s.projection),
      mid: median(peers.map((x) => mean(x.evaluation, x.projection))),
      salary: s.contract?.salary ?? 0,
    };
  }
  const m = league.medics[who.id];
  const peers = Object.values(league.medics).filter((x) => x.role === m.role && x.teamId !== null);
  return {
    his: mean(m.physio, m.science),
    mid: median(peers.map((x) => mean(x.physio, x.science))),
    salary: m.contract?.salary ?? 0,
  };
}

export function staffCall(
  league: League,
  who: { kind: 'coach' | 'scout' | 'medic'; id: number },
  money: { ask: number; overBudget: boolean },
): string {
  const { his, mid, salary } = standing(league, who);
  return say(
    CALL,
    { above: his > mid, raise: salary > 0 ? money.ask / salary : 1, overBudget: money.overBudget },
    { key: `staffcall:${league.season}:${who.kind}:${who.id}`, slot: 'call' },
  );
}
