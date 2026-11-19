/**
 * The draft room's read of needs (spec `docs/superpowers/specs/2026-11-19-draft-room-rail-design.md`): what each team
 * needed as the draft opened, which of those it has drafted for since, and your lineup behind your needs, all on your
 * scouts' read. Reads only: nothing drawn, nothing stored, and nothing in the sim reads it (AI teams keep their own
 * needs, `teamNeeds`).
 */
import { ROSTER_TEMPLATE, STARTERS } from './positions';
import { spotsFor, type TeamScheme } from './schemes';
import { rosterOf, type TradeContext } from './trade/context';
import { littleFilm, needSeverity, needsOn, scoutedLine, type Need } from './trade/plans';
import { POSITIONS, type Player, type Position, type Team } from './types';

/** How hard a need presses, for its colour: big, a plain need, or minor (no colour). */
export type NeedTier = 'big' | 'need' | 'minor';

export interface DraftNeed extends Need {
  /** The team has a player it drafted this year at the position. */
  filled: boolean;
  tier: NeedTier;
}

export interface TeamDraftNeeds {
  needs: DraftNeed[];
  /** Our scouts have barely seen this team: its needs are early word. */
  littleFilm: boolean;
}

export interface LineupRow {
  position: Position;
  /** Players at the position on the 53, this year's draftees included. */
  have: number;
  /** What the schemes call for: the usual room, plus or minus the starters the scheme adds or drops. */
  want: number;
  /** The depth chart's starters at the position, as many as the scheme starts. */
  starters: Player[];
  /** The starter the need is about: the lowest on our read. None when the scheme starts nobody there. */
  weakest: Player | null;
  /** The league's typical starter here, on our read of the league. None when the scheme starts nobody there. */
  typical: number | null;
  need: DraftNeed | null;
  /** This year's draftees at the position, on the team now. */
  picks: Player[];
}

/** Big from 0.6 of a hole (a hole, or the weakest starter about 1.3 points under typical), a need from 0.3. */
export function needTier(n: Need): NeedTier {
  const s = needSeverity(n);
  return s >= 0.6 ? 'big' : s >= 0.3 ? 'need' : 'minor';
}

/** How many start at each position under a team's schemes. */
export function schemeStarters(scheme: TeamScheme): Record<Position, number> {
  return Object.fromEntries(POSITIONS.map((pos) => [pos, spotsFor(scheme, pos).length])) as Record<Position, number>;
}

/** The team's players taken in this year's draft, as it is now (a draftee traded away no longer counts). */
export function draftedThisYear(ctx: TradeContext, teamId: number): Player[] {
  return rosterOf(ctx, teamId).filter((p) => p.draft?.season === ctx.league.season);
}

/** The team as the draft opened: today's 53 without this year's draftees. */
export function rosterAtOpen(ctx: TradeContext, teamId: number): Player[] {
  return rosterOf(ctx, teamId).filter((p) => p.draft?.season !== ctx.league.season);
}

/** What `viewerId`'s scouts think `team` needed as the draft opened, and what it has drafted for since. */
export function draftNeeds(
  ctx: TradeContext,
  viewerId: number,
  team: Team,
  starters: Record<Position, number> = STARTERS,
): TeamDraftNeeds {
  const got = new Set(draftedThisYear(ctx, team.id).map((p) => p.position));
  const seen = (p: Player) => ctx.view(viewerId, p).ovr;
  const needs = needsOn(ctx.league, rosterAtOpen(ctx, team.id), scoutedLine(ctx, viewerId, starters), seen, starters);
  return {
    needs: needs.map((n) => ({ ...n, filled: got.has(n.position), tier: needTier(n) })),
    littleFilm: littleFilm(ctx, viewerId, team),
  };
}

/** The needs a screen shows: the first `n` not yet drafted for, then every one that has been. */
export function shownNeeds(needs: DraftNeed[], n = 5): DraftNeed[] {
  return [...needs.filter((x) => !x.filled).slice(0, n), ...needs.filter((x) => x.filled)];
}

/** `team`'s lineup behind its needs, one row a position in the game's order, on `viewerId`'s read. */
export function lineupRows(ctx: TradeContext, viewerId: number, team: Team, scheme: TeamScheme): LineupRow[] {
  const counts = schemeStarters(scheme);
  const line = scoutedLine(ctx, viewerId, counts);
  const { needs } = draftNeeds(ctx, viewerId, team, counts);
  const roster = rosterOf(ctx, team.id);
  const picks = draftedThisYear(ctx, team.id);
  const seen = (p: Player) => ctx.view(viewerId, p).ovr;
  return POSITIONS.map((pos) => {
    const n = counts[pos];
    const starters = team.depthChart[pos]
      .slice(0, n)
      .map((id) => ctx.league.players[id])
      .filter((p): p is Player => !!p && p.position === pos);
    return {
      position: pos,
      have: roster.filter((p) => p.position === pos).length,
      want: ROSTER_TEMPLATE[pos] + n - STARTERS[pos],
      starters,
      weakest: starters.length ? starters.reduce((a, b) => (seen(b) < seen(a) ? b : a)) : null,
      typical: n ? line[pos] : null,
      need: needs.find((x) => x.position === pos) ?? null,
      picks: picks.filter((p) => p.position === pos),
    };
  });
}
