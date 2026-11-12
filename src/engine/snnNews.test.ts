/**
 * The week's other news as edition candidates and stories: a division lead changing hands, trades and rumors (by the
 * rules that decide today's trade news), a coach or GM out, and the three items SNN files on its own today (a player
 * speaking out, a coach losing his room, a coach facing his mentor).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { playWeek } from './league';
import { divisionLeadChange } from './news';
import { computeRecords, divisionStandings } from './season/standings';
import { newsCandidates, rankCandidates, STORY_FRESH, storylineCandidates, type Candidate } from './snnWeek';
import { beat, closeStory, COACH, markTold, SNN_OUTLET, untold } from './stories';
import { joined, layoffSpan, writeStory } from './snnVoice';
import { ruleBreaks } from './storyRules';
import { reportableTrades } from './tradeNews';
import { TRADE_DEADLINE_WEEK } from './trade/rules';
import type { League } from './types';

let l: League;
const byWeek = new Map<number, Candidate[]>();
const at = () => ({ editionId: 'snn:test', said: [] as string[] });
beforeAll(() => {
  l = createLeague({ seed: 'snn-news' });
  for (let week = 1; week <= 16; week++) {
    playWeek(l);
    byWeek.set(week, newsCandidates(l, week, new Set()));
  }
}, 240_000);
const all = () => [...byWeek.values()].flat();

describe('the week’s other news', () => {
  it('reports a division lead change exactly when first place changed hands in the reader’s division, from week 10', () => {
    const division = l.teams[l.userTeamId].division;
    const leaderAfter = (week: number) => {
      const now = { ...l, games: l.games.filter((g) => g.season !== l.season || g.week <= week) };
      return divisionStandings(now, computeRecords(now))[division].teams[0].teamId;
    };
    for (let week = 2; week <= 16; week++) {
      const change = divisionLeadChange(l, week);
      if (week < 10) expect(change).toBeNull();
      else
        expect(change?.leaderId ?? null).toBe(leaderAfter(week) !== leaderAfter(week - 1) ? leaderAfter(week) : null);
      const c = byWeek.get(week)!.find((x) => x.kind === 'division');
      expect(!!c).toBe(!!change);
      if (c) expect(c).toMatchObject({ tier: 2, clubId: change!.leaderId });
    }
  });

  it('carries the trades today’s rules would report, never the reader’s own, and none after the deadline', () => {
    let seen = 0;
    for (let week = 1; week <= 16; week++) {
      const deals = reportableTrades(l, week, week);
      for (const d of deals) {
        expect(d.deal.week).toBe(week);
        expect(d.deal.sides.some((s) => s.teamId === l.userTeamId)).toBe(false);
        expect(l.players[d.playerId]).toBeDefined();
      }
      const trades = byWeek.get(week)!.filter((x) => x.kind === 'trade');
      expect(trades).toHaveLength(week <= TRADE_DEADLINE_WEEK ? deals.length : 0);
      // A star deal leads. A first-round pick changing hands is real news; the rest still rank with a good game story,
      // so a trade is not buried under every one of them.
      for (const t of trades) expect(t.tier).toBe(t.trade!.star ? 1 : t.trade!.pick?.round === 1 ? 3 : 4);
      seen += trades.length;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('does not offer what has been told already, under its own key or the old mail’s id', () => {
    for (const [week, cs] of byWeek) {
      for (const c of cs) {
        expect(newsCandidates(l, week, new Set([c.key])).some((x) => x.key === c.key)).toBe(false);
        for (const old of c.covers ?? [])
          expect(newsCandidates(l, week, new Set([old])).some((x) => x.key === c.key)).toBe(false);
      }
    }
  });

  it('writes every one of them to the rules', () => {
    const breaks = all().flatMap((c) => {
      const s = writeStory(l, c, at());
      return ruleBreaks(l, s).map((b) => `${c.kind} · ${s.headline} · ${b}`);
    });
    expect(breaks).toEqual([]);
    for (const c of all()) {
      const s = writeStory(l, c, at());
      expect(s.kind).toBe(c.kind);
      expect(s.headline.length).toBeGreaterThan(8);
      for (const t of [s.headline, s.summary, ...s.paragraphs]) expect(t).not.toMatch(/\{|\}|undefined|NaN/);
    }
  });

  it('says what the traded man has done this season, and how far off the deadline is', () => {
    const trades = all().filter((c) => c.kind === 'trade');
    const stories = trades.map((c) => writeStory(l, c, at()));
    expect(stories.some((s) => /this season\./.test(s.paragraphs[0]))).toBe(true);
    for (const s of stories) expect(s.paragraphs.join(' ')).toMatch(/deadline/);
    // Two trade stories in one edition do not both say when the deadline is.
    const one = at();
    const pair = trades.slice(0, 2).map((c) => writeStory(l, { ...c, trade: { ...c.trade!, week: 5 } }, one));
    if (pair.length === 2) expect(pair.filter((s) => /deadline/.test(s.paragraphs.join(' '))).length).toBe(1);
  });

  it('tells a second sale as one, with the first sale as its callback', () => {
    const second = all().find((c) => c.kind === 'trade' && c.angle === 'secondSale');
    if (!second) return; // not every league has a club that sells twice before the deadline
    const s = writeStory(l, second, at());
    expect(s.paragraphs.join(' ')).toMatch(/second|third|fourth/);
  });
});

describe('news built by hand, for the kinds a season may not make', () => {
  const club = () => l.teams.find((t) => t.id !== l.userTeamId)!;
  const hc = () => teamCoaches(l, club().id).find((c) => c.role === 'headCoach')!;
  const man = () => Object.values(l.players).find((p) => p.teamId === club().id && p.position === 'WR')!;
  const story = (c: Candidate) => writeStory(l, c, at());
  const base = { tier: 4 as const, stakes: 1, teams: [] as number[] };

  it('reports a head coach out with the record he leaves and who steps in, and nothing on anyone’s job', () => {
    const s = story({
      ...base,
      key: 'leaderOut:x',
      kind: 'leaderOut',
      angle: 'coachOut',
      tier: 1,
      clubId: club().id,
      leader: { teamId: club().id, role: 'headCoach', out: 'Sam Rivers', in: `${hc().firstName} ${hc().lastName}` },
    });
    expect(s.paragraphs[0]).toContain('Sam Rivers');
    expect(s.paragraphs[0]).toContain(hc().lastName);
    expect(s.paragraphs.join(' ')).not.toMatch(/hot seat|pressure|should|deserve/i);
    expect(ruleBreaks(l, s)).toEqual([]);
  });

  describe('a change at another club', () => {
    const push = (id: number, week: number, kind: 'coachInterim' | 'gmDismissed') => {
      const t = club();
      l.leadership.events.push({
        id,
        date: { season: l.season, phase: 'regular', week },
        teamId: t.id,
        kind,
        report: `${t.abbrev} dismissed Sam Rivers and named Lee Marsh interim head coach.`,
        ...(kind === 'gmDismissed' ? { gmId: t.gmId! } : {}),
      });
      return `leadership:${l.season}:${id}`;
    };
    const of = (week: number, have: string[], id: string) =>
      newsCandidates(l, week, new Set(have)).filter((c) => c.kind === 'leaderOut' && c.covers?.includes(id));
    const clear = () => (l.leadership.events = l.leadership.events.filter((e) => e.id < 9000));

    it('is still told from a week the reader skipped, once, and no longer as the week’s biggest news', () => {
      const id = push(9001, 6, 'coachInterim');
      // The week it happened it leads.
      expect(of(6, [], id).map((c) => c.tier)).toEqual([1]);
      // Six weeks on, after a long advance, it is still told, among the week's other stories.
      const late = of(12, [], id);
      expect(late.map((c) => c.tier)).toEqual([4]);
      expect(of(12, late[0].covers!, id)).toHaveLength(0);
      clear();
    });

    it('tells a head coach and a GM out at one club as two stories: the second waits for the next edition', () => {
      const coach = push(9002, 12, 'coachInterim');
      const gm = push(9003, 12, 'gmDismissed');
      const first = of(12, [], coach);
      expect(first.map((c) => c.angle)).toEqual(['coachOut']);
      // The coach's story does not use up the GM's.
      expect(first[0].covers).toEqual([coach]);
      const second = of(13, [first[0].key, coach], gm);
      expect(second.map((c) => c.angle)).toEqual(['gmOut']);
      expect(second[0].key).not.toBe(first[0].key);
      clear();
    });
  });

  it('does not print a fixture line another story of the page has already printed', () => {
    const cand: Candidate = {
      ...base,
      key: 'leaderOut:y',
      kind: 'leaderOut',
      angle: 'coordinatorOut',
      clubId: club().id,
      leader: { teamId: club().id, role: 'coordinator', out: 'Sam Rivers', side: 'offensive' },
    };
    const first = writeStory(l, cand, at());
    const fixture = first.paragraphs.at(-1)!.split('. ').at(-1)!;
    expect(fixture).toMatch(/next\.$|then /);
    // The same page, a second story that would close on the same fixture.
    const again = writeStory(l, { ...cand, key: 'leaderOut:z' }, { editionId: 'snn:test', said: [fixture] });
    expect(again.paragraphs.join(' ')).not.toContain(fixture);
    expect(again.paragraphs).toHaveLength(2);
    expect(ruleBreaks(l, again)).toEqual([]);
  });

  it('quotes a player who speaks out, and still ends on a fact', () => {
    const p = man();
    const s = story({
      ...base,
      key: `speak:${l.season}:${p.id}:benched`,
      kind: 'speak',
      angle: 'benched',
      clubId: club().id,
      speak: { playerId: p.id, teamId: club().id, kind: 'benched' },
    });
    expect(s.quote?.playerId).toBe(p.id);
    expect(s.quote?.coachId).toBeUndefined();
    expect(s.cast).toContain(p.id);
    expect(ruleBreaks(l, s)).toEqual([]);
  });

  it('reports a coach losing his room as a report, and a coach facing his mentor as a fixture', () => {
    const room = story({
      ...base,
      key: 'rumor:x',
      kind: 'room',
      angle: 'room',
      clubId: club().id,
      room: {
        teamId: club().id,
        coachId: hc().id,
        text: `There is talk around the ${club().name} that the players have stopped listening.`,
      },
    });
    expect(room.paragraphs[0]).toContain('stopped listening');
    expect(ruleBreaks(l, room)).toEqual([]);
    const other = l.teams.find((t) => t.id !== l.userTeamId && t.id !== club().id)!;
    const mentor = story({
      ...base,
      tier: 5,
      key: 'tree:meet:1:2',
      kind: 'mentor',
      angle: 'mentor',
      clubId: club().id,
      mentor: {
        mentorId: teamCoaches(l, other.id).find((c) => c.role === 'headCoach')!.id,
        discipleId: hc().id,
        homeId: other.id,
        awayId: club().id,
      },
    });
    expect(mentor.paragraphs.join(' ')).toContain(hc().lastName);
    expect(ruleBreaks(l, mentor)).toEqual([]);
  });

  it('ranks a coach out above everything a game can be', () => {
    const out: Candidate = { ...base, key: 'a', kind: 'leaderOut', angle: 'coachOut', tier: 1, clubId: 1 };
    const game: Candidate = { ...base, key: 'b', kind: 'game', angle: 'unbeatenFalls', tier: 2, stakes: 2, clubId: 2 };
    expect(rankCandidates([game, out], 'snn:x')[0].key).toBe('a');
  });
});

describe('how long a hurt star is gone', () => {
  it('says the rest of the season only when the shortest estimate runs past the final', () => {
    expect(layoffSpan(10, 14)).toBe('the rest of the season');
    expect(layoffSpan(15, 7)).toBe('the rest of the season');
    // Hurt in week 15 and out four weeks, he is back for the second round: a playoff club's season is not over.
    expect(layoffSpan(15, 4)).toBe('the rest of the regular season');
    expect(layoffSpan(14, 4)).toBe('the rest of the regular season');
  });
});

describe('a second story about the reader’s club', () => {
  it('is a brief: its news only, with the standing and the next game left to the club’s own story', () => {
    const t = l.teams.find((x) => x.id !== l.userTeamId)!;
    const cand: Candidate = {
      key: `run:${t.id}:x`,
      kind: 'run',
      angle: 'streak',
      tier: 5,
      stakes: 1,
      clubId: t.id,
      teams: [t.id],
      run: { teamId: t.id, length: 6, startWeek: 11 },
    };
    const full = writeStory(l, cand, at());
    expect(full.paragraphs.length).toBeGreaterThan(1);
    const wording = at();
    const brief = writeStory(l, cand, wording, { brief: true });
    expect(brief.brief).toBe(true);
    expect(brief.paragraphs).toEqual([full.paragraphs[0]]);
    expect(ruleBreaks(l, brief)).toEqual([]);
    // What it did not print is not held against the stories after it.
    for (const cut of full.paragraphs.slice(1)) expect(wording.said.join(' ')).not.toContain(cut);
  });
});

describe('two facts joined into one sentence', () => {
  it('lowers a leading "For" that is no longer the start of a sentence', () => {
    expect(joined('{c:3} turned it over three times.', 'For {c:4}, {M:9} had three sacks.')).toEqual([
      '{c:3} turned it over three times, and for {c:4}, {M:9} had three sacks.',
    ]);
    // Left as two sentences, it still opens one.
    expect(joined('{c:3} ran and threw.', 'For {c:4}, {M:9} had three sacks.')[1]).toMatch(/^For /);
  });
});

describe('your club’s public storylines', () => {
  const FOG = /\b(rating|overall|morale|mood|potential|trait|ceiling|unhappy|promise)\b/i;
  const clock = () => l.moraleAt ?? l.season * 32 + 20;
  const mine = (pos: string, n = 0) =>
    Object.values(l.players).filter((p) => p.teamId === l.userTeamId && p.position === pos)[n];
  const on = (playerId: number) => ({ kind: 'benched' as const, teamId: l.userTeamId, playerId });
  const told = (have: string[] = []) => storylineCandidates(l, 16, new Set(have));
  const wipe = () => (l.stories = { next: 1, open: [], closed: [] });

  it('lets the public outlet see only the beats the league could know', () => {
    wipe();
    const qb = mine('QB');
    const s = beat(l, on(qb.id), 'sat', clock(), { pub: true, other: mine('QB', 1).id })!;
    beat(l, on(qb.id), 'asked', clock());
    expect(untold(l, s, SNN_OUTLET).map((b) => b.kind)).toEqual(['sat']);
    expect(untold(l, s, COACH).map((b) => b.kind)).toEqual(['sat', 'asked']);
    // A story of talks alone gives it nothing.
    const deal = beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: mine('WR').id }, 'asked', clock())!;
    expect(untold(l, deal, SNN_OUTLET)).toEqual([]);
    // What the coach has told is his own count.
    markTold(s, COACH);
    expect(untold(l, s, SNN_OUTLET).map((b) => b.kind)).toEqual(['sat']);
  });

  it('makes a quarterback’s benching a story once, and his return another', () => {
    wipe();
    const [qb, other] = [mine('QB'), mine('QB', 1)];
    beat(l, on(qb.id), 'sat', clock(), { pub: true, other: other.id });
    beat(l, on(qb.id), 'asked', clock());
    const first = told();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'storyline', angle: 'sat', tier: 2, clubId: l.userTeamId });
    // Told: not again.
    expect(told([first[0].key])).toEqual([]);
    closeStory(l, on(qb.id), 'backIn', clock() + 2, undefined, true);
    const second = told([first[0].key]);
    expect(second.map((c) => c.angle)).toEqual(['backIn']);
    expect(second[0].key).not.toBe(first[0].key);
    // A man who is not the quarterback ranks with the week's other stories.
    wipe();
    beat(l, on(mine('WR').id), 'sat', clock(), { pub: true });
    expect(told()[0].tier).toBe(4);
  });

  it('tells only fresh news: a benching from weeks ago that no edition printed is not told late', () => {
    wipe();
    l.moraleAt = clock();
    const [qb, other] = [mine('QB'), mine('QB', 1)];
    // Last week's is still news. One from a month ago, or from last season, is not.
    beat(l, on(qb.id), 'sat', clock() - (STORY_FRESH - 1), { pub: true, other: other.id });
    expect(told().map((c) => c.angle)).toEqual(['sat']);
    wipe();
    beat(l, on(qb.id), 'sat', clock() - STORY_FRESH, { pub: true, other: other.id });
    beat(l, on(mine('WR').id), 'sat', clock() - 30, { pub: true });
    expect(told()).toEqual([]);
  });

  it('tells nothing private, and nothing to a reader between jobs', () => {
    wipe();
    beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: mine('WR').id }, 'asked', clock());
    beat(l, { kind: 'snaps', teamId: l.userTeamId, playerId: mine('RB').id }, 'dispute', clock(), { how: 'trade' });
    expect(told()).toEqual([]);
    beat(l, on(mine('QB').id), 'sat', clock(), { pub: true });
    const gm = l.gms[l.userGmId];
    const was = gm.teamId;
    gm.teamId = null;
    expect(told()).toEqual([]);
    gm.teamId = was;
  });

  it('writes each as a brief to the rules', () => {
    wipe();
    const [qb, other, wr, rb] = [mine('QB'), mine('QB', 1), mine('WR'), mine('RB')];
    const at0 = clock();
    const write = () => told().map((c) => writeStory(l, c, at(), { brief: true }));
    const check = (stories: ReturnType<typeof write>, n: number) => {
      expect(stories).toHaveLength(n);
      for (const s of stories) {
        expect(s.kind).toBe('storyline');
        expect(s.paragraphs).toHaveLength(1);
        expect(ruleBreaks(l, s), s.paragraphs.join(' ')).toEqual([]);
        expect(s.paragraphs.join(' ')).not.toMatch(FOG);
        expect(s.headline.length).toBeLessThanOrEqual(70);
      }
      return stories;
    };
    beat(l, on(qb.id), 'sat', at0, { pub: true, other: other.id });
    beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: wr.id }, 'leaked', at0, { pub: true });
    const opened = check(write(), 2);
    expect(opened.map((s) => s.paragraphs[0]).join(' ')).toContain(`${qb.firstName} ${qb.lastName}`);
    expect(opened.find((s) => s.angle === 'leaked')!.paragraphs[0]).toContain('according to reports');
    // How much he had played is said more than one way: a man who started them all is not "16 of 16".
    const everyGame = opened.map((s) => s.paragraphs[0]).filter((p) => /\b(\d+|\w+) of [^.]*\b\1 games\b/.test(p));
    expect(everyGame).toEqual([]);
    // Closings.
    wipe();
    beat(l, on(qb.id), 'sat', at0, { pub: true, other: other.id });
    closeStory(l, on(qb.id), 'settled', at0 + 3, 'chart', true);
    beat(l, on(rb.id), 'sat', at0, { pub: true });
    closeStory(l, on(rb.id), 'backIn', at0 + 2, undefined, true);
    beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: wr.id }, 'leaked', at0, { pub: true });
    beat(l, { kind: 'deal', teamId: l.userTeamId, playerId: wr.id }, 'disputeEnd', at0 + 4, {
      how: 'withdrawn',
      pub: true,
    });
    check(write(), 3);
    wipe();
  });
});
