/**
 * `npm run editions -- --seasons n [seed]`: how often each part of SNN's opinion and your club's coverage would fire,
 * season by season, for the owner to set the bars from (`FORM` in `slump.ts`, `LADDER` in `snnColumn.ts`). A preview,
 * not a check. It plays the seasons as the Continue button does (mail filed each step) and counts:
 *
 * - the Column the editor would run each week, by rung and direction, how many were about your club, and corrections;
 * - your club's public story beats (what SNN could report about it), by kind;
 * - your men who matter (the starting quarterback, a leader of the room) in a four-game slump, and how many of those
 *   were also down: the three bars of the conversation.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { employed } from '../src/engine/employment';
import { createLeague } from '../src/engine/generate';
import { deliverMail } from '../src/engine/inbox';
import { playWeek } from '../src/engine/league';
import { moraleContext } from '../src/engine/morale';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { FORM, inSlump } from '../src/engine/slump';
import { columnClaims, LADDER, pickColumn, type Claim } from '../src/engine/snnColumn';
import { tierOf, weightOf } from '../src/engine/standing';
import type { League, Player } from '../src/engine/types';
import { toldKeys } from '../src/engine/voice';

/** Steps a man must have been down before he asks (`DOWN_STEPS` in `playerTalks.ts`). */
const DOWN = 3;
const YEAR = 32;

interface Row {
  season: number;
  columns: number;
  byKind: Record<string, number>;
  yours: number;
  fixes: number;
  /** Weeks with at least one claim to choose from, and the mean number to choose from. */
  weeksWithClaims: number;
  supply: number;
  beats: Record<string, number>;
  slumpYours: Set<number>;
  askYours: Set<number>;
  slumpLeague: Set<number>;
  askLeague: Set<number>;
}

const label = (c: Claim) => (c.dir === 'fix' ? 'fix' : `${c.subject.kind} ${c.rung}${c.dir === 'blame' ? '−' : '+'}`);

function matters(l: League, p: Player, ctx: ReturnType<typeof moraleContext>): boolean {
  if (p.teamId === null) return false;
  const holds = !!l.teams[p.teamId].jobs?.held[p.id];
  return holds && (p.position === 'QB' || tierOf(l, p, weightOf(l, p, ctx)) === 'leader');
}

export function runCounts(seed: string, seasons: number): void {
  const l = createLeague({ seed });
  deliverMail(l);
  const rows: Row[] = [];
  for (let n = 0; n < seasons; n++) {
    const row: Row = {
      season: l.season,
      columns: 0,
      byKind: {},
      yours: 0,
      fixes: 0,
      weeksWithClaims: 0,
      supply: 0,
      beats: {},
      slumpYours: new Set(),
      askYours: new Set(),
      slumpLeague: new Set(),
      askLeague: new Set(),
    };
    // What the Column has said: the inbox's own record, plus the picks made here until the edition carries them.
    const said = new Set<string>();
    let lastYours = -9;
    for (let step = 0; step < 30 && (l.phase === 'regular' || l.phase === 'playoffs'); step++) {
      const week = l.week;
      const regular = l.phase === 'regular';
      playWeek(l);
      deliverMail(l);
      if (!regular || week > 18) continue;
      const user = employed(l) ? l.userTeamId : null;
      const have = new Set([...toldKeys(l), ...said]);
      const claims = columnClaims(l, week, have);
      if (claims.length) {
        row.weeksWithClaims++;
        row.supply += claims.length;
      }
      const edition = (l.inbox ?? []).find((m) => m.id === `snn:${l.season}:w${week}`)?.edition;
      const taken = new Set(edition ? [edition.lead, ...edition.tiles].map((s) => s.clubId) : []);
      const pick = pickColumn(claims, {
        taken,
        userTeamId: user,
        yoursTold: row.yours,
        yoursLastWeek: lastYours === week - 1,
        editionId: `snn:${l.season}:w${week}`,
      });
      if (pick) {
        said.add(pick.key);
        row.columns++;
        row.byKind[label(pick)] = (row.byKind[label(pick)] ?? 0) + 1;
        if (pick.dir === 'fix') row.fixes++;
        if (user !== null && pick.teamId === user) {
          row.yours++;
          lastYours = week;
        }
      }
      // The conversation's bars: he matters, his unit is in a slump he started all of, and he has been down.
      const ctx = moraleContext(l);
      const clock = l.moraleAt ?? 0;
      for (const p of Object.values(l.players)) {
        if (p.teamId === null || !matters(l, p, ctx) || !inSlump(l, p.id, week)) continue;
        const since = p.morale?.talk?.downSince;
        const down = since !== undefined && clock - since >= DOWN - 1;
        row.slumpLeague.add(p.id);
        if (down) row.askLeague.add(p.id);
        if (p.teamId === user) {
          row.slumpYours.add(p.id);
          if (down) row.askYours.add(p.id);
        }
      }
    }
    for (const s of [...(l.stories?.open ?? []), ...(l.stories?.closed ?? [])])
      for (const b of s.beats)
        if (b.pub && s.teamId === l.userTeamId && Math.floor(b.at / YEAR) === row.season)
          row.beats[b.kind] = (row.beats[b.kind] ?? 0) + 1;
    rows.push(row);
    if (n === seasons - 1) break;
    beginOffseason(l);
    deliverMail(l);
    while (l.phase !== 'regular') {
      advanceOffseason(l, { autoUser: true });
      deliverMail(l);
    }
  }

  const kinds = [...new Set(rows.flatMap((r) => Object.keys(r.byKind)))].sort();
  const beats = [...new Set(rows.flatMap((r) => Object.keys(r.beats)))].sort();
  const mean = (f: (r: Row) => number) => (rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(1);
  const table = (head: string[], cells: (r: Row) => (string | number)[], means: string[]) =>
    [
      `| ${head.join(' | ')} |`,
      `| ${head.map(() => '---').join(' | ')} |`,
      ...rows.map((r) => `| ${cells(r).join(' | ')} |`),
      `| ${means.join(' | ')} |`,
    ].join('\n');
  const out = [
    `# Counts for SNN's Column and your club's coverage`,
    `League seed \`${seed}\`, ${rows.length} seasons. Bars: a span of ${FORM.games} games, a quarter of ${FORM.quarter} clubs, ${FORM.results} results that agree; a coach at ${LADDER.coachPct} through ${LADDER.coachGames} games; "it's time" after Week ${LADDER.timeAfterWeek}; a GM after ${LADDER.gmFair} and ${LADDER.gmTime} losing seasons; a turnaround from ${LADDER.turnWins} wins to ${LADDER.turnPct}; ${LADDER.yoursASeason} about your club a season.`,
    `## Columns a season`,
    table(
      ['Season', 'Columns', 'About your club', 'Corrections', 'Weeks with a claim', 'Claims to choose from', ...kinds],
      (r) => [
        r.season,
        r.columns,
        r.yours,
        r.fixes,
        r.weeksWithClaims,
        r.weeksWithClaims ? (r.supply / r.weeksWithClaims).toFixed(1) : '0',
        ...kinds.map((k) => r.byKind[k] ?? 0),
      ],
      [
        'Mean',
        mean((r) => r.columns),
        mean((r) => r.yours),
        mean((r) => r.fixes),
        mean((r) => r.weeksWithClaims),
        mean((r) => (r.weeksWithClaims ? r.supply / r.weeksWithClaims : 0)),
        ...kinds.map((k) => mean((r) => r.byKind[k] ?? 0)),
      ],
    ),
    `## Your club's public story beats`,
    beats.length
      ? table(['Season', ...beats], (r) => [r.season, ...beats.map((b) => r.beats[b] ?? 0)], [
          'Mean',
          ...beats.map((b) => mean((r) => r.beats[b] ?? 0)),
        ])
      : 'None in these seasons.',
    `## The conversation's bars`,
    table(
      [
        'Season',
        'Your men who matter, in a slump',
        '…and down: would ask',
        'League: men in a slump',
        'League: would ask',
      ],
      (r) => [r.season, r.slumpYours.size, r.askYours.size, r.slumpLeague.size, r.askLeague.size],
      [
        'Mean',
        mean((r) => r.slumpYours.size),
        mean((r) => r.askYours.size),
        mean((r) => r.slumpLeague.size),
        mean((r) => r.askLeague.size),
      ],
    ),
  ].join('\n\n');
  mkdirSync('.check', { recursive: true });
  writeFileSync('.check/editions.md', `${out}\n`);
  console.log(out);
}
