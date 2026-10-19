/** Moving the assets. The sending team books the bonus money still on each traded contract; the new team takes the salary. */
import { autoPostJune1, logTransaction, paidShare, weeksPaid } from '../finance/cap';
import { deadMoney } from '../finance/contract';
import { freeJersey } from '../generate';
import { syncDepthChart, teamPlayers } from '../roster';
import type { DealKind, League, TradeMarket, TradeRecord } from '../types';
import type { TradeProposal } from './rules';

/** Trades kept for trade trails and the market's memory: the last five league years. */
const HISTORY_YEARS = 5;

export const emptyMarket = (): TradeMarket => ({ moment: 0, history: [], interest: [], rumors: [] });

/**
 * Move the assets and log the trade. `kind` and `tag` say what it was for the news ("deadline
 * rental"); the user's own trades go in untagged.
 */
export function executeTrade(league: League, proposal: TradeProposal, meta: { kind: DealKind; tag?: string } = { kind: 'user' }): TradeRecord {
  const post = autoPostJune1(league.phase);
  const moved: string[][] = [[], []];
  proposal.sides.forEach((side, i) => {
    const to = proposal.sides[1 - i].teamId;
    const from = league.teams[side.teamId];
    for (const id of side.players) {
      const p = league.players[id];
      const c = p.contract!;
      // Measured against this contract's own base: it may already have been cut by an earlier trade or a mid-season signing.
      const paid = paidShare(league, c);
      const split = deadMoney(c, league.season, { paid, postJune1: post, trade: true });
      const bonusNow = split.thisYear - (c.years.find((y) => y.season === league.season)?.base ?? 0) * paid;
      if (bonusNow > 0) from.deadMoney.push({ season: league.season, amount: Math.round(bonusNow), playerId: id, note: 'Traded' });
      if (split.nextYear > 0) from.deadMoney.push({ season: league.season + 1, amount: Math.round(split.nextYear), playerId: id, note: 'Traded' });
      // Salary already paid this season stays with the old team's cap; the new team takes the rest.
      if (paid > 0) {
        const y = c.years.find((x) => x.season === league.season);
        if (y) {
          from.deadMoney.push({ season: league.season, amount: Math.round(y.base * paid), playerId: id, note: 'Salary paid before trade' });
          y.base = Math.round(y.base * (1 - paid));
          y.guaranteed = Math.min(y.guaranteed, y.base);
          y.paidBefore = weeksPaid(league);
        }
      }
      c.bonuses = [];
      c.years = c.years.filter((y) => !y.void);
      p.teamId = to;
      p.jersey = freeJersey(p.position, new Set(teamPlayers(league, to).filter((x) => x.id !== id).map((x) => x.jersey)), p.jersey);
      if (league.teams[side.teamId].taggedId === id) league.teams[side.teamId].taggedId = null;
      p.tagCount = 0; // a tag by the new team is not a consecutive one
      delete league.negotiations[id];
      moved[i].push(`${p.position} ${p.firstName} ${p.lastName}`);
    }
    for (const id of side.picks) {
      const pick = league.draftPicks.find((x) => x.id === id)!;
      pick.ownerId = to;
      moved[i].push(`${pick.season} R${pick.round}${pick.overall ? ` (No. ${pick.overall})` : ''}`);
    }
  });
  for (const side of proposal.sides) syncDepthChart(league, league.teams[side.teamId]);
  const [a, b] = proposal.sides.map((s) => league.teams[s.teamId]);
  logTransaction(league, 'trade', [a.id, b.id], `${a.abbrev} traded ${moved[0].join(', ') || 'nothing'} to ${b.abbrev} for ${moved[1].join(', ') || 'nothing'}${meta.tag ? ` (${meta.tag})` : ''}`);
  const record: TradeRecord = {
    season: league.season,
    phase: league.phase,
    week: league.week,
    sides: [proposal.sides[0], proposal.sides[1]].map((s) => ({ teamId: s.teamId, players: [...s.players], picks: [...s.picks] })) as TradeRecord['sides'],
    kind: meta.kind,
  };
  const market = (league.market ??= emptyMarket());
  market.history = [...market.history.filter((r) => r.season > league.season - HISTORY_YEARS), record];
  return record;
}
