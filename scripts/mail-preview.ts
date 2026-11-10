/**
 * Saves at each moment the digest letters file, for screenshots (`npm run screens -- --mail …`) and review.
 *
 *   npm run mail-preview -- --save <save.json> --out <dir>
 *
 * Loads and migrates the save as the app would, then steps the calendar the way the app's Continue button does
 * (`playWeek` in season, `beginOffseason` and `advanceOffseason` between, the AI making your offseason calls, a GM
 * out of a job taking the first offer), filing
 * mail after every step as `store.mutate` does. Writes a save the first time each moment comes round:
 * `deadline.json` (trade deadline week), `late.json` (week 15), `end.json` (the re-sign window), `camp.json` (training camp),
 * `wire.json` (cut-down day, the wire full), `cutdown.json` (the next season's first week, after cut-down day), and the
 * head coach's weekly letter: `room.json` (the first step it has a "The rooms" row) and `result.json` (the first
 * with a "Since last week" row telling a meeting's result).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { employed } from '../src/engine/employment';
import { deliverMail } from '../src/engine/inbox';
import { acceptGmOffer, pendingGmOffers } from '../src/engine/leadership';
import { playWeek } from '../src/engine/league';
import { answerMeeting } from '../src/engine/meetings';
import { migrateLeague } from '../src/engine/migrate';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { TRADE_DEADLINE_WEEK } from '../src/engine/trade/rules';
import type { League } from '../src/engine/types';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const savePath = option('save');
const outOption = option('out');
if (!savePath || !outOption) {
  console.error('Usage: npm run mail-preview -- --save <save.json> --out <dir>');
  process.exit(2);
}
const out = resolve(outOption);
mkdirSync(out, { recursive: true });

const league = migrateLeague(JSON.parse(readFileSync(resolve(savePath), 'utf8')) as League);
if (!league) {
  console.error('That save is from a newer version of the game.');
  process.exit(2);
}
deliverMail(league);
const startSeason = league.season;

/** One press of Continue. */
function step(l: League): void {
  // The head coach's meeting request is answered as a GM who goes along (his first approach, the firmest backing, the
  // first timing), so the next letter has a result to tell.
  const pending = l.teams[l.userTeamId].meetings?.pending;
  if (pending && pending.kind !== 'gm')
    answerMeeting(l, {
      approach: pending.approaches[0],
      backing: pending.backings[pending.backings.length - 1],
      timing: pending.timings[0],
    });
  // A GM out of a job takes the first offer (his own club's extension when there is one): the preview needs a desk.
  if (l.phase === 'resign' && pendingGmOffers(l)) {
    const offers = l.leadership.search!.offers;
    acceptGmOffer(l, (offers.find((o) => o.teamId === l.userTeamId) ?? offers[0]).teamId);
    deliverMail(l);
    return;
  }
  if (l.phase === 'regular' || l.phase === 'playoffs') playWeek(l);
  else if (l.phase === 'complete') beginOffseason(l);
  else advanceOffseason(l, { autoUser: true });
  deliverMail(l);
}

/** The newest head coach's letter has a section with this title. */
const coachLetterHas = (l: League, title: string) => {
  const m = [...(l.inbox ?? [])].reverse().find((x) => x.id.startsWith('coach:'));
  return !!m?.sections?.some((sec) => sec.title === title);
};

const moments: [string, (l: League) => boolean][] = [
  ['deadline', (l) => l.phase === 'regular' && l.week >= TRADE_DEADLINE_WEEK && l.season === startSeason],
  // The stretch run: a few weeks of the staff's notes behind it.
  ['late', (l) => l.phase === 'regular' && l.week >= 15 && l.season === startSeason],
  ['end', (l) => l.phase === 'resign' && employed(l)],
  ['camp', (l) => l.phase === 'preseason'],
  // Cut-down day: the wire is full of other clubs' releases.
  ['wire', (l) => l.phase === 'preseason' && (l.personnel?.waivers?.pending.length ?? 0) > 0],
  ['cutdown', (l) => l.phase === 'regular' && l.season > startSeason],
  // The head coach's weekly letter: one with a rooms row, one telling last step's meeting.
  ['room', (l) => coachLetterHas(l, 'The rooms')],
  ['result', (l) => coachLetterHas(l, 'Since last week')],
];
const done = new Set<string>();
for (let i = 0; i < 400 && done.size < moments.length; i++) {
  for (const [name, at] of moments)
    if (!done.has(name) && at(league)) {
      done.add(name);
      writeFileSync(join(out, `${name}.json`), JSON.stringify(league));
      console.log(`${name}.json  ${league.season} ${league.phase}, week ${league.week}`);
    }
  if (!employed(league) && !pendingGmOffers(league) && league.phase !== 'complete') {
    console.log('The GM lost his job: stopping here.');
    break;
  }
  step(league);
}
