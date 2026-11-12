/**
 * A game's story from the box score, a pure function of the result. It lives apart from `inbox.ts` so the cast sheet
 * and the coach's weekly letters can read it without importing the inbox (which imports them): keep it a leaf.
 */
import type { GameResult, TeamGameStats } from './types';

/** "seven" up to nine, digits past that: how a coach says a number mid-sentence. */
const small = (n: number) =>
  (['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] ?? String(n)).toLowerCase();
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
    takeaway = `We controlled it from start to finish, with ${ours.totalYds} yards to ${theirs.totalYds}${ours.top >= 33 * 60 ? ` and ${clock(ours.top)} of possession` : ''}.`;
  else if (margin >= 21 && lost && ledThroughout(themQ, usQ) && yds <= 0)
    takeaway = `They controlled it from start to finish, with ${theirs.totalYds} yards to ${ours.totalYds}.`;
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
    takeaway = `The defense shut them down after halftime, with ${them2 === 0 ? 'nothing' : `${small(them2)} points`} allowed after the break.`;
  else if (margin <= 3 && !r.overtime && Math.abs(sum(usQ, 0, 3) - sum(themQ, 0, 3)) <= 8)
    takeaway = 'It was a one-score game all through the fourth quarter.';
  else if (r.overtime) takeaway = 'Neither side could put it away in regulation.';
  else takeaway = yards;
  return { swing, takeaway };
}
