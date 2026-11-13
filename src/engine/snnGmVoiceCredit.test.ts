/**
 * SNN's Column crediting a general manager, as a piece written from what he did: the two reference pieces word for
 * word, time words chosen by the facts, and every credit shape held to the GM piece rules on a scene that finds its
 * family.
 */
import { describe, expect, it } from 'vitest';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { FINDING_ORDER, type FindingFamily } from './gmFindings';
import { teamPlayers } from './roster';
import { columnClaims, gmLeadKey, type Claim } from './snnColumn';
import { CLOSES, gmShapeKey, SHAPES } from './snnGmVoice';
import { COLUMN, columnStory } from './snnVoice';
import { ruleBreaks } from './storyRules';
import type { Game, GameResult, GmMove, League, Player, TeamGameStats } from './types';

const line = { passAtt: 30, rushAtt: 25, sacked: 2, totalYds: 300, passYds: 200, rushYds: 100 } as TeamGameStats;
/** Weeks 1 to `to` by decree: `t` wins every game, everyone else's home side wins. */
function plant(l: League, t: number, to: number) {
  for (const g of l.games as Game[]) {
    if (g.season !== l.season || g.playoffRound || g.week > to) continue;
    const homeWins = g.awayId !== t;
    g.result = {
      homeScore: homeWins ? 24 : 13,
      awayScore: homeWins ? 13 : 24,
      home: line,
      away: line,
      quarters: { home: [7, 7, 7, 3], away: [3, 3, 7, 0] },
      playerStats: {},
      playerTeams: {},
    } as unknown as GameResult;
  }
  l.week = to + 1;
}
const teamBy = (l: League, abbrev: string) => l.teams.find((x) => x.abbrev === abbrev)!.id;
const named = <T extends { firstName: string; lastName: string }>(p: T, first: string, last: string) => {
  p.firstName = first;
  p.lastName = last;
  return p;
};
const at = () => ({ editionId: 'snn:test', said: [] as string[] });
const pos = (l: League, t: number, position: string, n = 0) =>
  teamPlayers(l, t).filter((p) => p.position === position)[n];

type Past = { w: number; l: number; champion?: true };
/**
 * A team unbeaten through week 14 under a GM with these finished seasons behind him and nothing on his record. Its
 * head coach has been here as long as he has, unless a test says otherwise.
 */
function scene(seed: string, abbrev: string, past: Past[], gmName: [string, string] = ['Ryan', 'Sharp']) {
  const l = createLeague({ seed });
  const t = teamBy(l, abbrev);
  const gm = named(l.gms[l.teams[t].gmId!], ...gmName);
  gm.career = [];
  past.forEach((r, i) => {
    const season = l.season - past.length + i;
    gm.career.push({ season, teamId: t });
    l.history.push({
      season,
      championId: r.champion ? t : -1,
      runnerUpId: -1,
      records: Object.fromEntries(
        l.teams.map((x) => [x.id, x.id === t ? { w: r.w, l: r.l, t: 0 } : { w: 8, l: 9, t: 0 }]),
      ),
    });
  });
  for (const p of Object.values(l.players)) {
    if (p.draft?.teamId === t) delete p.draft;
    if (p.left) p.left = p.left.filter((d) => d.teamId !== t);
  }
  delete gm.deals;
  l.teams[t].jobs = { held: {} };
  for (const c of [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)]) c.career = [];
  const hc = teamCoaches(l, t).find((c) => c.role === 'headCoach')!;
  delete hc.interim;
  hc.career = [...past.map((_, i) => l.season - past.length + i), l.season].map((season) => ({
    season,
    teamId: t,
    role: 'headCoach' as const,
  }));
  plant(l, t, 14);
  const claim = () =>
    columnClaims(l, 14, new Set()).find((c) => c.subject.kind === 'gm' && c.teamId === t && c.dir === 'credit') as
      | Claim
      | undefined;
  return { l, t, gm, hc, claim, Y1: l.season - 1, Y2: l.season - 2 };
}
type Scene = ReturnType<typeof scene>;
const starts = (s: Scene, p: Player) => {
  s.l.teams[s.t].jobs!.held[p.id] = { pos: p.position, since: 0 };
};
const honor = (s: Scene, p: Player, season: number, key: 'mvp' | 'droy' | 'first' | 'second') => {
  let a = s.l.awards.find((x) => x.season === season);
  if (!a) s.l.awards.push((a = { season, winners: {}, allLeague: [[], []] }));
  if (key === 'first' || key === 'second') a.allLeague[key === 'first' ? 0 : 1].push({ playerId: p.id, teamId: s.t });
  else a.winners[key] = { playerId: p.id, teamId: s.t };
};
type Trade = Extract<GmMove, { kind: 'trade' }>;
const trade = (
  s: Scene,
  season: number,
  otherId: number,
  rounds: number[],
  p: Player,
  phase: Trade['phase'] = 'resign',
): Trade => ({
  kind: 'trade',
  season,
  phase,
  week: 1,
  teamId: s.t,
  otherId,
  gave: { players: [], picks: rounds.map((round) => ({ season: season + 1, round })) },
  got: { players: [p.id], picks: [] },
});
/** Every shape and close but these has been used this league year. */
const pin = (s: Scene, ids: string[]) => {
  const all = [...SHAPES.map((x) => x.id), ...CLOSES.map((x) => x.id)];
  s.l.mailTold = Object.fromEntries(
    all.filter((id) => !ids.includes(id)).map((id) => [gmShapeKey(s.l.season, id), s.l.season]),
  );
};

/** Indianapolis: a quarterback traded for, the award and the title that followed, and a second trade this spring. */
function indianapolis(seed = 'gm-credit-ind') {
  const s = scene(seed, 'IND', [
    { w: 10, l: 7 },
    { w: 14, l: 3, champion: true },
  ]);
  const was = teamBy(s.l, 'WAS');
  const qb = named(pos(s.l, s.t, 'QB'), 'Jonathan', 'Richards');
  const ol = named(pos(s.l, s.t, 'OL'), 'Cody', 'Locklear');
  s.gm.deals = [trade(s, s.Y1, was, [1, 2, 2], qb), trade(s, s.l.season, was, [1, 1, 4], ol)];
  honor(s, qb, s.Y1, 'mvp');
  return { ...s, was, qb, ol };
}

/** Tampa Bay: three honored picks from one draft, and a different quarterback every season. */
function tampaBay(seed = 'gm-credit-tb') {
  const s = scene(
    seed,
    'TB',
    [
      { w: 14, l: 3 },
      { w: 12, l: 5 },
    ],
    ['Troy', 'Roberts'],
  );
  const [a, b, c] = [
    named(pos(s.l, s.t, 'OL'), 'Demetrius', 'Jordan'),
    named(pos(s.l, s.t, 'DT'), 'DeMarcus', 'Wallace'),
    named(pos(s.l, s.t, 'S'), 'Michael', 'Bryant'),
  ];
  a.draft = { season: s.Y2, round: 1, pick: 13, teamId: s.t };
  b.draft = { season: s.Y2, round: 2, pick: 45, teamId: s.t };
  c.draft = { season: s.Y2, round: 5, pick: 150, teamId: s.t };
  honor(s, a, s.Y2, 'second');
  honor(s, b, s.Y2, 'droy');
  honor(s, c, s.Y1, 'first');
  [s.Y2, s.Y1, s.l.season].forEach((season, i) => {
    const p = teamPlayers(s.l, s.t).filter((x) => x.position === 'QB' || x.position === 'WR')[i];
    p.stats[season] = { passAtt: 400 };
    p.statTeams = { ...(p.statTeams ?? {}), [season]: [s.t] };
  });
  return s;
}

describe('a hype piece', () => {
  it('is written from its findings: the trade that paid', () => {
    const s = indianapolis();
    const c = s.claim()!;
    expect(c.findings!.map((f) => f.family)).toEqual(['starTrade']);
    pin(s, ['c:starTrade:1', 'c+:starTrade']);
    const story = columnStory(s.l, c, at());
    const rec = `${c.context.w}–${c.context.l}`;
    expect(story.headline).toBe('Sharp paid for Richards and Indianapolis got a title');
    expect(story.paragraphs).toEqual([
      `Ryan Sharp sent Washington a first-round pick and two second-round picks for quarterback Jonathan Richards before the ${s.Y1} season. Richards was the league's most valuable player that year, and Indianapolis won the title.`,
      'Trades like that usually look expensive by the second year. Sharp made another one instead. This spring he paid the same team two first-round picks and a fourth-round pick for offensive lineman Cody Locklear.',
      `That is three first-round picks for two players. The Racers are ${rec} with last season's most valuable player at quarterback, and nobody in Indianapolis is asking for the picks back.`,
    ]);
    expect(story.covers).toEqual([
      c.key,
      gmLeadKey(s.l.season, s.gm.id, s.t, 'starTrade'),
      gmShapeKey(s.l.season, 'c:starTrade:1'),
      gmShapeKey(s.l.season, 'c+:starTrade'),
    ]);
    expect(ruleBreaks(s.l, story), story.paragraphs.join(' / ')).toEqual([]);
  });

  it('chooses its time words by the facts', () => {
    const s = indianapolis('gm-credit-time');
    const dal = teamBy(s.l, 'DAL');
    // The award came a season after the trade, the title never did, and the second trade was in season, with Dallas.
    s.gm.deals = [trade(s, s.Y2, s.was, [1], s.qb), trade(s, s.Y1, dal, [1], s.ol, 'regular')];
    s.l.history.forEach((h) => (h.championId = -1));
    pin(s, ['c:starTrade:1', 'c+:starTrade']);
    const text = columnStory(s.l, s.claim()!, at()).paragraphs.join(' ');
    expect(text).toContain("Richards was the league's most valuable player last season.");
    expect(text).not.toContain('that year');
    expect(text).not.toContain('won the title');
    expect(text).not.toContain('This spring');
    expect(text).toContain(
      `During the ${s.Y1} season he paid Dallas a first-round pick for offensive lineman Cody Locklear.`,
    );
    expect(text).toContain('That is two first-round picks for two players.');
    // An award from two seasons back is not "last season's".
    s.l.awards.length = 0;
    honor(s, s.qb, s.Y2, 'mvp');
    const older = columnStory(s.l, s.claim()!, at()).paragraphs.join(' ');
    expect(older).toContain("Richards was the league's most valuable player that year.");
    expect(older).not.toContain("last season's most valuable player");
  });

  it('is written from its findings: the draft class, and winning whoever plays quarterback', () => {
    const s = tampaBay();
    const c = s.claim()!;
    expect(c.findings!.map((f) => f.family)).toEqual(['class', 'lateFind', 'qbs']);
    pin(s, ['c:class:1', 'c:record:built', 'c+:qbs']);
    const story = columnStory(s.l, c, at());
    const rec = `${c.context.w}–${c.context.l}`;
    expect(story.headline).toBe("Tampa Bay keep winning with Roberts' draft picks");
    expect(story.paragraphs).toEqual([
      `Tampa Bay took offensive lineman Demetrius Jordan in the first round in ${s.Y2}. He made the second All-League team as a rookie. DeMarcus Wallace went in the second round of the same draft and was the defensive rookie of the year. Michael Bryant, a fifth-round pick, made the first All-League team a year later.`,
      `Troy Roberts made all three picks. The Corsairs are ${rec} after two winning seasons in a row under Roberts.`,
      "Plenty of teams win for a year on a quarterback. Tampa Bay have started a different one in each of Roberts' three seasons and kept winning, which says the roster is doing it.",
    ]);
    expect(ruleBreaks(s.l, story), story.paragraphs.join(' / ')).toEqual([]);
  });

  it('names the coach he hired when the credit is for a first-year coach’s turnaround', () => {
    const s = scene('gm-credit-hire', 'DEN', [{ w: 4, l: 13 }]);
    named(s.hc, 'Victor', 'Ochoa').career = [{ season: s.l.season, teamId: s.t, role: 'headCoach' }];
    const c = s.claim()!;
    expect(c.facts.why).toBe('hire');
    expect(c.findings!.map((f) => f.family)).toEqual(['coaches']);
    const story = columnStory(s.l, c, at());
    expect(story.paragraphs.join(' ')).toContain('Victor Ochoa');
    expect(story.paragraphs.at(-1)).toContain('Ochoa');
    expect(ruleBreaks(s.l, story), story.paragraphs.join(' / ')).toEqual([]);
  });

  it('no GM claim is written from the old banks', () => {
    for (const key of ['gm2-', 'gm3-', 'gm2+', 'gmBuilt+', 'gmRun+']) expect(COLUMN[key], key).toBeUndefined();
  });
});

/** Scenes that find one credit family each (two for head coaches: the hire that lasted, and the new one). */
const SCENES: Partial<Record<FindingFamily, ((s: Scene) => void)[]>> = {
  starTrade: [
    (s) => {
      const p = pos(s.l, s.t, 'EDGE');
      s.gm.deals = [trade(s, s.Y2, teamBy(s.l, 'DAL'), [1, 3], p)];
      honor(s, p, s.Y1, 'first');
    },
  ],
  class: [
    (s) => {
      const [a, b] = [pos(s.l, s.t, 'CB'), pos(s.l, s.t, 'LB')];
      a.draft = { season: s.Y2, round: 2, pick: 40, teamId: s.t };
      b.draft = { season: s.Y1, round: 3, pick: 77, teamId: s.t };
      honor(s, a, s.Y1, 'first');
      honor(s, b, s.Y1, 'second');
    },
  ],
  lateFind: [
    (s) => {
      const p = pos(s.l, s.t, 'S');
      p.draft = { season: s.Y2, round: 5, pick: 150, teamId: s.t };
      honor(s, p, s.Y1, 'first');
    },
  ],
  qbs: [
    (s) => {
      [s.Y2, s.Y1, s.l.season].forEach((season, i) => {
        const p = teamPlayers(s.l, s.t)[i];
        p.stats[season] = { passAtt: 400 };
        p.statTeams = { ...(p.statTeams ?? {}), [season]: [s.t] };
      });
    },
  ],
  contract: [
    (s) => {
      const p = pos(s.l, s.t, 'WR');
      s.gm.deals = [
        {
          kind: 'sign',
          season: s.Y2,
          phase: 'freeAgency',
          week: 1,
          teamId: s.t,
          playerId: p.id,
          years: 4,
          total: 88_000,
        },
      ];
      starts(s, p);
      honor(s, p, s.Y1, 'first');
    },
  ],
  firsts: [
    (s) => {
      const [a, b] = [pos(s.l, s.t, 'CB'), pos(s.l, s.t, 'DT')];
      a.draft = { season: s.Y2, round: 1, pick: 14, teamId: s.t };
      b.draft = { season: s.Y1, round: 1, pick: 27, teamId: s.t };
      starts(s, a);
      starts(s, b);
    },
  ],
  coaches: [
    // The coach he hired when he came, with a season on record before either of them.
    (s) => {
      s.l.history.push({ season: s.l.season - 3, championId: -1, runnerUpId: -1, records: {} });
    },
    // A coach in his first season here.
    (s) => {
      s.hc.career = [{ season: s.l.season, teamId: s.t, role: 'headCoach' }];
    },
  ],
};

describe('the hype pieces’ shapes', () => {
  const leads = (family: FindingFamily) =>
    SHAPES.filter((x) => x.side === 'credit' && x.role === 'lead' && x.family === family);

  it('has two lead shapes or more for every credit family, a turn for each, and closes to choose from', () => {
    for (const family of FINDING_ORDER.credit) {
      expect(leads(family).length, family).toBeGreaterThanOrEqual(2);
      expect(
        SHAPES.some((x) => x.side === 'credit' && x.role === 'turn' && x.family === family),
        family,
      ).toBe(true);
    }
    expect(CLOSES.filter((x) => x.on === '+' && !x.family && !x.also).length).toBeGreaterThanOrEqual(3);
    for (const family of ['starTrade', 'class'] as const)
      expect(
        CLOSES.some((x) => x.on === '+' && x.family === family),
        family,
      ).toBe(true);
    const ids = [...SHAPES.map((x) => x.id), ...CLOSES.map((x) => x.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const family of FINDING_ORDER.credit) {
    it(`${family}: every lead shape keeps the rules, and no two open the same way`, () => {
      const written = new Map<string, string>();
      for (const [n, build] of SCENES[family]!.entries())
        for (const shape of leads(family)) {
          const s = scene(
            `gm-credit-${family}-${n}`,
            'SEA',
            [
              { w: 10, l: 7 },
              { w: 11, l: 6 },
            ],
            ['Patrick', 'Williams'],
          );
          build(s);
          const c = s.claim()!;
          expect(c.findings![0].family, shape.id).toBe(family);
          s.l.mailTold = Object.fromEntries(
            leads(family)
              .filter((x) => x.id !== shape.id)
              .map((x) => [gmShapeKey(s.l.season, x.id), s.l.season]),
          );
          const story = columnStory(s.l, c, at());
          // A shape that does not fit this scene (the other kind of head coach finding) is told by another scene.
          if (!story.covers!.includes(gmShapeKey(s.l.season, shape.id))) continue;
          expect(ruleBreaks(s.l, story), `${shape.id}: ${story.paragraphs.join(' / ')}`).toEqual([]);
          expect(`${story.headline} ${story.paragraphs.join(' ')}`, shape.id).not.toMatch(/[{}]|undefined|NaN/);
          written.set(shape.id, story.paragraphs[0].split(' ').slice(0, 3).join(' '));
        }
      expect([...written.keys()].sort(), family).toEqual(
        leads(family)
          .map((x) => x.id)
          .sort(),
      );
      const openings = [...written.values()];
      expect(new Set(openings).size, openings.join(' | ')).toBe(openings.length);
    });
  }

  it('every credit close keeps the rules and finishes on the man or the team', () => {
    for (const close of CLOSES.filter((x) => x.on === '+')) {
      const s = close.family === 'starTrade' ? indianapolis(`gm-close-${close.id}`) : tampaBay(`gm-close-${close.id}`);
      if (close.also === 'coaches')
        s.l.history.push({ season: s.l.season - 3, championId: -1, runnerUpId: -1, records: {} });
      const c = s.claim()!;
      s.l.mailTold = Object.fromEntries(
        CLOSES.filter((x) => x.id !== close.id).map((x) => [gmShapeKey(s.l.season, x.id), s.l.season]),
      );
      const story = columnStory(s.l, c, at());
      expect(story.covers, close.id).toContain(gmShapeKey(s.l.season, close.id));
      expect(ruleBreaks(s.l, story), `${close.id}: ${story.paragraphs.at(-1)}`).toEqual([]);
    }
  });
});
