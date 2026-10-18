/**
 * The user's inbox: mail from the league office, agents and the club's own staff, the way a
 * manager's desk fills up in Football Manager. Nothing in the sim sends mail. `deliverMail` looks
 * at the league after each change and files whatever is new, each message keyed by what it's about,
 * so delivering twice (or after a long sim) never duplicates one.
 */
import { AWARD_KEYS, AWARD_NAMES, HONOR_SLOTS, MONTHS, seasonAwards, weeklyAwards, type AwardWinner } from './awards';
import { teamCoaches } from './coaching';
import { estimateText, injuryLabel, weeksLeft } from './injuries';
import { userGame } from './league';
import { teamMedics } from './medical';
import { expiringPlayers } from './offseason/ai';
import { leaguePercentile, perceive } from './scouting';
import { starters, teamPlayers } from './roster';
import { ROUND_NAMES } from './season/playoffs';
import { teamStaff } from './staff';
import type { InboxMessage, League, Phase, Player, Position, Team } from './types';

/** Saves keep the latest messages only, like the transaction log. */
const KEEP = 300;
const PHASE_ORDER: Phase[] = ['resign', 'freeAgency', 'draft', 'preseason', 'regular', 'playoffs', 'complete'];

/** Position groups an opposition report talks about, in the staff's words. */
const GROUPS: [string, Position[]][] = [
  ['quarterback play', ['QB']],
  ['backfield', ['RB']],
  ['receiving corps', ['WR', 'TE']],
  ['offensive line', ['OL']],
  ['defensive front', ['DT', 'EDGE']],
  ['linebackers', ['LB']],
  ['secondary', ['CB', 'S']],
];

type Draft = Omit<InboxMessage, 'read'>;
type Sender = Pick<InboxMessage, 'from' | 'fromCard'>;

const fullName = (p: Player) => `${p.firstName} ${p.lastName}`;
const teamName = (t: Team) => `${t.city} ${t.name}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

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

/** The start of the league year: deals that are up, players who retired, the combine. */
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
  const combine = `scouting:${season}:combine`;
  if (!have.has(combine) && league.draftClass.length) {
    out.push({
      id: combine,
      season,
      phase: 'resign',
      week: 0,
      ...director(league),
      category: 'scouting',
      subject: `The ${season} combine is done`,
      body: `${plural(league.draftClass.length, 'prospect')} worked out for the ${season} draft, and the numbers are on the big board. We have ${plural(league.scoutPoints, 'scouting visit')} to spend this year: send them to the players you're serious about before draft day.`,
      actions: [{ kind: 'draft' }],
    });
  }
  return out;
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
  const ranked = GROUPS.map(([label, positions]) => ({ label, score: groupScore(league, opp, positions) })).sort((a, b) => a.score - b.score);
  const weak = ranked[0].label;
  const strong = ranked[ranked.length - 1].label;
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
      body: `We face the ${teamName(opp)} ${where} in ${occasion}. Their ${weak} is the soft spot, and that's where we'll go after them. Respect their ${strong}: it's the best unit they have.`,
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

const order = (m: Draft) => m.season * 1000 + PHASE_ORDER.indexOf(m.phase) * 100 + m.week;

/**
 * File whatever is new for the user. A league that has never had mail (an older save) gets its
 * first batch already read, so years of history don't land as unread.
 */
export function deliverMail(league: League): void {
  const first = !league.inbox;
  const inbox = (league.inbox ??= []);
  const have = new Set(inbox.map((m) => m.id));
  const fresh = [...awardMail(league, have), ...injuryMail(league, have), ...tradeMail(league, have)];
  if (league.phase === 'resign') fresh.push(...newYearMail(league, have));
  if (league.phase === 'draft') fresh.push(...draftDayMail(league, have));
  if (league.phase === 'regular' || league.phase === 'playoffs') fresh.push(...matchupMail(league, have));
  if (!fresh.length) return;
  fresh.sort((a, b) => order(a) - order(b));
  inbox.push(...fresh.map((m) => ({ ...m, read: first })));
  if (inbox.length > KEEP) inbox.splice(0, inbox.length - KEEP);
}

export const unreadCount = (league: League) => league.inbox?.reduce((n, m) => n + (m.read ? 0 : 1), 0) ?? 0;
