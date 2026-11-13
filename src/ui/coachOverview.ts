import { coachTitle } from '../engine/coaching';
import { coachCharacter } from '../engine/coachTraits';
import { coachRecord, formatRecord, type CoachCareerSeason } from '../engine/records';
import type { Coach, League } from '../engine/types';

/**
 * A coach in two to four plain sentences, the way someone who follows the league would say it: where he coaches and
 * since when, the job before that, his record as a head coach, and what he is known for. Read only from what the card
 * already shows (his career, his public reputation), so the fog of war holds. docs/UI.md, "Words on a screen".
 */
export function coachOverview(league: League, c: Coach): string[] {
  const out: string[] = [];
  const stints = stintsOf(coachRecord(league, c).seasons);
  const teamName = (id: number) => `the ${league.teams[id].city} ${league.teams[id].name}`;
  const job = (s: Stint) => coachTitle({ role: s.role, room: s.room }).toLowerCase();
  const years = (s: Stint) => (s.from === s.to ? `in ${s.from}` : `from ${s.from} to ${s.to}`);
  const current = stints.at(-1);
  const holdsIt = current && c.teamId === current.teamId && league.coaches[c.id];

  if (holdsIt) {
    const before = stints.at(-2);
    // Promoted on the same team: his job dates from the promotion, not from the year he joined.
    const promoted = before?.teamId === current.teamId;
    const since = promoted ? current.from : (c.since ?? current.from);
    out.push(`${c.lastName} has been ${job(current)} of ${teamName(current.teamId)} since ${since}.`);
    if (before)
      out.push(
        `Before that he was ${job(before)} ${promoted ? 'there' : `of ${teamName(before.teamId)}`} ${
          // Promoted during a season: the old job ran until that year's promotion.
          promoted && before.to === current.from && before.from < before.to
            ? `from ${before.from} until his promotion in ${before.to}`
            : years(before)
        }.`,
      );
  } else if (current) {
    out.push(`${c.lastName} was ${job(current)} of ${teamName(current.teamId)} ${years(current)}.`);
  } else if (c.teamId !== null && league.coaches[c.id]) {
    out.push(`${c.lastName} is in his first season as ${coachTitle(c).toLowerCase()} of ${teamName(c.teamId)}.`);
  }

  const head = coachRecord(league, c, ['headCoach']);
  if (head.seasons.length) {
    const trips = head.playoffTrips;
    const titles = head.titles;
    out.push(
      `As a head coach he is ${formatRecord(head.regular)}` +
        (titles ? ` with ${count(titles, 'title')}.` : trips ? ` with ${count(trips, 'playoff trip')}.` : '.'),
    );
  }

  const { name, lines } = coachCharacter(c);
  const article = /^[AEIOU]/.test(name) ? 'an' : 'a';
  const meaning = name === 'Climber' && c.role === 'headCoach' ? climbingHeadCoach(league, c) : MEANING[name];
  if (meaning) out.push(`Around the league he is known as ${article} ${name.toLowerCase()}, ${meaning}.`);
  else {
    // A label with no meaning written here yet: the label, then his reputation's own line.
    out.push(`Around the league he is known as ${article} ${name.toLowerCase()}.`);
    if (lines[0] && !/:/.test(lines[0])) out.push(aboutHim(lines[0]));
  }
  return out.slice(0, 4);
}

interface Stint {
  teamId: number;
  role: CoachCareerSeason['role'];
  room?: CoachCareerSeason['room'];
  from: number;
  to: number;
}

/** His seasons joined into jobs, oldest first: the same team and the same job in a row are one stint. */
function stintsOf(seasons: CoachCareerSeason[]): Stint[] {
  const out: Stint[] = [];
  for (const s of [...seasons].sort((a, b) => a.season - b.season)) {
    const last = out.at(-1);
    if (last && last.teamId === s.teamId && last.role === s.role && last.room === s.room) last.to = s.season;
    else out.push({ teamId: s.teamId, role: s.role, room: s.room, from: s.season, to: s.season });
  }
  return out;
}

/** What each reputation means, said plainly after its label so a reader never has to guess what "a climber" is. */
const MEANING: Record<string, string> = {
  Climber: 'a coach who wants to run his own team',
  Lifer: 'a coach who is happy where he is and does not chase the next job',
  'Loyal Lieutenant': 'a coach who follows his old boss when he calls and stays where he is wanted',
  'Hired Gun': 'a coach who goes wherever the best job is',
  Chameleon: 'a coordinator who runs whatever his head coach asks for',
  'True Believer': 'a coordinator who runs his own system wherever he goes',
  Disciplinarian: 'a coach whose teams draw few flags and keep a quiet locker room',
  'Player’s Coach': 'a coach his players love, though his teams draw more flags',
  'Steady Hand': 'with nothing extreme about him',
};

/**
 * A head coach already runs his own team, so his climbing is toward a bigger job, and a big market (the game's own
 * line for one: `staffBudgetMult` 1.08 or more, as the owner's leeway reads it) is already one of the biggest.
 */
function climbingHeadCoach(league: League, c: Coach): string {
  if (c.teamId === null) return 'a head coach who wants a bigger job than his last one';
  return league.teams[c.teamId].staffBudgetMult >= 1.08
    ? 'a head coach who already has one of the league’s biggest jobs and still wants more'
    : 'a head coach who is always looking for a bigger job';
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const count = (n: number, noun: string) => `${NUMBERS[n] ?? n} ${noun}${n === 1 ? '' : 's'}`;

/** A reputation line as a sentence about him: "Runs a tight ship…" becomes "He runs a tight ship…". */
function aboutHim(line: string): string {
  return /^(He|His|If)\b/.test(line) ? line : `He ${line[0].toLowerCase()}${line.slice(1)}`;
}
