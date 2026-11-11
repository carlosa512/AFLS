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
import { newsCandidates, rankCandidates, type Candidate } from './snnWeek';
import { writeStory } from './snnVoice';
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
