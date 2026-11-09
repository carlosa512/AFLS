/**
 * A read-through of what AI general managers write and say, for the owner to judge the words (a preview, not a check).
 *
 *   npm run gm-letters
 *
 * Builds a league, picks seven AI GMs across the manners, plants moments with your GM (`withYou`) so they stand at each
 * band and carry each kind of memory, then writes each one's offers (a pitch, a bid, a counter, a final counter, an
 * enquiry), a trade-table line per band, his refusal and your director's note to `.check/gm-letters.md`. The heading
 * names the manner and band; the letters never do, and the file is scanned for digits outside the offer and for the
 * words "standing" and "trust".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLeague } from '../src/engine/generate';
import { aiGm } from '../src/engine/gmHabits';
import { standingBand, standingWith, type StandingBand } from '../src/engine/gmMemory';
import { historyNote, refusalLine, talkFacts, tableLine, type Manner, type TableBand } from '../src/engine/gmTalk';
import { offerWords } from '../src/engine/inbox';
import { playerOvr } from '../src/engine/positions';
import { teamPlayers } from '../src/engine/roster';
import type { League, Team, TradeOffer, YouMoment } from '../src/engine/types';

const league: League = createLeague({ seed: 'gm-letters' });
const user = league.teams[league.userTeamId];
const season = league.season;
const moment = (m: Partial<YouMoment> & Pick<YouMoment, 'kind'>): YouMoment => ({
  season,
  phase: 'regular',
  ...m,
});

/** The best-rated few of a club: real men to name in a memory and an offer. */
const bestOf = (t: Team) =>
  teamPlayers(league, t.id)
    .filter((p) => !p.retired)
    .sort((a, b) => playerOvr(b) - playerOvr(a) || a.id - b.id);
const pickOf = (teamId: number, i: number) => league.draftPicks.filter((p) => p.ownerId === teamId && !p.playerId)[i];

// One GM per manner first, then the rest in team order.
const AI = league.teams.filter((t) => t.id !== league.userTeamId && aiGm(league, t));
const picked: Team[] = [];
for (const manner of ['firm', 'urgent', 'careful', 'easy', 'plain'] as Manner[]) {
  const t = AI.find((x) => !picked.includes(x) && talkFacts(league, x).manner === manner);
  if (t) picked.push(t);
}
for (const t of AI) if (picked.length < 7 && !picked.includes(t)) picked.push(t);

interface Plan {
  band: StandingBand;
  plant: (t: Team) => YouMoment[];
}
/** A trade with a real man on each side, already judged (a verdict is what a GM remembers). */
const trade = (t: Team, verdict: YouMoment['verdict'], big = false): YouMoment =>
  moment({
    kind: 'trade',
    verdict,
    big,
    got: { players: [bestOf(user)[0].id], picks: [] },
    gave: { players: [bestOf(t)[0].id], picks: [] },
  });
const PLANS: Plan[] = [
  { band: 'warm', plant: (t) => [trade(t, 'heWon', true)] },
  { band: 'warm', plant: (t) => [trade(t, 'both', true)] },
  { band: 'neutral', plant: () => [] },
  { band: 'neutral', plant: () => [moment({ kind: 'ledOn' })] },
  { band: 'cool', plant: (t) => [trade(t, 'brokeDown', true)] },
  { band: 'sour', plant: (t) => [trade(t, 'youWon', true)] },
  {
    band: 'sour',
    plant: () => [moment({ kind: 'finalNo' }), moment({ kind: 'finalNo' }), moment({ kind: 'finalNo' })],
  },
];

let n = 0;
const offer = (t: Team, reason: TradeOffer['reason'], extra: Partial<TradeOffer> = {}): TradeOffer => {
  const his = bestOf(t);
  const yours = bestOf(user);
  const i = n++ % 3;
  const enq = reason === 'enquiry';
  return {
    id: 9000 + n,
    teamId: t.id,
    sides: [
      {
        teamId: t.id,
        players: reason === 'pitch' ? [his[i + 1].id] : [],
        picks: reason === 'pitch' ? [] : [pickOf(t.id, i)?.id],
      },
      { teamId: user.id, players: [yours[i + 1].id], picks: enq || reason === 'pitch' ? [] : [pickOf(user.id, i)?.id] },
    ].map((s) => ({ ...s, picks: s.picks.filter((x) => x !== undefined) })) as TradeOffer['sides'],
    kind: 'buy',
    reason,
    season,
    phase: 'regular',
    week: 5,
    moment: 1,
    status: 'pending',
    patience: 1,
    worth: 0,
    ...extra,
  };
};

const lines: string[] = [
  '# AI general managers: read-through',
  '',
  'Seven GMs, each at the band in the heading. Letters are exactly as the game files them.',
  '',
];
let count = 0;
const letters: string[] = [];
picked.slice(0, 7).forEach((t, k) => {
  const plan = PLANS[k];
  const gm = aiGm(league, t)!;
  gm.withYou = plan.plant(t);
  const band = standingBand(standingWith(league, gm));
  if (band !== plan.band) throw new Error(`${gm.firstName} ${gm.lastName} landed ${band}, wanted ${plan.band}`);
  const f = talkFacts(league, t);
  lines.push(`## ${gm.firstName} ${gm.lastName}, ${t.name} (${f.manner}, ${band})`, '');
  const items: [string, string][] = [
    ['Pitch', offerWords(league, offer(t, 'pitch')).body],
    ['Bid', offerWords(league, offer(t, 'bid')).body],
    ['Enquiry', offerWords(league, offer(t, 'enquiry')).body],
    ['Counter', offerWords(league, offer(t, 'counter', { replyTo: 1 })).body],
    ['Final counter', offerWords(league, offer(t, 'counter', { replyTo: 1, final: true, patience: 0 })).body],
  ];
  const proposal = { sides: offer(t, 'bid').sides };
  for (const b of ['accept', 'close', 'short', 'far'] as TableBand[])
    items.push([`Table, ${b}`, tableLine(league, t, b, proposal)]);
  items.push(['Refusal', refusalLine(league, t)]);
  items.push(["Director's note", historyNote(league, gm) ?? '(nothing he would have seen)']);
  for (const [label, text] of items) {
    lines.push(`**${label}.** ${text}`, '');
    letters.push(`${gm.firstName} ${gm.lastName} / ${label}: ${text}`);
    count++;
  }
});

mkdirSync('.check', { recursive: true });
const path = '.check/gm-letters.md';
writeFileSync(path, lines.join('\n'));
console.log(`${count} letters and lines for ${Math.min(7, picked.length)} GMs → ${path}`);

// The fog rule: the letters never say it. Digits belong to the offer (a pick's slot), so only list them to read.
const banned = letters.filter((l) => /standing|trust/i.test(l.split(': ').slice(1).join(': ')));
const digits = letters.filter((l) => /\d/.test(l.split(': ').slice(1).join(': ')));
if (banned.length) console.log(`✗ ${banned.length} lines say "standing" or "trust":\n${banned.join('\n')}`);
if (digits.length) console.log(`digits in ${digits.length} lines (check they are the offer's):\n${digits.join('\n')}`);
