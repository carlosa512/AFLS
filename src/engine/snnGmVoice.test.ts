/**
 * SNN's Column on a general manager, as a piece written from what he did: the reference piece word for word, time
 * words chosen by the facts, no shape twice in a league year, and every shape held to the GM piece rules on a scene
 * that finds its family.
 */
import { describe, expect, it } from 'vitest';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { FINDING_ORDER, type FindingFamily } from './gmFindings';
import { setTeam, teamPlayers } from './roster';
import { columnClaims, gmLeadKey, type Claim } from './snnColumn';
import { CLOSES, gmPiece, gmShapeKey, SHAPES } from './snnGmVoice';
import { columnStory } from './snnVoice';
import { ruleBreaks } from './storyRules';
import type { Game, GameResult, GmMove, League, Player, TeamGameStats } from './types';

const line = { passAtt: 30, rushAtt: 25, sacked: 2, totalYds: 300, passYds: 200, rushYds: 100 } as TeamGameStats;
/** Weeks 1 to `to` by decree: `t` loses every game, everyone else's home side wins. */
function plant(l: League, t: number, to: number) {
  for (const g of l.games as Game[]) {
    if (g.season !== l.season || g.playoffRound || g.week > to) continue;
    const homeWins = g.homeId !== t;
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
const named = (p: Player, first: string, last: string) => {
  p.firstName = first;
  p.lastName = last;
  return p;
};
const at = () => ({ editionId: 'snn:test', said: [] as string[] });

/**
 * A team out of the race in week 12 under a GM with two losing seasons behind him and nothing on his record: each test
 * writes what it needs onto it.
 */
function scene(seed: string, abbrev = 'JAX') {
  const l = createLeague({ seed });
  const t = teamBy(l, abbrev);
  const gm = l.gms[l.teams[t].gmId!];
  named(gm as unknown as Player, 'George', 'Sutton');
  gm.career = [];
  const past = [
    { w: 2, l: 15 },
    { w: 3, l: 14 },
  ];
  past.forEach((r, i) => {
    const season = l.season - 2 + i;
    gm.career.push({ season, teamId: t });
    l.history.push({
      season,
      championId: -1,
      runnerUpId: -1,
      records: Object.fromEntries(l.teams.map((x) => [x.id, x.id === t ? { ...r, t: 0 } : { w: 9, l: 8, t: 0 }])),
    });
  });
  for (const p of Object.values(l.players)) {
    if (p.draft?.teamId === t) delete p.draft;
    if (p.left) p.left = p.left.filter((d) => d.teamId !== t);
  }
  delete gm.deals;
  l.teams[t].jobs = { held: {} };
  // His head coach has been here as long as he has.
  for (const c of [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)]) c.career = [];
  const hc = teamCoaches(l, t).find((c) => c.role === 'headCoach')!;
  hc.career = [l.season - 2, l.season - 1, l.season].map((season) => ({
    season,
    teamId: t,
    role: 'headCoach' as const,
  }));
  plant(l, t, 12);
  const claim = (have: string[] = []) =>
    columnClaims(l, 12, new Set(have)).find((c) => c.subject.kind === 'gm' && c.teamId === t) as Claim | undefined;
  return { l, t, gm, claim, Y1: l.season - 1, Y2: l.season - 2 };
}
const qbsOf = (l: League, t: number) => teamPlayers(l, t).filter((p) => p.position === 'QB');
const elsewhere = (l: League, t: number) => teamBy(l, l.teams[t].abbrev === 'GB' ? 'DAL' : 'GB');
const sign = (season: number, teamId: number, p: Player, years: number, total: number): GmMove => ({
  kind: 'sign',
  season,
  phase: 'freeAgency',
  week: 1,
  teamId,
  playerId: p.id,
  years,
  total,
});

/** Every shape and close but these has been used this league year: the piece must be written from these. */
const only = (l: League, ids: string[]) =>
  new Set(
    [...SHAPES.map((s) => s.id), ...CLOSES.map((c) => c.id)]
      .filter((id) => !ids.includes(id))
      .map((id) => gmShapeKey(l.season, id)),
  );

/** The Jacksonville piece's facts: two first-round quarterbacks, a third signed before them, and a contract gone. */
function jacksonville(seed = 'gm-voice') {
  const s = scene(seed);
  const { l, t, gm, Y1 } = s;
  const [a, b] = qbsOf(l, t);
  named(a, 'Reid', 'Andrews').draft = { season: Y1, round: 1, pick: 1, teamId: t };
  // Andrews is the starter, as he was in the league the piece was first written from.
  l.teams[t].jobs!.held[a.id] = { pos: 'QB', since: 0 };
  named(b, 'Victor', 'Salami').draft = { season: l.season, round: 1, pick: 2, teamId: t };
  const gb = elsewhere(l, t);
  const third = named(qbsOf(l, gb)[0], 'Zach', 'Griffith');
  const fowler = named(teamPlayers(l, gb).find((p) => p.position === 'OL')!, 'Ezekiel', 'Fowler');
  gm.deals = [sign(Y1, t, third, 5, 17_700), sign(Y1, t, fowler, 2, 43_000)];
  return { ...s, a, b, third, fowler, gb };
}

describe('a hit piece', () => {
  it('is written from its findings: the reference piece', () => {
    const { l, t, gm, claim, Y1 } = jacksonville();
    const c = claim()!;
    expect(c.findings!.map((f) => f.family)).toEqual(['qbPicks', 'contract']);
    const piece = gmPiece(l, c, only(l, ['b:qbPicks:1', 'b:record:combined', 'b:contract:turn', 'b2:qbPicks']))!;
    // Twelve weeks with a bye in them.
    const rec = `${c.context.w}–${c.context.l}`;
    expect(piece.headline).toBe(`Sutton has drafted two quarterbacks and Jacksonville are ${rec}`);
    const story = columnStory(l, c, at());
    // The page writes it through the same writer; here the shapes are pinned.
    l.mailTold = Object.fromEntries(
      [...only(l, ['b:qbPicks:1', 'b:record:combined', 'b:contract:turn', 'b2:qbPicks'])].map((k) => [k, l.season]),
    );
    const pinned = columnStory(l, c, at());
    expect(pinned.paragraphs).toEqual([
      `George Sutton used the first pick of the ${Y1} draft on quarterback Reid Andrews. A year later he used the second pick on another quarterback, Victor Salami, who has not played a snap. Before either pick he had signed a third, Zach Griffith, to a five-year contract.`,
      `The Tarpons won five games in Sutton's first two seasons combined and are ${rec} in his third. The money has gone the same way. Ezekiel Fowler got $43 million over two years in ${Y1} and plays for Green Bay now.`,
      'A general manager gets one try at a quarterback before the questions start. He has had three. It is fair to ask whether Sutton gets another season to find one.',
    ]);
    expect(pinned.headline).toBe(piece.headline);
    expect(pinned.table).toEqual(c.table);
    expect(pinned.covers).toEqual([
      c.key,
      gmLeadKey(l.season, gm.id, t, 'qbPicks'),
      ...['b:qbPicks:1', 'b:record:combined', 'b:contract:turn', 'b2:qbPicks'].map((id) => gmShapeKey(l.season, id)),
    ]);
    for (const s of [story, pinned]) {
      expect(s.kind).toBe('column');
      expect(s.kicker).toBe('Column');
      expect(ruleBreaks(l, s), s.paragraphs.join(' / ')).toEqual([]);
    }
  });

  it('chooses its time words by the facts', () => {
    const { l, a, b, third, gm, claim, Y1, Y2, t } = jacksonville('gm-voice-time');
    const write = () => {
      const c = claim()!;
      return gmPiece(l, c, only(l, ['b:qbPicks:1', 'b:record:combined', 'b:contract:turn', 'b2:qbPicks']))!
        .paragraphs[0];
    };
    expect(write()).toContain('A year later he used');
    expect(write()).toContain('Before either pick he had signed a third');
    // Two drafts apart, a second quarterback who has played, and a signing that came after the first pick.
    a.draft!.season = Y2;
    b.draft!.season = l.season;
    b.stats[l.season] = { snaps: 120, gp: 3 };
    gm.deals = gm.deals!.map((m) => (m.kind === 'sign' && m.playerId === third.id ? { ...m, season: l.season } : m));
    const text = write();
    expect(text).not.toContain('A year later');
    expect(text).toContain(`In ${l.season} he used`);
    expect(text).not.toContain('has not played a snap');
    expect(text).not.toContain('Before either pick');
    expect(text).toContain('He has also signed a third');
    expect(Y1 && t).toBeTruthy();
  });

  it('says so when neither quarterback he drafted is the starter', () => {
    const { l, t, a, claim } = jacksonville('gm-voice-bench');
    const lead = (id: string) => gmPiece(l, claim()!, only(l, [id, 'b:record:combined', 'b2:qbPicks']))!.paragraphs[0];
    expect(lead('b:qbPicks:1')).not.toContain('Neither');
    expect(lead('b:qbPicks:2')).toContain('George Sutton made both picks.');
    delete l.teams[t].jobs!.held[a.id];
    expect(lead('b:qbPicks:1')).toContain('who has not played a snap. Neither is the starter. Before either pick');
    expect(lead('b:qbPicks:2')).toContain('George Sutton made both picks, and neither is the starter.');
  });

  it('says "she" and "her" for a general manager who is a woman', () => {
    const { l, gm, claim } = jacksonville('gm-voice-she');
    named(gm as unknown as Player, 'Felicia', 'Byrd');
    gm.woman = true;
    const piece = gmPiece(l, claim()!, only(l, ['b:qbPicks:1', 'b:record:combined', 'b:contract:turn', 'b2:qbPicks']))!;
    const text = piece.paragraphs.join(' ');
    expect(text).toContain('A year later she used the second pick');
    expect(text).toContain('Before either pick she had signed a third');
    expect(text).toContain("in Byrd's first two seasons combined");
    expect(text).toMatch(/in her third\./);
    expect(text).toContain('She has had three.');
    // The quarterback is still "who has not played a snap", and nothing about her says "he".
    expect(text).not.toMatch(/\b(he|his|him)\b/i);
    // The closes and the records that speak of the general manager, one by one.
    for (const ids of [
      ['b:qbPicks:1', 'b:record:each', 'b2:3'],
      ['b:qbPicks:1', 'b:record:run', 'b2:starTrade'],
    ]) {
      const other = gmPiece(l, claim()!, only(l, ids))!.paragraphs.slice(1).join(' ');
      expect(other, ids.join()).not.toMatch(/\b(he|his|him)\b/i);
    }
  });

  it('prefers the other shape and another close when this general manager’s piece used them last year', () => {
    const { l, t, gm, b, claim } = jacksonville('gm-voice-again');
    // A new first-round quarterback this year lets the family lead again; last year's piece used shape 1 and the
    // quarterback close.
    b.draft!.season = l.season;
    const last = [
      gmLeadKey(l.season - 1, gm.id, t, 'qbPicks'),
      gmShapeKey(l.season - 1, 'b:qbPicks:1'),
      gmShapeKey(l.season - 1, 'b2:qbPicks'),
    ];
    for (let n = 0; n < 6; n++) {
      // Whatever the claim's key hashes to, it is never last year's lead shape or close.
      const c = { ...claim(last)!, key: `${claim(last)!.key}#${n}` };
      const piece = gmPiece(l, c, new Set(last))!;
      expect(piece.covers).toContain(gmShapeKey(l.season, 'b:qbPicks:2'));
      expect(piece.covers).not.toContain(gmShapeKey(l.season, 'b2:qbPicks'));
    }
  });

  it('never uses a shape or a close twice in a league year', () => {
    const { l, claim } = jacksonville('gm-voice-twice');
    const c = claim()!;
    const first = gmPiece(l, c, new Set())!;
    const used = first.covers.filter((k) => k.startsWith('gmshape:'));
    expect(used.length).toBeGreaterThanOrEqual(3);
    const second = gmPiece(l, c, new Set(used))!;
    expect(second.covers.filter((k) => used.includes(k))).toEqual([]);
    expect(second.paragraphs[0]).not.toBe(first.paragraphs[0]);
    expect(second.paragraphs.at(-1)).not.toBe(first.paragraphs.at(-1));
  });

  it('names a team that shares its city by its nickname in the headline', () => {
    const s = scene('gm-voice-city', 'NYK');
    const [a, b] = qbsOf(s.l, s.t);
    a.draft = { season: s.Y2, round: 1, pick: 1, teamId: s.t };
    b.draft = { season: s.Y1, round: 1, pick: 2, teamId: s.t };
    const piece = gmPiece(s.l, s.claim()!, only(s.l, ['b:qbPicks:1', 'b:record:combined', 'b2:qbPicks']))!;
    const team = s.l.teams[s.t];
    expect(piece.headline).toContain(`the ${team.name}`);
    expect(piece.headline).not.toContain(team.city);
  });

  it('says "it is time" a season after it asked', () => {
    const { l, gm, t, claim } = jacksonville('gm-voice-time-up');
    // A third losing season behind him, and last year's Column asked.
    gm.career.unshift({ season: l.season - 3, teamId: t });
    l.history.push({
      season: l.season - 3,
      championId: -1,
      runnerUpId: -1,
      records: Object.fromEntries(l.teams.map((x) => [x.id, { w: x.id === t ? 4 : 9, l: x.id === t ? 13 : 8, t: 0 }])),
    });
    const c = claim([`column:${l.season - 1}:gm:${gm.id}:2-`])!;
    expect(c.rung).toBe(3);
    const story = columnStory(l, c, at());
    expect(story.paragraphs.at(-1)).toMatch(/It is time/);
    expect(story.paragraphs.join(' ')).not.toMatch(/fair to ask/);
    expect(ruleBreaks(l, story), story.paragraphs.join(' / ')).toEqual([]);
  });
});

describe('getting the facts right', () => {
  /** A player traded away last season who has won an award since, where he plays now. */
  const departed = (s: ReturnType<typeof scene>, honorSeason: number) => {
    const p = named(teamPlayers(s.l, s.t).find((x) => x.position === 'EDGE')!, 'Jaylon', 'Stephens');
    const now = elsewhere(s.l, s.t);
    setTeam(s.l, p, now);
    p.left = [{ teamId: s.t, season: s.Y1, how: 'traded' }];
    s.l.awards.push({ season: honorSeason, winners: { dpoy: { playerId: p.id, teamId: now } }, allLeague: [[], []] });
    return p;
  };
  const text = (s: ReturnType<typeof scene>, ids: string[]) => {
    s.l.mailTold = Object.fromEntries([...only(s.l, ids)].map((k) => [k, s.l.season]));
    return columnStory(s.l, s.claim()!, at());
  };

  it('never tells the lead’s own player again as its second point', () => {
    const s = scene('gm-voice-same');
    const p = departed(s, s.Y1);
    // He had signed a big contract here before he was traded: one story, not two.
    s.gm.deals = [sign(s.Y2, s.t, p, 4, 67_000)];
    const one = columnStory(s.l, s.claim()!, at());
    expect(s.claim()!.findings!.map((f) => f.family)).toEqual(['left', 'contract']);
    expect(one.covers!.some((k) => k.endsWith(':turn'))).toBe(false);
    // The same contract given to someone else is a second point.
    const other = teamPlayers(s.l, elsewhere(s.l, s.t)).find((x) => x.position === 'OL')!;
    s.gm.deals = [sign(s.Y1, s.t, other, 4, 67_000)];
    const two = columnStory(s.l, s.claim()!, at());
    expect(two.covers).toContain(gmShapeKey(s.l.season, 'b:contract:turn'));
  });

  it('says "this season", "last season" or the year for when an honor was won', () => {
    const lead = ['b:left:2', 'b:record:run', 'b2:1'];
    const a = scene('gm-voice-when');
    departed(a, a.l.season);
    expect(text(a, lead).paragraphs[0]).toContain('was the defensive player of the year this season with Green Bay');
    const b = scene('gm-voice-when');
    departed(b, b.Y1);
    expect(text(b, lead).paragraphs[0]).toContain('was the defensive player of the year last season with Green Bay');
    const c = scene('gm-voice-when');
    const p = departed(c, c.Y2);
    // Honored the season before he left counts for nothing here: move the departure back so the honor follows it.
    p.left = [{ teamId: c.t, season: c.Y2, how: 'traded' }];
    expect(text(c, lead).paragraphs[0]).toContain(`was the defensive player of the year in ${c.Y2} with Green Bay`);
  });

  it('headlines the player who left by what he did since, in one way of naming teams', () => {
    const s = scene('gm-voice-left-head');
    departed(s, s.Y1);
    const story = text(s, ['b:left:1', 'b:record:run', 'b2:1']);
    expect(story.headline).toBe('Stephens left Jacksonville and was the defensive player of the year');
    expect(story.paragraphs[0]).toBe(
      `Edge rusher Jaylon Stephens was the defensive player of the year last season, with Green Bay. The Tarpons traded him in ${s.Y1}, a decision George Sutton made.`,
    );
  });

  it('names the passer who leads now as the latest, when an earlier one has come back', () => {
    const s = scene('gm-voice-qb-back');
    // A third losing season behind him, and the passers over four seasons: X, Y, Z, then Y again.
    s.gm.career.unshift({ season: s.l.season - 3, teamId: s.t });
    s.l.history.push({
      season: s.l.season - 3,
      championId: -1,
      runnerUpId: -1,
      records: Object.fromEntries(
        s.l.teams.map((x) => [x.id, { w: x.id === s.t ? 4 : 9, l: x.id === s.t ? 13 : 8, t: 0 }]),
      ),
    });
    const [x, y, z] = [
      named(teamPlayers(s.l, s.t)[0], 'Xavier', 'Xander'),
      named(teamPlayers(s.l, s.t)[1], 'Yusuf', 'Young'),
      named(teamPlayers(s.l, s.t)[2], 'Zane', 'Zeller'),
    ];
    [x, y, z, y].forEach((p, i) => {
      const season = s.l.season - 3 + i;
      p.stats[season] = { passAtt: 380 };
      p.statTeams = { ...(p.statTeams ?? {}), [season]: [s.t] };
    });
    const story = text(s, ['b:qbs:1', 'b:record:run', 'b2:1']);
    expect(story.paragraphs[0]).toContain('The latest is Yusuf Young.');
    expect(story.paragraphs[0]).not.toContain('Zeller');
    // Three quarterbacks, four seasons: he is not "on his third".
    expect(story.headline).toBe('Jacksonville have had three quarterbacks in four seasons');
  });

  it('counts head coaches over his seasons on record, not since he was hired', () => {
    const s = scene('gm-voice-coaches');
    SCENES.coaches!(s);
    const story = text(s, ['b:coaches:2', 'b:record:run', 'b2:1']);
    expect(story.paragraphs[0]).toContain(
      'have changed head coaches twice in three seasons under general manager George Sutton',
    );
    expect(story.paragraphs[0]).not.toContain('became general manager');
  });
});

/** A scene that finds one blame family and nothing else. */
const SCENES: Record<FindingFamily, ((s: ReturnType<typeof scene>) => void) | null> = {
  qbPicks: ({ l, t, Y1, Y2 }) => {
    const [a, b] = qbsOf(l, t);
    a.draft = { season: Y2, round: 1, pick: 3, teamId: t };
    b.draft = { season: Y1, round: 1, pick: 7, teamId: t };
    // Both hold jobs, so the two picks are no finding of their own.
    for (const p of [a, b]) l.teams[t].jobs!.held[p.id] = { pos: 'QB', since: 0 };
  },
  left: ({ l, t, Y1 }) => {
    const p = teamPlayers(l, t).find((x) => x.position === 'EDGE')!;
    const now = elsewhere(l, t);
    setTeam(l, p, now);
    p.left = [{ teamId: t, season: Y1, how: 'traded' }];
    l.awards.push({ season: Y1, winners: { dpoy: { playerId: p.id, teamId: now } }, allLeague: [[], []] });
  },
  starTrade: ({ l, t, gm, Y2 }) => {
    const p = teamPlayers(l, t).find((x) => x.position === 'WR')!;
    gm.deals = [
      {
        kind: 'trade',
        season: Y2,
        phase: 'resign',
        week: 1,
        teamId: t,
        otherId: elsewhere(l, t),
        gave: {
          players: [],
          picks: [
            { season: Y2, round: 1 },
            { season: Y2 + 1, round: 3 },
          ],
        },
        got: { players: [p.id], picks: [] },
      },
    ];
  },
  contract: ({ l, t, gm, Y1 }) => {
    const p = teamPlayers(l, elsewhere(l, t)).find((x) => x.position === 'OL')!;
    gm.deals = [sign(Y1, t, p, 3, 61_500)];
  },
  firsts: ({ l, t, Y1, Y2 }) => {
    const [a, b, c] = teamPlayers(l, t).filter((p) => p.position !== 'QB');
    a.draft = { season: Y2, round: 1, pick: 4, teamId: t };
    b.draft = { season: Y1, round: 1, pick: 9, teamId: t };
    c.draft = { season: l.season, round: 1, pick: 2, teamId: t };
    l.teams[t].jobs!.held[c.id] = { pos: c.position, since: 0 };
    setTeam(l, b, elsewhere(l, t));
  },
  qbs: ({ l, t, Y1, Y2 }) => {
    [Y2, Y1, l.season].forEach((season, i) => {
      const p = teamPlayers(l, t)[i];
      p.stats[season] = { passAtt: 380 };
      p.statTeams = { ...(p.statTeams ?? {}), [season]: [t] };
    });
  },
  coaches: ({ l, t, Y1, Y2 }) => {
    const hc = teamCoaches(l, t).find((c) => c.role === 'headCoach')!;
    hc.career = [{ season: l.season, teamId: t, role: 'headCoach' }];
    const [a, b] = Object.values(l.coaches).filter((c) => c.id !== hc.id);
    a.career = [{ season: Y2, teamId: t, role: 'headCoach' }];
    b.career = [{ season: Y1, teamId: t, role: 'headCoach' }];
  },
  class: null,
  lateFind: null,
};

describe('the hit pieces’ shapes', () => {
  const leads = (family: FindingFamily) =>
    SHAPES.filter((s) => s.side === 'blame' && s.role === 'lead' && s.family === family);

  it('has two lead shapes or more for every blame family, and three closes or more for each blame rung', () => {
    for (const family of FINDING_ORDER.blame) expect(leads(family).length, family).toBeGreaterThanOrEqual(2);
    for (const family of FINDING_ORDER.blame)
      expect(
        SHAPES.some((s) => s.side === 'blame' && s.role === 'turn' && s.family === family),
        family,
      ).toBe(true);
    for (const on of ['2-', '3-'] as const) {
      expect(CLOSES.filter((c) => c.on === on && !c.family).length, on).toBeGreaterThanOrEqual(3);
      for (const family of ['qbPicks', 'starTrade'] as const)
        expect(
          CLOSES.some((c) => c.on === on && c.family === family),
          `${on} ${family}`,
        ).toBe(true);
    }
    const ids = [...SHAPES.map((s) => s.id), ...CLOSES.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const family of FINDING_ORDER.blame) {
    it(`${family}: every lead shape keeps the rules, and no two open the same way`, () => {
      const openings: string[] = [];
      for (const shape of leads(family)) {
        const s = scene(`gm-shape-${family}`);
        SCENES[family]!(s);
        const c = s.claim()!;
        expect(c.findings![0].family, shape.id).toBe(family);
        // Pin the lead; the record, the turn and the close fall as they would.
        const others = leads(family).filter((x) => x.id !== shape.id);
        s.l.mailTold = Object.fromEntries(others.map((x) => [gmShapeKey(s.l.season, x.id), s.l.season]));
        const story = columnStory(s.l, c, at());
        expect(story.covers, shape.id).toContain(gmShapeKey(s.l.season, shape.id));
        expect(ruleBreaks(s.l, story), `${shape.id}: ${story.paragraphs.join(' / ')}`).toEqual([]);
        expect(story.paragraphs.join(' '), shape.id).not.toMatch(/[{}]|undefined|NaN/);
        expect(story.headline, shape.id).not.toMatch(/[{}]|undefined|NaN/);
        openings.push(story.paragraphs[0].split(' ').slice(0, 3).join(' '));
      }
      expect(new Set(openings).size, openings.join(' | ')).toBe(openings.length);
    });
  }

  it('every close keeps the rules and finishes on the man or the team', () => {
    for (const close of CLOSES.filter((c) => c.on !== '+')) {
      const s = jacksonville(`gm-close-${close.id}`);
      if (close.on === '3-') {
        s.gm.career.unshift({ season: s.l.season - 3, teamId: s.t });
        s.l.history.push({
          season: s.l.season - 3,
          championId: -1,
          runnerUpId: -1,
          records: Object.fromEntries(
            s.l.teams.map((x) => [x.id, { w: x.id === s.t ? 4 : 9, l: x.id === s.t ? 13 : 8, t: 0 }]),
          ),
        });
      }
      const have = close.on === '3-' ? [`column:${s.l.season - 1}:gm:${s.gm.id}:2-`] : [];
      if (close.family === 'starTrade') {
        for (const p of qbsOf(s.l, s.t)) delete p.draft;
        s.gm.deals = [];
        SCENES.starTrade!(s);
      }
      const c = s.claim(have)!;
      const others = CLOSES.filter((x) => x.id !== close.id);
      s.l.mailTold = Object.fromEntries(others.map((x) => [gmShapeKey(s.l.season, x.id), s.l.season]));
      const story = columnStory(s.l, c, at());
      expect(story.covers, close.id).toContain(gmShapeKey(s.l.season, close.id));
      expect(ruleBreaks(s.l, story), `${close.id}: ${story.paragraphs.at(-1)}`).toEqual([]);
    }
  });
});
