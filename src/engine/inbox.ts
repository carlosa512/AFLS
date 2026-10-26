import { employed, managesTeam } from './employment';
import { gmOfferTerms } from './leadership';
import { recordAdvicePublications } from './coachDecisions';
import {
  coachAdviceObservation,
  userCoachGameObservation,
  teachingObservation,
  positionTeachingNote,
} from './coachReports';
/**
 * The user's inbox: mail from the league office, agents and the team's own staff, the way a
 * manager's desk fills up in Football Manager. Nothing in the sim sends mail. `deliverMail` looks
 * at the league after each change and files whatever is new, each message keyed by what it's about,
 * so delivering twice (or after a long sim) never duplicates one.
 */
import {
  AWARD_KEYS,
  AWARD_NAMES,
  HONOR_SLOTS,
  honorBadges,
  MONTHS,
  playerHonors,
  playerOfTheGame,
  seasonAwards,
  weeklyAwards,
  type AwardWinner,
} from './awards';
import {
  CHAIRS,
  chairHolder,
  coachName,
  coachMandate,
  coachResignForecast,
  coachTitle,
  isCoachExpiring,
  ownerLeeway,
  ownerTrigger,
  ownerTriggerNote,
  promotionFor,
  sameChair,
  teamCoaches,
  type Chair,
} from './coaching';
import { leagueNews, rookieImpactMail, matchupStakes } from './news';
import { capSpace } from './finance/cap';
import {
  concussionCount,
  concussionRetireChance,
  concussionWindow,
  delegates,
  estimateText,
  healthyAt,
  injuryLabel,
  IR_MIN_WEEKS,
  IR_RETURNS,
  irReturnsUsed,
  irProblem,
  NEED,
  outlookText,
  shortPositions,
  weeksLeft,
} from './injuries';
import { knockFor, knockWord } from './familiarity';
import { userGame } from './league';
import { isMedicExpiring, MEDIC_ROLE_LABEL, medicResignForecast, teamMedics } from './medical';
import { expiringPlayers } from './offseason/ai';
import { draftComplete, reachOrSteal } from './offseason/draft';
import { rookieCost, ROSTER_MAX } from './offseason/negotiation';
import { knowledge, leaguePercentile, perceive, scoutReportParts } from './scouting';
import { POSITION_NAMES } from './positions';
import { activeRoster, chooseCover, practiceSquad, starters, teamPlayers, isAvailable, slotOf } from './roster';
import { futuresKept, futuresWindowOpen } from './personnel/futures';
import { elevationUses } from './personnel/elevations';
import { isPrimeTime, kickoffLabel } from './season/kickoff';
import { ROUND_NAMES } from './season/playoffs';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { computeRecords, conferenceSeeds, playoffRace, type RaceStatus } from './season/standings';
import { isExpiring, ownerBudgetNote, resignForecast, ROLE_LABEL, staffWindowOpen, teamStaff } from './staff';
import { careerLine } from './stats';
import { isDeadlineDay, openOffers, pickLabel, TRADE_DEADLINE_WEEK } from './trade';
import { activeLearning, formerPositions, moveProblem, reasonWords, suggestMove } from './training';
import type {
  Coach,
  CoachRole,
  CoachRoom,
  GameResult,
  InboxMessage,
  League,
  MoveReason,
  Phase,
  Player,
  Position,
  StatLine,
  Team,
  TeamGameStats,
  TradeOffer,
  TradeSide,
} from './types';

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
const nth = (n: number) => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][n - 1] ?? `${n}th`;
/** A small count in words, the way a sentence starts with one ("Two of them…"). */
const count = (n: number) =>
  ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] ?? String(n);
/** "seven" up to nine, digits past that: how a coach says a number mid-sentence. */
const small = (n: number) => count(n).toLowerCase();
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The staff member who signs a message, with a link to their card (a department name when the chair is empty).
function headCoach(league: League): Sender {
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'headCoach');
  return c
    ? { from: `${c.firstName} ${c.lastName}, Head coach`, fromCard: { kind: 'coach', id: c.id } }
    : { from: 'Coaching staff' };
}
function director(league: League): Sender {
  const s = teamStaff(league, league.userTeamId).find((x) => x.role === 'director');
  return s
    ? { from: `${s.firstName} ${s.lastName}, Director of scouting`, fromCard: { kind: 'scout', id: s.id } }
    : { from: 'Scouting department' };
}
function doctor(league: League): Sender {
  const m = teamMedics(league, league.userTeamId).find((x) => x.role === 'doctor');
  return m
    ? { from: `${m.firstName} ${m.lastName}, Head team doctor`, fromCard: { kind: 'medic', id: m.id } }
    : { from: 'Medical staff' };
}

/** Existing careers: the league office offers practice squads once, at the start of the offseason. */
function personnelOfferMail(league: League, have: Set<string>): Draft[] {
  if (league.personnel?.offered !== league.season || league.personnel.enabled) return [];
  const id = `personnelOffer:${league.season}`;
  if (have.has(id)) return [];
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: 0,
      from: 'League office',
      category: 'league',
      subject: 'Practice squads are available',
      body: 'Clubs can now carry a practice squad of up to 16 players, with waivers, one-game call-ups and squad signings between clubs. You can turn them on for this career on the practice squad desk until training camp opens. Once on, they stay on.',
      actions: [{ kind: 'team', teamId: league.userTeamId }],
    },
  ];
}

/** Waivers that concern you: a claim you made, won or lost, and a player you released, claimed or cleared. */
function waiverMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  const out: Draft[] = [];
  for (const r of league.personnel?.waivers?.results ?? []) {
    if (r.season !== league.season) continue;
    const p = league.players[r.playerId];
    if (!p) continue;
    const won = r.toTeamId === user && r.fromTeamId !== user;
    if (won || r.userReason) {
      const id = `waiverClaim:${r.season}:${r.entryId}`;
      if (have.has(id)) continue;
      out.push({
        id,
        season: r.season,
        phase: league.phase,
        week: league.week,
        ...director(league),
        category: 'contracts',
        subject: won ? `We claimed ${fullName(p)}` : `Our claim for ${fullName(p)} didn't win`,
        body: won
          ? `${fullName(p)} is ours off waivers from the ${league.teams[r.fromTeamId].name}, on the contract he already had.`
          : `${r.userReason} ${fullName(p)} ${r.toTeamId === null ? 'cleared waivers and is a free agent.' : `went to the ${league.teams[r.toTeamId].name}.`}`,
        actions: [{ kind: 'player', playerId: p.id }],
      });
    } else if (r.fromTeamId === user) {
      const id = `waiverOut:${r.season}:${r.entryId}`;
      if (have.has(id)) continue;
      out.push({
        id,
        season: r.season,
        phase: league.phase,
        week: league.week,
        ...director(league),
        category: 'contracts',
        subject:
          r.toTeamId === null
            ? `${fullName(p)} cleared waivers`
            : `${fullName(p)} was claimed by the ${league.teams[r.toTeamId].name}`,
        body:
          r.toTeamId === null
            ? `Nobody claimed ${fullName(p)}, so he's a free agent and his release is booked to our cap.`
            : `The ${league.teams[r.toTeamId].city} ${league.teams[r.toTeamId].name} claimed ${fullName(p)} and take on his contract.`,
        actions: [{ kind: 'player', playerId: p.id }],
      });
    }
  }
  return out;
}

/** A squad player of ours has used his third regular-season call-up: he needs a contract to play again. */
function callupsUsedMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  const out: Draft[] = [];
  for (const p of practiceSquad(league, user)) {
    if (elevationUses(league, p, user) < 3) continue;
    const id = `callups:${league.season}:${p.id}`;
    if (have.has(id)) continue;
    out.push({
      id,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...headCoach(league),
      category: 'contracts',
      subject: `${fullName(p)} has used his three call-ups`,
      body: `That was ${fullName(p)}'s third regular-season call-up. To play him again this season we'd need to sign him to a contract on the 53.`,
      actions: [{ kind: 'player', playerId: p.id }],
    });
  }
  return out;
}

/** Our season is over: the scouts' futures picks, kept by staff unless you change them. Once a season. */
function futuresMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  if (!futuresWindowOpen(league, user) || !practiceSquad(league, user).length) return [];
  const id = `futures:${league.season}:${user}`;
  if (have.has(id)) return [];
  const picks = futuresKept(league, user).map((x) => league.players[x]);
  const staff = league.teams[user].autoSquad !== false;
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...director(league),
      category: 'scouting',
      subject: picks.length ? `Squad players worth keeping: ${picks.length}` : 'Nobody on the squad to keep',
      body: picks.length
        ? `Our season is over, so practice squad deals end at the new league year. We'd keep ${list(picks.map(fullName))} on futures deals: minimum contracts for next season. ${staff ? 'Staff will sign them unless you change it on the squad desk.' : 'Mark them on the squad desk before the new league year.'}`
        : "Our season is over and the practice squad deals end at the new league year. On our read nobody there reaches our backups' level, so we'd let them go.",
      actions: [
        ...picks.slice(0, 3).map((p) => ({ kind: 'player' as const, playerId: p.id })),
        { kind: 'team', teamId: user },
      ],
    },
  ];
}

/** The new league year: who signed a futures deal with us. */
function futuresKeptMail(league: League, have: Set<string>): Draft[] {
  const f = league.personnel?.futures;
  const ids = f && f.season === league.season - 1 ? (f.signed?.[league.userTeamId] ?? []) : [];
  const id = `futuresKept:${league.season}`;
  if (!ids.length || have.has(id)) return [];
  const players = ids.map((x) => league.players[x]);
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: 0,
      ...director(league),
      category: 'contracts',
      subject: `Kept from the practice squad: ${players.length}`,
      body: `${list(players.map(fullName))} signed futures deals and join the offseason roster. The rest of last year's squad are free agents.`,
      actions: players.slice(0, 3).map((p) => ({ kind: 'player' as const, playerId: p.id })),
    },
  ];
}

/** Another club signed one of our practice squad players to its 53: the head coach says so, once. */
function squadPoachMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const r of league.personnel?.poaching?.results ?? []) {
    if (r.fromTeamId !== league.userTeamId || r.toTeamId === null || r.season !== league.season) continue;
    const id = `squadPoach:${r.season}:${r.week}:${r.playerId}`;
    if (have.has(id)) continue;
    const p = league.players[r.playerId];
    const club = league.teams[r.toTeamId];
    out.push({
      id,
      season: r.season,
      phase: 'regular',
      week: r.week,
      ...headCoach(league),
      category: 'trades',
      subject: `${fullName(p)} signed with the ${club.name}`,
      body: `The ${club.city} ${club.name} signed ${fullName(p)} off our practice squad to their 53. He wasn't one of our two protected players this week.`,
      actions: [
        { kind: 'player', playerId: p.id },
        { kind: 'team', teamId: club.id },
      ],
    });
  }
  return out;
}

/**
 * Players of the week and month as they're named, and once a year the season's honors: one message
 * per player, whatever he won (the weekly and monthly ones aren't repeated).
 */
function awardMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const team = league.teams[league.userTeamId];
  const mine = (w: AwardWinner | null | undefined): w is AwardWinner =>
    !!w && w.teamId === league.userTeamId && !!league.players[w.playerId];
  const send = (id: string, season: number, week: number, playerId: number, honor: string, body: string) => {
    if (have.has(id)) return;
    const p = league.players[playerId];
    out.push({
      id,
      season,
      phase: 'regular',
      week,
      from: 'League office',
      category: 'awards',
      subject: `${fullName(p)}: ${honor}`,
      body,
      actions: [{ kind: 'player', playerId }],
    });
  };
  const slotName = (i: number, period: string) =>
    `${league.conferences[HONOR_SLOTS[i].conference].abbrev} ${HONOR_SLOTS[i].side === 'offense' ? 'Offensive' : 'Defensive'} Player of the ${period}`;
  for (const season of [league.season - 1, league.season]) {
    const weekly = weeklyAwards(league, season);
    for (const [week, winners] of Object.entries(weekly?.weeks ?? {})) {
      winners.forEach((w, i) => {
        if (!mine(w)) return;
        const honor = slotName(i, 'Week');
        send(
          `awards:${season}:w${week}:${i}`,
          season,
          Number(week),
          w.playerId,
          honor,
          `${fullName(league.players[w.playerId])} has been named ${honor} for week ${week}. The league office congratulates him and the ${teamName(team)}.`,
        );
      });
    }
    for (const month of MONTHS) {
      weekly?.months[month.key]?.forEach((w, i) => {
        if (!mine(w)) return;
        const honor = slotName(i, 'Month');
        send(
          `awards:${season}:m${month.key}:${i}`,
          season,
          month.weeks[1],
          w.playerId,
          honor,
          `${fullName(league.players[w.playerId])} has been named ${honor} for ${month.label}, after a month of consistent play for the ${teamName(team)}.`,
        );
      });
    }
    const voted = seasonAwards(league, season);
    if (!voted) continue;
    const honors = new Map<number, string[]>();
    const add = (w: AwardWinner, honor: string) => honors.set(w.playerId, [...(honors.get(w.playerId) ?? []), honor]);
    for (const k of AWARD_KEYS) if (mine(voted.winners[k])) add(voted.winners[k]!, AWARD_NAMES[k]);
    voted.allLeague.forEach((tier, t) =>
      tier.filter(mine).forEach((w) => add(w, `${t === 0 ? 'First' : 'Second'}-team All-League`)),
    );
    for (const [playerId, won] of honors) {
      const p = league.players[playerId];
      send(
        `awards:${season}:year:${playerId}`,
        season,
        18,
        playerId,
        list(won),
        `The votes are in for ${season}: ${fullName(p)} has been named ${list(won)}. A season to remember, and it reflects well on the whole organization.`,
      );
    }
  }
  return out;
}

/** The diagnosis matters through the people still available and the choices the roster permits. */
function medicalImpact(league: League, p: Player): string {
  const team = league.teams[league.userTeamId];
  const pos = slotOf(league, p);
  const available = activeRoster(league, team.id).filter((x) => isAvailable(x) && slotOf(league, x) === pos);
  const n = available.length;
  const people = available.slice(0, 3).map(fullName);
  const label = posWord(pos);
  const noun = n === 1 ? label : pos === 'S' ? 'safeties' : pos === 'OL' ? 'offensive linemen' : `${label}s`;
  const coverage =
    n === 0
      ? `Nobody is available at ${pos} on the active roster.`
      : `That leaves ${small(n)} available ${noun}${people.length ? `, including ${list(people)}` : ''}.`;
  let decision: string;
  if (n < NEED[pos]) {
    const cover = chooseCover(league, team, pos, NEED);
    decision = ` We need ${small(NEED[pos])} for normal cover. ${cover ? `${fullName(cover)} can cover at ${pos} with "Play at…", or we can look at free agents.` : 'There is no suitable cover elsewhere on the roster; take a look at free agents before the next game.'}`;
  } else decision = ' We still have enough cover for the usual roles at that position.';
  const reserve =
    p.injury!.estimate[0] >= IR_MIN_WEEKS && !irProblem(league, p)
      ? ` Injured reserve would free his roster spot, with a minimum ${IR_MIN_WEEKS}-week stay.`
      : '';
  return `${isAvailable(p) ? 'He remains available under the current treatment plan. ' : ''}${coverage}${decision}${reserve}`;
}

/** The head doctor's word on each of our players who's hurt for a week or more (news, so only while he's still out). */
function injuryMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  const short = new Set(shortPositions(league, league.teams[league.userTeamId]));
  for (const p of teamPlayers(league, league.userTeamId)) {
    const now = p.injury;
    // The doctor's estimate, never the true weeks.
    if (!now || now.estimate[1] < 1) continue;
    const id = `medical:${now.season}:${now.week}:${p.id}:${now.type}`;
    if (have.has(id)) continue;
    const what = injuryLabel(now.type);
    const record = p.injuries?.at(-1);
    const how =
      record?.aggravated && record.type === now.type
        ? `has aggravated an old injury (${what})`
        : `was hurt ${now.where === 'game' ? 'in the game' : 'in practice'} (${what})`;
    out.push({
      id,
      season: now.season,
      phase: phaseOf(league, now.week),
      week: now.week,
      ...doctor(league),
      category: 'medical',
      subject: `${fullName(p)}: ${what}${short.has(slotOf(league, p)) ? `; short at ${slotOf(league, p)}` : ''}`,
      body: `${now.protocol ? concussionNote(p) : `${fullName(p)} ${how}. Our early read is that he'll be ${estimateText(now, weeksLeft(league))}.`} ${medicalImpact(league, p)}`,
      actions: [{ kind: 'player', playerId: p.id }, { kind: 'medical' }],
    });
  }
  return out.concat(setbackMail(league, have));
}

const phaseOf = (league: League, week: number): Phase =>
  week === 0 ? league.phase : week > 18 ? 'playoffs' : 'regular';

/** The doctor on a concussion: the protocol and no set timeline, his file, or a player who has had enough for this year. */
function concussionNote(p: Player): string {
  const now = p.injury!;
  const n = concussionCount(p);
  const file = n > 1 ? ` It's his ${nth(n)} concussion, and each one tends to take longer to clear than the last.` : '';
  if (now.protocol?.shutdown) {
    const thisYear = (p.injuries ?? []).filter((r) => r.type === 'concussion' && r.season === now.season).length;
    return `${fullName(p)} took another hit to the head: his ${nth(n)} concussion${thisYear >= 3 ? `, and his ${nth(thisYear)} this season` : ''}. He has told us he's shutting himself down for the rest of the year to think about his future. We support him; he'll be back in the building after the offseason.`;
  }
  return `${fullName(p)} was concussed ${now.where === 'game' ? 'in the game' : 'in practice'} and is in the concussion protocol. He clears it when his symptoms do, one test a week, so there's no set timeline: for now he's ${outlookText(now).replace('in the concussion protocol, ', '')}.${file}`;
}

/** A setback in the concussion protocol: his symptoms came back at this week's test. */
function setbackMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const p of teamPlayers(league, league.userTeamId)) {
    const now = p.injury;
    const week = now?.protocol?.setbackWeek;
    if (!now || week === undefined) continue;
    const id = `setback:${now.season}:${now.week}:${p.id}:${week}`;
    if (have.has(id)) continue;
    out.push({
      id,
      season: now.season,
      phase: phaseOf(league, week),
      week,
      ...doctor(league),
      category: 'medical',
      subject: `${fullName(p)}: a setback in the protocol`,
      body: `${fullName(p)}'s symptoms came back at this week's test, so he's a step back in the concussion protocol. We'll test him again next week; for now he's ${outlookText(now).replace('in the concussion protocol, ', '')}.`,
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
      body:
        concussionRetireChance(p, season) > 0
          ? `After ${plural(p.experience, 'season')} in the league and ${concussionCount(p)} concussions, I've decided my health has to come first. Thank you to everyone in the ${teamName(team)} organization, my teammates and our fans.`
          : `After ${plural(p.experience, 'season')} in the league${careerWords(league, p)}, I've decided it's time to hang up my cleats. Thank you to everyone in the ${teamName(team)} organization, my teammates and our fans.`,
      actions: [{ kind: 'player', playerId: p.id }],
    });
  }
  return out;
}

/**
 * What a career added up to, for a retirement letter (", 38,412 passing yards and 241 touchdowns,
 * and two All-League teams"): his totals by position and his honors, or nothing when neither says much.
 */
function careerWords(league: League, p: Player): string {
  const s = careerLine(p);
  const n = (k: keyof StatLine) => (s[k] as number | undefined) ?? 0;
  const big = (x: number) => x.toLocaleString('en-US');
  let totals = '';
  if (p.position === 'QB' && n('passYds') >= 5000)
    totals = `${big(n('passYds'))} passing yards and ${plural(n('passTd'), 'touchdown')}`;
  else if (p.position === 'RB' && n('rushYds') >= 2000)
    totals = `${big(n('rushYds'))} rushing yards and ${plural(n('rushTd'), 'touchdown')}`;
  else if ((p.position === 'WR' || p.position === 'TE') && n('rec') >= 150)
    totals = `${big(n('rec'))} catches for ${big(n('recYds'))} yards`;
  else if (['DT', 'EDGE'].includes(p.position) && n('sacks') >= 20)
    totals = `${n('sacks') % 1 ? n('sacks').toFixed(1) : n('sacks')} sacks`;
  else if (['LB', 'CB', 'S'].includes(p.position) && n('tackles') >= 300)
    totals = `${big(n('tackles'))} tackles${n('defInt') >= 5 ? ` and ${plural(n('defInt'), 'interception')}` : ''}`;
  const honors = honorBadges(playerHonors(league, p.id)).filter(
    (h) => h.label !== 'Player of the Week' && h.label !== 'Player of the Month',
  );
  const honored = honors.length
    ? list(
        honors
          .slice(0, 2)
          .map((h) => `${small(h.seasons.length)} ${h.label} honor${h.seasons.length === 1 ? '' : 's'}`),
      )
    : '';
  if (!totals && !honored) return '';
  return `, ${[totals, honored].filter(Boolean).join(', and ')},`;
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
  return [
    {
      id,
      season: league.season,
      phase: 'draft',
      week: 0,
      ...director(league),
      category: 'scouting',
      subject: 'The draft board is ready',
      body,
      actions: [{ kind: 'draft' }],
    },
  ];
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
  const rank = first.draft!.rank;
  const consensus =
    rank === undefined
      ? ''
      : rank === first.draft!.pick
        ? ' (right where the consensus had him)'
        : ` (the consensus had him at No. ${rank})`;
  const steals = picks.filter((p) => reachOrSteal(p.draft!) === 'steal');
  const reaches = picks.filter((p) => reachOrSteal(p.draft!) === 'reach');
  const value = !steals.length
    ? ''
    : steals.length === 1
      ? ` ${steals[0].position} ${fullName(steals[0])} came well after where the consensus had him: the value pick of our class.`
      : ` ${count(steals.length)} of them came well after where the consensus had them.`;
  const board = !reaches.length
    ? ''
    : reaches.length === 1
      ? ` We took ${reaches[0].position} ${fullName(reaches[0])} well ahead of the consensus: our board had him higher than the room did.`
      : ` ${count(reaches.length)} of them went well ahead of the consensus: our board, not the room's.`;
  // The one our own scouts rate highest for where he could end up (our own players: exact today, the ceiling still a judgment).
  const favorite =
    picks.length > 1
      ? [...picks].sort(
          (a, b) => perceive(league, league.userTeamId, b).potMid - perceive(league, league.userTeamId, a).potMid,
        )[0]
      : first;
  const verdict = lowerFirst(scoutReportParts(league, league.userTeamId, favorite).verdict);
  const liked = ` Our scouts like ${favorite.position} ${fullName(favorite)} most of all: ${verdict}`;
  return [
    {
      id,
      season: league.season,
      phase: 'draft',
      week: 0,
      ...director(league),
      category: 'scouting',
      subject: `Our ${league.season} draft class`,
      body: `We made ${plural(picks.length, 'pick')}, starting with ${first.position} ${fullName(first)} at No. ${first.draft!.pick}${consensus}.${value}${board}${liked}`,
      actions: [{ kind: 'draft' }],
    },
  ];
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A position group's starters as our scouts read them: where the unit ranks in the league, and its best player. */
export interface UnitRead {
  title: string;
  /**
   * Where the unit ranks among the league's same units (0 the worst, 0.5 a typical one, 1 the best), by our scouts'
   * read of every team's starters: a rival's through the fog of war.
   */
  score: number;
  /** Player id of the group's best starter by our read; none when the group is empty. */
  lead?: number;
}

/**
 * Every team's raw read of each group, by team id. A unit is ranked on this rather than on the player percentile
 * alone: that ranks starters against backups too, so every group read high, and some higher than others.
 */
export function unitTable(league: League): number[][] {
  return league.teams.map((t) => GROUPS.map((g) => groupScore(league, t, g.positions)));
}

/** Each position group's starters as our scouts read them, ranked against the league's (pass `table` to share one). */
export function unitReads(league: League, teamId: number, table = unitTable(league)): UnitRead[] {
  const team = league.teams[teamId];
  return GROUPS.map((g, i) => {
    const mine = table[teamId][i];
    const below = table.filter((row) => row[i] < mine).length;
    // A tie sits halfway through the teams it ties with (itself not counted).
    const ties = table.filter((row) => row[i] === mine).length - 1;
    const best = g.positions
      .flatMap((pos) => starters(league, team, pos))
      .sort((a, b) => perceive(league, league.userTeamId, b).ovr - perceive(league, league.userTeamId, a).ovr)[0];
    return { title: g.title, score: (below + ties / 2) / Math.max(1, table.length - 1), lead: best?.id };
  });
}

/** One unit against the unit it lines up across from, and who our scouts think has the better of it. */
export interface Matchup {
  title: string;
  offense: UnitRead;
  defense: UnitRead;
  edge: 'ours' | 'theirs' | null;
}

/**
 * How far apart two units' league ranks must be before the card calls an edge: closer is a fair fight. At 0.4 about
 * a third of matchups get one, as often for the offense as the defense, so a report names two or so.
 */
export const EDGE_GAP = 0.4;

/**
 * The opposition report's key matchups: each offensive unit against the defenders it faces (the line against the
 * front, the backs against the linebackers, the quarterback and receivers against the secondary), our offense
 * against their defense and theirs against ours. Units that never meet on the field aren't compared.
 */
export function keyMatchups(league: League, oppId: number): { attack: Matchup[]; defend: Matchup[] } {
  const table = unitTable(league);
  const side = (offenseId: number, defenseId: number): Matchup[] => {
    const off = unitReads(league, offenseId, table);
    const def = unitReads(league, defenseId, table);
    const unit = (units: UnitRead[], title: string) => units.find((u) => u.title === title)!;
    const qb = unit(off, 'Quarterback');
    const passing: UnitRead = {
      title: 'QB and receivers',
      score: (qb.score + unit(off, 'Receivers').score) / 2,
      lead: qb.lead,
    };
    const pairs: [string, UnitRead, UnitRead][] = [
      ['Trenches', unit(off, 'Offensive line'), unit(def, 'Defensive front')],
      ['Run game', unit(off, 'Backfield'), unit(def, 'Linebackers')],
      ['Pass game', passing, unit(def, 'Secondary')],
    ];
    const oursOnOffense = offenseId === league.userTeamId;
    return pairs.map(([title, offense, defense]) => {
      const gap = offense.score - defense.score;
      const offenseAhead = gap >= EDGE_GAP ? true : gap <= -EDGE_GAP ? false : null;
      return {
        title,
        offense,
        defense,
        edge: offenseAhead === null ? null : offenseAhead === oursOnOffense ? 'ours' : 'theirs',
      };
    });
  };
  return { attack: side(league.userTeamId, oppId), defend: side(oppId, league.userTeamId) };
}

/** What a message is about, read back from its id. The ids are built here, so this is the one place that knows their shape. */
export type MailSubject =
  | { kind: 'leadership'; season: number; eventId: number }
  | { kind: 'gmOffer'; season: number; teamId: number }
  | { kind: 'news'; season: number }
  | { kind: 'rookieImpact'; season: number }
  | { kind: 'matchup'; season: number; week: number }
  | { kind: 'injury'; season: number; week: number; playerId: number; type: string }
  | { kind: 'award'; season: number; playerId: number; period: 'week' | 'month' | 'year'; weeks: [number, number] }
  | { kind: 'contract'; season: number; playerId: number }
  | { kind: 'retirement'; season: number; playerId: number }
  | { kind: 'combine'; season: number }
  | { kind: 'draftDay'; season: number }
  | { kind: 'draftClass'; season: number }
  | { kind: 'trade'; season: number; text: string }
  | { kind: 'offer'; season: number; offerId: number; root: number }
  | { kind: 'recap'; season: number; gameId: number }
  | { kind: 'cleared'; season: number; week: number; playerId: number; type: string }
  | { kind: 'deadline'; season: number; weeksLeft: number | 'day' }
  | { kind: 'race'; season: number; level: 'spot' | 'division' | 'bye' | 'out' }
  | { kind: 'flex'; season: number; gameId: number }
  | { kind: 'owner'; season: number }
  | { kind: 'staffDeals'; season: number; people: StaffRef[] }
  | { kind: 'poached'; season: number; coachId: number; chair: Chair }
  | { kind: 'carousel'; season: number }
  | { kind: 'faWrap'; season: number }
  | { kind: 'market'; season: number; phase: Phase; week: number }
  | { kind: 'marketRecap'; season: number }
  | { kind: 'positionOffer'; season: number; playerId: number; to: Position }
  | { kind: 'positionMoved'; season: number; playerId: number }
  | { kind: 'covering'; season: number; week: number; playerId: number; pos: Position }
  | { kind: 'shortHanded'; season: number; week: number; pos: Position }
  | { kind: 'squadPoach'; season: number; week: number; playerId: number }
  | { kind: 'futures'; season: number }
  | { kind: 'personnelOffer'; season: number }
  | { kind: 'waiverClaim'; season: number; entryId: number }
  | { kind: 'waiverOut'; season: number; entryId: number }
  | { kind: 'callups'; season: number; playerId: number }
  | { kind: 'futuresKept'; season: number };

/** One of our coaches, scouts or medical staff, as a staff message names him. */
export interface StaffRef {
  kind: 'coach' | 'scout' | 'medic';
  id: number;
}
const REF_KEY = { coach: 'c', scout: 's', medic: 'm' } as const;
const refKey = (r: StaffRef) => `${REF_KEY[r.kind]}${r.id}`;
const refOf = (key: string): StaffRef => ({
  kind: key[0] === 'c' ? 'coach' : key[0] === 's' ? 'scout' : 'medic',
  id: Number(key.slice(1)),
});

export function mailSubject(m: InboxMessage): MailSubject | null {
  const [category, s, a, b, ...rest] = m.id.split(':');
  const season = Number(s);
  if (category === 'leadership') return { kind: 'leadership', season, eventId: Number(a) };
  if (category === 'gm-offer') return { kind: 'gmOffer', season, teamId: Number(a) };
  const player = m.actions.find((x) => x.kind === 'player');
  const playerId = player?.kind === 'player' ? player.playerId : -1;
  switch (category) {
    case 'press':
      return { kind: 'news', season };
    case 'rookies':
      return { kind: 'rookieImpact', season };
    case 'matchup':
      return { kind: 'matchup', season, week: Number(a) };
    case 'medical':
      return { kind: 'injury', season, week: Number(a), playerId: Number(b), type: rest.join(':') };
    case 'setback':
      return { kind: 'injury', season, week: Number(a), playerId: Number(b), type: 'concussion' };
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
      return { kind: 'offer', season, offerId: Number(a), root: b === undefined ? Number(a) : Number(b) };
    case 'recap':
      return { kind: 'recap', season, gameId: Number(a) };
    case 'cleared':
      return { kind: 'cleared', season, week: Number(a), playerId: Number(b), type: rest.join(':') };
    case 'deadline':
      return { kind: 'deadline', season, weeksLeft: a === 'day' ? 'day' : Number(a) };
    case 'race':
      return { kind: 'race', season, level: a as 'spot' | 'division' | 'bye' | 'out' };
    case 'flex':
      return { kind: 'flex', season, gameId: Number(a) };
    case 'owner':
      return { kind: 'owner', season };
    case 'staff':
      if (a === 'deals') return { kind: 'staffDeals', season, people: b ? b.split('.').map(refOf) : [] };
      return {
        kind: 'poached',
        season,
        coachId: Number(b),
        chair:
          rest[0] === 'positionCoach'
            ? { role: 'positionCoach', room: rest[1] as CoachRoom }
            : { role: rest[0] as CoachRole },
      };
    case 'league':
      return { kind: 'carousel', season };
    case 'fa':
      return { kind: 'faWrap', season };
    case 'market':
      return a === 'recap'
        ? { kind: 'marketRecap', season }
        : { kind: 'market', season, phase: a as Phase, week: Number(b) };
    case 'cover':
      return { kind: 'covering', season, week: Number(a), playerId: Number(b), pos: rest[0] as Position };
    case 'short':
      return { kind: 'shortHanded', season, week: Number(a), pos: b as Position };
    case 'waiverClaim':
      return { kind: 'waiverClaim', season, entryId: Number(a) };
    case 'waiverOut':
      return { kind: 'waiverOut', season, entryId: Number(a) };
    case 'callups':
      return { kind: 'callups', season, playerId: Number(a) };
    case 'personnelOffer':
      return { kind: 'personnelOffer', season };
    case 'futures':
      return { kind: 'futures', season };
    case 'futuresKept':
      return { kind: 'futuresKept', season };
    case 'squadPoach':
      return { kind: 'squadPoach', season, week: Number(a), playerId: Number(b) };
    case 'position':
      return a === 'offer'
        ? { kind: 'positionOffer', season, playerId: Number(b), to: rest[0] as Position }
        : { kind: 'positionMoved', season, playerId: Number(b) };
    default:
      return null;
  }
}

/** A briefing can still be current without requiring a decision. Used by the live report cards. */
export function briefingCurrent(league: League, m: InboxMessage): boolean {
  const s = mailSubject(m);
  if (!s || s.season !== league.season) return false;
  if (s.kind === 'matchup') {
    const game = userGame(league, s.week);
    return !!game && !game.result;
  }
  return (
    s.kind === 'deadline' && league.phase === 'regular' && (league.week <= TRADE_DEADLINE_WEEK || isDeadlineDay(league))
  );
}

/** Present-day management tasks only; news and preparation never become tasks just for being current. */
export function needsYou(league: League, m: InboxMessage): boolean {
  if (!canReadMail(league, m)) return false;
  const s = mailSubject(m);
  if (!s || s.season !== league.season) return false;
  const user = league.userTeamId;
  switch (s.kind) {
    case 'gmOffer':
      return (
        league.phase === 'resign' &&
        !!league.leadership.search?.offers.some(
          (o) => o.teamId === s.teamId && league.leadership.search!.round < o.expiresRound,
        )
      );
    case 'matchup':
    case 'injury':
    case 'deadline':
      return false;
    case 'contract':
      return league.phase === 'resign' && expiringPlayers(league, user).some((p) => p.id === s.playerId);
    case 'combine':
      return league.phase === 'freeAgency' && league.scoutPoints > 0;
    case 'draftDay':
      return (
        league.phase === 'draft' &&
        league.draftPicks.some((p) => p.season === league.season && p.ownerId === user && p.playerId === undefined)
      );
    case 'cleared': {
      const p = league.players[s.playerId];
      if (
        !p ||
        p.teamId !== user ||
        !p.ir ||
        p.injury ||
        p.ir.weeks < IR_MIN_WEEKS ||
        irReturnsUsed(league, user) >= IR_RETURNS
      )
        return false;
      // You activate him yourself; or your staff would, but the 53 is full and it never cuts a man for him.
      return !delegates(league, league.teams[user]) || waitsForSpot(league, p);
    }
    case 'shortHanded':
      return (
        (league.phase === 'regular' || league.phase === 'playoffs') &&
        shortPositions(league, league.teams[user]).includes(s.pos)
      );
    case 'staffDeals':
      return league.phase === 'resign' && s.people.some((r) => stillExpiring(league, r));
    case 'poached':
      return staffWindowOpen(league) && !chairHolder(teamCoaches(league, user), s.chair);
    case 'offer':
      return openOffers(league).some((o) => o.id === s.offerId);
    case 'positionOffer': {
      const p = league.players[s.playerId];
      const passed = league.teams[user].training?.passed?.[s.playerId];
      return (
        (league.phase === 'draft' || league.phase === 'preseason') &&
        !!p &&
        p.teamId === user &&
        !activeLearning(p) &&
        !moveProblem(league, p, s.to) &&
        passed !== league.season
      );
    }
    default:
      return false;
  }
}

export function markAllRead(league: League): void {
  for (const m of league.inbox ?? []) m.read = true;
}

/** Our read of a team's starters in a position group, as a league percentile (0–1). */
function groupScore(league: League, team: Team, positions: Position[]): number {
  const players = positions.flatMap((pos) =>
    starters(league, team, pos).map((p) => leaguePercentile(league, pos, perceive(league, league.userTeamId, p).ovr)),
  );
  return players.reduce((s, x) => s + x, 0) / Math.max(1, players.length);
}

/** How well our scouts know a team's starters in a position group (0–1). */
function groupKnowledge(league: League, team: Team, positions: Position[]): number {
  const ks = positions.flatMap((pos) =>
    starters(league, team, pos).map((p) => knowledge(league, league.userTeamId, p)),
  );
  return ks.reduce((s, x) => s + x, 0) / Math.max(1, ks.length);
}

/**
 * What a soft unit means for us, and what a strong one costs us, by group: where the chances should
 * be, never a plan the sim doesn't run.
 */
const OPENING: Record<string, string> = {
  Quarterback: 'there are mistakes to be had from their quarterback if we get to him',
  Backfield: 'they should struggle to run it, which puts the game on their quarterback',
  Receivers: 'their receivers should not trouble our secondary much',
  'Offensive line': 'there should be pressure to be had up front',
  'Defensive front': 'there should be room to run and time to throw',
  Linebackers: 'the middle of their defense is where they are thinnest',
  Secondary: 'there may be opportunities downfield',
};
const CATCH: Record<string, string> = {
  Quarterback: 'he can punish any mistake in coverage',
  Backfield: 'their back can carry a game if we let him get going',
  Receivers: 'their receivers will test our secondary all day',
  'Offensive line': 'pressure will be hard to come by',
  'Defensive front': "we'll need to give the quarterback time",
  Linebackers: 'their linebackers will make the middle of the field a hard place to work',
  Secondary: 'the deep ball will be a hard sell',
};
/** Below this gap between their best and worst units (league percentile), no unit stands out either way. */
const EVEN_UNITS = 0.12;

/**
 * The head coach's opposition report for this week's game: a briefing on our scouts' read of their
 * starters. Where they look soft and what that opens up, their best unit and what it costs us,
 * said with the confidence the read allows: decisive when we know them, qualified when we don't.
 */
function matchupMail(league: League, have: Set<string>): Draft[] {
  const game = userGame(league);
  const id = `matchup:${league.season}:${league.week}`;
  if (!game || game.result || have.has(id)) return [];
  const home = game.homeId === league.userTeamId;
  const opp = league.teams[home ? game.awayId : game.homeId];
  const ranked = GROUPS.map((g) => ({ g, score: groupScore(league, opp, g.positions) })).sort(
    (a, b) => a.score - b.score,
  );
  const weak = ranked[0];
  const strong = ranked[ranked.length - 1];
  const known =
    (groupKnowledge(league, opp, weak.g.positions) + groupKnowledge(league, opp, strong.g.positions)) / 2 >= 0.7;
  const occasion = game.playoffRound ? `the ${ROUND_NAMES[game.playoffRound]}` : `week ${league.week}`;
  const where = game.neutral ? 'on a neutral field' : home ? 'at home' : 'on the road';
  const opener = `We face the ${teamName(opp)} ${where} in ${occasion}.`;
  let read: string;
  if (strong.score - weak.score < EVEN_UNITS)
    read = `${known ? 'Our scouts grade their units about even: there is no obvious soft spot' : 'On what our scouts have seen, there is no obvious soft spot: they look about even across the board'}, so this one will come down to who executes.`;
  else {
    const soft = known
      ? `Our scouts see their ${weak.g.phrase} as the softest unit they have`
      : `On what our scouts have seen, their ${weak.g.phrase} ${weak.g.plural ? 'look' : 'looks'} like the softest unit they have`;
    const best = `their ${strong.g.phrase} ${strong.g.plural ? 'are' : 'is'} the strength of the team`;
    read = `${soft}, while ${best}. ${capital(OPENING[weak.g.title])}, but ${CATCH[strong.g.title]}.`;
  }
  const stakes = matchupStakes(league, opp.id);
  const coaching = coachAdviceObservation(league);
  return [
    {
      id,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...headCoach(league),
      category: 'matchup',
      ...(coaching
        ? {
            coachNoteKey: coaching.key,
            coachNote: {
              coachId: coaching.coachId,
              coachName: coaching.coachName,
              text: coaching.text,
              kind: coaching.kind,
            },
          }
        : {}),
      subject: stakes?.subject ?? `Opposition report: ${teamName(opp)}`,
      body: `${opener} ${stakes?.body ?? ''}${read}${coaching ? `\n\n${coaching.text}` : ''}`,
      actions: [
        { kind: 'team', teamId: opp.id },
        ...(coaching
          ? [
              { kind: 'player' as const, playerId: coaching.playerId },
              { kind: 'team' as const, teamId: league.userTeamId },
            ]
          : []),
      ],
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
      actions: [
        { kind: 'team', teamId: league.userTeamId },
        { kind: 'team', teamId: partner.id },
      ],
    });
  }
  return out;
}

/** A side of a deal in words: "WR Riley Wright, a 2027 3rd and a 2028 6th". */
export function packageWords(league: League, side: TradeSide, opts?: { projected?: boolean }): string {
  const players = side.players.map((id) => `${league.players[id].position} ${fullName(league.players[id])}`);
  const picks = side.picks
    .map((id) => league.draftPicks.find((p) => p.id === id))
    .filter((p) => !!p)
    .map((p) => pickLabel(league, p!, opts));
  return list([...players, ...picks]) || 'nothing';
}

/** Mail is read later, when a projected pick number would be stale: the offer card shows it live. */
const NO_PROJ = { projected: false };

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
      return {
        subject: `The ${team.name} ask about ${name(yourMan!)}`,
        body: `Is ${name(yourMan!)} available? We'd be interested if you're willing to listen.`,
      };
    case 'pitch':
      return {
        subject: `The ${team.name} are listening on ${name(hisMan!)}`,
        body: `We're listening on ${name(hisMan!)}. Would ${packageWords(league, yours, NO_PROJ)} get it done?${close}`,
      };
    case 'dump':
      return {
        subject: `The ${team.name} want to move ${name(hisMan!)}'s deal`,
        body: `Take on ${name(hisMan!)}'s contract and ${packageWords(league, { ...his, players: [] }, NO_PROJ)} is yours.${close}`,
      };
    case 'counter':
      return {
        subject: `The ${team.name} come back with a counter`,
        body: `We've looked at your counter. ${packageWords(league, his, NO_PROJ)} for ${packageWords(league, yours, NO_PROJ)}, and we have a deal.${close}`,
      };
    case 'shop':
      return {
        subject: `The ${team.name} answer your call about ${name(yourMan!)}`,
        body: `You're shopping ${name(yourMan!)}. Our best: ${packageWords(league, his, NO_PROJ)}.${close}`,
      };
    default:
      return {
        subject: `The ${team.name} make an offer for ${name(yourMan!)}`,
        body: `We'd like to bring ${name(yourMan!)} to ${team.city}. ${capital(packageWords(league, his, NO_PROJ))}, if you're open to it.${close}`,
      };
  }
}

/**
 * The offer that opened a conversation: walk `replyTo` back. When a parent was pruned the walk ends early and the
 * id returned is only a best-effort root, which is why nothing should recompute it after the mail is filed
 * (look the message up with `mailForOffer`).
 */
function offerRoot(league: League, offer: TradeOffer): number {
  const offers = league.market?.offers ?? [];
  const seen = new Set<number>([offer.id]);
  let root = offer;
  while (root.replyTo !== undefined && !seen.has(root.replyTo)) {
    const prev = offers.find((o) => o.id === root.replyTo);
    if (!prev) return root.replyTo;
    seen.add(prev.id);
    root = prev;
  }
  return root.id;
}

/** An offer's mail id: its last segment is the conversation's root, so replies fold into one thread. */
export function offerMailId(league: League, offer: TradeOffer): string {
  return `offer:${offer.season}:${offer.id}:${offerRoot(league, offer)}`;
}

/** The message filed for an offer, whatever root its id carries (old saves have no root segment). */
export function mailForOffer(league: League, offer: TradeOffer): InboxMessage | undefined {
  const prefix = `offer:${offer.season}:${offer.id}`;
  return (league.inbox ?? []).find((m) => m.id === prefix || m.id.startsWith(`${prefix}:`));
}

/** Every offer on your desk files a message: it asks something of you while the offer is open. */
function offerMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  // Filed under the offer's own prefix, so pruning an ancestor (which moves the root) never files it twice.
  const filed = new Set<string>();
  for (const id of have) if (id.startsWith('offer:')) filed.add(id.split(':').slice(0, 3).join(':'));
  for (const offer of league.market?.offers ?? []) {
    const id = offerMailId(league, offer);
    if (filed.has(`offer:${offer.season}:${offer.id}`) || offer.status !== 'pending') continue;
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
      actions: [
        { kind: 'trades' },
        ...(about !== undefined ? [{ kind: 'player' as const, playerId: about }] : []),
        { kind: 'team', teamId: team.id },
      ],
    });
  }
  return out;
}

/** "Hip flexor strain" → "hip flexor strain" inside a sentence; "MCL sprain" and "ACL" stay as they are. */
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const sum = (xs: readonly number[], from: number, to: number) => xs.slice(from, to).reduce((a, b) => a + (b ?? 0), 0);

/** Touchdowns from trips inside the 20, for a side that had a few: the one place a box score shows a game turning on finishing. */
const redZone = (t: TeamGameStats) =>
  `${t.redZoneTd} touchdown${t.redZoneTd === 1 ? '' : 's'} from ${t.redZoneAtt} trips inside the 20`;

/**
 * What the box score says about how the game went, from `home`'s side: a clause on the halftime
 * swing for the result sentence ("after trailing by seven at halftime"), and the one sentence that
 * best explains the result. Chosen in order of what decides games (a comeback or a lead let go, the
 * turnover battle, control from start to finish, a result against the yardage, a defense that shut
 * the door, a game that stayed close), and every claim read off the quarters and team stats: a
 * routine game gets the yards and nothing more.
 */
export function gameStory(r: GameResult, home: boolean): { swing: string; takeaway: string } {
  const [us, them] = home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
  const [ours, theirs] = home ? [r.home, r.away] : [r.away, r.home];
  const [usQ, themQ] = home ? [r.quarters.home, r.quarters.away] : [r.quarters.away, r.quarters.home];
  const [usHalf, themHalf] = [sum(usQ, 0, 2), sum(themQ, 0, 2)];
  // Everything after the break, overtime included.
  const [us2, them2] = [us - usHalf, them - themHalf];
  const won = us > them;
  const lost = us < them;
  const margin = Math.abs(us - them);
  const [give, take] = [ours.turnovers, theirs.turnovers];
  const yds = ours.totalYds - theirs.totalYds;
  const outgained = yds <= -60;
  const outgaining = yds >= 60;
  // Ahead at the end of every quarter (the end of the game counts for the last one).
  const ledThroughout = (a: readonly number[], b: readonly number[]) =>
    [1, 2, 3].every((q) => sum(a, 0, q) > sum(b, 0, q)) && a.reduce((x, y) => x + y, 0) > b.reduce((x, y) => x + y, 0);
  const yards =
    ours.totalYds >= theirs.totalYds
      ? `We outgained them ${ours.totalYds} yards to ${theirs.totalYds}${ours.top >= 33 * 60 ? ` and held the ball for ${clock(ours.top)}` : ''}.`
      : `They outgained us ${theirs.totalYds} yards to ${ours.totalYds}.`;

  let swing = '';
  if (won && usHalf < themHalf) swing = ` after trailing by ${small(themHalf - usHalf)} at halftime`;
  else if (lost && usHalf > themHalf) swing = ` after leading by ${small(usHalf - themHalf)} at halftime`;

  let takeaway: string;
  if (swing && won)
    takeaway = `We outscored them ${us2}–${them2} after the break${take - give >= 2 ? `, and ${small(take)} takeaways helped turn it around` : ''}${outgained ? ', despite being outgained on the day' : ''}.`;
  else if (swing && lost)
    takeaway = `They outscored us ${them2}–${us2} after the break${give - take >= 2 ? `, and our ${small(give)} turnovers gave them the chances` : ''}${outgaining ? ', even though we moved the ball better' : ''}.`;
  else if (won && take - give >= 2)
    takeaway = `We won the turnover battle ${take}–${give}, and that decided it${outgained ? `: they outgained us ${theirs.totalYds} yards to ${ours.totalYds}` : ''}.`;
  else if (lost && give - take >= 2)
    takeaway = outgaining
      ? `We moved the ball better than they did, but ${small(give)} turnovers cost us possessions and left too little room for error.`
      : `We lost the turnover battle ${give}–${take}, and that is where the game went.`;
  else if (margin >= 21 && won && ledThroughout(usQ, themQ) && yds >= 0)
    takeaway = `We controlled it from start to finish: ${ours.totalYds} yards to ${theirs.totalYds}${ours.top >= 33 * 60 ? ` and ${clock(ours.top)} of possession` : ''}.`;
  else if (margin >= 21 && lost && ledThroughout(themQ, usQ) && yds <= 0)
    takeaway = `They controlled it from start to finish: ${theirs.totalYds} yards to ${ours.totalYds}.`;
  else if (won && outgained) {
    const why =
      ours.redZoneAtt >= 2 && ours.redZoneTd / ours.redZoneAtt >= 0.6
        ? `we cashed in ${redZone(ours)}`
        : theirs.redZoneAtt >= 3 && theirs.redZoneTd / theirs.redZoneAtt <= 0.34
          ? `we held them to ${redZone(theirs)}`
          : 'we got the points when it mattered';
    takeaway = `They outgained us ${theirs.totalYds} yards to ${ours.totalYds}, but ${why}.`;
  } else if (lost && outgaining)
    takeaway = `We outgained them ${ours.totalYds} yards to ${theirs.totalYds} but ${ours.redZoneAtt >= 3 && ours.redZoneTd / ours.redZoneAtt <= 0.34 ? `came away with only ${redZone(ours)}` : 'could not turn the yards into points'}.`;
  else if (!lost && themHalf >= 14 && them2 <= 3)
    takeaway = `The defense shut the door after halftime: ${them2 === 0 ? 'nothing' : `${small(them2)} points`} allowed after the break.`;
  else if (margin <= 3 && !r.overtime && Math.abs(sum(usQ, 0, 3) - sum(themQ, 0, 3)) <= 8)
    takeaway = 'A one-score game all through the fourth quarter.';
  else if (r.overtime) takeaway = 'Neither side could put it away in regulation.';
  else takeaway = yards;
  return { swing, takeaway };
}

/** A player's game in a few words, by position ("3 catches for 71 yards"), or nothing when his line has no number worth saying. */
export function statBlurb(p: Player, s: StatLine): string {
  const n = (k: keyof StatLine) => (s[k] as number | undefined) ?? 0;
  const td = (k: keyof StatLine) => (n(k) ? ` and ${plural(n(k), 'touchdown')}` : '');
  switch (p.position) {
    case 'QB':
      return n('passAtt')
        ? `${n('passYds')} yards passing${td('passTd')}${n('passInt') >= 2 ? `, with ${plural(n('passInt'), 'interception')}` : ''}`
        : '';
    case 'RB':
      return n('rushAtt')
        ? `${n('rushYds')} yards on ${n('rushAtt')} ${n('rushAtt') === 1 ? 'carry' : 'carries'}${td('rushTd')}`
        : '';
    case 'WR':
    case 'TE':
      return n('rec')
        ? `${n('rec')} ${n('rec') === 1 ? 'catch' : 'catches'} for ${n('recYds')} yards${td('recTd')}`
        : '';
    case 'K':
      return n('fgAtt') ? `${n('fgMade')} of ${n('fgAtt')} field goals` : '';
    case 'OL':
    case 'P':
      return '';
    default: {
      const sacks = n('sacks');
      const parts = [
        sacks ? `${sacks % 1 ? sacks.toFixed(1) : sacks} sack${sacks === 1 ? '' : 's'}` : '',
        n('defInt') ? plural(n('defInt'), 'interception') : '',
        n('forcedFum') ? plural(n('forcedFum'), 'forced fumble') : '',
        n('tackles') ? plural(n('tackles'), 'tackle') : '',
      ].filter(Boolean);
      return list(parts.slice(0, 2));
    }
  }
}

/**
 * The head coach's word after our latest game: the score, the one thing that decided it, and the
 * player of the game with his line. One game only, so a long sim doesn't bury the inbox.
 */
function recapMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  const game = league.games
    .filter((g) => g.season === league.season && g.result && (g.homeId === user || g.awayId === user))
    .sort((a, b) => b.week - a.week)[0];
  if (!game || have.has(`recap:${game.season}:${game.id}`)) return [];
  const r = game.result!;
  const home = game.homeId === user;
  const [us, them] = home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
  const me = league.teams[user];
  const opp = league.teams[home ? game.awayId : game.homeId];
  const where = game.neutral ? 'on a neutral field' : home ? 'at home' : 'on the road';
  const when = `${where}${game.playoffRound ? ` in the ${ROUND_NAMES[game.playoffRound]}` : ''}${r.overtime ? ' in overtime' : ''}`;
  const score = `${Math.max(us, them)}–${Math.min(us, them)}`;
  const { swing, takeaway } = gameStory(r, home);
  const result =
    us > them
      ? `We beat the ${teamName(opp)} ${score} ${when}${swing}.`
      : us < them
        ? `We lost to the ${teamName(opp)} ${score} ${when}${swing}.`
        : `We tied the ${teamName(opp)} ${score} ${when}.`;
  const star = playerOfTheGame(league, game);
  const p = star !== null ? league.players[star] : undefined;
  const line = p ? statBlurb(p, r.playerStats[p.id] ?? {}) : '';
  const potg = !p
    ? ''
    : ` ${r.playerTeams[p.id] === user ? fullName(p) : `Their ${p.position} ${fullName(p)}`} was the player of the game${line ? `, with ${line}` : ''}.`;
  const [win, lose] =
    us >= them
      ? [
          { team: me, pts: us },
          { team: opp, pts: them },
        ]
      : [
          { team: opp, pts: them },
          { team: me, pts: us },
        ];
  const before = computeRecords(
    { ...league, games: league.games.filter((g) => g.season !== game.season || g.week < game.week) },
    game.season,
  );
  const theirRecord = before.get(opp.id)!;
  const ourRecord = before.get(user)!;
  const strongOpponent =
    !game.playoffRound &&
    theirRecord.w + theirRecord.l + theirRecord.t >= 6 &&
    (theirRecord.w + theirRecord.t / 2) / (theirRecord.w + theirRecord.l + theirRecord.t) >= 0.75;
  const coaching =
    userCoachGameObservation(league, game, headCoach(league).fromCard?.id) || teachingObservation(league);
  const resultWithReaction = coaching
    ? `${result.slice(0, -1)}; ${coaching.replace(/^Our /, 'our ').replace(/^The /, 'the ')}`
    : result;
  const headline =
    us > them && strongOpponent
      ? us - them >= 14
        ? 'Statement win'
        : ourRecord.w <= ourRecord.l
          ? 'Upset win'
          : 'Game recap'
      : 'Game recap';
  return [
    {
      id: `recap:${game.season}:${game.id}`,
      season: game.season,
      phase: game.playoffRound ? 'playoffs' : 'regular',
      week: game.week,
      ...headCoach(league),
      category: 'matchup',
      subject: `${headline}: ${win.team.name} ${win.pts}, ${lose.team.name} ${lose.pts}`,
      body: `${resultWithReaction} ${takeaway}${potg}`,
      actions: [{ kind: 'game', gameId: game.id }],
    },
  ];
}

/** A healed player on your reserve your staff would bring back, but the 53 is full (it never cuts a man for him). */
const waitsForSpot = (league: League, p: Player) =>
  !!p.ir &&
  !p.injury &&
  p.ir.weeks >= IR_MIN_WEEKS &&
  irReturnsUsed(league, league.userTeamId) < IR_RETURNS &&
  activeRoster(league, league.userTeamId).length >= ROSTER_MAX;

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
    const ir = !p.ir
      ? " He's back in his spot on the depth chart."
      : !delegates(league, team)
        ? " He's still on injured reserve: activate him when you want him back."
        : waitsForSpot(league, p)
          ? " He's waiting on injured reserve: the 53 is full, so make room and the staff will bring him back."
          : " He's still on injured reserve: the staff will bring him back once his four weeks are up, if there's a spot on the 53.";
    out.push({
      id: `cleared:${key}`,
      season: league.season,
      phase: league.phase,
      week: league.week,
      ...doctor(league),
      category: 'medical',
      subject: `${fullName(p)} is cleared to play${waitsForSpot(league, p) ? '; the 53 is full' : ''}`,
      body:
        was.type === 'concussion'
          ? `${fullName(p)} has passed the last step of the concussion protocol${was.held ? ', and we gave him the extra week we planned,' : ''} and is cleared for full practice.${ir}${concussionWindow(league, p) > 0 ? ' A second concussion is likelier in his first couple of weeks back.' : ''}`
          : `${fullName(p)} is over his ${what} and cleared for full practice.${ir}`,
      actions: [
        { kind: 'player', playerId: p.id },
        { kind: 'team', teamId: team.id },
      ],
    });
  }
  return out;
}

// ───────── the trade market ─────────

/** The week a weekly digest covers: the market moment after the games of the week before (`marketMoment`). */
const coveredWeek = (phase: Phase, week: number) => (phase === 'regular' ? week - 1 : week);

/** League trades a digest covers (ours have their own mail): one market moment's, from the transaction log. */
export function marketTrades(league: League, season: number, phase: Phase, week: number) {
  const at = coveredWeek(phase, week);
  return league.transactions.filter(
    (t) =>
      t.kind === 'trade' &&
      t.season === season &&
      t.phase === phase &&
      (phase !== 'regular' || t.week === at) &&
      !t.teamIds.includes(league.userTeamId),
  );
}

/** Rumors a digest covers: what front offices were really doing that moment (`writeRumors`), never about us. */
export function marketRumors(league: League, season: number, phase: Phase, week: number) {
  const at = coveredWeek(phase, week);
  return (league.market?.rumors ?? []).filter(
    (r) => r.season === season && r.phase === phase && (phase !== 'regular' || r.week === at),
  );
}

/** Weeks of the regular season the director writes up: from week 5 to the deadline week (deadline day has its own mail). */
const DIGEST_FROM = 5;

/**
 * The director of scouting's market digest: the trades around the league since the last one, what his people are
 * hearing, and how far off the deadline is. Weekly from week 5 to the deadline, and once as the league year opens. A
 * moment with nothing to report sends nothing.
 */
function marketMail(league: League, have: Set<string>): Draft[] {
  const { season, phase } = league;
  const weekly = phase === 'regular' && league.week >= DIGEST_FROM && league.week <= TRADE_DEADLINE_WEEK;
  if (!weekly && phase !== 'resign') return [];
  const week = phase === 'regular' ? league.week : 0;
  const id = `market:${season}:${phase}:${week}`;
  if (have.has(id)) return [];
  const trades = marketTrades(league, season, phase, week).length;
  const rumors = marketRumors(league, season, phase, week).length;
  if (!trades && !rumors) return [];
  const dealt = trades
    ? `${count(trades)} trade${trades === 1 ? '' : 's'} went through around the league`
    : 'No trades went through around the league';
  const heard = rumors
    ? `, and we're hearing ${rumors === 1 ? 'one more name' : `${count(rumors).toLowerCase()} more names`} that could move`
    : '';
  const left = TRADE_DEADLINE_WEEK - league.week;
  const deadline =
    phase === 'regular'
      ? ` The deadline is the day after week ${TRADE_DEADLINE_WEEK}${left ? `, ${left === 1 ? 'a week' : `${count(left).toLowerCase()} weeks`} from now` : ': this is the last week before it'}.`
      : '';
  return [
    {
      id,
      season,
      phase,
      week,
      ...director(league),
      category: 'trades',
      subject:
        phase === 'resign'
          ? 'Market report: the league year opens'
          : trades
            ? `Market report: ${plural(trades, 'trade')} this week`
            : 'Market report: the rumor mill',
      body: `${dealt}${phase === 'resign' ? ' as the league year opened' : ' this week'}${heard}.${deadline}`,
      actions: [{ kind: 'trades' }],
    },
  ];
}

/** The season's in-season trades by what they were (`TradeRecord.kind`), ours left out (an offer we took keeps its kind, so go by team). */
export function seasonDeals(league: League, season = league.season) {
  return (league.market?.history ?? []).filter(
    (r) => r.season === season && r.phase === 'regular' && !r.sides.some((s) => s.teamId === league.userTeamId),
  );
}

/** Once the deadline has passed: how the trade season went, with deadline day's deals. */
function marketRecapMail(league: League, have: Set<string>): Draft[] {
  const { season } = league;
  const passed =
    (league.phase === 'regular' && league.week > TRADE_DEADLINE_WEEK + 1) ||
    league.phase === 'playoffs' ||
    league.phase === 'complete';
  const id = `market:${season}:recap`;
  if (!passed || have.has(id)) return [];
  const all = league.transactions.filter((t) => t.kind === 'trade' && t.season === season && t.phase === 'regular');
  if (!all.length) return [];
  const day = deadlineDayTrades(league, season).length;
  const division = league.teams[league.userTeamId].division;
  const rivals = all.filter((t) =>
    t.teamIds.some((id) => id !== league.userTeamId && league.teams[id].division === division),
  ).length;
  const ours = all.filter((t) => t.teamIds.includes(league.userTeamId)).length;
  const stood = ours ? ` We made ${ours === 1 ? 'one of them' : `${small(ours)} of them`}.` : ' We stood pat.';
  return [
    {
      id,
      season,
      phase: league.phase,
      week: league.week,
      ...director(league),
      category: 'trades',
      subject: 'Deadline recap',
      body: `The trade deadline has passed. ${count(all.length)} trade${all.length === 1 ? '' : 's'} went through this season, ${day ? `${count(day).toLowerCase()} of them on deadline day` : 'none of them on deadline day'}.${stood}${rivals ? ` ${rivals === 1 ? 'One involved' : `${count(rivals)} involved`} a division rival.` : ''} Rosters are set until the new league year.`,
      actions: [{ kind: 'trades' }],
    },
  ];
}

/** Trades around the league on deadline day: the market's last round runs as the deadline week's games end. */
export const deadlineDayTrades = (league: League, season = league.season) =>
  league.transactions.filter(
    (t) =>
      t.kind === 'trade' &&
      t.season === season &&
      t.phase === 'regular' &&
      (t.week === TRADE_DEADLINE_WEEK || t.week === TRADE_DEADLINE_WEEK + 1),
  );

/**
 * The league office's word on the trade deadline: the week before, the week of, and deadline day itself (the
 * day after the deadline week, as in the NFL: the last day to deal, and the market's busiest).
 */
function deadlineMail(league: League, have: Set<string>): Draft[] {
  const weeks = TRADE_DEADLINE_WEEK - league.week;
  const key = isDeadlineDay(league) ? 'day' : weeks === 0 || weeks === 1 ? String(weeks) : null;
  const id = `deadline:${league.season}:${key}`;
  if (!key || have.has(id)) return [];
  const w = TRADE_DEADLINE_WEEK;
  const done = deadlineDayTrades(league).length;
  const text: Record<string, [string, string]> = {
    1: [
      'Trade deadline: one week to go',
      `The trade deadline is the day after week ${w}. After that, rosters are set until the new league year.`,
    ],
    0: [
      'Trade deadline: this week',
      `Week ${w} is the last week of games before the deadline. Trades stay open through deadline day, the day after it, then rosters are set until the new league year.`,
    ],
    day: [
      'Deadline day',
      `It's deadline day, the last day to make a trade this season. ${done ? `${count(done)} trade${done === 1 ? ' has' : 's have'} gone through around the league so far.` : 'The league has been quiet so far.'} Once week ${w + 1} is played, rosters are set until the new league year.`,
    ],
  };
  const [subject, body] = text[key];
  return [
    {
      id,
      season: league.season,
      phase: 'regular',
      week: league.week,
      from: 'League office',
      category: 'trades',
      subject,
      body,
      actions: [{ kind: 'trades' }],
    },
  ];
}

/**
 * The league office's word when it moves one of our games (`season/flex.ts`): into prime time or out of
 * it, or week 18's times once week 17 is played. One message per move, keyed by the new kickoff.
 */
function flexMail(league: League, have: Set<string>): Draft[] {
  const user = league.userTeamId;
  const out: Draft[] = [];
  for (const g of league.games) {
    if (g.season !== league.season || g.result || !g.flexed || !g.kickoff || (g.homeId !== user && g.awayId !== user))
      continue;
    const { kickoff: k, flexed: was } = g;
    if (k.day === was.day && k.et === was.et) continue;
    const id = `flex:${g.season}:${g.id}:${k.day}${k.et}`;
    if (have.has(id)) continue;
    const opp = league.teams[g.homeId === user ? g.awayId : g.homeId];
    const where = g.homeId === user ? `against the ${teamName(opp)}` : `at the ${teamName(opp)}`;
    const final = g.week === REGULAR_SEASON_WEEKS;
    out.push({
      id,
      season: g.season,
      phase: 'regular',
      week: league.week,
      from: 'League office',
      category: 'league',
      subject: final
        ? `Week ${g.week} kickoff: ${kickoffLabel(k)}`
        : isPrimeTime(k)
          ? `Moved to prime time: ${kickoffLabel(k)}`
          : `Moved out of prime time: ${kickoffLabel(k)}`,
      body: final
        ? `With a week to play, the league has set the final week's kickoffs. Our game ${where} kicks off ${kickoffLabel(k)}.`
        : `The league has moved our week ${g.week} game ${where} from ${kickoffLabel(was)} to ${kickoffLabel(k)}.`,
      actions: [{ kind: 'standings' }],
    });
  }
  return out;
}

const RACE = ['bye', 'division', 'spot'] as const;

/**
 * Where the final standings put a team. `playoffRace` counts a tie on wins as still open, so a team that
 * finishes level on the line, in or out on a tiebreaker, would otherwise never hear its fate.
 */
function finalRace(league: League, teamId: number): RaceStatus {
  const seed = conferenceSeeds(league, league.teams[teamId].conference, computeRecords(league)).indexOf(teamId);
  return { spot: seed >= 0, division: seed >= 0 && seed < 4, bye: seed === 0, out: seed < 0 };
}

/** The league office's word when our playoff fate is certain: the best clinch so far (a bye implies the rest), or elimination. */
function raceMail(league: League, have: Set<string>): Draft[] {
  const team = league.teams[league.userTeamId];
  const over = !league.games.some((g) => g.season === league.season && !g.playoffRound && !g.result);
  const race = over ? finalRace(league, team.id) : playoffRace(league, team.id);
  const sent = (level: string) => have.has(`race:${league.season}:${level}`);
  const best = RACE.find((level) => race[level]);
  const level = race.out ? 'out' : best && !RACE.slice(0, RACE.indexOf(best) + 1).some(sent) ? best : null;
  if (!level || sent(level)) return [];
  const left = league.games.filter(
    (g) => g.season === league.season && !g.playoffRound && !g.result && (g.homeId === team.id || g.awayId === team.id),
  ).length;
  const still = left ? ` with ${count(left).toLowerCase()} game${left === 1 ? '' : 's'} to play` : '';
  const name = teamName(team);
  const text = {
    bye: [
      `Top seed clinched`,
      `The ${name} have clinched the top seed in the ${league.conferences[team.conference].abbrev}, and with it the only first-round bye${still}.`,
    ],
    division: [
      `${league.divisions[team.division].name} title clinched`,
      `The ${name} have clinched the ${league.divisions[team.division].name} title${still}.`,
    ],
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
const recordIn = (league: League, season: number, teamId: number) =>
  league.history.find((h) => h.season === season)?.records[teamId] ?? null;

/**
 * The owner's letter as the league year opens: the budgets (on the card), and how far past the coaching
 * budget he'll go, in his words rather than a number (`ownerLeeway`): a sharp reader can tell a contender's
 * owner who wants a title from one who wants the budget kept.
 */
function ownerMail(league: League, have: Set<string>): Draft[] {
  const { season } = league;
  const id = `owner:${season}:${league.userTeamId}`;
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
  const patience =
    trigger === 'Quick trigger with head coaches'
      ? ' I expect results, and I expect them soon.'
      : trigger
        ? ' I believe in giving good people time to build something.'
        : '';
  const promises = teamCoaches(league, team.id)
    .flatMap((c) => {
      const mandate = coachMandate(league, c);
      return mandate
        ? [
            `${coachName(c)} stays as ${coachTitle(c).toLowerCase()} through ${mandate.through}. ${mandate.reason} His contract already covers that commitment, and his salary counts toward our coaching budget.`,
          ]
        : [];
    })
    .join(' ');
  return [
    {
      id,
      season,
      phase: 'resign',
      week: 0,
      from: 'The owner',
      category: 'staff',
      subject: 'A letter from the owner',
      body: `A new league year starts today, and the budgets for ${season} are below. ${marketLine} ${leeway}${patience}${promises ? ` ${promises}` : ''}`,
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
  const people: StaffRef[] = [
    ...coaches.map((c) => ({ kind: 'coach' as const, id: c.id })),
    ...scouts.map((s) => ({ kind: 'scout' as const, id: s.id })),
    ...medics.map((m) => ({ kind: 'medic' as const, id: m.id })),
  ];
  if (!people.length) return [];
  const group = (n: number, one: string, many: string) =>
    n === 1 ? `our ${one}` : `${count(n).toLowerCase()} ${many}`;
  const groups = [
    coaches.length ? group(coaches.length, coachTitle(coaches[0]).toLowerCase(), 'coaches') : '',
    scouts.length ? group(scouts.length, ROLE_LABEL[scouts[0].role].toLowerCase(), 'scouts') : '',
    medics.length ? group(medics.length, MEDIC_ROLE_LABEL[medics[0].role].toLowerCase(), 'of the medical staff') : '',
  ].filter(Boolean);
  const leaving = [
    coachResignForecast(league, user),
    resignForecast(league, user),
    medicResignForecast(league, user),
  ].reduce((n, f) => n + [...f.values()].filter((o) => o !== 'stays').length, 0);
  const n = people.length;
  const outlook = !leaving
    ? 'As things stand, every one of them stays.'
    : leaving === n
      ? 'As things stand, none of them stays.'
      : `As things stand, ${count(leaving).toLowerCase()} of them would leave.`;
  return [
    {
      id: `staff:${season}:deals:${people.map(refKey).join('.')}`,
      season,
      phase: 'resign',
      week: 0,
      from: 'Front office',
      category: 'staff',
      subject: n === 1 ? 'A staff contract is up' : `${count(n)} staff contracts are up`,
      body: `${capital(list(groups))} ${n === 1 ? 'is' : 'are'} out of contract. Unless you extend them or let them go first, each re-signs for two years at the ask when free agency opens, as long as the chair is free and the budget covers the ask. ${outlook}`,
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
    if (
      t.kind !== 'coach' ||
      t.season !== league.season ||
      t.teamIds.length !== 2 ||
      t.teamIds[1] !== user ||
      t.teamIds[0] === user
    )
      continue;
    const hirer = league.teams[t.teamIds[0]];
    const c = teamCoaches(league, hirer.id).find((x) => t.text.includes(` ${coachName(x)} as `));
    // "LV hired BUF quarterbacks coach Sam Reed as offensive coordinator": the chair he held with us.
    const was = c && t.text.split(` ${league.teams[user].abbrev} `)[1]?.split(` ${coachName(c)} as `)[0];
    const chair = was ? chairTitled(was) : undefined;
    if (!c || !was || !chair) continue;
    const id = `staff:${league.season}:gone:${c.id}:${chair.role}${chair.role === 'positionCoach' ? `:${chair.room}` : ''}`;
    if (have.has(id)) continue;
    const now = coachTitle(c).toLowerCase();
    const fill = promotionCandidates(league, chair).length
      ? 'promote from within or go to the market'
      : 'go to the market';
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
  /**
   * His latest chair before this season: "Offensive coordinator, KC", "Head coach, DEN" (and that team's record),
   * from a season or more back for a man who sat a year out. Null for one who has never coached in the league.
   */
  from: { title: string; teamId: number; season: number; record: { w: number; l: number; t: number } | null } | null;
  /** Last season's head coach, and the team's record under him. */
  replaced: Coach | null;
  record: { w: number; l: number; t: number } | null;
}

/** Every team whose head coach for `season` isn't the one who finished `season - 1`, the user's division first. */
export function headCoachChanges(league: League, season = league.season): HeadCoachChange[] {
  const everyone = [...Object.values(league.coaches), ...Object.values(league.retiredCoaches)];
  const headed = (s: number) =>
    new Map(
      everyone.flatMap((c) =>
        (c.career ?? []).filter((x) => x.season === s && x.role === 'headCoach').map((x) => [x.teamId, c] as const),
      ),
    );
  const before = headed(season - 1);
  // This league year: the chair as it stands now; a past one: whoever finished it.
  const after =
    season === league.season
      ? new Map(league.teams.map((t) => [t.id, chairHolder(teamCoaches(league, t.id), { role: 'headCoach' })] as const))
      : headed(season);
  const division = league.teams[league.userTeamId].division;
  const out: HeadCoachChange[] = [];
  for (const team of league.teams) {
    const coach = after.get(team.id);
    const replaced = before.get(team.id) ?? null;
    if (!coach || coach === replaced) continue;
    // Not just last season: a head coach fired a year ago and hired back now sat that season out.
    const last = (coach.career ?? []).filter((x) => x.season < season).sort((a, b) => b.season - a.season)[0];
    out.push({
      teamId: team.id,
      coach,
      from: last
        ? {
            title: coachTitle(last),
            teamId: last.teamId,
            season: last.season,
            record: last.role === 'headCoach' ? recordIn(league, last.season, last.teamId) : null,
          }
        : null,
      replaced,
      record: recordIn(league, season - 1, team.id),
    });
  }
  return out.sort(
    (a, b) =>
      Number(league.teams[b.teamId].division === division) - Number(league.teams[a.teamId].division === division),
  );
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
    // Transactions name a player by the position he had then: a later move mustn't hide him.
    for (const pos of new Set([p.position, ...formerPositions(p)])) {
      const key = `${pos} ${p.firstName} ${p.lastName}`;
      byName.set(key, [...(byName.get(key) ?? []), p]);
    }
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
    resigned: league.transactions.filter(
      (t) => t.kind === 'resign' && t.season === season && t.phase === 'resign' && t.teamIds.includes(user),
    ).length,
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
  const walked = fa.walked.length
    ? `; ${count(fa.walked.length).toLowerCase()} of last season's players signed elsewhere`
    : '';
  const deal = (d: Signing) => `${d.player.position} ${fullName(d.player)} (${d.years} yr, ${millions(d.total)})`;
  // The deals that shaped it: our biggest, the loss that hurts most, and the richest around the league if it wasn't ours.
  const headline = fa.signed.length ? ` Our biggest deal was ${deal(fa.signed[0])}.` : '';
  const gone = fa.walked.length
    ? ` The one that hurts is ${fa.walked[0].player.position} ${fullName(fa.walked[0].player)}, gone to the ${teamName(league.teams[fa.walked[0].teamId])} for ${millions(fa.walked[0].total)} over ${plural(fa.walked[0].years, 'year')}.`
    : '';
  // The league's richest deal, unless it was one of ours or the one we just said hurts.
  const top = fa.biggest[0];
  const richest =
    top && top.teamId !== league.userTeamId && top.player.id !== fa.walked[0]?.player.id
      ? ` Around the league, the richest deal was ${deal(top)} to the ${teamName(league.teams[top.teamId])}.`
      : '';
  const cap =
    rookies > 0
      ? ` We have ${millions(space)} of cap space going into the draft, and our rookie class will need about ${millions(rookies)} of it.`
      : ` We have ${millions(space)} of cap space.`;
  return [
    {
      id,
      season: league.season,
      phase: 'draft',
      week: 0,
      from: 'Front office',
      category: 'contracts',
      subject: 'Free agency wrap-up',
      body: `Free agency is over. ${signed}${kept}${walked}.${headline}${gone}${richest}${cap}`,
      actions: [{ kind: 'cap' }, { kind: 'fa' }],
    },
  ];
}

// ───────── position moves ─────────

/** A position as a noun: "safety", "edge rusher". */
const posWord = (pos: Position) => (pos === 'OL' ? 'offensive lineman' : POSITION_NAMES[pos].toLowerCase());
/** With its article: "a safety", "an edge rusher". */
export const aPosition = (pos: Position) => `${/^[aeiou]/.test(posWord(pos)) ? 'an' : 'a'} ${posWord(pos)}`;

/**
 * The case for a move in the coaches' words, for the suggestion and anywhere else a reason is shown. A
 * scheme reason names the coordinator whose scheme it is, and says so when he is new this year.
 */
export function reasonLine(reason: MoveReason, to: Position, coordinator?: { coach: Coach; isNew: boolean }): string {
  switch (reason) {
    case 'hole':
      return `Fills a hole at ${to}`;
    case 'nextYear':
      return `Takes over at ${to} next year`;
    case 'scheme':
      if (!coordinator) return `The coordinator's scheme wants him at ${to}`;
      return `${coachName(coordinator.coach)}'s scheme wants him at ${to}${coordinator.isNew ? `: he is the new ${coachTitle(coordinator.coach).toLowerCase()}` : ''}`;
    case 'upside':
      return `His game fits ${to} better`;
    case 'reps':
      return 'Gets him on the field';
    case 'age':
      return `Extends his career: ${to} asks less of his legs`;
    case 'upgrade':
      return `A clear upgrade at ${to}`;
  }
}

/** The cut-down day a move should be done by, as the camps in the coaches' estimate count it (0 is the coming one). */
const readyBy = (season: number, camps: number) =>
  camps === 0
    ? "this year's cut-down day"
    : camps === 1
      ? "next year's cut-down day"
      : `the ${season + camps} cut-down day`;

/**
 * The coaches' suggestion, once a league year, while a plan can still start before cut-down day (the draft and
 * camp): their best move for us, and the case for it. Nothing is sent to a team that has let the coaches decide.
 * Starting it, turning it down or the end of camp answers it (`needsYou`).
 */
function positionOfferMail(league: League, have: Set<string>): Draft[] {
  const { season, phase } = league;
  const team = league.teams[league.userTeamId];
  if (team.training?.coachesDecide || [...have].some((id) => id.startsWith(`position:${season}:offer:`))) return [];
  const pick = suggestMove(league, team.id);
  if (!pick) return [];
  const { player: p, read, why } = pick;
  const from = p.position;
  const reason = `${reasonLine(why, read.to, read.coordinator)}. ${positionTeachingNote(league, p, read.to)}`;
  const ahead = read.ahead ? `, ahead of ${fullName(read.ahead)}` : '';
  const role = read.role === 'starter' ? `he would start at ${read.to}${ahead}` : `he would be depth at ${read.to}`;
  return [
    {
      id: `position:${season}:offer:${p.id}:${read.to}`,
      season,
      phase,
      week: 0,
      ...headCoach(league),
      category: 'staff',
      subject: `Move ${fullName(p)} to ${posWord(read.to)}?`,
      body:
        `We'd like to teach ${fullName(p)}, our ${p.age}-year-old ${posWord(from)}, to play ${posWord(read.to)}. ${reason}` +
        `We think it's worth it: ${role}, and that leaves ${read.left} at ${from}. ` +
        // The estimate counts the spring program while the draft is on: started later, he learns at camp only.
        `He should be ready by ${readyBy(season, read.camps)}${phase === 'draft' ? ' if we start before the draft closes' : ''}. ` +
        `Until then he keeps playing ${from}. Say "Not now" below and we won't raise it again until ${season + 2}.`,
      actions: [{ kind: 'player', playerId: p.id }, { kind: 'coaches' }],
    },
  ];
}

const MOVE_REASONS: MoveReason[] = ['hole', 'nextYear', 'scheme', 'upside', 'reps', 'age', 'upgrade'];

/**
 * The news line of a player's latest move and the reason it gave: his plan is gone once he has moved, but the
 * transaction log kept why ("KC moved LB Sam Reed to S: they were short at S"). Null when it was another team's
 * move: a player who came to us already moved.
 */
function moveNews(league: League, p: Player): { when: Pick<Draft, 'phase' | 'week'>; reason?: MoveReason } | null {
  const move = p.moves!.at(-1)!;
  const said = `moved ${move.from} ${p.firstName} ${p.lastName} to ${move.to}`;
  const news = [...league.transactions]
    .reverse()
    .find(
      (t) =>
        t.kind === 'position' &&
        t.season === move.season &&
        p.teamId !== null &&
        t.teamIds.includes(p.teamId) &&
        t.text.includes(said),
    );
  if (!news) return null;
  const why = news.text.split(said)[1]?.replace(/^: /, '');
  return {
    when: { phase: news.phase, week: news.phase === 'regular' ? news.week : 0 },
    reason: MOVE_REASONS.find((r) => reasonWords(r, move.to) === why),
  };
}

/**
 * One note for each of our players who changed position this league year (cut-down day is the only day anyone
 * does), the head coach's word that it is done: what changed, why, where he stands on the chart and the lock.
 */
function positionMovedMail(league: League, have: Set<string>): Draft[] {
  const { season } = league;
  const team = league.teams[league.userTeamId];
  const out: Draft[] = [];
  for (const p of teamPlayers(league, team.id)) {
    const move = p.moves?.at(-1);
    const id = `position:${season}:moved:${p.id}`;
    if (!move || move.season !== season || p.retired || have.has(id)) continue;
    const news = moveNews(league, p);
    if (!news) continue;
    const { when, reason } = news;
    out.push({
      id,
      season,
      ...when,
      ...headCoach(league),
      category: 'staff',
      subject: `${fullName(p)} is now ${aPosition(move.to)}`,
      body:
        `${fullName(p)} moved from ${posWord(move.from)} to ${posWord(move.to)} on cut-down day. ${reason ? `${reasonLine(reason, move.to)}. ` : ''}` +
        `${team.autoDepth ? '' : `He is placed by rating on your ${move.to} depth chart. `}` +
        "He can't be traded until the new league year.",
      actions: [
        { kind: 'player', playerId: p.id },
        { kind: 'team', teamId: team.id },
      ],
    });
  }
  return out;
}

/**
 * The head coach on a short position: who the staff lined up there (once per move), or that it's short with nobody on
 * the roster good enough to cover, pointing to free agency there (once while it stays short).
 */
function coverMail(league: League, have: Set<string>): Draft[] {
  const { season } = league;
  const team = league.teams[league.userTeamId];
  const out: Draft[] = [];
  for (const [id, at] of Object.entries(team.playingAt ?? {})) {
    if (at.by !== 'staff' || at.since?.season !== season) continue;
    const p = league.players[Number(id)];
    const key = `cover:${season}:${at.since.week}:${p.id}:${at.pos}`;
    if (have.has(key)) continue;
    const knock = knockWord(knockFor(p, at.pos));
    out.push({
      id: key,
      season,
      phase: league.phase,
      week: league.week,
      ...headCoach(league),
      category: 'medical',
      subject: `${fullName(p)} covers at ${at.pos}`,
      body:
        `We're short at ${posWord(at.pos)} with the injuries, so ${fullName(p)} lines up there for now` +
        `${knock === 'none' ? '.' : `; out of position he'll take a ${knock} knock.`} ` +
        `He goes back to ${posWord(p.position)} once we're healthy there. You can move him yourself with "Play at…".`,
      actions: [
        { kind: 'player', playerId: p.id },
        { kind: 'team', teamId: team.id },
      ],
    });
  }
  for (const pos of shortPositions(league, team)) {
    const key = `short:${season}:${league.week}:${pos}`;
    const open = (league.inbox ?? []).some((m) => {
      const s = mailSubject(m);
      return s?.kind === 'shortHanded' && s.pos === pos && needsYou(league, m);
    });
    if (open || have.has(key)) continue;
    const cover = !delegates(league, team) ? chooseCover(league, team, pos, NEED) : null;
    const n = healthyAt(league, team, pos);
    out.push({
      id: key,
      season,
      phase: league.phase,
      week: league.week,
      ...headCoach(league),
      category: 'medical',
      subject: `We're short at ${pos}`,
      body:
        `With the injuries we're down to ${count(n).toLowerCase()} healthy ${n === 1 ? posWord(pos) : `${posWord(pos)}s`}. ` +
        (cover
          ? `${fullName(cover)} could cover there with "Play at…", or `
          : 'Nobody else on the roster is good enough to cover there, so ') +
        'free agency has players who would sign for the rest of the season.',
      actions: [
        { kind: 'fa', pos },
        { kind: 'team', teamId: team.id },
      ],
    });
  }
  return out;
}

/** Only your club sends private instructions. Outside reporting never quotes its decision file. */
export function leadershipMail(league: League, have: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const e of league.leadership.events) {
    const id = `leadership:${e.date.season}:${e.id}`;
    if (have.has(id)) continue;
    const personal = e.gmId === league.userGmId;
    const inside = managesTeam(league, e.teamId);
    out.push({
      id,
      season: e.date.season,
      phase: e.date.phase,
      week: e.date.week,
      from: inside || (personal && e.kind === 'gmDismissed') ? 'The owner' : 'SNN league desk',
      category: inside || personal ? 'staff' : 'league',
      subject: e.report,
      body: (inside || (personal && e.kind === 'gmDismissed')) && e.privateText ? e.privateText : e.report,
      actions: [{ kind: 'gms' }],
    });
  }
  const search = league.leadership.search;
  if (league.phase === 'resign' && search && search.round < 3)
    for (const o of search.offers) {
      const id = `gm-offer:${search.season}:${o.teamId}`;
      if (!have.has(id))
        out.push({
          id,
          season: league.season,
          phase: league.phase,
          week: league.week,
          from: 'The owner',
          category: 'staff',
          subject: `${league.teams[o.teamId].abbrev}: ${o.incumbent ? 'permanent GM offer' : 'GM job offer'}`,
          body: `We are offering you the GM position through ${o.through}. ${gmOfferTerms(league, o).expectation} ${gmOfferTerms(league, o).staffing.join(' ')} Review the terms in Front office → GMs before the staffing window closes.`,
          actions: [{ kind: 'gms' }],
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
  recordAdvicePublications(league, inbox);
  const have = new Set(inbox.filter((m) => canReadMail(league, m)).map((m) => m.id));
  const fresh: Draft[] = [];
  if (employed(league)) {
    fresh.push(
      ...awardMail(league, have),
      ...injuryMail(league, have),
      ...tradeMail(league, have),
      ...offerMail(league, have),
    );
    if (league.phase === 'resign')
      fresh.push(
        ...ownerMail(league, have),
        ...staffDealsMail(league, have),
        ...newYearMail(league, have),
        ...futuresKeptMail(league, have),
        ...personnelOfferMail(league, have),
      );
    if (league.phase === 'playoffs' || league.phase === 'complete') fresh.push(...futuresMail(league, have));
    // Waivers run in every phase but the gap after the final: news arrives the step it happens.
    if (league.phase !== 'complete') fresh.push(...waiverMail(league, have));
    if (league.phase === 'regular') fresh.push(...callupsUsedMail(league, have));
    // Free agency's first day: the window's coaching moves are done.
    if (league.phase === 'freeAgency')
      fresh.push(...combineMail(league, have), ...poachedMail(league, have), ...carouselMail(league, have));
    // Free agency is over by the draft (or by camp, if a sim ran straight through it).
    if (league.phase === 'draft' || league.phase === 'preseason') fresh.push(...faWrapMail(league, have));
    if (league.phase === 'draft') fresh.push(...draftDayMail(league, have));
    // The coaches' position suggestion while a plan can still start; the note once cut-down day has made the move.
    if (league.phase === 'draft' || league.phase === 'preseason') fresh.push(...positionOfferMail(league, have));
    if (league.phase === 'regular' || league.phase === 'playoffs' || league.phase === 'complete')
      fresh.push(...positionMovedMail(league, have));
    if ((league.phase === 'draft' && draftComplete(league)) || league.phase === 'preseason')
      fresh.push(...draftClassMail(league, have));
    if (league.phase === 'regular' || league.phase === 'playoffs') {
      fresh.push(
        ...recapMail(league, have),
        ...clearedMail(league, have),
        ...coverMail(league, have),
        ...raceMail(league, have),
        ...matchupMail(league, have),
        ...flexMail(league, have),
      );
    }
    if (league.phase === 'regular') fresh.push(...deadlineMail(league, have));
    // The week-18 settle runs in the same step that starts the playoffs.
    if (league.phase === 'regular' || league.phase === 'playoffs') fresh.push(...squadPoachMail(league, have));
    if (league.phase === 'regular' || league.phase === 'resign') fresh.push(...marketMail(league, have));
    if (league.phase === 'regular' || league.phase === 'playoffs' || league.phase === 'complete')
      fresh.push(...marketRecapMail(league, have));
  }
  fresh.push(
    ...leagueNews(league, have),
    ...(employed(league) ? rookieImpactMail(league, draftClassOf(league, league.season), director(league)) : []),
    ...leadershipMail(league, have),
  );
  // Old full saves have no record of evicted IDs. Preserve their conservative cutoff once;
  // thereafter only IDs actually evicted on the boundary date are tombstoned.
  if (!league.mailFloor && inbox.length >= KEEP) {
    const date = order(inbox[0]);
    league.mailFloor = { date, ids: fresh.filter((m) => order(m) === date).map((m) => m.id) };
  }
  const floor = league.mailFloor;
  const evicted = new Set(floor?.ids ?? []);
  const due = fresh.filter((m) => !floor || order(m) > floor.date || (order(m) === floor.date && !evicted.has(m.id)));
  if (!due.length) return;
  due.sort((a, b) => order(a) - order(b));
  inbox.push(
    ...due.map((m) => ({
      ...m,
      read: first,
      ...(m.category !== 'league' && employed(league) ? { organizationId: league.userTeamId } : {}),
    })),
  );
  recordAdvicePublications(league, due);
  // A newly reconstructed historical story may predate mail already filed. Evict chronologically.
  inbox.sort((a, b) => order(a) - order(b));
  const removed = inbox.splice(0, Math.max(0, inbox.length - KEEP));
  for (const m of removed) {
    const date = order(m);
    if (!league.mailFloor || date > league.mailFloor.date) league.mailFloor = { date, ids: [] };
    if (date === league.mailFloor.date) league.mailFloor.ids.push(m.id);
  }
}

/** Messages still in the inbox: not filed away, not deleted. */
export const inInbox = (m: InboxMessage) => !m.archived && !m.deleted;
export const canReadMail = (league: League, m: InboxMessage) =>
  m.organizationId === undefined || managesTeam(league, m.organizationId);

/** Unread in the inbox, as it lists them: a folded day of letters counts once. */
export const unreadCount = (league: League) =>
  new Set((league.inbox ?? []).filter((m) => canReadMail(league, m) && !m.read && inInbox(m)).map(threadKey)).size;

/** File messages away (they're read by then), or bring them back. */
export function archiveMail(league: League, ids: readonly string[], archived = true): void {
  const pick = new Set(ids);
  for (const m of league.inbox ?? []) {
    if (!pick.has(m.id)) continue;
    if (archived) {
      m.archived = true;
      m.read = true;
    } else delete m.archived;
  }
}

/** Delete messages, or bring them back. A deleted message stays on file, hidden, so delivery never files it again. */
export function deleteMail(league: League, ids: readonly string[], deleted = true): void {
  const pick = new Set(ids);
  for (const m of league.inbox ?? []) {
    if (!pick.has(m.id)) continue;
    if (deleted) {
      m.deleted = true;
      m.read = true;
    } else delete m.deleted;
  }
}

/** File away everything read that no longer asks anything of you. */
export function archiveRead(league: League): void {
  archiveMail(
    league,
    (league.inbox ?? []).filter((m) => m.read && inInbox(m) && !needsYou(league, m)).map((m) => m.id),
  );
}

/**
 * Kinds whose messages from the same day fold into one: a stack of agents' letters as the league year opens, a
 * week's injuries, the all-clears, retirements, our players' honors.
 */
const FOLDED = new Set<MailSubject['kind']>(['contract', 'retirement', 'injury', 'cleared', 'award', 'positionMoved']);

/** A message, or the same day's messages of one kind folded together, newest first. */
export interface MailThread {
  key: string;
  kind: MailSubject['kind'] | null;
  messages: InboxMessage[];
}

/** What a message folds under: its kind and day, or (for kinds that don't fold) itself. */
export function threadKey(m: InboxMessage): string {
  const subject = mailSubject(m);
  if (subject?.kind === 'offer') return `offer:${subject.season}:${subject.root}`;
  const kind = subject?.kind;
  return kind && FOLDED.has(kind) ? `${kind}:${m.season}:${m.phase}:${m.week}` : m.id;
}

/** Who a thread is from and what it's about: a folded day of mail gets its own line ("9 contracts are up"). */
export function threadLabel(t: MailThread): { from: string; subject: string } {
  const [lead] = t.messages;
  const n = t.messages.length;
  if (n === 1) return { from: lead.from, subject: lead.subject };
  switch (t.kind) {
    case 'contract':
      return { from: "Players' agents", subject: `${n} contracts are up` };
    case 'injury':
      return { from: lead.from, subject: `Injury report: ${n} players hurt` };
    case 'cleared':
      return { from: lead.from, subject: `${n} players cleared to play` };
    case 'retirement':
      return { from: 'Your players', subject: `${n} players retire` };
    case 'award':
      return { from: 'League office', subject: `${n} of our players honored` };
    case 'positionMoved':
      return { from: lead.from, subject: `${n} players change position` };
    case 'offer':
      return { from: lead.from, subject: `${lead.subject} (${n} messages)` };
    default:
      return { from: lead.from, subject: `${lead.subject} and ${n - 1} more` };
  }
}

/** One person's line inside a folded thread: the subject without what the thread already says. */
export function memberTitle(m: InboxMessage): string {
  return m.subject
    .replace(/'s contract is up$/, '')
    .replace(/ is cleared to play$/, '')
    .replace(/ retires$/, '')
    .replace(/ is now an? [a-z ]+$/, '');
}

/** Fold messages (newest first) into threads, each where its newest message is. */
export function threads(messages: readonly InboxMessage[]): MailThread[] {
  const byKey = new Map<string, MailThread>();
  const out: MailThread[] = [];
  for (const m of messages) {
    const key = threadKey(m);
    let t = byKey.get(key);
    if (!t) {
      t = { key, kind: mailSubject(m)?.kind ?? null, messages: [] };
      byKey.set(key, t);
      out.push(t);
    }
    t.messages.push(m);
  }
  return out;
}
