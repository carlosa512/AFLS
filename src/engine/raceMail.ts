/**
 * The director's letters on free agency's race (`offseason/race.ts`, spec
 * `docs/superpowers/specs/2026-11-20-free-agency-race-design.md`): a player's agent calling when another team is about
 * to take him from us (it asks for an answer while his warning is open), our offer coming off the table, and where he
 * signed when we had an offer in. Told only from what a screen may read (`raceView`) and the public record: another
 * team's number is the agent's rounded one. Filed once each, keyed by player and day (a drop by the day it came off).
 */
import { raceView } from './offseason/raceView';
import { clubFeeling } from './relationships';
import { director, type Draft } from './senders';
import type { League, Player, RaceResult } from './types';
import { FA_DAYS } from './types';

const name = (p: Player) => `${p.firstName} ${p.lastName}`;
const city = (league: League, teamId: number) => league.teams[teamId].city;

/** A yearly figure ($K) to the nearest half million, as the agents say it: "$13M", "$12.5M". */
const about = (apyK: number) => `$${Math.round(apyK / 500) / 2}M`;

/**
 * The share of a year's pay another team's deal must beat ours by to be what tipped it, and the least gap ($K) that
 * reads as more once rounded to the half million.
 */
const TIP = 1.05;
const TIP_MIN = 250;

const base = (league: League, id: string, p: Player): Omit<Draft, 'subject' | 'body'> => ({
  id,
  season: league.season,
  phase: league.phase,
  week: 0,
  ...director(league),
  category: 'contracts',
  actions: [{ kind: 'player', playerId: p.id }, { kind: 'fa' }],
});

/** His agent's call: another team is ahead of us and he is about to choose. */
function warning(league: League, id: string, p: Player, day: number): Draft | null {
  const view = raceView(league, p.id);
  if (!view || view.leader === null || view.leaderApy === null || view.leader === league.userTeamId) return null;
  const ahead = `${city(league, view.leader)} is ahead of us at about ${about(view.leaderApy)} a year`;
  const timing =
    day >= FA_DAYS - 1
      ? ', and free agency ends tomorrow. He will pick a team then.'
      : ', and he is close to picking a team. He will wait one day for our answer.';
  return {
    ...base(league, id, p),
    subject: `${name(p)}'s agent called`,
    body: `${name(p)}'s agent called. ${ahead}${timing}`,
  };
}

/** Our offer came off the table: we could no longer make it, or it fell under what he would accept. */
function dropped(league: League, id: string, p: Player, why: 'cap' | 'floor' | undefined): Draft {
  const reason =
    why === 'cap'
      ? 'We can no longer make it as written, because our cap room or our roster has changed since we put it in.'
      : 'It no longer meets his terms, so his agent will not take it to him.';
  return {
    ...base(league, id, p),
    subject: `Our offer to ${name(p)} is off the table`,
    body: `Our offer to ${name(p)} no longer stands. ${reason} He can still sign with another team, and we can put in a new offer while he is on the market.`,
  };
}

const PLACES = ['first', 'second', 'third', 'fourth', 'fifth'];

/** Where he signed, what we offered and what tipped it when one thing did. */
function result(league: League, id: string, p: Player, r: RaceResult): Draft {
  const c = p.teamId === r.teamId ? p.contract : null;
  const deal = c ? `${c.length} years at about ${about(c.apy)} a year` : null;
  if (r.teamId === league.userTeamId) {
    const others = r.offers - 1;
    return {
      ...base(league, id, p),
      subject: `${name(p)} signed with us`,
      body:
        `${name(p)} signed with us${deal ? `, ${deal}` : ''}. ` +
        (others > 0
          ? `He weighed ${others === 1 ? 'one other offer' : `${others} other offers`} and took ours.`
          : 'No other team had an offer in that he would take.'),
    };
  }
  const where = city(league, r.teamId);
  // The one thing that tipped it: a team that paid clearly more, or the team he had played for and went back to.
  let tip = '';
  if (c && r.userApy !== undefined && c.apy >= r.userApy * TIP && c.apy - r.userApy >= TIP_MIN)
    tip = ` ${where} paid about ${about(c.apy - r.userApy)} a year more than we offered.`;
  else if (clubFeeling(league, p, r.teamId) === 'home') tip = ` He had played for ${where} before, and he went back.`;
  // Ours led when he weighed them only when it came off the table as he chose: we could no longer make it.
  const place =
    r.userPlace === 1
      ? 'Our offer was the best he had, but we could no longer make it when he chose.'
      : r.userDropped
        ? 'Our offer had already come off the table.'
        : r.userPlace === null
          ? ''
          : `Our offer was ${PLACES[r.userPlace - 1] ?? `number ${r.userPlace}`} of the ${r.offers} he weighed.`;
  return {
    ...base(league, id, p),
    subject: `${name(p)} signed with ${where}`,
    body: `${name(p)} signed with ${where}${deal ? `, ${deal}` : ''}. ${place}${tip}`.trim(),
  };
}

export function raceMail(league: League, have: Set<string>): Draft[] {
  const race = league.faRace;
  if (!race || race.season !== league.season) return [];
  const out: Draft[] = [];
  const file = (d: Draft | null) => {
    if (!d) return;
    have.add(d.id);
    out.push(d);
  };
  // A player with a result: his result says it all, so no letter for an offer that came off the table first.
  const resulted = new Set(race.results.map((r) => r.playerId));
  if (league.phase === 'freeAgency')
    for (const w of race.warnings) {
      const id = `race:${league.season}:${w.playerId}:${w.day}`;
      if (!w.answered && !have.has(id)) file(warning(league, id, league.players[w.playerId], w.day));
    }
  // Keyed by the day it came off, so a second offer dropped the same year is told too; the last day's after it closes.
  for (const playerId of race.dropped ?? []) {
    const id = `race:${league.season}:${playerId}:dropped:${race.droppedOn?.[playerId] ?? league.faDay}`;
    if (!have.has(id) && !resulted.has(playerId))
      file(dropped(league, id, league.players[playerId], race.droppedWhy?.[playerId]));
  }
  for (const r of race.results) {
    if (r.userPlace === null && !r.userDropped) continue;
    const id = `race:${league.season}:${r.playerId}:done`;
    if (!have.has(id)) file(result(league, id, league.players[r.playerId], r));
  }
  return out;
}
