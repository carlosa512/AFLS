/**
 * The user's inbox: mail from the league office, agents and the team's own staff, the way a
 * manager's desk fills up in Football Manager. Nothing in the sim sends mail. `deliverMail` looks
 * at the league after each change and files whatever is new, each message keyed by what it's about,
 * so delivering twice (or after a long sim) never duplicates one.
 */
import { AWARD_KEYS, AWARD_NAMES, HONOR_SLOTS, MONTHS, playerOfTheGame, seasonAwards, weeklyAwards, type AwardWinner } from './awards';
import { CHAIRS, chairHolder, coachName, coachResignForecast, coachTitle, isCoachExpiring, ownerLeeway, ownerTrigger, ownerTriggerNote, promotionFor, sameChair, teamCoaches, type Chair } from './coaching';
import { capSpace } from './finance/cap';
import { delegates, estimateText, injuryLabel, weeksLeft } from './injuries';
import { userGame } from './league';
import { isMedicExpiring, MEDIC_ROLE_LABEL, medicResignForecast, teamMedics } from './medical';
import { expiringPlayers } from './offseason/ai';
import { draftComplete, reachOrSteal } from './offseason/draft';
import { rookieCost } from './offseason/negotiation';
import { leaguePercentile, perceive } from './scouting';
import { starters, teamPlayers } from './roster';
import { ROUND_NAMES } from './season/playoffs';
import { playoffRace } from './season/standings';
import { isExpiring, ownerBudgetNote, resignForecast, ROLE_LABEL, staffWindowOpen, teamStaff } from './staff';
import { openOffers, pickLabel, TRADE_DEADLINE_WEEK } from './trade';
import type { Coach, CoachRole, CoachRoom, InboxMessage, League, Phase, Player, Position, Team, TradeOffer, TradeSide } from './types';

/** Saves keep the latest messages only, like the transaction log. */
const KEEP = 300;
const PHASE_ORDER: Phase[] = ['resign', 'freeAgency', 'draft', 'preseason', 'regular', 'playoffs', 'complete'];

/** Position groups an opposition report talks about: in the staff's words, and as the report's card titles them. */
const GROUPS: { phrase: string; title: string; positions: Position[]; plural?: true }[] = [
  { phrase: 'quarterback play', title: 'Quarterback', positions: ['QB'] },
  { phrase: 'backfield', title: 'Backfield', positions: ['RB'] },
  { phrase: 'receiving corps', title: 'Receivers', positions: ['WR', 'TE'] },
  { phrase: 'offensive line', title: 'Offensive line', positions: ['OL'] },
  { phrase: 'defensive front', title: 'Defensive front', positions: ['DT', 'EDGE'] },
  { phrase: 'linebackers', title: 'Linebackers', positions: ['LB'], plural: true },
  { phrase: 'secondary', title: 'Secondary', positions: ['CB', 'S'] },
];

type Draft = Omit<InboxMessage, 'read'>;
type Sender = Pick<InboxMessage, 'from' | 'fromCard'>;

const fullName = (p: Player) => `${p.firstName} ${p.lastName}`;
const teamName = (t: Team) => `${t.city} ${t.name}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** A small count in words, the way a sentence starts with one ("Two of them…"). */
const count = (n: number) => ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] ?? String(n);
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The staff member who signs a message, with a link to their card (a department name when the chair is empty).
function headCoach(league: League): Sender {
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'headCoach');
  return c ? { from: `${c.firstName} ${c.lastName}, Head coach`, fromCard: { kind: 'coach', id: c.id } } : { from: 'Coaching staff' };
}
function director(league: League): Sender {
  const s = teamStaff(league, league.userTeamId).find((x) => x.role === 'director');
  return s ? { from: `${s.firstName} ${s.lastName}, Director of scouting`, fromCard: { kind: 'scout', id: s.id } } : { from: 'Scouting department' };
}
function doctor(league: League): Sender {
  const m = teamMedics(league, league.userTeamId).find((x) => x.role === 'doctor');
  return m ? { from: `${m.firstName} ${m.lastName}, Head team doctor`, fromCard: { kind: 'medic', id: m.id } } : { from: 'Medical staff' };
}

/**
 * Players of the week and month as they're named, and once a year the season's honors: one message
 * per player, whatever he won (the weekly and monthly ones aren't repeated).
 */
function awardMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const team = league.teams[league.userTeamId];
  const mine = (w: AwardWinner | null | undefined): w is AwardWinner => !!w && w.teamId === league.userTeamId && !!league.players[w.playerId];
  const send = (id: string, season: number, week: number, playerId: number, honor: string, body: string) => {
    if (have.has(id)) return;
    const p = league.players[playerId];
    out.push({ id, season, phase: 'regular', week, from: 'League office', category: 'awards', subject: `${fullName(p)}: ${honor}`, body, actions: [{ kind: 'player', playerId }] });
  };
  const slotName = (i: number, period: string) => `${league.conferences[HONOR_SLOTS[i].conference].abbrev} ${HONOR_SLOTS[i].side === 'offense' ? 'Offensive' : 'Defensive'} Player of the ${period}`;
  for (const season of [league.season - 1, league.season]) {
    const weekly = weeklyAwards(league, season);
    for (const [week, winners] of Object.entries(weekly?.weeks ?? {})) {
      winners.forEach((w, i) => {
        if (!mine(w)) return;
        const honor = slotName(i, 'Week');
        send(`awards:${season}:w${week}:${i}`, season, Number(week), w.playerId, honor, `${fullName(league.players[w.playerId])} has been named ${honor} for week ${week}. The league office congratulates him and the ${teamName(team)}.`);
      });
    }
    for (const month of MONTHS) {
      weekly?.months[month.key]?.forEach((w, i) => {
        if (!mine(w)) return;
        const honor = slotName(i, 'Month');
        send(`awards:${season}:m${month.key}:${i}`, season, month.weeks[1], w.playerId, honor, `${fullName(league.players[w.playerId])} has been named ${honor} for ${month.label}, after a month of consistent play for the ${teamName(team)}.`);
      });
    }
    const voted = seasonAwards(league, season);
    if (!voted) continue;
    const honors = new Map<number, string[]>();
    const add = (w: AwardWinner, honor: string) => honors.set(w.playerId, [...(honors.get(w.playerId) ?? []), honor]);
    for (const k of AWARD_KEYS) if (mine(voted.winners[k])) add(voted.winners[k]!, AWARD_NAMES[k]);
    voted.allLeague.forEach((tier, t) => tier.filter(mine).forEach((w) => add(w, `${t === 0 ? 'First' : 'Second'}-team All-League`)));
    for (const [playerId, won] of honors) {
      const p = league.players[playerId];
      send(`awards:${season}:year:${playerId}`, season, 18, playerId, list(won), `The votes are in for ${season}: ${fullName(p)} has been named ${list(won)}. A season to remember, and it reflects well on the whole organization.`);
    }
  }
  return out;
}

/** The head doctor's word on each of our players who's hurt for a week or more (news, so only while he's still out). */
function injuryMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const p of teamPlayers(league, league.userTeamId)) {
    const now = p.injury;
    // The doctor's estimate, never the true weeks.
    if (!now || now.estimate[1] < 1) continue;
    const id = `medical:${now.season}:${now.week}:${p.id}:${now.type}`;
    if (have.has(id)) continue;
    const what = injuryLabel(now.type);
    const record = p.injuries?.at(-1);
    const how = record?.aggravated && record.type === now.type ? `has aggravated an old injury (${what})` : `was hurt ${now.where === 'game' ? 'in the game' : 'in practice'} (${what})`;
    out.push({
      id,
      season: now.season,
      phase: now.week === 0 ? league.phase : now.week > 18 ? 'playoffs' : 'regular',
      week: now.week,
      ...doctor(league),
      category: 'medical',
      subject: `${fullName(p)}: ${what}`,
      body: `${fullName(p)} ${how}. Our early read is that he'll be ${estimateText(now, weeksLeft(league))}; we'll keep you posted through his rehab.`,
      actions: [{ kind: 'player', playerId: p.id }, { kind: 'medical' }],
    });
  }
  return out;
}

/** The start of the league year: deals that are up and players who retired. */
function newYearMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const { season } = league;
  const team = league.teams[league.userTeamId];
  for (const p of expiringPlayers(league, team.id)) {
    const id = `contracts:${season}:${p.id}`;
    if (have.has(id)) continue;
    out.push({
      id,
      season,
      phase: 'resign',
      week: 0,
      from: `${fullName(p)}'s agent`,
      category: 'contracts',
      subject: `${fullName(p)}'s contract is up`,
      body: `My client's deal with the ${teamName(team)} has run out. He's open to staying, and we'd like to hear your offer during the re-sign window. Once free agency opens, he'll listen to the rest of the league.`,
      actions: [{ kind: 'player', playerId: p.id }, { kind: 'resign' }],
    });
  }
  const last = season - 1;
  for (const p of Object.values(league.players)) {
    // Retired this offseason after finishing last season with us.
    if (!p.retired || p.statTeams?.[last]?.at(-1) !== team.id) continue;
    const id = `retirement:${season}:${p.id}`;
    if (have.has(id)) continue;
    out.push({
      id,
      season,
      phase: 'resign',
      week: 0,
      from: fullName(p),
      category: 'retirement',
      subject: `${fullName(p)} retires`,
      body: `After ${plural(p.experience, 'season')} in the league, I've decided it's time to hang up my cleats. Thank you to everyone in the ${teamName(team)} organization, my teammates and our fans.`,
      actions: [{ kind: 'player', playerId: p.id }],
    });
  }
  return out;
}

/** The combine report, the day free agency opens: as in the NFL, the combine wraps up just before it. */
function combineMail(league: League, have: Set<string>): Draft[] {
  const { season } = league;
  const id = `scouting:${season}:combine`;
  if (have.has(id) || !league.draftClass.length) return [];
  return [
    {
      id,
      season,
      phase: 'freeAgency',
      week: 0,
      ...director(league),
      category: 'scouting',
      subject: `The ${season} combine is done`,
      body: `${plural(league.draftClass.length, 'prospect')} worked out for the ${season} draft, and the numbers are on the big board. We have ${plural(league.scoutPoints, 'scouting visit')} to spend this year: send them to the players you're serious about before draft day.`,
      actions: [{ kind: 'draft' }],
    },
  ];
}

function draftDayMail(league: League, have: Set<string>): Draft[] {
  const id = `scouting:${league.season}:draft`;
  if (have.has(id)) return [];
  const pick = league.draftPicks
    .filter((p) => p.season === league.season && p.ownerId === league.userTeamId && p.playerId === undefined)
    .sort((a, b) => (a.overall ?? 999) - (b.overall ?? 999))[0];
  const body = pick
    ? `Draft day. Our first pick is round ${pick.round}, No. ${pick.overall}. The big board is ready, and I'll make the call for you if you'd rather leave it to the scouts.`
    : `Draft day. We don't hold a pick in this draft, but the big board is there if you want to see where the class goes.`;
  return [{ id, season: league.season, phase: 'draft', week: 0, ...director(league), category: 'scouting', subject: 'The draft board is ready', body, actions: [{ kind: 'draft' }] }];
}

/** Our draftees this year, in pick order. Only players from drafts this league held: a new league's veterans have made-up draft lines. */
export function draftClassOf(league: League, season: number, teamId = league.userTeamId): Player[] {
  return Object.values(league.players)
    .filter((p) => p.scouting && p.draft?.season === season && p.draft.teamId === teamId)
    .sort((a, b) => a.draft!.pick - b.draft!.pick);
}

/** The director's word on our class once the draft is done: the picks, and how they compare with the consensus. */
function draftClassMail(league: League, have: Set<string>): Draft[] {
  const id = `scouting:${league.season}:class`;
  const picks = draftClassOf(league, league.season);
  if (have.has(id) || !picks.length) return [];
  const first = picks[0];
  const steals = picks.filter((p) => reachOrSteal(p.draft!) === 'steal').length;
  const value = !steals ? '' : steals === 1 ? ' One of them came well after where the consensus had him.' : ` ${count(steals)} of them came well after where the consensus had them.`;
  return [
    {
      id,
      season: league.season,
      phase: 'draft',
      week: 0,
      ...director(league),
      category: 'scouting',
      subject: `Our ${league.season} draft class`,
      body: `We made ${plural(picks.length, 'pick')}, starting with ${first.position} ${fullName(first)} at No. ${first.draft!.pick}.${value}`,
      actions: [{ kind: 'draft' }],
    },
  ];
}

/** Each position group's starters as our scouts read them, as a league percentile (0–1): what the opposition report's card shows. */
export function unitReads(league: League, teamId: number): { title: string; score: number }[] {
  return GROUPS.map((g) => ({ title: g.title, score: groupScore(league, league.teams[teamId], g.positions) }));
}

/** What a message is about, read back from its id. The ids are built here, so this is the one place that knows their shape. */
export type MailSubject =
  | { kind: 'matchup'; season: number; week: number }
  | { kind: 'injury'; season: number; week: number; playerId: number; type: string }
  | { kind: 'award'; season: number; playerId: number; period: 'week' | 'month' | 'year'; weeks: [number, number] }
  | { kind: 'contract'; season: number; playerId: number }
  | { kind: 'retirement'; season: number; playerId: number }
  | { kind: 'combine'; season: number }
  | { kind: 'draftDay'; season: number }
  | { kind: 'draftClass'; season: number }
  | { kind: 'trade'; season: number; text: string }
  | { kind: 'offer'; season: number; offerId: number }
  | { kind: 'recap'; season: number; gameId: number }
  | { kind: 'cleared'; season: number; week: number; playerId: number; type: string }
  | { kind: 'deadline'; season: number; weeksLeft: number }
  | { kind: 'race'; season: number; level: 'spot' | 'division' | 'bye' | 'out' }
  | { kind: 'owner'; season: number }
  | { kind: 'staffDeals'; season: number; people: StaffRef[] }
  | { kind: 'poached'; season: number; coachId: number; chair: Chair }
  | { kind: 'carousel'; season: number }
  | { kind: 'faWrap'; season: number };

/** One of our coaches, scouts or medical staff, as a staff message names him. */
export interface StaffRef {
  kind: 'coach' | 'scout' | 'medic';
  id: number;
}
const REF_KEY = { coach: 'c', scout: 's', medic: 'm' } as const;
const refKey = (r: StaffRef) => `${REF_KEY[r.kind]}${r.id}`;
const refOf = (key: string): StaffRef => ({ kind: key[0] === 'c' ? 'coach' : key[0] === 's' ? 'scout' : 'medic', id: Number(key.slice(1)) });

export function mailSubject(m: InboxMessage): MailSubject | null {
  const [category, s, a, b, ...rest] = m.id.split(':');
  const season = Number(s);
  const player = m.actions.find((x) => x.kind === 'player');
  const playerId = player?.kind === 'player' ? player.playerId : -1;
  switch (category) {
    case 'matchup':
      return { kind: 'matchup', season, week: Number(a) };
    case 'medical':
      return { kind: 'injury', season, week: Number(a), playerId: Number(b), type: rest.join(':') };
    case 'awards': {
      if (a === 'year') return { kind: 'award', season, playerId: Number(b), period: 'year', weeks: [1, 18] };
      const month = MONTHS.find((x) => `m${x.key}` === a);
      if (month) return { kind: 'award', season, playerId, period: 'month', weeks: month.weeks };
      const week = Number(a.slice(1));
      return { kind: 'award', season, playerId, period: 'week', weeks: [week, week] };
    }
    case 'contracts':
      return { kind: 'contract', season, playerId: Number(a) };
    case 'retirement':
      return { kind: 'retirement', season, playerId: Number(a) };
    case 'scouting':
      if (a === 'combine') return { kind: 'combine', season };
      return a === 'draft' ? { kind: 'draftDay', season } : { kind: 'draftClass', season };
    case 'trades':
      return { kind: 'trade', season, text: rest.join(':') };
    case 'offer':
      return { kind: 'offer', season, offerId: Number(a) };
    case 'recap':
      return { kind: 'recap', season, gameId: Number(a) };
    case 'cleared':
      return { kind: 'cleared', season, week: Number(a), playerId: Number(b), type: rest.join(':') };
    case 'deadline':
      return { kind: 'deadline', season, weeksLeft: Number(a) };
    case 'race':
      return { kind: 'race', season, level: a as 'spot' | 'division' | 'bye' | 'out' };
    case 'owner':
      return { kind: 'owner', season };
    case 'staff':
      if (a === 'deals') return { kind: 'staffDeals', season, people: b ? b.split('.').map(refOf) : [] };
      return { kind: 'poached', season, coachId: Number(b), chair: rest[0] === 'positionCoach' ? { role: 'positionCoach', room: rest[1] as CoachRoom } : { role: rest[0] as CoachRole } };
    case 'league':
      return { kind: 'carousel', season };
    case 'fa':
      return { kind: 'faWrap', season };
    default:
      return null;
  }
}

/**
 * Whether a message still asks something of the user, worked out from the league as it is now (nothing
 * stored): a report until the game is played, an injury while he's out and off reserve, an expiring deal
 * through the re-sign window, the combine while visits are left before the draft, draft day until our picks
 * are in, the trade deadline until it passes, an all-clear while he waits on reserve for you to activate him,
 * staff deals through the re-sign window, a coach hired away until his chair is filled (or the window shuts).
 */
export function needsYou(league: League, m: InboxMessage): boolean {
  const s = mailSubject(m);
  if (!s || s.season !== league.season) return false;
  const user = league.userTeamId;
  switch (s.kind) {
    case 'matchup': {
      const game = userGame(league, s.week);
      return !!game && !game.result;
    }
    case 'injury': {
      const p = league.players[s.playerId];
      return !!p && p.teamId === user && !p.ir && p.injury?.season === s.season && p.injury.week === s.week && p.injury.type === s.type;
    }
    case 'contract':
      return league.phase === 'resign' && expiringPlayers(league, user).some((p) => p.id === s.playerId);
    case 'combine':
      return league.phase === 'freeAgency' && league.scoutPoints > 0;
    case 'draftDay':
      return league.phase === 'draft' && league.draftPicks.some((p) => p.season === league.season && p.ownerId === user && p.playerId === undefined);
    case 'deadline':
      return league.phase === 'regular' && league.week <= TRADE_DEADLINE_WEEK;
    case 'cleared': {
      const p = league.players[s.playerId];
      return !!p && p.teamId === user && !!p.ir && !p.injury && !delegates(league, league.teams[user]);
    }
    case 'staffDeals':
      return league.phase === 'resign' && s.people.some((r) => stillExpiring(league, r));
    case 'poached':
      return staffWindowOpen(league) && !chairHolder(teamCoaches(league, user), s.chair);
    case 'offer':
      return openOffers(league).some((o) => o.id === s.offerId);
    default:
      return false;
  }
}

export function markAllRead(league: League): void {
  for (const m of league.inbox ?? []) m.read = true;
}

/** Our read of a team's starters in a position group, as a league percentile (0–1). */
function groupScore(league: League, team: Team, positions: Position[]): number {
  const players = positions.flatMap((pos) => starters(league, team, pos).map((p) => leaguePercentile(league, pos, perceive(league, league.userTeamId, p).ovr)));
  return players.reduce((s, x) => s + x, 0) / Math.max(1, players.length);
}

/** The head coach's opposition report for this week's game, built on our scouts' read of their starters. */
function matchupMail(league: League, have: Set<string>): Draft[] {
  const game = userGame(league);
  const id = `matchup:${league.season}:${league.week}`;
  if (!game || game.result || have.has(id)) return [];
  const home = game.homeId === league.userTeamId;
  const opp = league.teams[home ? game.awayId : game.homeId];
  const ranked = GROUPS.map((g) => ({ g, score: groupScore(league, opp, g.positions) })).sort((a, b) => a.score - b.score);
  const weak = ranked[0].g;
  const strong = ranked[ranked.length - 1].g.phrase;
  const occasion = game.playoffRound ? `the ${ROUND_NAMES[game.playoffRound]}` : `week ${league.week}`;
  const where = game.neutral ? 'on a neutral field' : home ? 'at home' : 'on the road';
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...headCoach(league),
      category: 'matchup',
      subject: `Opposition report: ${teamName(opp)}`,
      body: `We face the ${teamName(opp)} ${where} in ${occasion}. Their ${weak.phrase} ${weak.plural ? 'are' : 'is'} the soft spot, and that's where we'll go after them. Respect their ${strong}: it's the best unit they have.`,
      actions: [{ kind: 'team', teamId: opp.id }],
    },
  ];
}

function tradeMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const t of league.transactions) {
    if (t.kind !== 'trade' || t.season < league.season - 1 || !t.teamIds.includes(league.userTeamId)) continue;
    const id = `trades:${t.season}:${t.phase}:${t.week}:${t.text}`;
    if (have.has(id)) continue;
    const partner = league.teams[t.teamIds.find((x) => x !== league.userTeamId) ?? league.userTeamId];
    out.push({
      id,
      season: t.season,
      phase: t.phase,
      week: t.phase === 'regular' ? t.week : 0,
      from: `${teamName(partner)} front office`,
      category: 'trades',
      subject: `Trade with the ${partner.name} is done`,
      body: `Pleasure doing business. ${t.text}. The players have passed their physicals and the league has approved the deal.`,
      actions: [{ kind: 'team', teamId: league.userTeamId }, { kind: 'team', teamId: partner.id }],
    });
  }
  return out;
}

/** A side of a deal in words: "WR Riley Wright, a 2027 3rd and a 2028 6th". */
export function packageWords(league: League, side: TradeSide): string {
  const players = side.players.map((id) => `${league.players[id].position} ${fullName(league.players[id])}`);
  const picks = side.picks.map((id) => league.draftPicks.find((p) => p.id === id)).filter((p) => !!p).map((p) => pickLabel(league, p!));
  return list([...players, ...picks]) || 'nothing';
}

/** The offer's subject and opening line, in the GM's words (never a number from his valuation). */
export function offerWords(league: League, offer: TradeOffer): { subject: string; body: string } {
  const team = league.teams[offer.teamId];
  const [his, yours] = offer.sides;
  const yourMan = yours.players[0] !== undefined ? league.players[yours.players[0]] : null;
  const hisMan = his.players[0] !== undefined ? league.players[his.players[0]] : null;
  const name = (p: Player) => `${p.position} ${fullName(p)}`;
  const close = offer.final ? ' That is our final offer.' : '';
  switch (offer.reason) {
    case 'enquiry':
      return { subject: `The ${team.name} ask about ${name(yourMan!)}`, body: `Is ${name(yourMan!)} available? We'd be interested if you're willing to listen.` };
    case 'pitch':
      return { subject: `The ${team.name} are listening on ${name(hisMan!)}`, body: `We're listening on ${name(hisMan!)}. Would ${packageWords(league, yours)} get it done?${close}` };
    case 'dump':
      return { subject: `The ${team.name} want to move ${name(hisMan!)}'s deal`, body: `Take on ${name(hisMan!)}'s contract and ${packageWords(league, { ...his, players: [] })} is yours.${close}` };
    case 'counter':
      return { subject: `The ${team.name} come back with a counter`, body: `We've looked at your counter. ${packageWords(league, his)} for ${packageWords(league, yours)}, and we have a deal.${close}` };
    case 'shop':
      return { subject: `The ${team.name} answer your call about ${name(yourMan!)}`, body: `You're shopping ${name(yourMan!)}. Our best: ${packageWords(league, his)}.${close}` };
    default:
      return { subject: `The ${team.name} make an offer for ${name(yourMan!)}`, body: `We'd like to bring ${name(yourMan!)} to ${team.city}. ${capital(packageWords(league, his))}, if you're open to it.${close}` };
  }
}

/** Every offer on your desk files a message: it asks something of you while the offer is open. */
function offerMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const offer of league.market?.offers ?? []) {
    const id = `offer:${offer.season}:${offer.id}`;
    if (have.has(id) || offer.status !== 'pending') continue;
    const team = league.teams[offer.teamId];
    const { subject, body } = offerWords(league, offer);
    const about = [...offer.sides[1].players, ...offer.sides[0].players][0];
    out.push({
      id,
      season: offer.season,
      phase: offer.phase,
      week: offer.phase === 'regular' ? league.week : 0,
      from: `${teamName(team)} front office`,
      category: 'trades',
      subject,
      body,
      actions: [{ kind: 'trades' }, ...(about !== undefined ? [{ kind: 'player' as const, playerId: about }] : []), { kind: 'team', teamId: team.id }],
    });
  }
  return out;
}

/** "Hip flexor strain" → "hip flexor strain" inside a sentence; "MCL sprain" and "ACL" stay as they are. */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The head coach's word after our latest game: the score, the yards, the player of the game. One game only, so a long sim doesn't bury the inbox. */
function recapMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  const game = league.games
    .filter((g) => g.season === league.season && g.result && (g.homeId === user || g.awayId === user))
    .sort((a, b) => b.week - a.week)[0];
  if (!game || have.has(`recap:${game.season}:${game.id}`)) return [];
  const r = game.result!;
  const home = game.homeId === user;
  const [us, them] = home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
  const [ours, theirs] = home ? [r.home, r.away] : [r.away, r.home];
  const me = league.teams[user];
  const opp = league.teams[home ? game.awayId : game.homeId];
  const where = game.neutral ? 'on a neutral field' : home ? 'at home' : 'on the road';
  const when = `${where}${game.playoffRound ? ` in the ${ROUND_NAMES[game.playoffRound]}` : ''}${r.overtime ? ' in overtime' : ''}`;
  const score = `${Math.max(us, them)}–${Math.min(us, them)}`;
  const result = us > them ? `We beat the ${teamName(opp)} ${score} ${when}.` : us < them ? `We lost to the ${teamName(opp)} ${score} ${when}.` : `We tied the ${teamName(opp)} ${score} ${when}.`;
  const yards =
    ours.totalYds >= theirs.totalYds
      ? ` We outgained them ${ours.totalYds} yards to ${theirs.totalYds}${ours.top >= 33 * 60 ? ` and held the ball for ${clock(ours.top)}` : ''}.`
      : ` They outgained us ${theirs.totalYds} yards to ${ours.totalYds}.`;
  const star = playerOfTheGame(league, game);
  const p = star !== null ? league.players[star] : undefined;
  const potg = !p ? '' : r.playerTeams[p.id] === user ? ` ${fullName(p)} was the player of the game.` : ` Their ${p.position} ${fullName(p)} was the player of the game.`;
  const [win, lose] = us >= them ? [{ team: me, pts: us }, { team: opp, pts: them }] : [{ team: opp, pts: them }, { team: me, pts: us }];
  return [
    {
      id: `recap:${game.season}:${game.id}`,
      season: game.season,
      phase: game.playoffRound ? 'playoffs' : 'regular',
      week: game.week,
      ...headCoach(league),
      category: 'matchup',
      subject: `Game recap: ${win.team.name} ${win.pts}, ${lose.team.name} ${lose.pts}`,
      body: `${result}${yards}${potg}`,
      actions: [{ kind: 'game', gameId: game.id }],
    },
  ];
}

/** The doctor's all-clear for a player whose injury we wrote about, once he's healthy again (in season: the offseason heals everyone at once). */
function clearedMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const team = league.teams[league.userTeamId];
  for (const p of teamPlayers(league, team.id)) {
    const was = p.injuries?.at(-1);
    if (p.injury || !was || was.season !== league.season) continue;
    const key = `${was.season}:${was.week}:${p.id}:${was.type}`;
    if (!have.has(`medical:${key}`) || have.has(`cleared:${key}`)) continue;
    const what = lower(injuryLabel(was.type));
    const ir = !p.ir ? " He's back in his spot on the depth chart." : delegates(league, team) ? " He's still on injured reserve: the staff will bring him back once his four weeks are up." : " He's still on injured reserve: activate him when you want him back.";
    out.push({
      id: `cleared:${key}`,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...doctor(league),
      category: 'medical',
      subject: `${fullName(p)} is cleared to play`,
      body: `${fullName(p)} is over his ${what} and cleared for full practice.${ir}`,
      actions: [{ kind: 'player', playerId: p.id }, { kind: 'team', teamId: team.id }],
    });
  }
  return out;
}

/** The league office's reminder the week before the trade deadline, and the week of it. */
function deadlineMail(league: League, have: Set<string>): Draft[] {
  const weeks = TRADE_DEADLINE_WEEK - league.week;
  const id = `deadline:${league.season}:${weeks}`;
  if ((weeks !== 0 && weeks !== 1) || have.has(id)) return [];
  return [
    {
      id,
      season: league.season,
      phase: 'regular',
      week: league.week,
      from: 'League office',
      category: 'trades',
      subject: weeks ? 'Trade deadline: one week to go' : 'Trade deadline: this week',
      body: weeks
        ? `Trades are open through week ${TRADE_DEADLINE_WEEK}. After that, rosters are set until the new league year.`
        : `This is the last week to make a trade. The deadline passes when week ${TRADE_DEADLINE_WEEK} is played.`,
      actions: [{ kind: 'trades' }],
    },
  ];
}

const RACE = ['bye', 'division', 'spot'] as const;

/** The league office's word when our playoff fate is certain: the best clinch so far (a bye implies the rest), or elimination. */
function raceMail(league: League, have: Set<string>): Draft[] {
  const team = league.teams[league.userTeamId];
  const race = playoffRace(league, team.id);
  const sent = (level: string) => have.has(`race:${league.season}:${level}`);
  const best = RACE.find((level) => race[level]);
  const level = race.out ? 'out' : best && !RACE.slice(0, RACE.indexOf(best) + 1).some(sent) ? best : null;
  if (!level || sent(level)) return [];
  const left = league.games.filter((g) => g.season === league.season && !g.playoffRound && !g.result && (g.homeId === team.id || g.awayId === team.id)).length;
  const still = left ? ` with ${count(left).toLowerCase()} game${left === 1 ? '' : 's'} to play` : '';
  const name = teamName(team);
  const text = {
    bye: [`Top seed clinched`, `The ${name} have clinched the top seed in the ${league.conferences[team.conference].abbrev}, and with it the only first-round bye${still}.`],
    division: [`${league.divisions[team.division].name} title clinched`, `The ${name} have clinched the ${league.divisions[team.division].name} title${still}.`],
    spot: [`Playoff spot clinched`, `The ${name} have clinched a place in the ${league.season} playoffs${still}.`],
    out: [`Out of the playoff race`, `The ${name} can no longer reach the ${league.season} playoffs.`],
  }[level];
  return [
    {
      id: `race:${league.season}:${level}`,
      season: league.season,
      phase: league.phase,
      week: league.week,
      from: 'League office',
      category: 'league',
      subject: text[0],
      body: text[1],
      actions: [{ kind: 'standings' }],
    },
  ];
}

// ───────── the front office ─────────

const millions = (k: number) => `$${(k / 1000).toFixed(1)}M`;
const recordWords = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
const recordIn = (league: League, season: number, teamId: number) => league.history.find((h) => h.season === season)?.records[teamId] ?? null;

/**
 * The owner's letter as the league year opens: the budgets (on the card), and how far past the coaching
 * budget he'll go, in his words rather than a number (`ownerLeeway`): a sharp reader can tell a contender's
 * owner who wants a title from one who wants the budget kept.
 */
function ownerMail(league: League, have: Set<string>): Draft[] {
  const { season } = league;
  const id = `owner:${season}`;
  if (have.has(id)) return [];
  const team = league.teams[league.userTeamId];
  const market = ownerBudgetNote(team.staffBudgetMult);
  const marketLine =
    market === 'Big-spending owner'
      ? `${team.city} can carry a bigger staff than most, and I expect us to have one.`
      : market
        ? `${team.city} isn't a big market, and I won't pretend we can spend like the teams that are.`
        : 'Our budgets sit about where the rest of the league’s do. Spend them well.';
  const stance = ownerLeeway(league, team.id, { role: 'headCoach' });
  const last = recordIn(league, season - 1, team.id);
  const rec = last ? recordWords(last) : '';
  const over = 'If the right head coach or coordinator costs a little more than the coaching budget';
  const leeway = {
    playoffs: `We made the playoffs last year, and I want a title. ${over}, make the case and I'll listen.`,
    winNow: `After a ${rec} season, I want to win now. ${over}, make the case.`,
    newCoach: `Not after a ${rec} season: stay inside the coaching budget, unless it's for the right head coach.`,
    bigMarket: `${over}, I'll find it.`,
    stretch: `For the right head coach or coordinator I'll stretch a little past the coaching budget, but only a little.`,
    lastYear: 'We went past the coaching budget last year. This year I want it kept.',
    tight: "This market can't carry a dollar more than the budgets below.",
    losing: `Not after a ${rec} season: stay inside the coaching budget.`,
    assistant: '',
  }[stance.reason];
  const trigger = ownerTriggerNote(ownerTrigger(league, team.id));
  const patience = trigger === 'Quick trigger with head coaches' ? ' I expect results, and I expect them soon.' : trigger ? ' I believe in giving good people time to build something.' : '';
  return [
    {
      id,
      season,
      phase: 'resign',
      week: 0,
      from: 'The owner',
      category: 'staff',
      subject: 'A letter from the owner',
      body: `A new league year starts today, and the budgets for ${season} are below. ${marketLine} ${leeway}${patience}`,
      actions: [{ kind: 'coaches' }, { kind: 'cap' }],
    },
  ];
}

/** Whether one of the people a staff message names still has a deal that ran out, with us. */
function stillExpiring(league: League, r: StaffRef): boolean {
  const user = league.userTeamId;
  if (r.kind === 'coach') {
    const c = league.coaches[r.id];
    return !!c && c.teamId === user && isCoachExpiring(league, c);
  }
  if (r.kind === 'scout') {
    const s = league.staff[r.id];
    return !!s && s.teamId === user && isExpiring(league, s);
  }
  const m = league.medics[r.id];
  return !!m && m.teamId === user && isMedicExpiring(league, m);
}

/** Our coaches, scouts and medical staff whose deals ran out, and how each one's re-sign window ends if nothing changes. */
function staffDealsMail(league: League, have: Set<string>): Draft[] {
  const { season } = league;
  const user = league.userTeamId;
  if ([...have].some((id) => id.startsWith(`staff:${season}:deals`))) return [];
  const coaches = teamCoaches(league, user).filter((c) => isCoachExpiring(league, c));
  const scouts = teamStaff(league, user).filter((s) => isExpiring(league, s));
  const medics = teamMedics(league, user).filter((m) => isMedicExpiring(league, m));
  const people: StaffRef[] = [...coaches.map((c) => ({ kind: 'coach' as const, id: c.id })), ...scouts.map((s) => ({ kind: 'scout' as const, id: s.id })), ...medics.map((m) => ({ kind: 'medic' as const, id: m.id }))];
  if (!people.length) return [];
  const group = (n: number, one: string, many: string) => (n === 1 ? `our ${one}` : `${count(n).toLowerCase()} ${many}`);
  const groups = [
    coaches.length ? group(coaches.length, coachTitle(coaches[0]).toLowerCase(), 'coaches') : '',
    scouts.length ? group(scouts.length, ROLE_LABEL[scouts[0].role].toLowerCase(), 'scouts') : '',
    medics.length ? group(medics.length, MEDIC_ROLE_LABEL[medics[0].role].toLowerCase(), 'of the medical staff') : '',
  ].filter(Boolean);
  const leaving = [coachResignForecast(league, user), resignForecast(league, user), medicResignForecast(league, user)].reduce((n, f) => n + [...f.values()].filter((o) => o !== 'stays').length, 0);
  const n = people.length;
  const outlook = !leaving ? 'As things stand, every one of them stays.' : leaving === n ? 'As things stand, none of them stays.' : `As things stand, ${count(leaving).toLowerCase()} of them would leave.`;
  return [
    {
      id: `staff:${season}:deals:${people.map(refKey).join('.')}`,
      season,
      phase: 'resign',
      week: 0,
      from: 'Front office',
      category: 'staff',
      subject: n === 1 ? 'A staff contract is up' : `${count(n)} staff contracts are up`,
      body: `${capital(list(groups))} ${n === 1 ? 'is' : 'are'} out of contract. Unless you extend them or let them go first, each re-signs for two years at his ask when free agency opens, as long as his chair is free and the budget covers him. ${outlook}`,
      actions: [{ kind: 'coaches' }, { kind: 'staff' }, { kind: 'medical' }],
    },
  ];
}
/** The chair a coach title names ("quarterbacks coach" → the QB room), as the transaction log writes it. */
const chairTitled = (title: string): Chair | undefined => CHAIRS.find((ch) => coachTitle(ch).toLowerCase() === title);

/** Our people one rung below a chair who could step into it (`promotionFor`): a coach needs a season in his chair first. */
export function promotionCandidates(league: League, chair: Chair): Coach[] {
  return teamCoaches(league, league.userTeamId).filter((c) => {
    const up = promotionFor(c);
    return !!up && sameChair(up, chair) && !!c.career?.length;
  });
}

/**
 * The head coach's word when another team hires one of our coaches into a bigger chair (`fillChairs` can
 * raid a staff for a promotion, and the NFL lets no team block one). His chair stays open until we fill it.
 */
function poachedMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  const out: Draft[] = [];
  for (const t of league.transactions) {
    if (t.kind !== 'coach' || t.season !== league.season || t.teamIds.length !== 2 || t.teamIds[1] !== user || t.teamIds[0] === user) continue;
    const hirer = league.teams[t.teamIds[0]];
    const c = teamCoaches(league, hirer.id).find((x) => t.text.includes(` ${coachName(x)} as `));
    // "LV hired BUF quarterbacks coach Sam Reed as offensive coordinator": the chair he held with us.
    const was = c && t.text.split(` ${league.teams[user].abbrev} `)[1]?.split(` ${coachName(c)} as `)[0];
    const chair = was ? chairTitled(was) : undefined;
    if (!c || !was || !chair) continue;
    const id = `staff:${league.season}:gone:${c.id}:${chair.role}${chair.role === 'positionCoach' ? `:${chair.room}` : ''}`;
    if (have.has(id)) continue;
    const now = coachTitle(c).toLowerCase();
    const fill = promotionCandidates(league, chair).length ? 'promote from within or go to the market' : 'go to the market';
    out.push({
      id,
      season: league.season,
      phase: 'freeAgency',
      week: 0,
      ...headCoach(league),
      category: 'staff',
      subject: `${coachName(c)} leaves for the ${hirer.name}`,
      body: `The ${teamName(hirer)} have hired ${coachName(c)}, our ${was}, as their ${now}. It's a promotion, not a lateral move, so we couldn't block it. That leaves our ${was} chair open: ${fill} before free agency ends.`,
      actions: [{ kind: 'coaches' }],
    });
  }
  return out;
}

/** A head coaching change this league year: who took over a team, where he was last season, and the man he replaced. */
export interface HeadCoachChange {
  teamId: number;
  coach: Coach;
  /** Last season's chair: "Offensive coordinator, KC", "Head coach, DEN" (and that team's record), or new to the league. */
  from: { title: string; teamId: number; record: { w: number; l: number; t: number } | null } | null;
  /** Last season's head coach, and the team's record under him. */
  replaced: Coach | null;
  record: { w: number; l: number; t: number } | null;
}

/** Every team whose head coach for `season` isn't the one who finished `season - 1`, the user's division first. */
export function headCoachChanges(league: League, season = league.season): HeadCoachChange[] {
  const everyone = [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)];
  const headed = (s: number) => new Map(everyone.flatMap((c) => (c.career ?? []).filter((x) => x.season === s && x.role === 'headCoach').map((x) => [x.teamId, c] as const)));
  const before = headed(season - 1);
  // This league year: the chair as it stands now; a past one: whoever finished it.
  const after = season === league.season ? new Map(league.teams.map((t) => [t.id, chairHolder(teamCoaches(league, t.id), { role: 'headCoach' })] as const)) : headed(season);
  const division = league.teams[league.userTeamId].division;
  const out: HeadCoachChange[] = [];
  for (const team of league.teams) {
    const coach = after.get(team.id);
    const replaced = before.get(team.id) ?? null;
    if (!coach || coach === replaced) continue;
    const last = coach.career?.find((x) => x.season === season - 1);
    out.push({
      teamId: team.id,
      coach,
      from: last ? { title: coachTitle(last), teamId: last.teamId, record: last.role === 'headCoach' ? recordIn(league, season - 1, last.teamId) : null } : null,
      replaced,
      record: recordIn(league, season - 1, team.id),
    });
  }
  return out.sort((a, b) => Number(league.teams[b.teamId].division === division) - Number(league.teams[a.teamId].division === division));
}

/** The league office's note once the window's hirings are done: every team with a new head coach. */
function carouselMail(league: League, have: Set<string>): Draft[] {
  const id = `league:${league.season}:carousel`;
  if (have.has(id)) return [];
  const changes = headCoachChanges(league);
  if (!changes.length) return [];
  const team = league.teams[league.userTeamId];
  const near = changes.filter((x) => league.teams[x.teamId].division === team.division && x.teamId !== team.id).length;
  const ours = changes.some((x) => x.teamId === team.id);
  const n = changes.length;
  return [
    {
      id,
      season: league.season,
      phase: 'freeAgency',
      week: 0,
      from: 'League office',
      category: 'league',
      subject: `Coaching carousel: ${n} new head coach${n === 1 ? '' : 'es'}`,
      body: `${count(n)} team${n === 1 ? ' has a' : 's have'} new head coach${n === 1 ? '' : 'es'} for ${league.season}${ours ? ', ours among them' : ''}.${near ? ` ${near === 1 ? 'One is' : `${count(near)} are`} in the ${league.divisions[team.division].name}.` : ''}`,
      actions: [{ kind: 'coaches' }],
    },
  ];
}

/** One free-agent signing, read back from the transaction log ("LV signed WR Sam Reed (3 yr, $24.0M)"). */
export interface Signing {
  teamId: number;
  player: Player;
  years: number;
  /** The whole deal, $K. */
  total: number;
}

/** What free agency did: our signings, our players who signed elsewhere (and those still unsigned), and the league's biggest deals. */
export function freeAgencyMoves(league: League, season = league.season) {
  const user = league.userTeamId;
  const byName = new Map<string, Player[]>();
  for (const p of Object.values(league.players)) {
    const key = `${p.position} ${p.firstName} ${p.lastName}`;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const abbrevs = new Map(league.teams.map((t) => [t.abbrev, t.id]));
  const deals: Signing[] = [];
  for (const t of league.transactions) {
    if (t.kind !== 'sign' || t.season !== season || t.phase !== 'freeAgency') continue;
    const m = /^(\w+) signed (\w+ .+) \((\d+) yr, \$([\d.]+)M\)$/.exec(t.text);
    const teamId = m ? abbrevs.get(m[1]) : undefined;
    if (!m || teamId === undefined) continue;
    const named = byName.get(m[2]) ?? [];
    const player = named.find((p) => p.teamId === teamId) ?? named[0];
    if (player) deals.push({ teamId, player, years: Number(m[3]), total: Math.round(Number(m[4]) * 1000) });
  }
  // A player can sign twice (cut, then signed again): his last deal is the one that stands.
  const last = new Map(deals.map((d) => [d.player.id, d]));
  const standing = [...last.values()];
  const ours = (p: Player) => p.statTeams?.[season - 1]?.at(-1) === user;
  const left = Object.values(league.players).filter((p) => ours(p) && !p.retired && p.teamId !== user);
  return {
    signed: standing.filter((d) => d.teamId === user).sort((a, b) => b.total - a.total),
    walked: standing.filter((d) => d.teamId !== user && ours(d.player)).sort((a, b) => b.total - a.total),
    unsigned: left.filter((p) => p.teamId === null),
    resigned: league.transactions.filter((t) => t.kind === 'resign' && t.season === season && t.phase === 'resign' && t.teamIds.includes(user)).length,
    biggest: [...standing].sort((a, b) => b.total - a.total).slice(0, 3),
  };
}

/** The front office's summary once free agency closes: who we signed, who signed elsewhere, and the cap the draft has to fit in. */
function faWrapMail(league: League, have: Set<string>): Draft[] {
  const id = `fa:${league.season}`;
  if (have.has(id)) return [];
  const fa = freeAgencyMoves(league);
  const space = capSpace(league, league.userTeamId);
  const rookies = rookieCost(league, league.userTeamId);
  const signed = fa.signed.length ? `We signed ${plural(fa.signed.length, 'free agent')}` : 'We signed no free agents';
  const kept = fa.resigned ? ` and re-signed ${fa.resigned} of our own` : '';
  const walked = fa.walked.length ? `; ${count(fa.walked.length).toLowerCase()} of last season's players signed elsewhere` : '';
  const cap = rookies > 0 ? ` We have ${millions(space)} of cap space going into the draft, and our rookie class will need about ${millions(rookies)} of it.` : ` We have ${millions(space)} of cap space.`;
  return [
    {
      id,
      season: league.season,
      phase: 'draft',
      week: 0,
      from: 'Front office',
      category: 'contracts',
      subject: 'Free agency wrap-up',
      body: `Free agency is over. ${signed}${kept}${walked}.${cap}`,
      actions: [{ kind: 'cap' }, { kind: 'fa' }],
    },
  ];
}

const order = (m: Draft) => m.season * 1000 + PHASE_ORDER.indexOf(m.phase) * 100 + m.week;

/**
 * File whatever is new for the user. A league that has never had mail (an older save) gets its
 * first batch already read, so years of history don't land as unread.
 */
export function deliverMail(league: League): void {
  const first = !league.inbox;
  const inbox = (league.inbox ??= []);
  const have = new Set(inbox.map((m) => m.id));
  const fresh = [...awardMail(league, have), ...injuryMail(league, have), ...tradeMail(league, have), ...offerMail(league, have)];
  if (league.phase === 'resign') fresh.push(...ownerMail(league, have), ...staffDealsMail(league, have), ...newYearMail(league, have));
  // Free agency's first day: the window's coaching moves are done.
  if (league.phase === 'freeAgency') fresh.push(...combineMail(league, have), ...poachedMail(league, have), ...carouselMail(league, have));
  // Free agency is over by the draft (or by camp, if a sim ran straight through it).
  if (league.phase === 'draft' || league.phase === 'preseason') fresh.push(...faWrapMail(league, have));
  if (league.phase === 'draft') fresh.push(...draftDayMail(league, have));
  if ((league.phase === 'draft' && draftComplete(league)) || league.phase === 'preseason') fresh.push(...draftClassMail(league, have));
  if (league.phase === 'regular' || league.phase === 'playoffs') {
    fresh.push(...recapMail(league, have), ...clearedMail(league, have), ...raceMail(league, have), ...matchupMail(league, have));
  }
  if (league.phase === 'regular') fresh.push(...deadlineMail(league, have));
  if (!fresh.length) return;
  fresh.sort((a, b) => order(a) - order(b));
  inbox.push(...fresh.map((m) => ({ ...m, read: first })));
  if (inbox.length > KEEP) inbox.splice(0, inbox.length - KEEP);
}

export const unreadCount = (league: League) => league.inbox?.reduce((n, m) => n + (m.read ? 0 : 1), 0) ?? 0;
