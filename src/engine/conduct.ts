/**
 * Discipline (spec `docs/superpowers/specs/2026-11-23-discipline-design.md`): trouble on and off the field and what
 * comes of it. The games a suspension costs (`serveGames`), the league's review of a week (`reviewWeek`), each step's
 * off-field trouble (`troubleWeek`), your answers and your head coach's (`answerConduct`, `settleConduct`,
 * `setConductByCoach`) and what the public may read (`publicConduct`).
 */
import { traitLean, traitOf } from './coachTraits';
import { teamCoaches } from './coaching';
import { disputeOf, onDidNotReport } from './disputeRead';
import { managesTeam } from './employment';
import { addJolt, moraleClock, moraleLevel, moodLean, YEAR } from './morale';
import { waitFor } from './playerTalks';
import { hashUnits } from './rng';
import { suspended, teamPlayers } from './roster';
import { computeRecords } from './season/standings';
import { temperamentOf, TRAIT_MEAN, workEthicOf } from './traits';
import type { ConductEntry, ConductKind, GameResult, League, Player, Team } from './types';

/** Lives in roster.ts (`isAvailable` reads it) so roster and conduct never import each other. */
export { suspended };

/**
 * After a week's games: each listed team's suspended players serve one, and a man with none left is clear. Pass only
 * the teams that played, so a bye holds the suspension (an offseason ruling keeps its games for week 1).
 */
export function serveGames(league: League, teamIds: number[]): void {
  for (const id of new Set(teamIds)) {
    for (const p of teamPlayers(league, id)) {
      if (!p.suspension) continue;
      p.suspension.games -= 1;
      if (p.suspension.games <= 0) delete p.suspension;
    }
  }
}

/**
 * A new league year: a team's own sitting ends with the year, and a record keeps only the last two league years (what
 * the ladder and the readers look at), its foul clocks only those the pattern review could still count. Reads and
 * changes nothing a draw depends on, so no seeded world moves.
 */
export function conductNewYear(league: League): void {
  const clock = league.season * YEAR;
  for (const p of Object.values(league.players)) {
    if (p.suspension?.by === 'team') delete p.suspension;
    const d = p.discipline;
    if (!d) continue;
    d.entries = d.entries.filter((e) => e.season >= league.season - 1);
    if (d.fouls) {
      d.fouls = d.fouls.filter((c) => clock - c < REVIEW.span);
      if (!d.fouls.length) delete d.fouls;
    }
    if (d.lean && d.lean.until <= clock) delete d.lean;
    if (!d.entries.length && !d.fouls && !d.lean) delete p.discipline;
  }
}

// ───────── trouble, the league's review and your answers ─────────

/** A public spat and a skipped team event are public by nature; the rest only when the team sits a man. */
const PUBLIC_KINDS: ReadonlySet<ConductKind> = new Set(['teamEvent', 'spat']);

/**
 * Who gets into trouble, a step's odds at an ordinary man (z = 0), each rising as `exp(−tilt · z)` toward the bottom of
 * the trait (the bottom fifth draws most of it). Starting guesses: `npm run conduct` (the plan's last tasks) tunes them.
 */
export const TROUBLE = {
  /** Missed a meeting, late to practice, out past curfew: low work ethic. */
  workEthic: { base: 0.0003, tilt: 1.6 },
  /** A skipped team event or a public spat: high controversy (its z is turned round). */
  controversy: { base: 0.00015, tilt: 1.4 },
  /** A scuffle at practice: low temperament. */
  scuffle: { base: 0.00015, tilt: 1.6 },
  /** A fight off the field: very low temperament. */
  fight: { base: 0.0000015, tilt: 2.2 },
  /** A bad mood adds up to this much (exp of the mood's lean), and each loss in a row of his team's this much. */
  mood: 0.5,
  losing: 0.1,
  /** The offseason's steps are a few and short: each rolls this share of a week's odds. */
  offseason: 0.5,
  /** Steps his last answer leans his odds for, and by how much: let go raises them, a fine lowers a little, sitting most. */
  leanSteps: 6,
  lean: { fine: 0.8, sat: 0.5, letGo: 1.5 } as const,
  /** An answer's mood jolt, in morale points (small: the meetings line sits near its edge). */
  jolt: { fine: -0.4, sat: -0.8 },
  /** The odds of each answer at a head coach's discipline lean −1…+1 (strict sits and fines, lenient lets it go). */
  sat: { at0: 0.2, per: 0.25 },
  letGo: { at0: 0.4, per: -0.3 },
};

/** The league's review: a pattern of dangerous fouls (`fouls` within `span` games) and the jolts of its rulings. */
export const REVIEW = {
  fouls: 3,
  span: 4,
  jolt: { fine: -0.4, suspension: { 1: -0.9, 2: -1.4, 4: -2.2 } as Record<number, number> },
};

/** Games for a league suspension by how many he's had in the last two league years: one, two, then four. */
export const LADDER = [1, 2, 4];

const stepOf = (clock: number) => clock % YEAR;

/** His league suspensions in the last two league years (fines, team fines and games you sat him never count). */
function priorBans(league: League, p: Player): number {
  return (p.discipline?.entries ?? []).filter((e) => e.outcome === 'suspended' && e.season >= league.season - 1).length;
}

function record(league: League, p: Player, clock: number, e: Omit<ConductEntry, 'season' | 'week' | 'teamId'>): void {
  const d = (p.discipline ??= { entries: [] });
  d.entries.push({
    season: league.season,
    week: stepOf(clock),
    ...e,
    ...(p.teamId !== null ? { teamId: p.teamId } : {}),
  });
  // Kept short: the last two league years.
  d.entries = d.entries.filter((x) => x.season >= league.season - 1);
}

/** The league's ruling on a man: a fine, or the next rung of the ladder (a first one is one game, whatever happened). */
function rule(league: League, p: Player, kind: ConductKind, clock: number, ruling: 'fine' | 'suspend'): void {
  if (ruling === 'fine') {
    record(league, p, clock, { kind, outcome: 'leagueFine', public: true });
    addJolt(p, 'fined', REVIEW.jolt.fine, clock);
    return;
  }
  const games = LADDER[Math.min(priorBans(league, p), LADDER.length - 1)];
  record(league, p, clock, { kind, outcome: 'suspended', games, public: true });
  // Two suspensions add up, and the league's ruling is the one on the record.
  p.suspension = { games: games + (p.suspension?.games ?? 0), by: 'league', reason: kind };
  addJolt(p, 'suspended', REVIEW.jolt.suspension[games], clock);
}

/**
 * After a week's games: the ejections and the dangerous fouls the box scores name. An ejection is a fine, a fight or a
 * second ejection in the league year a suspension; `REVIEW.fouls` dangerous fouls inside `REVIEW.span` games a fine,
 * then a suspension.
 */
export function reviewWeek(league: League, results: GameResult[]): void {
  const clock = moraleClock(league, true);
  for (const r of results) {
    for (const e of r.ejections ?? []) {
      const p = league.players[e.playerId];
      if (!p || p.retired || p.teamId === null) continue;
      const again = (p.discipline?.entries ?? []).some((x) => x.kind === 'ejected' && x.season === league.season);
      rule(league, p, 'ejected', clock, e.why === 'fight' || again ? 'suspend' : 'fine');
    }
    for (const f of r.personalFouls ?? []) {
      const p = league.players[f.playerId];
      if (!p || p.retired || p.teamId === null) continue;
      const d = (p.discipline ??= { entries: [] });
      const fouls = [...(d.fouls ?? []).filter((c) => clock - c < REVIEW.span), clock];
      if (fouls.length < REVIEW.fouls) {
        d.fouls = fouls;
        continue;
      }
      delete d.fouls;
      const before = d.entries.some((x) => x.kind === 'dangerousFouls' && x.season >= league.season - 1);
      rule(league, p, 'dangerousFouls', clock, before ? 'suspend' : 'fine');
    }
  }
}

const headCoachOf = (league: League, teamId: number) => teamCoaches(league, teamId).find((c) => c.role === 'headCoach');

/** What an answer does: the entry, the mood, the lean, and a game sat. */
function applyAnswer(
  league: League,
  p: Player,
  kind: ConductKind,
  answer: 'fine' | 'sat' | 'letGo',
  clock: number,
  by: 'coach' | 'you' | 'team' = 'team',
) {
  const sat = answer === 'sat';
  record(league, p, clock, {
    kind,
    outcome: answer,
    ...(sat || PUBLIC_KINDS.has(kind) ? { public: true as const } : {}),
    // Only your own head coach's answers are told back to you, as a note in his letter.
    ...(by === 'coach' && p.teamId === league.userTeamId ? { byCoach: true as const } : {}),
    // The card says "You" only for what you answered on your desk while you ran the team.
    ...(by === 'you' ? { byYou: true as const } : {}),
  });
  if (answer === 'fine') addJolt(p, 'fined', TROUBLE.jolt.fine, clock);
  if (sat) {
    // A game sat adds to one he owes, and the league's ruling stays the one on the record.
    p.suspension = { ...(p.suspension ?? { by: 'team', reason: kind }), games: 1 + (p.suspension?.games ?? 0) };
    addJolt(p, 'satDown', TROUBLE.jolt.sat, clock);
  }
  (p.discipline ??= { entries: [] }).lean = { by: TROUBLE.lean[answer], until: clock + TROUBLE.leanSteps };
}

/** The head coach's own answer, by his discipline: a strict one sits and fines, a lenient one lets it go. */
function coachAnswer(league: League, p: Player, clock: number): 'fine' | 'sat' | 'letGo' {
  const hc = p.teamId === null ? undefined : headCoachOf(league, p.teamId);
  const lean = hc ? traitLean(traitOf(hc, 'discipline')) : 0;
  const u = hashUnits(`${league.seed}:${league.season}:${clock}:troubleAnswer:${p.id}`)[0];
  const sat = TROUBLE.sat.at0 + TROUBLE.sat.per * lean;
  const letGo = TROUBLE.letGo.at0 + TROUBLE.letGo.per * lean;
  return u < sat ? 'sat' : u < sat + (1 - sat - letGo) ? 'fine' : 'letGo';
}

const inTrouble = (p: Player) => !!p.suspension || !!disputeOf(p) || onDidNotReport(p);

/**
 * Every rostered player's roll for the step, a pure function of the seed, the season, the step, his id and his
 * character (nothing drawn), tilted by his mood, his team's losing and his last answer. Team-rules trouble on your team
 * waits for your answer unless the head coach handles it; elsewhere the head coach answers at once. A fight away from
 * the stadium goes to the league.
 */
export function troubleWeek(league: League, step: 'week' | 'offseason'): void {
  const clock = moraleClock(league, step === 'week');
  const scale = step === 'week' ? 1 : TROUBLE.offseason;
  const records = step === 'week' ? computeRecords(league) : undefined;
  for (const team of league.teams) {
    const losses = Number(/^L(\d+)$/.exec(records?.get(team.id)?.streak ?? '')?.[1] ?? 0);
    // Your desk is the team you run: a row left on any other team is its head coach's to answer.
    const yours = managesTeam(league, team.id);
    if (!yours) handOver(league, team);
    const userHolds = yours && !team.conduct?.byCoach;
    for (const p of teamPlayers(league, team.id)) {
      if (p.retired || inTrouble(p)) continue;
      if (team.conduct?.pending?.some((r) => r.playerId === p.id)) continue;
      // The same step read twice (the offseason's sites) finds him already dealt with.
      if (p.discipline?.entries.some((e) => e.season === league.season && e.week === stepOf(clock))) continue;
      const u = hashUnits(`${league.seed}:${league.season}:${clock}:trouble:${p.id}`);
      const lean = p.discipline?.lean;
      const tilt =
        scale *
        Math.exp(-TROUBLE.mood * moodLean(moraleLevel(league, p, clock))) *
        (1 + TROUBLE.losing * Math.min(losses, 4)) *
        (lean && clock < lean.until ? lean.by : 1);
      const z = (v: number) => (v - TRAIT_MEAN) / 3.5;
      const odds = (t: { base: number; tilt: number }, zv: number) =>
        Math.min(0.1, t.base * Math.exp(-t.tilt * zv) * tilt);
      const temper = z(temperamentOf(p));
      const pFight = odds(TROUBLE.fight, temper);
      const pScuffle = odds(TROUBLE.scuffle, temper);
      const pCont = odds(TROUBLE.controversy, -z(p.traits.controversy));
      const pWork = odds(TROUBLE.workEthic, z(workEthicOf(p)));
      let kind: ConductKind | null = null;
      if (u[0] < pFight) kind = 'fight';
      else if (u[1] < pScuffle) kind = 'practiceScuffle';
      else if (u[2] < pCont) kind = u[2] < pCont / 2 ? 'spat' : 'teamEvent';
      else if (u[3] < pWork) kind = u[3] < pWork / 3 ? 'curfew' : u[3] < (2 * pWork) / 3 ? 'meeting' : 'late';
      if (!kind) continue;
      if (kind === 'fight') rule(league, p, 'fight', clock, 'suspend');
      else if (userHolds)
        (team.conduct ??= {}).pending = [...(team.conduct?.pending ?? []), { playerId: p.id, kind, clock }];
      else applyAnswer(league, p, kind, coachAnswer(league, p, clock), clock, 'coach');
    }
  }
}

/** Your answer to a row: only for a man still on the team you run with a row waiting. */
export function answerConduct(league: League, playerId: number, answer: 'fine' | 'sat' | 'letGo'): void {
  const team = league.teams[league.userTeamId];
  if (!team || !managesTeam(league, team.id)) return;
  const row = team.conduct?.pending?.find((r) => r.playerId === playerId);
  const p = league.players[playerId];
  if (!row || !p || p.retired || p.teamId !== team.id) return;
  closeRow(team, playerId);
  applyAnswer(league, p, row.kind, answer, league.moraleAt ?? moraleClock(league), 'you');
}

function closeRow(team: Team, playerId: number): void {
  const c = team.conduct;
  if (!c?.pending) return;
  c.pending = c.pending.filter((r) => r.playerId !== playerId);
  if (!c.pending.length) delete c.pending;
  if (!c.pending && !c.byCoach) delete team.conduct;
}

/**
 * Rows waiting on a team you don't run (you were let go, or took another job) are answered at once, as its head coach
 * would. A man gone from the team takes his row with him.
 */
function handOver(league: League, team: Team): void {
  const now = league.moraleAt ?? moraleClock(league);
  for (const row of [...(team.conduct?.pending ?? [])]) {
    const p = league.players[row.playerId];
    closeRow(team, row.playerId);
    if (p && !p.retired && p.teamId === team.id)
      applyAnswer(league, p, row.kind, coachAnswer(league, p, now), now, 'coach');
  }
  // His setting goes with the desk.
  if (team.conduct?.byCoach) {
    delete team.conduct.byCoach;
    if (!team.conduct.pending) delete team.conduct;
  }
}

/** You are leaving a team: whatever was waiting on your desk there is answered as its head coach would. */
export function leaveDesk(league: League, teamId: number): void {
  const team = league.teams[teamId];
  if (team) handOver(league, team);
}

/** A row left past the usual wait is Let it go; a man gone from the club takes his row with him. */
export function settleConduct(league: League): void {
  const now = league.moraleAt ?? moraleClock(league);
  for (const team of league.teams) {
    // A user between jobs (the league playing itself) or another team has no desk of yours.
    if (!managesTeam(league, team.id)) {
      if (team.conduct) handOver(league, team);
      continue;
    }
    for (const row of [...(team.conduct?.pending ?? [])]) {
      const p = league.players[row.playerId];
      if (!p || p.retired || p.teamId !== team.id) closeRow(team, row.playerId);
      else if (now >= row.clock + waitFor(league, p)) {
        closeRow(team, row.playerId);
        applyAnswer(league, p, row.kind, 'letGo', now);
      }
    }
  }
}

/** "Let the head coach handle discipline": he answers by his own trait, like the meetings' setting. */
export function setConductByCoach(league: League, on: boolean): void {
  const team = league.teams[league.userTeamId];
  if (!team || !managesTeam(league, team.id)) return;
  if (on) {
    // What waits now, he answers now.
    (team.conduct ??= {}).byCoach = true;
    const now = league.moraleAt ?? moraleClock(league);
    for (const row of [...(team.conduct.pending ?? [])]) {
      const p = league.players[row.playerId];
      closeRow(team, row.playerId);
      if (p && !p.retired && p.teamId === team.id)
        applyAnswer(league, p, row.kind, coachAnswer(league, p, now), now, 'coach');
    }
    team.conduct.byCoach = true;
  } else if (team.conduct) {
    delete team.conduct.byCoach;
    if (!team.conduct.pending) delete team.conduct;
  }
}

/** One thing the public knows: SNN reads these (ejections, rulings, a spat, a man a team sat). */
export interface PublicConductRow {
  playerId: number;
  teamId: number | undefined;
  season: number;
  /** Morale's step in the league year (`8 +` the game week in season). */
  week: number;
  kind: ConductKind;
  outcome: ConductEntry['outcome'];
  games?: number;
}

/** What may be reported about a league year: every public entry, newest last. */
export function publicConduct(league: League, season: number): PublicConductRow[] {
  const rows: PublicConductRow[] = [];
  for (const p of Object.values(league.players))
    for (const e of p.discipline?.entries ?? [])
      if (e.season === season && e.public)
        rows.push({
          playerId: p.id,
          teamId: e.teamId,
          season,
          week: e.week,
          kind: e.kind,
          outcome: e.outcome,
          games: e.games,
        });
  return rows.sort((a, b) => a.week - b.week || a.playerId - b.playerId);
}
