import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { aiGm, HABITS } from './gmHabits';
import { ARCHETYPE_ACTIVITY } from './gmTraits';
import {
  MEMORY_OPENERS,
  OPENERS,
  SIGNOFFS,
  letterFrom,
  talkFacts,
  type Manner,
  type MemoryFact,
  type TalkFacts,
  type TalkMoment,
} from './gmTalk';
import { deliverMail, offerWords, packageWords } from './inbox';
import { noteMoment } from './gmMemory';
import { teamPlayers } from './roster';
import { emptyMarket } from './trade/execute';
import type { StandingBand } from './gmMemory';
import type { League, Team, TradeOffer } from './types';
import type { Line } from './voice';

const MANNERS: Manner[] = ['firm', 'urgent', 'careful', 'easy', 'plain'];
const BANDS: StandingBand[] = ['warm', 'easy', 'neutral', 'cool', 'sour'];
const MOMENTS: TalkMoment[] = ['deadline', 'week', 'leagueYear', 'freeAgency', 'camp', 'draft', 'offseason'];
const KINDS: MemoryFact['kind'][] = ['heWon', 'both', 'youWon', 'brokeDown', 'finalNo', 'ledOn'];
const HABIT_LABELS = Object.values(HABITS).map((h) => h.label);
const ARCHETYPE_NAMES = Object.keys(ARCHETYPE_ACTIVITY);

function setup() {
  const l = createLeague({ seed: 'gm-talk' });
  const team = l.teams.find((t) => t.id !== l.userTeamId)!;
  return { l, team, gm: aiGm(l, team)! };
}

const { l: base, team: baseTeam } = setup();
const SAMPLES: TalkFacts[] = [];
for (const manner of MANNERS)
  for (const band of BANDS)
    for (const moment of MOMENTS)
      for (const final of [false, true])
        for (const kind of [undefined, ...KINDS])
          SAMPLES.push({
            team: baseTeam,
            gm: aiGm(base, baseTeam),
            manner,
            band,
            moment,
            final,
            memory: kind && { kind, player: 'Marcus Jefferson', when: 'last year' },
            p: { he: 'he', He: 'He', him: 'him', his: 'his', His: 'His' },
          });
const all = (bank: readonly Line<TalkFacts>[], keep: (f: TalkFacts) => boolean = () => true) =>
  SAMPLES.filter(keep).flatMap((f) => bank.filter((x) => !x.when || x.when(f)).map((x) => x.text(f)));

const ids = (l: League) => l.market!.offers.map((o) => o.id);
/** A bid on the user's first player from `team`, filed on the market. */
function bid(l: League, team: Team, over: Partial<TradeOffer> = {}): TradeOffer {
  const market = (l.market ??= emptyMarket());
  const mine = teamPlayers(l, l.userTeamId)[0];
  const pick = l.draftPicks.find((p) => p.ownerId === team.id && !p.overall)!;
  const offer: TradeOffer = {
    id: market.nextOfferId++,
    teamId: team.id,
    sides: [
      { teamId: team.id, players: [], picks: [pick.id] },
      { teamId: l.userTeamId, players: [mine.id], picks: [] },
    ],
    kind: 'sale',
    reason: 'bid',
    season: l.season,
    phase: l.phase,
    week: l.week,
    moment: market.moment,
    status: 'pending',
    patience: 2,
    worth: 0,
    ...over,
  };
  market.offers.push(offer);
  return offer;
}

describe('the banks', () => {
  it('gives each common slot at least six lines', () => {
    const neutral = all(OPENERS, (f) => f.band === 'neutral' && f.moment === 'week');
    expect(new Set(neutral).size).toBeGreaterThanOrEqual(6);
    for (const m of MANNERS) {
      const lines = all(SIGNOFFS, (f) => f.manner === m && !f.final);
      expect(new Set(lines).size).toBeGreaterThanOrEqual(6);
    }
  });

  it('has openers for every band and the deadline and the draft, and memory lines for every kind', () => {
    for (const b of BANDS.filter((x) => x !== 'neutral'))
      expect(
        OPENERS.filter((o) => o.reads === 1 && o.when?.({ ...SAMPLES[0], band: b, moment: 'week' })).length,
      ).toBeGreaterThanOrEqual(3);
    for (const m of ['deadline', 'draft'] as const)
      expect(
        OPENERS.filter((o) => o.reads === 1 && o.when?.({ ...SAMPLES[0], moment: m, band: 'neutral' })).length,
      ).toBeGreaterThanOrEqual(2);
    for (const k of KINDS)
      expect(
        MEMORY_OPENERS.filter(
          (o) => o.reads === 2 && o.when?.({ ...SAMPLES[0], memory: { kind: k, player: 'A B', when: 'x' } }),
        ).length,
      ).toBeGreaterThanOrEqual(2);
    expect(new Set(all(SIGNOFFS, (f) => f.final)).size).toBeGreaterThanOrEqual(3);
  });

  it('never says a number, a habit, an archetype, standing or trust', () => {
    for (const s of [...all(OPENERS), ...all(MEMORY_OPENERS), ...all(SIGNOFFS)]) {
      expect(s).not.toMatch(/\d|standing|trust|!/i);
      for (const h of HABIT_LABELS) expect(s).not.toContain(h);
      for (const a of ARCHETYPE_NAMES) expect(s).not.toContain(a);
    }
  });
});

describe('a letter', () => {
  it('keeps the offer exact', () => {
    const { l, team } = setup();
    const o = bid(l, team);
    const man = teamPlayers(l, l.userTeamId)[0];
    const his = packageWords(l, o.sides[0], { projected: false });
    expect(offerWords(l, o).body).toContain(
      `We'd like to bring ${man.position} ${man.firstName} ${man.lastName} to ${team.city}. ${his[0].toUpperCase()}${his.slice(1)}, if you're open to it.`,
    );
  });

  it('does not repeat an opener inside his last five letters', () => {
    const { l, team } = setup();
    const from = letterFrom(l, team);
    const openers: string[] = [];
    for (let i = 0; i < 6; i++) {
      const o = bid(l, team);
      deliverMail(l);
      const m = l.inbox!.find((x) => x.id.startsWith(`offer:${o.season}:${o.id}`))!;
      expect(m.from).toBe(from);
      openers.push(m.body.split(" We'd like")[0]);
    }
    for (let i = 0; i + 5 <= openers.length; i++) expect(new Set(openers.slice(i, i + 5)).size).toBe(5);
  });

  it('reads the same filed as it does live', () => {
    const { l, team } = setup();
    const o = bid(l, team);
    const live = offerWords(l, o);
    deliverMail(l);
    expect(l.inbox!.find((x) => x.id.startsWith(`offer:${o.season}:${o.id}`))!.body).toBe(live.body);
    expect(offerWords(l, o)).toEqual(live);
  });

  it('names a memory only when there is one, and not in back-to-back letters', () => {
    const { l, team, gm } = setup();
    const quiet = offerWords(l, bid(l, team)).body;
    const name = l.players[teamPlayers(l, team.id)[0].id];
    expect(talkFacts(l, team).memory).toBeUndefined();
    expect(quiet).not.toContain(name.lastName + ' deal');
    gm.withYou = [
      { kind: 'trade', season: l.season, phase: l.phase, got: { players: [name.id], picks: [] }, verdict: 'heWon' },
    ];
    expect(talkFacts(l, team).memory).toMatchObject({ kind: 'heWon', player: `${name.firstName} ${name.lastName}` });
    const o1 = bid(l, team);
    deliverMail(l);
    const first = l.inbox!.find((x) => x.id.startsWith(`offer:${o1.season}:${o1.id}`))!.body;
    expect(first).toContain(name.lastName);
    const o2 = bid(l, team);
    deliverMail(l);
    const second = l.inbox!.find((x) => x.id.startsWith(`offer:${o2.season}:${o2.id}`))!.body;
    expect(MEMORY_OPENERS.some((m) => second.includes(m.text(talkFacts(l, team))))).toBe(false);
  });

  it('remembers a final no without naming a man', () => {
    const { l, team, gm } = setup();
    noteMoment(l, gm, { kind: 'finalNo' });
    expect(talkFacts(l, team).memory).toMatchObject({ kind: 'finalNo', player: '' });
    const body = offerWords(l, bid(l, team)).body;
    expect(body).toMatch(/final offer|last number|my best number|another way|different/);
  });

  it('signs as the GM by name with his face, or the front office when the chair is empty', () => {
    const { l, team, gm } = setup();
    const o = bid(l, team);
    deliverMail(l);
    const m = l.inbox!.find((x) => x.id.startsWith(`offer:${o.season}:${o.id}`))!;
    expect(m.from).toBe(`${gm.firstName} ${gm.lastName}, ${team.name} GM`);
    expect(m.gmNotes).toEqual([{ gmId: gm.id, line: '' }]);
    team.gmId = null;
    const o2 = bid(l, team);
    deliverMail(l);
    const m2 = l.inbox!.find((x) => x.id.startsWith(`offer:${o2.season}:${o2.id}`))!;
    expect(m2.from.endsWith('front office')).toBe(true);
    expect(m2.gmNotes).toBeUndefined();
    expect(m2.body).toContain("We'd like to bring");
    expect(ids(l).length).toBeGreaterThan(1);
  });

  it('says it is his final offer in his own words', () => {
    const { l, team } = setup();
    const body = offerWords(l, bid(l, team, { final: true })).body;
    expect(body).not.toContain('That is our final offer.');
    const finals = new Set(all(SIGNOFFS, (f) => f.final));
    expect([...finals].some((s) => body.endsWith(s))).toBe(true);
  });

  it('fits the words to the kind of letter: an enquiry has no price or money in its close, a counter no memory', () => {
    const MONEY = /number|price|money|cap\b|final|last|move much|meet it/i;
    const TRAITS = [
      { stubbornness: 0.9, winNow: 0.5, capAggression: 0.5 },
      { stubbornness: 0.5, winNow: 0.9, capAggression: 0.5 },
      { stubbornness: 0.5, winNow: 0.5, capAggression: 0.1 },
      { stubbornness: 0.1, winNow: 0.5, capAggression: 0.5 },
    ];
    for (const t of TRAITS) {
      const { l, team, gm } = setup();
      team.gm = { ...team.gm, ...t };
      const man = l.players[teamPlayers(l, team.id)[0].id];
      gm.withYou = [
        { kind: 'trade', season: l.season, phase: l.phase, got: { players: [man.id], picks: [] }, verdict: 'heWon' },
      ];
      const enquiry = offerWords(l, bid(l, team, { reason: 'enquiry' })).body;
      const core = enquiry.indexOf('Is ');
      expect(enquiry.slice(core + 'Is '.length)).toContain('available?');
      const close = enquiry.slice(enquiry.indexOf('listen.') + 'listen.'.length);
      expect(close.trim()).not.toBe('');
      expect(close).not.toMatch(MONEY);
      const counter = offerWords(l, bid(l, team, { reason: 'counter' })).body;
      for (const m of MEMORY_OPENERS) expect(counter).not.toContain(m.text(talkFacts(l, team, { reason: 'counter' })));
      for (const o of [
        'Got something',
        'Been going through',
        'Have a minute',
        'Straight to it',
        'Wanted to get this',
        'phone tag',
        'working through my list',
      ])
        expect(counter).not.toContain(o);
      expect(counter).toMatch(/^(I've gone back|Here's where|I took a hard|Thanks for the counter)/);
    }
  });
});
