import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { playWeek } from './league';
import { teamPlayers } from './roster';
import { conductCandidates, freshGood, goodSideWeek } from './snnConduct';
import { letterBreaks } from './letterRules';
import { LEDES } from './snnConductVoice';
import { sentencesOf } from './voice';
import { cutEdition, rankCandidates, buildEdition, type Candidate } from './snnWeek';
import { writeStory } from './snnVoice';
import { ruleBreaks } from './storyRules';
import { dayCandidates } from './snnDays';
import { writeDayStory } from './snnDayVoice';
import { YEAR } from './morale';
import type { ConductEntry, EditionStory, League, Player } from './types';

let l: League;
const WEEK = 2;
/** The morale step a game week's trouble is filed under. */
const step = (week: number) => 8 + week;

/** A man of a team with his trouble on file, in the week just played. */
function troubled(i: number, entry: Omit<ConductEntry, 'season' | 'week'>, week = WEEK, team = (i % 31) + 1): Player {
  const p = teamPlayers(l, team).filter((x) => !x.retired)[i];
  const d = (p.discipline ??= { entries: [] });
  d.entries.push({ season: l.season, week: step(week), teamId: team, ...entry });
  return p;
}

beforeAll(() => {
  l = createLeague({ seed: 'snn-conduct' });
  for (let i = 0; i < WEEK; i++) playWeek(l);
}, 120_000);

const story = (c: Candidate) => writeStory(l, c, { editionId: `snn:${l.season}:w${WEEK}`, said: [] });
const all = () => conductCandidates(l, WEEK, new Set());

describe('trouble as candidates', () => {
  it('tells a league suspension, a league fine, a public spat and a team sitting a man', () => {
    const ban = troubled(0, { kind: 'fight', outcome: 'suspended', games: 1, public: true }, WEEK, 3);
    const fine = troubled(1, { kind: 'dangerousFouls', outcome: 'leagueFine', public: true }, WEEK, 4);
    const spat = troubled(2, { kind: 'spat', outcome: 'letGo', public: true }, WEEK, 5);
    const sat = troubled(3, { kind: 'curfew', outcome: 'sat', public: true }, WEEK, 6);
    const private1 = troubled(4, { kind: 'meeting', outcome: 'fine' }, WEEK, 7);
    const cs = all();
    const by = (p: Player) => cs.find((c) => c.conduct?.playerId === p.id);
    expect(by(ban)?.angle).toBe('banFight');
    expect(by(fine)?.angle).toBe('fine');
    expect(by(spat)?.angle).toBe('spat');
    expect(by(sat)?.angle).toBe('sat');
    expect(by(private1)).toBeUndefined();
    for (const c of cs) expect(c.kind).toBe('conduct');
  });

  it('reports a team sitting a man as a violation of team rules, and names no incident', () => {
    const p = troubled(5, { kind: 'curfew', outcome: 'sat', public: true }, WEEK, 8);
    const c = all().find((x) => x.conduct?.playerId === p.id)!;
    const s = story(c);
    expect(s.paragraphs.join(' ')).toMatch(/violation of team rules/);
    expect(s.paragraphs.join(' ')).not.toMatch(/curfew/i);
  });

  it('tells an ejection by why it happened, from the game', () => {
    const g = l.games.find((x) => x.season === l.season && x.week === WEEK && x.result)!;
    const p = teamPlayers(l, g.homeId).filter((x) => !x.retired)[6];
    g.result!.ejections = [{ playerId: p.id, teamId: g.homeId, quarter: 3, clock: 400, why: 'fight' }];
    (p.discipline ??= { entries: [] }).entries.push({
      season: l.season,
      week: step(WEEK),
      teamId: g.homeId,
      kind: 'ejected',
      outcome: 'suspended',
      games: 1,
      public: true,
    });
    const c = all().find((x) => x.conduct?.playerId === p.id)!;
    expect(c.angle).toBe('ejectFight');
    const s = story(c);
    expect(s.paragraphs.join(' ')).toMatch(/third quarter/);
    expect(ruleBreaks(l, s)).toEqual([]);
  });

  it('tells a fine after an ejection, and its short form stops on a fact', () => {
    const g = l.games.find(
      (x) => x.season === l.season && x.week === WEEK && x.result && x.awayId !== 13 && x.homeId !== 13,
    )!;
    const p = teamPlayers(l, g.awayId).filter((x) => !x.retired)[8];
    g.result!.ejections = [{ playerId: p.id, teamId: g.awayId, quarter: 2, clock: 300, why: 'flagrant' }];
    (p.discipline ??= { entries: [] }).entries.push({
      season: l.season,
      week: step(WEEK),
      teamId: g.awayId,
      kind: 'ejected',
      outcome: 'leagueFine',
      public: true,
    });
    const c = all().find((x) => x.conduct?.playerId === p.id)!;
    expect(c.angle).toBe('ejectFlagrant');
    for (const brief of [false, true]) {
      const s = writeStory(l, c, { editionId: `snn:${l.season}:w${WEEK}`, said: [] }, brief ? { brief: true } : {});
      expect(ruleBreaks(l, s), s.paragraphs.join(' ')).toEqual([]);
    }
  });

  it('does not tell what an earlier edition told, or news that is more than a week old', () => {
    const p = troubled(7, { kind: 'spat', outcome: 'fine', public: true }, WEEK, 9);
    const c = all().find((x) => x.conduct?.playerId === p.id)!;
    expect(conductCandidates(l, WEEK, new Set([c.key])).find((x) => x.key === c.key)).toBeUndefined();
    const old = troubled(8, { kind: 'spat', outcome: 'fine', public: true }, 0, 10);
    expect(all().find((x) => x.conduct?.playerId === old.id)).toBeUndefined();
  });

  it('keeps every built story to the writing rules', () => {
    for (const c of all()) {
      const s = story(c);
      expect(ruleBreaks(l, s), `${c.angle}: ${s.paragraphs.join(' ')}`).toEqual([]);
      expect(s.kind).toBe('conduct');
      // As the reader's own team's second story, one paragraph that still stops on a fact.
      const one = writeStory(l, c, { editionId: `snn:${l.season}:w${WEEK}`, said: [] }, { brief: true, quote: false });
      expect(ruleBreaks(l, one), `${c.angle} brief: ${one.paragraphs.join(' ')}`).toEqual([]);
    }
  });
});

describe('the good side', () => {
  const at = (week: number) => l.season * YEAR + step(week);

  it('rolls about two a week league-wide, the same each time it is asked', () => {
    let n = 0;
    for (let w = 1; w <= 30; w++) n += goodSideWeek(l, at(w)).length;
    expect(n / 30).toBeGreaterThan(1);
    expect(n / 30).toBeLessThan(4);
    expect(goodSideWeek(l, at(3))).toEqual(goodSideWeek(l, at(3)));
  });

  it('leans to the loyal, hard-working, level-headed leaders', () => {
    const score = (p: Player) =>
      p.traits.leads + p.traits.workEthic + p.traits.temperament + p.personality.loyalty * 10;
    const picked: Player[] = [];
    for (let w = 1; w <= 60; w++) for (const g of goodSideWeek(l, at(w))) picked.push(l.players[g.playerId]);
    const everyone = Object.values(l.players).filter((p) => !p.retired && p.teamId !== null);
    const avg = (ps: Player[]) => ps.reduce((a, p) => a + score(p), 0) / ps.length;
    expect(avg(picked)).toBeGreaterThan(avg(everyone));
  });

  it('is a tile, never the lead, and one story a team', () => {
    // Rolled only for the week just played: a past week is never re-rolled from today's rosters.
    expect(conductCandidates(l, WEEK - 1, new Set()).filter((c) => c.angle.startsWith('good'))).toEqual([]);
    const cs = conductCandidates(l, WEEK, new Set()).filter((c) => c.conduct && c.angle.startsWith('good'));
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) expect(c.tier).toBe(5);
    const game = (k: string, club: number, tier: Candidate['tier']): Candidate => ({
      key: k,
      kind: 'game',
      angle: 'result',
      tier,
      stakes: 0.1,
      clubId: club,
      teams: [club, club + 1],
    });
    const cut = cutEdition(rankCandidates([...cs.map((c) => ({ ...c, stakes: 9 })), game('g1', 20, 5)], 'x'), null)!;
    expect(cut.lead.kind).toBe('game');
    expect(cut.tiles.some((t) => t.kind === 'conduct')).toBe(true);
    expect(new Set(cut.tiles.map((t) => t.clubId)).size).toBe(cut.tiles.length);
  });

  /** A good-side candidate for each deed rolled at a run of clocks, as the week would build it. */
  const deeds = (): Candidate[] =>
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].flatMap((w) =>
      freshGood(l, at(w), new Set()).map((g) => {
        const p = l.players[g.playerId];
        const angle = g.kind === 'community' ? 'goodCommunity' : g.kind === 'family' ? 'goodFamily' : 'goodTeammate';
        return {
          key: `good:${l.season}:${w}:${p.id}:${g.kind}`,
          kind: 'conduct',
          angle,
          tier: 5,
          clubId: p.teamId!,
          teams: [p.teamId!],
          stakes: 0,
          conduct: {
            playerId: p.id,
            angle,
            week: WEEK,
            asOf: WEEK,
            prior: { fine: false, ban: false },
            nth: 0,
            bans: 0,
            again: 0,
            star: false,
          },
        } as Candidate;
      }),
    );

  it('keeps every good-side story to the writing rules, with no trait, weekday or record in it', () => {
    const cs = deeds();
    expect(cs.length).toBeGreaterThan(10);
    for (const c of cs) {
      const s: EditionStory = story(c);
      const text = s.paragraphs.join(' ');
      expect(ruleBreaks(l, s), text).toEqual([]);
      expect(text).not.toMatch(/leadership|work ethic|temperament|loyalty/i);
      expect(text).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|months into/);
      // A good deed never carries the team's record.
      expect(s.paragraphs[0]).not.toMatch(/\d–\d/);
    }
  });

  it('tells a good deed in two paragraphs about the man, the deed and his career, with no record or standing', () => {
    const cs = deeds();
    expect(cs.length).toBeGreaterThan(10);
    const said: string[] = [];
    let quoted = 0;
    for (const c of cs) {
      const s: EditionStory = writeStory(l, c, { editionId: `snn:${l.season}:${c.key}`, said });
      expect(s.paragraphs, s.headline).toHaveLength(2);
      const second = s.paragraphs[1];
      expect(second, second).not.toMatch(/\d–\d|lead the|trail|sit behind|open the season|travel to|host |next\./);
      expect(second.length).toBeGreaterThan(0);
      expect(ruleBreaks(l, s), s.paragraphs.join(' ')).toEqual([]);
      // The man speaks: a good story has no word from his head coach.
      if (s.quote) {
        quoted++;
        expect(s.quote.playerId).toBe(c.conduct!.playerId);
        expect(s.quote.coachId).toBeUndefined();
        expect(letterBreaks(s.quote.text, { quotes: true })).toEqual([]);
      }
    }
    expect(quoted).toBeGreaterThan(0);
    expect(quoted).toBeLessThan(cs.length);
  });

  it('tells a man once a league year, and no second family moment', () => {
    const p = l.players[goodSideWeek(l, at(4))[0].playerId];
    const have = new Set([`good:${l.season}:2:${p.id}:community`]);
    for (let w = 1; w <= 30; w++) expect(freshGood(l, at(w), have).some((g) => g.playerId === p.id)).toBe(false);
    const old = new Set([`good:${l.season - 1}:9:${p.id}:family`]);
    for (let w = 1; w <= 60; w++)
      expect(freshGood(l, at(w), old).some((g) => g.playerId === p.id && g.kind === 'family')).toBe(false);
  });
});

describe('the edition', () => {
  it('can print a trouble story on the page', () => {
    const p = troubled(9, { kind: 'fight', outcome: 'suspended', games: 2, public: true }, WEEK, 12);
    p.draft = { season: l.season, round: 1, pick: 3, teamId: 12 };
    const e = buildEdition(l, WEEK)!;
    const stories = [e.lead, ...(e.club ? [e.club] : []), ...e.tiles];
    expect(stories.some((s) => s.kind === 'conduct' && s.cast.includes(p.id))).toBe(true);
  });
});

describe('a suspension handed down in the offseason', () => {
  it('is a big-day story, served from week one, and keeps the rules', () => {
    const p = troubled(10, { kind: 'fight', outcome: 'suspended', games: 1, public: true }, -5, 14);
    p.discipline!.entries.at(-1)!.week = 3; // the free-agency window's third step
    for (const day of ['year', 'market', 'kickoff'] as const) {
      const cs = dayCandidates(l, day, new Set()).filter((c) => c.angle === 'conduct' && c.playerId === p.id);
      expect(cs.length, day).toBe(day === 'year' ? 0 : 1);
    }
    const c = dayCandidates(l, 'market', new Set()).find((x) => x.playerId === p.id)!;
    const s = writeDayStory(l, c, { editionId: `snn:${l.season}:d:market`, said: [] });
    expect(s.paragraphs.join(' ')).toMatch(/season/);
    expect(ruleBreaks(l, s)).toEqual([]);
    expect(dayCandidates(l, 'market', new Set([c.key])).find((x) => x.key === c.key)).toBeUndefined();
  });
});

describe('a suspension handed down at the last offseason step', () => {
  it('is told once, by the Kickoff edition and no other', () => {
    const p = troubled(11, { kind: 'fight', outcome: 'suspended', games: 1, public: true }, -5, 15);
    p.discipline!.entries.at(-1)!.week = 8; // after cut-down day, before game one
    const told = (day: 'year' | 'market' | 'draft' | 'cuts' | 'kickoff', have = new Set<string>()) =>
      dayCandidates(l, day, have).filter((c) => c.angle === 'conduct' && c.playerId === p.id);
    for (const day of ['year', 'market', 'draft', 'cuts'] as const) expect(told(day), day).toHaveLength(0);
    const kick = told('kickoff');
    expect(kick).toHaveLength(1);
    // Filed, it is not told again, and no game week's edition picks it up.
    expect(told('kickoff', new Set([kick[0].key]))).toHaveLength(0);
    for (let w = 0; w <= 4; w++)
      expect(conductCandidates(l, w, new Set()).filter((c) => c.conduct?.playerId === p.id)).toHaveLength(0);
  });
});

describe('the depth of the words', () => {
  it('has several whole ledes for each kind of story', () => {
    for (const [angle, bank] of Object.entries(LEDES)) expect(bank.length, angle).toBeGreaterThanOrEqual(4);
  });

  it('says no sentence twice when a league year of the same trouble is told in a row', () => {
    const said: string[] = [];
    const out: string[] = [];
    for (let k = 0; k < 24; k++) {
      const team = (k % 31) + 1;
      const p = teamPlayers(l, team).filter((x) => !x.retired)[k % 5];
      p.discipline = {
        entries: [{ season: l.season, week: step(WEEK), teamId: team, kind: 'spat', outcome: 'letGo', public: true }],
      };
      const c = all().find((x) => x.conduct?.playerId === p.id)!;
      const s = writeStory(l, c, { editionId: `snn:${l.season}:w${k}`, said }, {});
      out.push(...s.paragraphs.flatMap((t) => sentencesOf(t)));
    }
    const twice = out.filter((x, i) => out.indexOf(x) !== i);
    expect(twice).toEqual([]);
  });
});

describe('late stories, quotes and depth', () => {
  /** A fight ejection in the week before the edition's, so the edition tells it a week late. */
  it('reads the next game and the record as of the edition, not the week the thing happened', () => {
    const g = l.games.find((x) => x.season === l.season && x.week === WEEK - 1 && x.result)!;
    const p = teamPlayers(l, g.homeId).filter((x) => !x.retired)[11];
    g.result!.ejections = [{ playerId: p.id, teamId: g.homeId, quarter: 2, clock: 100, why: 'fight' }];
    (p.discipline ??= { entries: [] }).entries.push({
      season: l.season,
      week: step(WEEK - 1),
      teamId: g.homeId,
      kind: 'ejected',
      outcome: 'suspended',
      games: 3,
      public: true,
    });
    const c = all().find((x) => x.conduct?.playerId === p.id)!;
    expect(c.conduct!.asOf).toBe(WEEK);
    const next = l.games
      .filter((x) => x.season === l.season && x.week > WEEK && (x.homeId === g.homeId || x.awayId === g.homeId))
      .sort((a, b) => a.week - b.week)[0];
    const text = story(c).paragraphs.join(' ');
    const opp = next.homeId === g.homeId ? next.awayId : next.homeId;
    expect(text).toContain(l.teams[opp].city);
    expect(text).not.toMatch(/miss the next three games/);
  });

  it('gives a fined ejection the fine’s word from the head coach, never a suspension’s', () => {
    const bans = ['next player up', 'let his teammates down', 'respect the league', 'handle it better'];
    const g = l.games.find(
      (x) => x.season === l.season && x.week === WEEK && x.result && x.homeId !== 15 && x.awayId !== 15,
    )!;
    for (let k = 0; k < 6; k++) {
      const p = teamPlayers(l, g.homeId).filter((x) => !x.retired)[12 + k];
      g.result!.ejections = [
        ...(g.result!.ejections ?? []),
        { playerId: p.id, teamId: g.homeId, quarter: 1 + (k % 4), clock: 100, why: 'flagrant' },
      ];
      (p.discipline ??= { entries: [] }).entries.push({
        season: l.season,
        week: step(WEEK),
        teamId: g.homeId,
        kind: 'ejected',
        outcome: 'leagueFine',
        public: true,
      });
      const c = all().find((x) => x.conduct?.playerId === p.id)!;
      const q = story(c).quote?.text ?? '';
      for (const b of bans) expect(q).not.toContain(b);
    }
  });

  it('prints four different ledes for four first-time fight ejections', () => {
    const said: string[] = [];
    const ledes: string[] = [];
    const g = l.games.find((x) => x.season === l.season && x.week === WEEK && x.result)!;
    for (let k = 0; k < 4; k++) {
      const p = teamPlayers(l, k % 2 ? g.homeId : g.awayId).filter((x) => !x.retired)[20 + k];
      g.result!.ejections = [{ playerId: p.id, teamId: p.teamId!, quarter: 1 + k, clock: 100, why: 'fight' }];
      p.discipline = {
        entries: [
          {
            season: l.season,
            week: step(WEEK),
            teamId: p.teamId!,
            kind: 'ejected',
            outcome: 'suspended',
            games: 1,
            public: true,
          },
        ],
      };
      const c = all().find((x) => x.conduct?.playerId === p.id)!;
      ledes.push(
        writeStory(l, c, { editionId: `snn:${l.season}:w${WEEK + k}`, said }, {}).paragraphs[0].replace(
          /[A-Z][a-z]+ [A-Z][a-z]+/g,
          'X',
        ),
      );
    }
    expect(new Set(ledes).size).toBe(4);
  });

  it('says a prior fine only when his record holds one and no ban', () => {
    const g = l.games.find((x) => x.season === l.season && x.week === WEEK && x.result)!;
    const mk = (i: number, prior: ConductEntry[]) => {
      const p = teamPlayers(l, g.homeId).filter((x) => !x.retired)[30 + i];
      p.discipline = {
        entries: [
          ...prior,
          {
            season: l.season,
            week: step(WEEK),
            teamId: g.homeId,
            kind: 'dangerousFouls',
            outcome: 'suspended',
            games: 1,
            public: true,
          },
        ],
      };
      return story(all().find((x) => x.conduct?.playerId === p.id)!).paragraphs.join(' ');
    };
    const none = mk(0, []);
    expect(none).not.toMatch(/already fined|fined him for his fouls before/);
    const fined = mk(1, [
      {
        season: l.season,
        week: step(WEEK) - 4,
        teamId: g.homeId,
        kind: 'dangerousFouls',
        outcome: 'leagueFine',
        public: true,
      },
    ]);
    expect(fined).toMatch(/fined him/);
  });

  it('puts a good deed on a big day as a tile, never the lead, and keeps the rules', () => {
    const cs = ['year', 'market', 'draft', 'cuts'].flatMap((d) =>
      dayCandidates(l, d as 'year', new Set()).filter((c) => c.angle === 'good'),
    );
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c.tier).toBe(5);
      const s = writeDayStory(l, c, { editionId: `snn:${l.season}:d:${c.day}`, said: [] });
      expect(ruleBreaks(l, s), s.paragraphs.join(' ')).toEqual([]);
    }
  });
});

describe('players in their own words', () => {
  it('quotes the man in a suspension story, or his head coach, never both, in words that pass the rules', () => {
    const said: string[] = [];
    const stories: EditionStory[] = [];
    for (let k = 0; k < 10; k++) {
      const team = 14 + k;
      const p = teamPlayers(l, team).filter((x) => !x.retired)[k % 4];
      p.discipline = {
        entries: [
          {
            season: l.season,
            week: step(WEEK),
            teamId: team,
            kind: 'fight',
            outcome: 'suspended',
            games: 1,
            public: true,
          },
        ],
      };
      const c = all().find((x) => x.conduct?.playerId === p.id)!;
      stories.push(writeStory(l, c, { editionId: `snn:${l.season}:q${k}`, said }, {}));
    }
    const talking = stories.filter((s) => s.quote?.playerId !== undefined);
    expect(talking.length).toBeGreaterThan(2);
    expect(stories.filter((s) => s.quote?.coachId !== undefined).length).toBeGreaterThan(0);
    for (const s of stories) {
      if (!s.quote) continue;
      expect(s.quote.playerId === undefined || s.quote.coachId === undefined).toBe(true);
      if (s.quote.playerId !== undefined) expect(s.quote.playerId).toBe(s.cast[0]);
      expect(letterBreaks(s.quote.text, { quotes: true }), s.quote.text).toEqual([]);
      expect(ruleBreaks(l, s), s.paragraphs.join(' ')).toEqual([]);
    }
    // No quote twice: a man speaks a line nobody has said this league year.
    const texts = stories.flatMap((s) => (s.quote ? [s.quote.text] : []));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('names the story’s own team one way, never by its nickname in one sentence and its city in the next', () => {
    for (const c of all()) {
      const s = story(c);
      const t = l.teams[c.clubId];
      const text = s.paragraphs.join(' ');
      expect(text.includes(t.name) && text.includes(t.city), text).toBe(false);
    }
  });
});

describe('a coach who talks of next week', () => {
  const lines = (team: number) => {
    const p = teamPlayers(l, team).filter((x) => !x.retired)[7];
    p.discipline = {
      entries: [{ season: l.season, week: step(WEEK), teamId: team, kind: 'curfew', outcome: 'sat', public: true }],
    };
    const c = all().find((x) => x.conduct?.playerId === p.id)!;
    const out: string[] = [];
    for (let k = 0; k < 80; k++) {
      const q = writeStory(l, c, { editionId: `snn:${l.season}:nw${k}`, said: [] }, {}).quote;
      if (q?.coachId !== undefined) out.push(q.text);
    }
    return { out };
  };

  it('says it only when the team has a game next week: never before a bye or after its last game', () => {
    const team = 20;
    // With games to come the line is on the shelf.
    expect(lines(team).out.some((t) => /next week/.test(t))).toBe(true);
    const kept = l.games;
    try {
      // Nothing left on the schedule after this week (the season's end, an exit): no line about next week.
      l.games = kept.filter((g) => !(g.week > WEEK && (g.homeId === team || g.awayId === team)));
      const none = lines(team).out;
      expect(none.length).toBeGreaterThan(0);
      expect(none.filter((t) => /next week/.test(t))).toEqual([]);
      // A bye: the next game is two weeks out.
      l.games = kept.filter((g) => !(g.week === WEEK + 1 && (g.homeId === team || g.awayId === team)));
      expect(lines(team).out.filter((t) => /next week/.test(t))).toEqual([]);
    } finally {
      l.games = kept;
    }
  });
});
