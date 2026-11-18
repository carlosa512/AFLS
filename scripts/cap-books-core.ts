/**
 * What the cap books are judged on, read the same way by `npm run cap-books` and the offseason check's drift leagues
 * (`docs/superpowers/specs/2026-11-18-multi-year-cap-books-design.md`): an offseason played to kickoff, with each
 * club's roster read as free agency opens, as the draft opens and as camp opens, then its books at kickoff.
 */
import { capFor, capSheet } from '../src/engine/finance/cap';
import { isExpired } from '../src/engine/finance/contract';
import { advanceOffseason } from '../src/engine/offseason';
import { teamPlayers } from '../src/engine/roster';
import type { League } from '../src/engine/types';

export interface SeasonFlow {
  /** The league year the kickoff opened. */
  season: number;
  /** Median cap room at kickoff (% of the cap). */
  room: number;
  /** Median players a club signed in free agency (signed for the league year at the draft, less at free agency's open). */
  faSigned: number;
  /** Median players a club had signed as camp opened. */
  campRoster: number;
  /** Median share of next year's cap already used at kickoff (%). */
  committed: number;
  /** Mean restructure money still to land on later years at kickoff (% of next year's cap). */
  restructureLater: number;
  /** Mean dead money added from camp's opening to kickoff (% of the cap): camp's compliance cuts, mostly. */
  campDead: number;
}

export const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Players a club has signed for the league year (practice squads aside). */
const signed = (l: League, teamId: number) =>
  teamPlayers(l, teamId).filter((p) => p.contract && !p.squad && !isExpired(p.contract, l.season)).length;
const deadNow = (l: League) =>
  l.teams.map((t) => t.deadMoney.filter((d) => d.season === l.season).reduce((a, d) => a + d.amount, 0));

/** Restructure money on a club's deals still to land after this league year. */
function restructureLater(l: League, teamId: number): number {
  let sum = 0;
  for (const p of teamPlayers(l, teamId))
    for (const b of p.contract?.bonuses ?? [])
      if (b.source === 'restructure')
        for (let y = b.start; y < b.start + b.years; y++) if (y > l.season) sum += b.amount / b.years;
  return sum;
}

/** Play the offseason (already begun) to kickoff, reading the rosters on the way, and measure the kickoff. */
export function playToKickoff(l: League): SeasonFlow {
  let atFa: number[] | null = null;
  let atDraft: number[] | null = null;
  let atCamp: number[] | null = null;
  let deadAtCamp: number[] = [];
  const read = () => l.teams.map((t) => signed(l, t.id));
  while (l.phase !== 'regular') {
    advanceOffseason(l, { autoUser: true });
    if (l.phase === 'freeAgency' && !atFa) atFa = read();
    if (l.phase === 'draft' && !atDraft) atDraft = read();
    if (l.phase === 'preseason' && !atCamp) {
      atCamp = read();
      deadAtCamp = deadNow(l);
    }
  }
  const s = l.season;
  const cap = capFor(l, s);
  const next = capFor(l, s + 1);
  const dead = deadNow(l);
  return {
    season: s,
    room: median(l.teams.map((t) => (100 * capSheet(l, t.id).space) / cap)),
    faSigned: atFa && atDraft ? median(atDraft.map((n, i) => n - atFa![i])) : NaN,
    campRoster: atCamp ? median(atCamp) : NaN,
    committed: median(l.teams.map((t) => (100 * capSheet(l, t.id, s + 1).used) / next)),
    restructureLater: mean(l.teams.map((t) => (100 * restructureLater(l, t.id)) / next)),
    campDead: mean(dead.map((d, i) => (100 * (d - (deadAtCamp[i] ?? 0))) / cap)),
  };
}
