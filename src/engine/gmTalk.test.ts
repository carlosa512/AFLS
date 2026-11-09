import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { aiGm, HABITS } from './gmHabits';
import { ARCHETYPE_ACTIVITY } from './gmTraits';
import {
  HISTORY,
  MEMORY_OPENERS,
  REFUSALS,
  TABLE_LINES,
  historyNote,
  tableLine,
  type TableBand,
  OPENERS,
  SIGNOFFS,
  letterFrom,
  talkFacts,
  type Manner,
  type MemoryFact,
  type TalkFacts,
  type TalkMoment,
} from './gmTalk';
import { evaluateTrade } from './trade/judge';
import type { TradeProposal } from './trade/rules';
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

  it('keeps at least six openers in play for a neutral GM at every moment, and three for each band', () => {
    // The pool `say` draws from: the most specific lines that fit.
    const pool = (f: TalkFacts) => {
      const fits = OPENERS.filter((o) => !o.when || o.when(f));
      const top = Math.max(...fits.map((o) => o.reads ?? 0));
      return new Set(fits.filter((o) => (o.reads ?? 0) === top).map((o) => o.text(f)));
    };
    const reasons = [undefined, 'bid', 'pitch', 'dump', 'shop', 'enquiry', 'ask'] as const;
    for (const moment of MOMENTS)
      for (const reason of reasons)
        expect(pool({ ...SAMPLES[0], band: 'neutral', moment, reason, memory: undefined }).size).toBeGreaterThanOrEqual(
          6,
        );
    for (const band of BANDS.filter((x) => x !== 'neutral'))
      for (const reason of reasons)
        expect(pool({ ...SAMPLES[0], band, moment: 'week', reason, memory: undefined }).size).toBeGreaterThanOrEqual(3);
    for (const k of KINDS)
      for (const reason of reasons)
        expect(
          MEMORY_OPENERS.filter((o) =>
            o.when?.({ ...SAMPLES[0], reason, memory: { kind: k, player: 'A B', when: 'x' } }),
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
    expect(body).toMatch(/final offer|last number|my best number|another way|different|last one|try again/);
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

  it('fits the words to the kind of letter: an enquiry has no price or offer, a counter no opener', () => {
    const OFFERISH =
      /number|price|money|cap\b|final|last number|move much|meet it|offer|best shot|what I can do|better one|cleaner|different|what I have|here's mine|one for you/i;
    const TRAITS = [
      { stubbornness: 0.9, winNow: 0.5, capAggression: 0.5 },
      { stubbornness: 0.5, winNow: 0.9, capAggression: 0.5 },
      { stubbornness: 0.5, winNow: 0.5, capAggression: 0.1 },
      { stubbornness: 0.1, winNow: 0.5, capAggression: 0.5 },
    ];
    for (const t of TRAITS)
      for (const kind of KINDS)
        for (const s of [0, 1, -1]) {
          const { l, team, gm } = setup();
          team.gm = { ...team.gm, ...t };
          const man = l.players[teamPlayers(l, team.id)[0].id];
          gm.withYou =
            kind === 'finalNo' || kind === 'ledOn'
              ? [{ kind, season: l.season, phase: l.phase }]
              : [
                  {
                    kind: 'trade',
                    season: l.season,
                    phase: l.phase,
                    got: { players: [man.id], picks: [] },
                    verdict: kind,
                  },
                ];
          // Weigh his feeling either way with deals that name no man (so the memory stays the forced one).
          for (let i = 0; s && i < 4; i++)
            gm.withYou.push({
              kind: 'trade',
              season: l.season,
              phase: l.phase,
              verdict: s > 0 ? 'heWon' : 'youWon',
              big: true,
            });
          const enquiry = offerWords(l, bid(l, team, { reason: 'enquiry' })).body;
          const at = enquiry.search(/Is [A-Z]{1,3} /);
          expect(at).toBeGreaterThan(0);
          const close = enquiry.slice(enquiry.indexOf('listen.') + 'listen.'.length);
          expect(close.trim()).not.toBe('');
          expect(close).not.toMatch(OFFERISH);
          expect(enquiry.slice(0, at)).not.toMatch(OFFERISH);
          // His reply to your counter opens on its own words, with no memory and no fresh-start line to echo them.
          const counter = offerWords(l, bid(l, team, { reason: 'counter' })).body;
          expect(counter.startsWith("We've looked at your counter.")).toBe(true);
        }
  });
});

const TABLE: TableBand[] = ['accept', 'close', 'short', 'far'];
const tableAll = (band: TableBand, keep: (f: TalkFacts) => boolean = () => true) =>
  SAMPLES.filter(keep).flatMap((f) => {
    const t = { ...f, table: band };
    return TABLE_LINES.filter((x) => !x.when || x.when(t)).map((x) => x.text(t));
  });

describe('the trade table, his refusal and your director', () => {
  /** A one-for-one between the user and `team`: his best man for the user's worst, so it lands far away. */
  function deal(l: League, team: Team, give: number, get: number): TradeProposal {
    return {
      sides: [
        { teamId: l.userTeamId, players: [give], picks: [] },
        { teamId: team.id, players: [get], picks: [] },
      ],
    };
  }

  it('answers in his own words by how close the deal is', () => {
    const { l, team } = setup();
    l.market = emptyMarket();
    // Never a kicker or punter: a club can't be left without one, which is a league rule, not his answer.
    const free = (id: number) => teamPlayers(l, id).filter((p) => p.position !== 'K' && p.position !== 'P');
    const mine = free(l.userTeamId);
    const his = free(team.id);
    const texts = (b: TableBand) => TABLE_LINES.map((x) => x.text({ ...talkFacts(l, team), table: b }));
    // His best man a league rule doesn't shield (a "won't move him" is the GM's own line, not a table answer).
    const far = his
      .map((p) => evaluateTrade(l, deal(l, team, mine[mine.length - 1].id, p.id)))
      .find((v) => !v.problem && !v.accepts)!;
    expect(far.accepts).toBe(false);
    expect([...texts('far'), ...texts('short'), ...texts('close')]).toContain(far.message);
    const gift = evaluateTrade(l, deal(l, team, mine[0].id, his[his.length - 1].id));
    if (gift.accepts) expect(texts('accept')).toContain(gift.message);
  });

  it('gives each table band, his refusal and each memory kind enough lines', () => {
    for (const b of TABLE) {
      expect(new Set(tableAll(b, (f) => f.band === 'neutral' && f.moment === 'week')).size).toBeGreaterThanOrEqual(6);
      for (const band of BANDS.filter((x) => x !== 'neutral')) {
        const pool = TABLE_LINES.filter(
          (x) => (x.reads ?? 0) === 1 && x.when?.({ ...SAMPLES[0], band, moment: 'week', table: b }),
        );
        expect(new Set(pool.map((x) => x.text({ ...SAMPLES[0], table: b }))).size).toBeGreaterThanOrEqual(3);
      }
    }
    expect(new Set(all(REFUSALS, (f) => f.band === 'neutral')).size).toBeGreaterThanOrEqual(6);
    for (const band of BANDS.filter((x) => x !== 'neutral'))
      expect(new Set(all(REFUSALS, (f) => f.band === band && f.moment === 'week')).size).toBeGreaterThanOrEqual(6);
    for (const k of KINDS)
      expect(
        HISTORY.filter((h) => h.when?.({ ...SAMPLES[0], memory: { kind: k, player: 'A B', when: 'x' } })).length,
      ).toBeGreaterThanOrEqual(2);
  });

  it('says the same thing for the same deal in the same moment, whatever order its sides are listed in', () => {
    const { l, team } = setup();
    l.market = emptyMarket();
    const mine = teamPlayers(l, l.userTeamId);
    const his = teamPlayers(l, team.id);
    const p: TradeProposal = {
      sides: [
        { teamId: l.userTeamId, players: [mine[1].id, mine[0].id], picks: [] },
        { teamId: team.id, players: [his[0].id], picks: [] },
      ],
    };
    const q: TradeProposal = {
      sides: [
        { teamId: l.userTeamId, players: [mine[0].id, mine[1].id], picks: [] },
        { teamId: team.id, players: [his[0].id], picks: [] },
      ],
    };
    expect(evaluateTrade(l, p).message).toBe(evaluateTrade(l, p).message);
    for (const b of TABLE) expect(tableLine(l, team, b, p)).toBe(tableLine(l, team, b, q));
  });

  it('keeps a league rule plain', () => {
    const { l, team } = setup();
    l.market = emptyMarket();
    const mine = teamPlayers(l, l.userTeamId);
    const kicker = teamPlayers(l, team.id).find((p) => p.position === 'K')!;
    const v = evaluateTrade(l, deal(l, team, mine[mine.length - 1].id, kicker.id));
    expect(v.problem).toMatch(/without/);
    expect(v.policy).toBe(false);
    for (const b of TABLE) expect(tableAll(b)).not.toContain(v.problem);
  });

  it('never says a number, standing or trust, a habit or an archetype', () => {
    const lines = [...TABLE.flatMap((b) => tableAll(b)), ...all(REFUSALS), ...all(HISTORY, (f) => !!f.memory)];
    for (const s of lines) {
      expect(s).not.toMatch(/\d|standing|trust|!/i);
      for (const h of HABIT_LABELS) expect(s).not.toContain(h);
      for (const a of ARCHETYPE_NAMES) expect(s).not.toContain(a);
    }
  });

  it('keeps the table, the refusal and the director free of offer wording they should not echo', () => {
    for (const s of [...TABLE.flatMap((b) => tableAll(b)), ...all(REFUSALS)]) expect(s).not.toMatch(/\bnumber\b/i);
  });

  it('notes your history only when there is one', () => {
    const { l, team, gm } = setup();
    expect(historyNote(l, gm)).toBeNull();
    const man = l.players[teamPlayers(l, team.id)[0].id];
    gm.withYou = [
      { kind: 'trade', season: l.season, phase: l.phase, got: { players: [man.id], picks: [] }, verdict: 'youWon' },
    ];
    const note = historyNote(l, gm)!;
    expect(note).toContain(man.lastName);
    expect(HISTORY.map((h) => h.text(talkFacts(l, team)))).toContain(note);
  });
});
