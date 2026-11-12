/**
 * `npm run editions -- --offseasons n [seed]`: what each of SNN's big-day editions would have to tell, offseason by
 * offseason, for the owner to set the bars from (`DAY` in `snnDays.ts`, `STANDING` in `publicStanding.ts`). A preview,
 * not a check. It plays the seasons, then steps each offseason as the Continue button does (the AI making your calls),
 * and at each of the five moments counts the public record an edition would read, at a few settings of each bar.
 * Writes `.check/day-counts.md`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLeague } from '../src/engine/generate';
import { deliverMail, headCoachChanges } from '../src/engine/inbox';
import { playWeek } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { freeAgents } from '../src/engine/offseason/negotiation';
import { draftedHigh, standingReader, type Standing } from '../src/engine/publicStanding';
import { activeRoster } from '../src/engine/roster';
import { statLine } from '../src/engine/stats';
import type { League, Phase, Player, Transaction } from '../src/engine/types';

type Counts = Record<string, number>;
type Year = Record<'year' | 'market' | 'draft' | 'cuts' | 'kickoff', Counts>;

const txs = (l: League, phase: Phase, kind: Transaction['kind']) =>
  l.transactions.filter((t) => t.season === l.season && t.phase === phase && t.kind === kind);
const players = (l: League, ts: Transaction[]) =>
  ts.flatMap((t) => (t.playerId !== undefined && l.players[t.playerId] ? [l.players[t.playerId]] : []));
const trades = (l: League, phase: Phase) =>
  (l.market?.history ?? []).filter((r) => r.season === l.season && r.phase === phase);
const total = (p: Player) => (p.contract ? (p.contract.apy * p.contract.length) / 1000 : 0);
/** Clubs with at least `n` of something. */
const clubsWith = (by: Map<number, number>, n: number) => [...by.values()].filter((x) => x >= n).length;
const tally = (ids: (number | null | undefined)[]) => {
  const by = new Map<number, number>();
  for (const id of ids) if (id !== null && id !== undefined) by.set(id, (by.get(id) ?? 0) + 1);
  return by;
};
const lastLeft = (p: Player) => p.left?.at(-1);

/** The new league year, read as free agency opens: the window's tags, re-signings, releases and changes at the top. */
function countYear(l: League, read: (p: Player) => Standing): Counts {
  const not = (s: Standing) => (p: Player) => read(p) !== s;
  const tagged = players(l, txs(l, 'resign', 'tag'));
  const kept = players(
    l,
    txs(l, 'resign', 'resign').filter((t) => t.text.includes(' re-signed ')),
  );
  const released = players(l, txs(l, 'resign', 'release'));
  const walked = freeAgents(l).filter((p) => lastLeft(p)?.season === l.season && lastLeft(p)?.how === 'walked');
  const keptBy = tally([...tagged, ...kept].filter(not('depth')).map((p) => p.teamId));
  const lostBy = tally(walked.filter(not('depth')).map((p) => lastLeft(p)!.teamId));
  return {
    'New head coaches': headCoachChanges(l).length,
    'New GMs': l.leadership.events.filter((e) => e.kind === 'gmHired' && e.date.season === l.season).length,
    Tags: tagged.length,
    'Stars tagged': tagged.filter((p) => read(p) === 'star').length,
    'Stars re-signed': kept.filter((p) => read(p) === 'star').length,
    'Stars released': released.filter((p) => read(p) === 'star').length,
    'Starters released': released.filter((p) => read(p) === 'starter').length,
    'Stars reaching the market': walked.filter((p) => read(p) === 'star').length,
    'Starters reaching the market': walked.filter((p) => read(p) === 'starter').length,
    'Clubs keeping 3+ starters': clubsWith(keptBy, 3),
    'Clubs keeping 4+ starters': clubsWith(keptBy, 4),
    'Clubs keeping 5+ starters': clubsWith(keptBy, 5),
    'Clubs losing 3+ starters': clubsWith(lostBy, 3),
    'Clubs losing 4+ starters': clubsWith(lostBy, 4),
    'Clubs losing 5+ starters': clubsWith(lostBy, 5),
    'Trades in the window': trades(l, 'resign').length,
  };
}

/** Free agency, read as the draft opens: who signed where, for how much. */
function countMarket(l: League, read: (p: Player) => Standing): Counts {
  const signed = players(l, txs(l, 'freeAgency', 'sign'));
  const moved = signed.filter((p) => lastLeft(p) && lastLeft(p)!.teamId !== p.teamId);
  const totals = signed.map(total).sort((a, b) => b - a);
  const starters = moved.filter((p) => read(p) !== 'depth');
  const gained = tally(starters.map((p) => p.teamId));
  const lost = tally(starters.map((p) => lastLeft(p)!.teamId));
  const open = freeAgents(l);
  const at = (n: number) => Math.round(totals[n - 1] ?? 0);
  return {
    Signings: signed.length,
    'Stars changing clubs': moved.filter((p) => read(p) === 'star').length,
    'Starters changing clubs': moved.filter((p) => read(p) === 'starter').length,
    'Largest contract ($M)': at(1),
    '5th largest ($M)': at(5),
    '10th largest ($M)': at(10),
    '20th largest ($M)': at(20),
    'Clubs signing 2+ starters': clubsWith(gained, 2),
    'Clubs signing 3+ starters': clubsWith(gained, 3),
    'Clubs signing 4+ starters': clubsWith(gained, 4),
    'Clubs losing 2+ starters': clubsWith(lost, 2),
    'Clubs losing 3+ starters': clubsWith(lost, 3),
    'Clubs losing 4+ starters': clubsWith(lost, 4),
    'Signed by a former club': signed.filter((p) => (p.left ?? []).slice(0, -1).some((d) => d.teamId === p.teamId))
      .length,
    'Stars still unsigned': open.filter((p) => read(p) === 'star').length,
    'Starters still unsigned': open.filter((p) => read(p) === 'starter').length,
    Trades: trades(l, 'freeAgency').length,
    'Trades with a star': trades(l, 'freeAgency').filter((r) =>
      r.sides.some((s) => s.players.some((id) => l.players[id] && read(l.players[id]) === 'star')),
    ).length,
  };
}

/** Draft day, read as camp opens. */
function countDraft(l: League, read: (p: Player) => Standing): Counts {
  const picks = Object.values(l.players).filter((p) => p.draft?.season === l.season);
  const d = (p: Player) => p.draft!;
  const early = picks.filter((p) => d(p).round <= 2);
  const fall = (n: number) => early.filter((p) => d(p).rank !== undefined && d(p).pick - d(p).rank! >= n).length;
  const gap = (n: number) =>
    picks.filter((p) => d(p).round === 1 && d(p).rank !== undefined && d(p).rank! - d(p).pick >= n).length;
  const up = (n: number) => picks.filter((p) => d(p).deal && d(p).pick <= n).length;
  const by = tally(early.map((p) => d(p).teamId));
  return {
    'Trades on the day': trades(l, 'draft').length,
    'Trades up into the top 5': up(5),
    'Trades up into the top 10': up(10),
    'Trades up into the top 15': up(15),
    'Quarterbacks in round one': picks.filter((p) => p.position === 'QB' && d(p).round === 1).length,
    'Fell 10+ places (rounds 1–2)': fall(10),
    'Fell 15+ places (rounds 1–2)': fall(15),
    'Fell 20+ places (rounds 1–2)': fall(20),
    'Taken 10+ ahead (round 1)': gap(10),
    'Taken 15+ ahead (round 1)': gap(15),
    'Taken 20+ ahead (round 1)': gap(20),
    'Clubs with 3+ picks in rounds 1–2': clubsWith(by, 3),
    'Clubs with no pick in rounds 1–2': l.teams.filter((t) => !by.has(t.id)).length,
    'Trades with a star': trades(l, 'draft').filter((r) =>
      r.sides.some((s) => s.players.some((id) => l.players[id] && read(l.players[id]) === 'star')),
    ).length,
  };
}

/** Cut-down day, read at week 1 before a game: camp's releases and trades, and who made a roster. */
function countCuts(l: League, read: (p: Player) => Standing): Counts {
  const cut = players(l, txs(l, 'preseason', 'release'));
  const snaps = (p: Player) => statLine(p, l.season - 1)?.snaps ?? 0;
  const rookies = l.teams.flatMap((t) => activeRoster(l, t.id).filter((p) => p.experience === 0));
  return {
    Releases: cut.length,
    'Stars released': cut.filter((p) => read(p) === 'star').length,
    'Released with 300+ snaps last season': cut.filter((p) => snaps(p) >= 300).length,
    'Released with 500+ snaps last season': cut.filter((p) => snaps(p) >= 500).length,
    'Released with 700+ snaps last season': cut.filter((p) => snaps(p) >= 700).length,
    'High picks released (rounds 1–2, last 3 drafts)': cut.filter((p) => draftedHigh(l, p)).length,
    'Undrafted rookies on a 53': rookies.filter((p) => !p.draft).length,
    'Position changes in camp': txs(l, 'preseason', 'position').length,
    'Camp trades': trades(l, 'preseason').length,
  };
}

/** Kickoff, read at week 1 before a game: who is new in charge and under center. */
function countKickoff(l: League): Counts {
  const last = l.season - 1;
  const passer = new Map<number, { id: number; att: number }>();
  for (const p of Object.values(l.players)) {
    const teamId = p.statTeams?.[last]?.at(-1);
    const att = statLine(p, last)?.passAtt ?? 0;
    if (teamId !== undefined && att > (passer.get(teamId)?.att ?? 0)) passer.set(teamId, { id: p.id, att });
  }
  const qbs = l.teams.flatMap((t) => {
    const id = Object.entries(t.jobs?.held ?? {}).find(([, j]) => j.pos === 'QB')?.[0];
    return id === undefined ? [] : [{ teamId: t.id, p: l.players[Number(id)] }];
  });
  return {
    'New head coaches': headCoachChanges(l).length,
    'Clubs with a new starting quarterback': qbs.filter((q) => passer.get(q.teamId)?.id !== q.p.id).length,
    'Rookie quarterbacks starting': qbs.filter((q) => q.p.experience === 0).length,
  };
}

/** The phase as it is now: a step moves it, which the compiler cannot see through the loop's own test. */
const phaseOf = (l: League): Phase => l.phase;

const table = (title: string, rows: Counts[]): string => {
  const keys = Object.keys(rows[0] ?? {});
  const mean = (k: string) => (rows.reduce((n, r) => n + r[k], 0) / rows.length).toFixed(1);
  return [
    `## ${title}`,
    '',
    `| | ${rows.map((_, i) => `Year ${i + 1}`).join(' | ')} | Mean |`,
    `| --- | ${rows.map(() => '---:').join(' | ')} | ---: |`,
    ...keys.map((k) => `| ${k} | ${rows.map((r) => r[k]).join(' | ')} | ${mean(k)} |`),
  ].join('\n');
};

export function runDayCounts(seed: string, offseasons: number): void {
  const l = createLeague({ seed });
  deliverMail(l);
  const years: Year[] = [];
  for (let n = 0; n < offseasons; n++) {
    while (l.phase === 'regular' || l.phase === 'playoffs') {
      playWeek(l);
      deliverMail(l);
    }
    beginOffseason(l);
    deliverMail(l);
    const year = {} as Year;
    // Last season's standing is read once: it does not move during the offseason.
    const read = standingReader(l);
    let phase: Phase = phaseOf(l);
    while (phaseOf(l) !== 'regular') {
      advanceOffseason(l, { autoUser: true });
      deliverMail(l);
      const now = phaseOf(l);
      if (now === phase) continue;
      phase = now;
      if (phase === 'freeAgency') year.year = countYear(l, read);
      if (phase === 'draft') year.market = countMarket(l, read);
      if (phase === 'preseason') year.draft = countDraft(l, read);
      if (phase === 'regular') {
        year.cuts = countCuts(l, read);
        year.kickoff = countKickoff(l);
      }
    }
    years.push(year);
    console.log(`offseason ${n + 1} of ${offseasons} (${l.season})`);
  }
  const head = [
    `# What each big-day edition would have to tell (${offseasons} offseasons, seed "${seed}")`,
    '',
    'A star: a season honor, a top-five place in a major stat, or a winning club’s passer, last season. A starter:',
    '500 or more scrimmage snaps last season. Both are read from the public record (`publicStanding.ts`).',
  ].join('\n');
  mkdirSync('.check', { recursive: true });
  writeFileSync(
    '.check/day-counts.md',
    `${[
      head,
      table(
        'The new league year',
        years.map((y) => y.year),
      ),
      table(
        'Free agency',
        years.map((y) => y.market),
      ),
      table(
        'Draft day',
        years.map((y) => y.draft),
      ),
      table(
        'Cut-down day',
        years.map((y) => y.cuts),
      ),
      table(
        'Kickoff',
        years.map((y) => y.kickoff),
      ),
    ].join('\n\n')}\n`,
  );
  console.log(`${offseasons} offseasons counted in .check/day-counts.md`);
}
