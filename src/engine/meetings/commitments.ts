import { chairHolder, teamCoaches } from '../coaching';
import { managesTeam } from '../employment';
import { actualRole, addJolt, moraleContext, YEAR, type MoraleContext } from '../morale';
import { STARTERS } from '../positions';
import { clamp, Rng } from '../rng';
import { activeRoster } from '../roster';
import { unitOf } from '../standing';
import { TRADE_DEADLINE_WEEK } from '../trade/rules';
import {
  POSITIONS,
  type Commitment,
  type GmTraits,
  type League,
  type MeetingRecord,
  type MeetingSuggestion,
  type Player,
} from '../types';
import { CRED, shiftCredibility } from './credibility';
import { dugIn } from './suggest';

/**
 * What's put behind a meeting (L2, spec §2.1): a promise to the room with a window. Kept, the men who bought in get a
 * further lift and the coach's word gains; broken, they get a dip bigger than the meeting gave and his word loses.
 */
export const WINDOW = { snaps: 3, talks: 4, feud: 4, move: Infinity, jobs: 3 };

/** Morale's clock at the step after deadline week's games: deadline day's deals are done by then. */
export const deadlineClock = (season: number): number => season * YEAR + 8 + TRADE_DEADLINE_WEEK + 1;

/** Every starter on the club's depth chart, sorted (a `jobs` or `move` commitment is judged against these). */
export function startersOf(league: League, teamId: number): number[] {
  const chart = league.teams[teamId].depthChart;
  return POSITIONS.flatMap((pos) => (chart[pos] ?? []).slice(0, STARTERS[pos])).sort((a, b) => a - b);
}

/** The commitment a meeting opens, or none (words only). */
export function openCommitment(
  league: League,
  teamId: number,
  record: MeetingRecord,
  s: MeetingSuggestion,
  lift: Record<number, number>,
): Commitment | null {
  const backing = record.backing;
  if (backing === 'words') return null;
  const opened = record.clock;
  const hcId = chairHolder(teamCoaches(league, teamId), { role: 'headCoach' })?.id;
  const deadline = deadlineClock(Math.floor(opened / YEAR));
  const before = opened < deadline;
  const window = WINDOW[backing];
  const closes =
    backing === 'move'
      ? before
        ? deadline
        : opened
      : backing === 'talks' && before
        ? Math.min(opened + window, deadline)
        : opened + window;
  const boughtIn = [...record.outcomes.lands].sort((a, b) => a - b);
  return {
    backing,
    scope: record.scope,
    opened,
    closes,
    named: [...(s.namedFor?.[backing] ?? [])],
    boughtIn,
    by: record.kind === 'gm' ? 'gm' : 'coach',
    ...(record.kind !== 'gm' && hcId !== undefined ? { coachId: hcId } : {}),
    lift: Object.fromEntries(boughtIn.map((id) => [id, lift[id] ?? 0])),
    ...(backing === 'jobs' || backing === 'move' ? { starters: startersOf(league, teamId) } : {}),
    ...(backing === 'move'
      ? {
          roster: activeRoster(league, teamId)
            .map((p) => p.id)
            .sort((a, b) => a - b),
        }
      : {}),
  };
}

/** What a broken commitment costs a man who bought in, against what the meeting gave him. */
export const BROKEN_DIP = 1.5;
/** What a kept one adds, to a man the meeting lifted fully (`FULL_LIFT`, a coach's Monday meeting). */
export const KEPT_LIFT = 1;
const FULL_LIFT = 2;

/** An AI GM keeps his club's word by his tendencies: mostly, sometimes not (G4's rule for promises). */
export const aiKeepChance = (gm: Pick<GmTraits, 'loyalty' | 'stubbornness'>): number =>
  clamp(0.55 + 0.3 * (gm.loyalty - gm.stubbornness), 0.2, 0.9);

const onClub = (league: League, teamId: number, id: number) => {
  const p = league.players[id];
  return !!p && !p.retired && p.teamId === teamId;
};
const inRoom = (league: League, teamId: number, c: Commitment, id: number) =>
  onClub(league, teamId, id) && (c.scope === 'team' || unitOf(league.players[id].position) === c.scope);
const startsNow = (league: League, teamId: number, p: Player) =>
  (league.teams[teamId].depthChart[p.position] ?? []).slice(0, STARTERS[p.position]).includes(p.id);
/**
 * Talks with his agent: open now, or already done with a raise since the meeting. A signing closes the talks between
 * steps, so no step would see them open; the raise it lands (`paid`, the step after) is the talks having happened.
 */
const talked = (league: League, teamId: number, c: Commitment, id: number) =>
  league.negotiations[id]?.teamId === teamId ||
  (onClub(league, teamId, id) &&
    !!league.players[id].morale?.jolts?.some((j) => j.kind === 'paid' && j.at >= c.opened));

/** Kept already (true), or still undecided (null): broken is only ever the window closing on it. */
export function isKept(league: League, teamId: number, c: Commitment, ctx?: MoraleContext): true | null {
  switch (c.backing) {
    case 'snaps': {
      if (!c.named.length) return null;
      const context = ctx ?? moraleContext(league);
      const up = (id: number) => {
        const p = league.players[id];
        return startsNow(league, teamId, p) || (actualRole(league, p, context) ?? 0) >= 1;
      };
      return c.named.every(up) ? true : null;
    }
    case 'talks':
      return c.named.length && c.named.every((id) => talked(league, teamId, c, id)) ? true : null;
    case 'feud':
      return c.named.some((id) => !inRoom(league, teamId, c, id)) ? true : null;
    case 'move': {
      const before = new Set(c.roster ?? []);
      return startersOf(league, teamId).some((id) => !before.has(id)) ? true : null;
    }
    case 'jobs': {
      const now = startersOf(league, teamId);
      const was = c.starters ?? [];
      return now.length !== was.length || now.some((id, i) => id !== was[i]) ? true : null;
    }
  }
}

/** His record with the club: what the talks system remembers (`promisesScore`). */
function remember(p: Player, teamId: number, kept: boolean) {
  if (!p.morale) return;
  const talk = (p.morale.talk ??= { club: teamId });
  if (kept) talk.kept = (talk.kept ?? 0) + 1;
  else talk.broken = (talk.broken ?? 0) + 1;
}

function settle(league: League, teamId: number, c: Commitment, kept: boolean, clock: number) {
  // What the season's-end report tells: the promise, and whether it held. Your club's only: no one reads an AI club's,
  // and thirty-one clubs' worth would grow the save for nothing.
  const m = league.teams[teamId].meetings;
  if (m && managesTeam(league, teamId))
    (m.settled ??= []).push({
      clock: c.opened,
      scope: c.scope,
      backing: c.backing,
      kept,
      named: [...c.named],
      ...(c.by === 'gm' ? { by: 'gm' as const } : {}),
    });
  for (const id of c.boughtIn) {
    const p = league.players[id];
    if (!p || !onClub(league, teamId, id)) continue;
    // Each man feels it as far as the meeting reached him: a full lift (a coach's Monday meeting) earns the whole of a
    // kept one, a man it barely touched a little.
    const lift = c.lift?.[id] ?? 0;
    // A man who has dug in since (a dispute, talks gone sour) isn't won back by it; he still feels it broken.
    if (kept && dugIn(p)) continue;
    addJolt(p, kept ? 'kept' : 'broken', kept ? KEPT_LIFT * Math.min(1, lift / FULL_LIFT) : -BROKEN_DIP * lift, clock);
  }
  // A feud's two are named, but the one who goes is the keeping of it, not a promise to him.
  if (c.backing !== 'feud')
    for (const id of c.named)
      if (onClub(league, teamId, id) && !(kept && dugIn(league.players[id])))
        remember(league.players[id], teamId, kept);
  if (c.by !== 'coach' || c.coachId === undefined) return;
  const hc = chairHolder(teamCoaches(league, teamId), { role: 'headCoach' });
  if (hc && hc.id === c.coachId && hc.teamId === teamId) shiftCredibility(hc, kept ? CRED.kept : CRED.broken);
}

/**
 * Saves before v84: a talks commitment judged broken though its man signed a raise inside the window (the signing closed
 * the talks between steps, so no step saw them open). Your club's record of this year's settled commitments says which;
 * each is kept now, his record with the club put right, and the dip the room took on it taken back. An AI club keeps no
 * record, and its word was its GM's draw anyway.
 */
export function repairSignedTalks(league: League): void {
  const deadline = deadlineClock(league.season);
  for (const team of league.teams) {
    const m = team.meetings;
    for (const s of m?.settled ?? []) {
      if (s.backing !== 'talks' || s.kept || !s.named.length || Math.floor(s.clock / YEAR) !== league.season) continue;
      const closes = s.clock < deadline ? Math.min(s.clock + WINDOW.talks, deadline) : s.clock + WINDOW.talks;
      const signed = (id: number) => {
        if (!onClub(league, team.id, id)) return false;
        const p = league.players[id];
        const c = p.contract;
        // A deal signed in a week is signed before its games: the step after the week before (`moraleClock`).
        const at =
          c && c.signedSeason === league.season && c.signedWeek > 0 ? league.season * YEAR + 8 + c.signedWeek - 1 : -1;
        const paid = p.morale?.jolts?.some((j) => j.kind === 'paid' && j.at >= s.clock && j.at <= closes);
        return (at >= s.clock && at < closes) || !!paid;
      };
      if (!s.named.every(signed)) continue;
      s.kept = true;
      const room = m!.log.find((r) => r.clock === s.clock && r.scope === s.scope)?.outcomes.lands ?? [];
      for (const id of new Set([...room, ...s.named])) {
        const mood = league.players[id]?.morale;
        if (!mood?.jolts) continue;
        mood.jolts = mood.jolts.filter((j) => !(j.kind === 'broken' && j.at === closes));
        if (!mood.jolts.length) delete mood.jolts;
      }
      for (const id of s.named) {
        const t = league.players[id].morale?.talk;
        if (!t?.broken || t.club !== team.id) continue;
        t.broken -= 1;
        if (!t.broken) delete t.broken;
        t.kept = (t.kept ?? 0) + 1;
      }
    }
  }
}

/**
 * Each step, every club's open commitments (spec §2.1): a man gone is void for him; a hurt man's snaps wait for him;
 * a kept one closes at once, an unkept one when its window does (an AI club's by its GM's draw); a new league year
 * judges whatever is left.
 */
export function judgeCommitments(league: League): void {
  const clock = league.moraleAt ?? league.season * YEAR;
  let ctx: MoraleContext | undefined;
  for (const team of league.teams) {
    const m = team.meetings;
    if (!m?.open.length) continue;
    const keep: Commitment[] = [];
    for (const c of m.open) {
      const yearOver = Math.floor(c.opened / YEAR) < league.season;
      // Gone from the club: neither kept nor broken for him (a feud's pair stay: one going is the point).
      if (c.backing !== 'feud') c.named = c.named.filter((id) => onClub(league, team.id, id));
      c.boughtIn = c.boughtIn.filter((id) => onClub(league, team.id, id));
      if ((c.backing === 'snaps' || c.backing === 'talks') && !c.named.length) continue;
      if (c.backing === 'snaps' && !yearOver) {
        const hurt = c.named.some((id) => {
          const p = league.players[id];
          return !!(p.injury || p.ir);
        });
        if (hurt) c.closes += 1;
      }
      ctx ??= moraleContext(league);
      let kept = isKept(league, team.id, c, ctx) === true;
      if (!kept && !yearOver && clock < c.closes) {
        keep.push(c);
        continue;
      }
      // An AI club's word at the window's end: kept by its GM's tendencies (it doesn't make its moves for the room).
      if (!kept && !managesTeam(league, team.id))
        kept = new Rng(`${league.seed}:meeting:${league.season}:${c.closes}:${team.id}:commit:${c.opened}`).chance(
          aiKeepChance(team.gm),
        );
      settle(league, team.id, c, kept, clock);
    }
    m.open = keep;
  }
}
