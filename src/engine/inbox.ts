/**
 * The user's inbox: mail from the league office, agents and the club's own staff, the way a
 * manager's desk fills up in Football Manager. Nothing in the sim sends mail. `deliverMail` looks
 * at the league after each change and files whatever is new, each message keyed by what it's about,
 * so delivering twice (or after a long sim) never duplicates one.
 */
import { AWARD_NAMES, AWARD_KEYS, HONOR_SLOTS, MONTHS, seasonAwards, weeklyAwards, type AwardWinner } from './awards';
import { teamCoaches } from './coaching';
import { userGame } from './league';
import { expiringPlayers } from './offseason/ai';
import { leaguePercentile, perceive } from './scouting';
import { starters } from './roster';
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

const fullName = (p: Player) => `${p.firstName} ${p.lastName}`;
const teamName = (t: Team) => `${t.city} ${t.name}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function headCoach(league: League): string {
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'headCoach');
  return c ? `${c.firstName} ${c.lastName}, Head coach` : 'Coaching staff';
}

function director(league: League): string {
  const s = teamStaff(league, league.userTeamId).find((x) => x.role === 'director');
  return s ? `${s.firstName} ${s.lastName}, Director of scouting` : 'Scouting department';
}

function awardMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const team = league.teams[league.userTeamId];
  const mine = (w: AwardWinner | null | undefined): w is AwardWinner => !!w && w.teamId === league.userTeamId && !!league.players[w.playerId];
  const send = (id: string, season: number, phase: Phase, week: number, w: AwardWinner, honor: string, body: string) => {
    if (have.has(id)) return;
    const p = league.players[w.playerId];
    out.push({ id, season, phase, week, from: 'League office', category: 'awards', subject: `${fullName(p)}: ${honor}`, body, action: { kind: 'player', playerId: p.id } });
  };
  for (const season of [league.season - 1, league.season]) {
    const weekly = weeklyAwards(league, season);
    for (const [week, winners] of Object.entries(weekly?.weeks ?? {})) {
      winners.forEach((w, i) => {
        if (!mine(w)) return;
        const { conference, side } = HONOR_SLOTS[i];
        const honor = `${league.conferences[conference].abbrev} ${side === 'offense' ? 'Offensive' : 'Defensive'} Player of the Week`;
        const p = league.players[w.playerId];
        send(`awards:${season}:w${week}:${i}`, season, 'regular', Number(week), w, honor, `${fullName(p)} has been named ${honor} for week ${week}. The league office congratulates him and the ${teamName(team)}.`);
      });
    }
    for (const month of MONTHS) {
      weekly?.months[month.key]?.forEach((w, i) => {
        if (!mine(w)) return;
        const { conference, side } = HONOR_SLOTS[i];
        const honor = `${league.conferences[conference].abbrev} ${side === 'offense' ? 'Offensive' : 'Defensive'} Player of the Month`;
        const p = league.players[w.playerId];
        send(`awards:${season}:m${month.key}:${i}`, season, 'regular', month.weeks[1], w, honor, `${fullName(p)} has been named ${honor} for ${month.label}, after a month of consistent play for the ${teamName(team)}.`);
      });
    }
    const voted = seasonAwards(league, season);
    if (!voted) continue;
    for (const k of AWARD_KEYS) {
      const w = voted.winners[k];
      if (!mine(w)) continue;
      const p = league.players[w.playerId];
      send(`awards:${season}:${k}`, season, 'regular', 18, w, AWARD_NAMES[k], `The votes are in: ${fullName(p)} is the ${season} ${AWARD_NAMES[k]}. A season to remember, and it reflects well on the whole organization.`);
    }
    voted.allLeague.forEach((tier, t) => {
      for (const w of tier) {
        if (!mine(w)) continue;
        const p = league.players[w.playerId];
        const honor = `${t === 0 ? 'First' : 'Second'}-team All-League`;
        send(`awards:${season}:all${t}:${p.id}`, season, 'regular', 18, w, honor, `${fullName(p)} has been named ${honor} for the ${season} season, one of the best ${p.position}s in the league this year.`);
      }
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
      action: { kind: 'resign' },
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
      action: { kind: 'player', playerId: p.id },
    });
  }
  const combine = `scouting:${season}:combine`;
  if (!have.has(combine) && league.draftClass.length) {
    out.push({
      id: combine,
      season,
      phase: 'resign',
      week: 0,
      from: director(league),
      category: 'scouting',
      subject: `The ${season} combine is done`,
      body: `${plural(league.draftClass.length, 'prospect')} worked out for the ${season} draft, and the numbers are on the big board. We have ${plural(league.scoutPoints, 'scouting visit')} to spend this year: send them to the players you're serious about before draft day.`,
      action: { kind: 'draft' },
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
  return [{ id, season: league.season, phase: 'draft', week: 0, from: director(league), category: 'scouting', subject: 'The draft board is ready', body, action: { kind: 'draft' } }];
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
      from: headCoach(league),
      category: 'matchup',
      subject: `Opposition report: ${teamName(opp)}`,
      body: `We face the ${teamName(opp)} ${where} in ${occasion}. Their ${weak} is the soft spot, and that's where we'll go after them. Respect their ${strong}: it's the best unit they have.`,
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
      action: { kind: 'trades' },
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
  const fresh = [...awardMail(league, have), ...tradeMail(league, have)];
  if (league.phase === 'resign') fresh.push(...newYearMail(league, have));
  if (league.phase === 'draft') fresh.push(...draftDayMail(league, have));
  if (league.phase === 'regular' || league.phase === 'playoffs') fresh.push(...matchupMail(league, have));
  if (!fresh.length) return;
  fresh.sort((a, b) => order(a) - order(b));
  inbox.push(...fresh.map((m) => ({ ...m, read: first })));
  if (inbox.length > KEEP) inbox.splice(0, inbox.length - KEEP);
}

export const unreadCount = (league: League) => league.inbox?.reduce((n, m) => n + (m.read ? 0 : 1), 0) ?? 0;
