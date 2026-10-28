/**
 * More leagues for one number of the trade market audit (`scripts/trades.ts`, section 6): the share of in-season
 * trades made on deadline day. The audit's own nine seasons hold only about 45 deadline-day deals, so the share moved
 * by several points between seeds of the same code (29.6-38% at 0.2.16) and one seed's luck decided the check. These
 * leagues play their seasons exactly as the audit's do, each in a child process beside it, and report each season's
 * in-season and deadline-day trades, and each draft's quarterback trade-ups into the top 16 (about three in the audit's
 * nine drafts, so one seed's luck decided that check too). Every other number stays on the audit's own leagues.
 */
import { fork } from 'node:child_process';
import { createLeague } from '../src/engine/generate';
import { playWeek, simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { isDeadlineDay, TRADE_DEADLINE_WEEK } from '../src/engine/trade';
import { guardBest } from './trades-prices';
import type { League } from '../src/engine/types';

/** One league's seasons: AI trades from week 1 through deadline day, and the ones on deadline day. */
export interface ShareRun {
  seed: string;
  inSeason: number[];
  deadlineDay: number[];
  /** Each draft's trade-ups for a quarterback into the top 16. */
  qbUps: number[];
}

function shareLeague(seed: string, seasons: number): ShareRun {
  const league = createLeague({ seed });
  guardBest(league);
  const run: ShareRun = { seed, inSeason: [], deadlineDay: [], qbUps: [] };
  for (let s = 0; s < seasons; s++) {
    const season = league.season;
    while (league.phase === 'regular' && (league.week <= TRADE_DEADLINE_WEEK + 1 || isDeadlineDay(league)))
      playWeek(league);
    const regular = (league.market?.history ?? []).filter((r) => r.season === season && r.phase === 'regular');
    run.inSeason.push(regular.length);
    run.deadlineDay.push(regular.filter((r) => r.week === TRADE_DEADLINE_WEEK).length);
    simToEndOfSeason(league);
    beginOffseason(league);
    while (league.phase !== 'regular') {
      const drafting = league.phase === 'draft';
      advanceOffseason(league, { autoUser: true });
      if (drafting && league.phase !== 'draft') run.qbUps.push(qbUps(league));
    }
  }
  return run;
}

/** This league year's draft-day trade-ups for a quarterback into the top 16, read as `scripts/trades.ts` reads them. */
function qbUps(league: League): number {
  const pickOf = (id: number) => league.draftPicks.find((p) => p.id === id);
  return (league.market?.history ?? []).filter((r) => {
    if (r.season !== league.season || r.phase !== 'draft' || r.kind !== 'draft') return false;
    const bought = pickOf(r.sides[1].picks[0]);
    return !!bought && bought.overall! <= 16 && league.players[bought.playerId!]?.position === 'QB';
  }).length;
}

/** Play these leagues in child processes, one each, and resolve when the last one reports. */
export function shareLeagues(seeds: string[], seasons: number): Promise<ShareRun[]> {
  return Promise.all(
    seeds.map(
      (seed) =>
        new Promise<ShareRun>((resolve, reject) => {
          const child = fork(new URL(import.meta.url).pathname, [], {
            env: { ...process.env, TRADE_SHARE_SEED: seed, TRADE_SHARE_SEASONS: String(seasons) },
          });
          let done = false;
          child.once('message', (run) => {
            done = true;
            resolve(run as ShareRun);
            child.kill();
          });
          child.once('error', reject);
          child.once(
            'exit',
            (code, signal) => done || reject(new Error(`share league ${seed} exited (${signal ?? code})`)),
          );
        }),
    ),
  );
}

// A worker: play its league and report (the parent ends it).
if (process.env.TRADE_SHARE_SEED && process.send)
  process.send(shareLeague(process.env.TRADE_SHARE_SEED, Number(process.env.TRADE_SHARE_SEASONS)));
