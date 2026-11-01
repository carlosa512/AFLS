import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { beginOffseason } from './offseason';
import {
  addJolt,
  DOWN_REASONS,
  promisesScore,
  liveSize,
  moraleAdvance,
  moraleClock,
  moraleLevel,
  moraleWeek,
  MORALE_WORDS,
  moraleContext,
  moraleFactors,
  moraleReasons,
  moraleStepOf,
  moraleTarget,
  moraleView,
  moodLean,
  moodPull,
  moraleMean,
  type MoraleFactors,
  heardWeight,
  QUIET,
} from './morale';
import { playerOvr, STARTERS } from './positions';
import { leagueMarket, resetLeagueMarket } from './finance/market';
import { activeRoster } from './roster';
import type { League, Player } from './types';

const league = createLeague({ seed: 'morale' });
const team0 = activeRoster(league, 0);

/** His team's best at his position: a starter by rank. */
function starter(pos: Player['position'] = 'WR'): Player {
  return team0.filter((p) => p.position === pos).sort((a, b) => playerOvr(b) - playerOvr(a))[0];
}

/** A veteran on a veteran deal: the best such man on team 0. */
function veteran(): Player {
  return team0
    .filter((p) => p.contract?.kind === 'veteran' && p.experience >= 3)
    .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
}

/** A copy of the league with one player replaced, so a test can change him without touching the shared league. */
function withPlayer(p: Player): League {
  return { ...league, players: { ...league.players, [p.id]: p } };
}

const ZERO: MoraleFactors = { contract: 0, role: 0, team: 0, room: 0, promises: 0, rest: 0 };

describe('morale: the factors', () => {
  it('reads a starter paid half his market as unhappy with his deal, more so in his final year', () => {
    const s = veteran();
    const ctx = moraleContext(league);
    const paid = moraleFactors(league, s, ctx).contract;
    const half: Player = {
      ...s,
      contract: { ...s.contract!, apy: s.contract!.apy / 2, years: s.contract!.years.slice(0, 3) },
    };
    const under = moraleFactors(withPlayer(half), half, ctx).contract;
    const last: Player = { ...half, contract: { ...half.contract!, years: half.contract!.years.slice(0, 1) } };
    const final = moraleFactors(withPlayer(last), last, ctx).contract;
    expect(under).toBeLessThan(paid);
    expect(final).toBeLessThan(under);
    expect(final).toBeGreaterThanOrEqual(-4);
  });

  it('never reads a rookie deal in its first seasons as a grievance', () => {
    const s = starter();
    const rookie: Player = {
      ...s,
      experience: 1,
      contract: { ...s.contract!, kind: 'rookie', apy: 100 },
    };
    expect(moraleFactors(withPlayer(rookie), rookie, moraleContext(league)).contract).toBeGreaterThanOrEqual(0);
  });

  it('caps a contract at its range', () => {
    const s = starter();
    const rich: Player = { ...s, contract: { ...s.contract!, apy: s.contract!.apy * 50 } };
    expect(moraleFactors(withPlayer(rich), rich, moraleContext(league)).contract).toBeLessThanOrEqual(2);
  });

  it('reads a starter who has not played after three games as wanting more snaps', () => {
    const s = { ...starter(), experience: 4 };
    const ctx = moraleContext(league);
    ctx.records.get(0)!.w = 3;
    ctx.live.WR = 300;
    expect(moraleFactors(league, s, ctx).role).toBeLessThan(0);
    expect(moraleFactors(league, s, ctx).role).toBeGreaterThanOrEqual(-3);
  });

  it("doesn't count the games a starter missed hurt against his role", () => {
    const base = starter();
    const ctx = moraleContext(league);
    Object.assign(ctx.records.get(0)!, { w: 6, l: 2 });
    ctx.live.WR = 480; // 60 snaps a game over eight games
    // Hurt for six of eight, healthy again, a starter's snaps in the two he played.
    const back = {
      ...base,
      experience: 4,
      injuries: [{ type: 'Hamstring', severity: 'moderate', season: league.season, week: 2, weeks: 6 }],
      stats: { [league.season]: { gp: 2, snaps: 120 } },
    } as Player;
    expect(moraleFactors(withPlayer(back), back, ctx).role).toBe(0);
    // A healthy starter who sat those games is benched.
    const sat = { ...back, injuries: [] } as Player;
    expect(moraleFactors(withPlayer(sat), sat, ctx).role).toBeLessThan(0);
    // Back but yet to play since: one healthy game is no read, so last season's role stands.
    Object.assign(ctx.records.get(0)!, { w: 5, l: 2 });
    ctx.live.WR = 420;
    const none = { ...back, stats: { ...base.stats, [league.season]: { gp: 1, snaps: 60 } } } as Player;
    expect(moraleFactors(withPlayer(none), none, ctx).role).toBe(0);
  });

  it('never reads a hurt backup as a starter: only regular-season weeks missed count, and never below the games he dressed', () => {
    const ol = team0.filter((p) => p.position === 'OL').sort((a, b) => playerOvr(b) - playerOvr(a));
    const ctx = moraleContext(league);
    Object.assign(ctx.records.get(0)!, { w: 6, l: 2 });
    ctx.live.OL = 480;
    const backup = { ...ol[STARTERS.OL + 1], experience: 5 };
    const hurt = (injuries: object[], gp: number, snaps: number) =>
      ({ ...backup, injuries, stats: { [league.season]: { gp, snaps } } }) as Player;
    // Played through a six-week injury, every game, a backup's snaps: still a backup, content.
    const through = hurt([{ type: 'Ankle', severity: 'moderate', season: league.season, week: 2, weeks: 6 }], 8, 60);
    expect(moraleFactors(withPlayer(through), through, ctx).role).toBe(0);
    // Hurt in camp, healed before week 1: none of his eight games was missed.
    const camp = hurt([{ type: 'Ankle', severity: 'moderate', season: league.season, week: 0, weeks: 1 }], 8, 60);
    expect(moraleFactors(withPlayer(camp), camp, ctx).role).toBe(0);
    // Two injuries over the same weeks count those weeks once.
    const twice = hurt(
      [
        { type: 'Ankle', severity: 'moderate', season: league.season, week: 2, weeks: 3 },
        { type: 'Knee', severity: 'moderate', season: league.season, week: 3, weeks: 3 },
      ],
      4,
      30,
    );
    expect(moraleFactors(withPlayer(twice), twice, ctx).role).toBe(0);
  });

  it('reads a depth player who sits as content: he knows the starters are better', () => {
    const ol = team0.filter((p) => p.position === 'OL').sort((a, b) => playerOvr(b) - playerOvr(a));
    const ctx = moraleContext(league);
    ctx.records.get(0)!.w = 3;
    ctx.live.OL = 300;
    // The seventh man in a five-starter room, a veteran with no snaps: depth, and he knows it.
    expect(moraleFactors(league, { ...ol[STARTERS.OL + 1], experience: 5 }, ctx).role).toBe(0);
    // A depth man who gets on the field anyway likes it.
    const sixth = {
      ...ol[STARTERS.OL + 1],
      experience: 5,
      stats: { [league.season]: { gp: 3, snaps: 150 } },
    } as Player;
    expect(moraleFactors(withPlayer(sixth), sixth, ctx).role).toBeGreaterThan(0);
  });

  it('reads a backup with no games yet as content: no role to compare', () => {
    const backup = team0
      .filter((p) => p.position === 'WR')
      .sort((a, b) => playerOvr(b) - playerOvr(a))
      .at(-1)!;
    expect(moraleFactors(league, backup, moraleContext(league)).role).toBe(0);
    expect(STARTERS.WR).toBeGreaterThan(0);
  });

  it('reads winning as good for the team factor, more for a man who wants to win', () => {
    const s = starter();
    const ctx = moraleContext(league);
    Object.assign(ctx.records.get(0)!, { w: 10, l: 2 });
    const keen: Player = { ...s, personality: { ...s.personality, winning: 1 } };
    const cool: Player = { ...s, personality: { ...s.personality, winning: 0 } };
    const k = moraleFactors(withPlayer(keen), keen, ctx).team;
    const c = moraleFactors(withPlayer(cool), cool, ctx).team;
    expect(c).toBeGreaterThan(0);
    expect(k).toBeGreaterThan(c);
    expect(k).toBeLessThanOrEqual(2);
    Object.assign(ctx.records.get(0)!, { w: 1, l: 11 });
    expect(moraleFactors(withPlayer(keen), keen, ctx).team).toBeLessThan(0);
  });

  it('reads a feud as down and the C as up for the locker room', () => {
    const [a, b] = team0;
    const base = moraleFactors(league, { ...a, ties: [] }, moraleContext(league)).room;
    const feud: Player = { ...a, ties: [{ kind: 'feud', with: b.id, since: league.season }] };
    expect(moraleFactors(withPlayer(feud), feud, moraleContext(league)).room).toBeLessThan(base);
    const captained: League = {
      ...league,
      teams: league.teams.map((t) =>
        t.id === 0
          ? { ...t, captains: { season: league.season, offense: a.id, defense: b.id, specialTeams: b.id } }
          : t,
      ),
    };
    const cap = { ...a, ties: [] };
    expect(moraleFactors(captained, cap, moraleContext(captained)).room).toBeGreaterThan(base);
  });

  it('rests a calm, patient, loyal man above a volatile, impatient one', () => {
    const s = starter();
    const calm: Player = {
      ...s,
      shifts: undefined,
      traits: { ...s.traits, temperament: 18 },
      personality: { ...s.personality, patience: 1, loyalty: 1 },
    };
    const hot: Player = {
      ...s,
      shifts: undefined,
      traits: { ...s.traits, temperament: 3 },
      personality: { ...s.personality, patience: 0, loyalty: 0 },
    };
    const ctx = moraleContext(league);
    const r1 = moraleFactors(withPlayer(calm), calm, ctx).rest;
    const r2 = moraleFactors(withPlayer(hot), hot, ctx).rest;
    expect(r1).toBeGreaterThan(0);
    expect(r2).toBeLessThan(0);
    expect(Math.abs(r1)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(r2)).toBeLessThanOrEqual(1.5);
  });

  it('leaves promises at zero until players can be promised anything', () => {
    for (const p of team0.slice(0, 10)) expect(moraleFactors(league, p, moraleContext(league)).promises).toBe(0);
  });
});

describe('morale: the target and the words', () => {
  it('adds the factors and clamps the sum', () => {
    expect(moraleTarget({ ...ZERO, contract: 1, role: -2, rest: 0.5 })).toBeCloseTo(-0.5);
    expect(moraleTarget({ contract: 9, role: 9, team: 9, room: 9, promises: 0, rest: 9 })).toBe(10);
    expect(moraleTarget({ contract: -9, role: -9, team: -9, room: -9, promises: 0, rest: -9 })).toBe(-10);
  });

  it('maps every band to its word', () => {
    const cases: [number, string][] = [
      [10, 'Superb'],
      [6, 'Superb'],
      [5.99, 'Very good'],
      [3, 'Very good'],
      [2.99, 'Good'],
      [1, 'Good'],
      [0.99, 'Okay'],
      [-0.99, 'Okay'],
      [-1, 'Poor'],
      [-2.99, 'Poor'],
      [-3, 'Very poor'],
      [-5.99, 'Very poor'],
      [-6, 'Abysmal'],
      [-10, 'Abysmal'],
    ];
    for (const [level, word] of cases) expect(MORALE_WORDS[moraleStepOf(level)], String(level)).toBe(word);
  });

  it('gives reasons in words only, biggest first, at most three', () => {
    const p = starter();
    const f: MoraleFactors = { ...ZERO, contract: -3, role: -1, team: 1.5, room: 0.8 };
    const reasons = moraleReasons(league, p, f);
    expect(reasons).toEqual(['Wants a new deal', 'Loving the winning', 'Wants more snaps']);
    for (const r of reasons) expect(r).not.toMatch(/\d/);
    expect(moraleReasons(league, p, { ...ZERO, contract: 0.5 })).toEqual([]);
    // A man low by nature gets that as his reason, so nobody is down for nothing.
    expect(moraleReasons(league, p, { ...ZERO, rest: -1.2 })).toEqual(['Hard to please']);
  });
});

describe('morale: what a screen may see', () => {
  it('shows your own players only, and only once they have a mood', () => {
    const mine = team0[0];
    const theirs = activeRoster(league, 1)[0];
    const moody = (p: Player): Player => ({ ...p, morale: { level: 2, jolts: [] } });
    const l = { ...league, players: { ...league.players, [mine.id]: moody(mine), [theirs.id]: moody(theirs) } };
    expect(moraleView(l, l.players[mine.id])).toMatchObject({ step: 5, word: 'Good' });
    expect(moraleView(l, l.players[theirs.id])).toBeNull();
    expect(moraleView(league, { ...mine, morale: undefined })).toBeNull();
  });
});

describe('morale: moving the mood', () => {
  it('starts every rostered player of a new league at his target, with no jolts', () => {
    const l = createLeague({ seed: 'morale-seed' });
    const ctx = moraleContext(l);
    for (const p of Object.values(l.players)
      .filter((x) => x.teamId !== null)
      .slice(0, 50)) {
      expect(p.morale!.jolts).toBeUndefined();
      expect(p.morale!.level).toBeCloseTo(moraleTarget(moraleFactors(l, p, ctx)));
    }
  });

  it('takes a week once: a second call for the same week changes nothing', () => {
    const l = createLeague({ seed: 'morale-once' });
    for (const p of Object.values(l.players)) if (p.morale) p.morale.level = 8;
    moraleWeek(l);
    const once = JSON.stringify(Object.values(l.players).map((p) => p.morale));
    moraleWeek(l);
    expect(JSON.stringify(Object.values(l.players).map((p) => p.morale))).toBe(once);
  });

  it('walks a level toward its target and never out of range', () => {
    const l = createLeague({ seed: 'morale-walk' });
    const p = activeRoster(l, 3)[0];
    const target = moraleTarget(moraleFactors(l, p));
    p.morale = { level: target > 0 ? -10 : 10, jolts: [] };
    const start = moraleClock(l);
    let gap = Math.abs(p.morale.level - target);
    for (let w = 1; w <= 40; w++) {
      moraleAdvance(l, start + w);
      const now = Math.abs(p.morale.level - target);
      expect(now).toBeLessThanOrEqual(gap + 1e-9);
      expect(Math.abs(moraleLevel(l, p))).toBeLessThanOrEqual(10);
      gap = now;
    }
    expect(gap).toBeLessThan(0.1);
  });

  it('halves a jolt every two weeks, drops it once it is small, and keeps four at most', () => {
    const at = 2026 * 32 + 10;
    const j = { kind: 'benched' as const, size: -3, at };
    expect(liveSize(j, at)).toBe(-3);
    expect(liveSize(j, at + 2)).toBeCloseTo(-1.5);
    const l = createLeague({ seed: 'morale-jolts' });
    const p = activeRoster(l, 2)[0];
    const clock = moraleClock(l);
    p.morale = {
      level: 0,
      jolts: [
        { kind: 'paid', size: 3, at: clock },
        { kind: 'captain', size: 2, at: clock },
        { kind: 'playoffs', size: 2, at: clock },
        { kind: 'friendGone', size: -2, at: clock },
        { kind: 'benched', size: -0.5, at: clock },
      ],
    };
    moraleAdvance(l, clock + 1);
    expect(p.morale!.jolts!.map((x) => x.kind)).toEqual(['paid', 'captain', 'playoffs', 'friendGone']);
    moraleAdvance(l, clock + 12);
    expect(p.morale!.jolts).toBeUndefined();
  });

  it('sets a free agent at wanting a job, and keeps no mood for retired players or prospects', () => {
    const l = createLeague({ seed: 'morale-fa' });
    const [fa, gone] = activeRoster(l, 4);
    fa.teamId = null;
    fa.contract = null;
    fa.morale = { level: 5, jolts: [{ kind: 'paid', size: 3, at: moraleClock(l) }] };
    gone.teamId = null;
    gone.retired = true;
    const start = moraleClock(l);
    for (let w = 1; w <= 30; w++) moraleAdvance(l, start + w);
    expect(fa.morale!.jolts).toBeUndefined();
    expect(fa.morale!.level).toBeCloseTo(-1, 1);
    expect(gone.morale).toBeUndefined();
  });
});

describe('morale: a season played', () => {
  const l = createLeague({ seed: 'morale-season' });
  simToEndOfSeason(l);
  beginOffseason(l);

  it('benches a starter whose room passed him at the new league year, once', () => {
    const benched = Object.values(l.players).filter((p) => p.morale?.jolts?.some((j) => j.kind === 'benched'));
    expect(benched.length).toBeGreaterThan(0);
    for (const p of benched) expect(p.morale!.jolts!.filter((j) => j.kind === 'benched')).toHaveLength(1);
    const clock = moraleClock(l);
    moraleAdvance(l, clock);
    for (const p of benched) expect(p.morale!.jolts!.filter((j) => j.kind === 'benched')).toHaveLength(1);
  });

  it('keeps every level in range through a season', () => {
    for (const p of Object.values(l.players)) {
      if (!p.morale) continue;
      expect(Math.abs(p.morale.level)).toBeLessThanOrEqual(10);
      expect(Math.abs(moraleLevel(l, p))).toBeLessThanOrEqual(10);
      expect(p.morale.jolts?.length ?? 0).toBeLessThanOrEqual(4);
    }
    for (const id of l.draftClass) expect(l.players[id].morale).toBeUndefined();
  });
}, 60_000);

describe('morale: what a save keeps', () => {
  it('keeps a mood small: no empty jolt list, one clock per jolt, no per-player key for a club’s moments', () => {
    const l = createLeague({ seed: 'morale-small' });
    const p = activeRoster(l, 5)[0];
    expect(JSON.stringify(p.morale)).not.toContain('jolts');
    p.ties = [];
    // Camp: the captains are named, and the C lands the step it happens.
    l.phase = 'preseason';
    delete l.moraleAt;
    l.teams[5].captains = { season: l.season, offense: p.id, defense: p.id, specialTeams: p.id };
    moraleAdvance(l, moraleClock(l));
    const m = p.morale!;
    expect(m.jolts).toHaveLength(1);
    expect(Object.keys(m.jolts![0]).sort()).toEqual(['at', 'kind', 'size']);
    expect(m.seen).toBeUndefined();
    // Still captain a week on: no second C.
    l.phase = 'regular';
    moraleAdvance(l, moraleClock(l));
    expect(p.morale!.jolts!.filter((j) => j.kind === 'captain')).toHaveLength(1);
  });

  it('fires the playoff jolt once per club, the step it clinches, and keeps no key on the players', () => {
    const l = createLeague({ seed: 'morale-clinch' });
    simToEndOfSeason(l);
    const clinched = Object.values(l.players).filter((p) => p.morale?.jolts?.some((j) => j.kind === 'playoffs'));
    expect(clinched.length).toBeGreaterThan(0);
    // Once per club: a man cut by one club that clinched and signed by another feels both, so he's left out here.
    const moved = (p: Player) =>
      l.transactions.some(
        (t) =>
          t.season === l.season &&
          ['sign', 'release', 'claim', 'trade', 'waiver'].includes(t.kind) &&
          t.text.includes(`${p.firstName} ${p.lastName}`),
      );
    for (const p of clinched.filter((x) => !moved(x)))
      expect(p.morale!.jolts!.filter((j) => j.kind === 'playoffs')).toHaveLength(1);
    expect(Object.values(l.players).some((p) => p.morale?.seen?.includes('playoffs'))).toBe(false);
  }, 60_000);
});

describe('morale reads the league without leaving anything behind', () => {
  it('never fills the pay market’s cache: a later read sees the league as it is then', () => {
    const l = createLeague({ seed: 'morale-market' });
    // Whatever building the league cached is its own business; from here, only morale reads the market.
    resetLeagueMarket(l);
    moraleAdvance(l, moraleClock(l) + 1);
    // Ratings move inside a step (development lands week by week); the market's key can't see that.
    const p = activeRoster(l, 6).find((x) => x.position === 'K')!;
    for (const k of Object.keys(p.ratings) as (keyof typeof p.ratings)[]) p.ratings[k] = 20;
    expect(leagueMarket(l).ovrs.K[0]).toBeCloseTo(playerOvr(p));
  });
});

describe('morale: what promises leave behind (G3)', () => {
  const l = createLeague({ seed: 'morale-promises' });
  const base = activeRoster(l, 7)[0];
  const withTalk = (kept?: number, broken?: number): Player => ({
    ...base,
    morale: { level: 0, talk: { club: 7, ...(kept ? { kept } : {}), ...(broken ? { broken } : {}) } },
  });

  it('scores kept and broken promises he remembers, clamped', () => {
    expect(promisesScore({ ...base, morale: { level: 0 } })).toBe(0);
    expect(promisesScore(withTalk(1))).toBe(0.5);
    expect(promisesScore(withTalk(0, 1))).toBe(-1.5);
    expect(promisesScore(withTalk(0, 3))).toBe(-3);
    expect(promisesScore(withTalk(4))).toBe(1);
  });

  it('names a broken promise and a lost trust as reasons that weigh on him', () => {
    const at = moraleClock(l);
    const p: Player = { ...withTalk(), morale: { level: 0, jolts: [{ kind: 'broken', size: -4, at }] } };
    expect(moraleReasons(l, p, { ...ZERO }, at)).toContain('You broke your word');
    expect(moraleReasons(l, p, { ...ZERO, promises: -1.5 }, at)).toContain("Doesn't trust your word");
    for (const r of ['You broke your word', "Doesn't trust your word", "Didn't like your answer", 'Feels ignored'])
      expect(DOWN_REASONS.has(r)).toBe(true);
    expect(DOWN_REASONS.has('You kept your word')).toBe(false);
  });

  it('keeps four jolts at most when one is added', () => {
    const at = moraleClock(l);
    const p: Player = { ...base, morale: { level: 0 } };
    for (const [kind, size] of [
      ['paid', 3],
      ['captain', 2],
      ['reassured', 1],
      ['kept', 2],
      ['broken', -4],
    ] as const)
      addJolt(p, kind, size, at);
    expect(p.morale!.jolts!.map((j) => j.kind).sort()).toEqual(['broken', 'captain', 'kept', 'paid']);
  });
});

describe('morale: the scale its effects read (G2)', () => {
  it('leans −1…+1: Superb +1, Abysmal −1, Okay 0', () => {
    expect(moodLean(6)).toBe(1);
    expect(moodLean(10)).toBe(1);
    expect(moodLean(-6)).toBe(-1);
    expect(moodLean(0)).toBe(0);
    expect(moodLean(3)).toBe(0.5);
  });

  it('pulls against the league: nothing at the mean', () => {
    expect(moodPull(1, 1)).toBe(0);
    expect(moodPull(4, 1)).toBe(0.5);
    expect(moodPull(10, -2)).toBe(1);
  });

  it('averages the rostered players only', () => {
    const l = structuredClone(league);
    for (const p of Object.values(l.players)) if (p.teamId !== null) p.morale = { level: 2, jolts: [] };
    // A free agent, unhappy as they come, doesn't count.
    const id = Math.max(...Object.keys(l.players).map(Number)) + 1;
    l.players[id] = { ...structuredClone(team0[0]), id, teamId: null, morale: { level: -10, jolts: [] } };
    expect(moraleMean(l)).toBeCloseTo(2, 9);
  });

  it('tells a screen what it costs him, for your players only', () => {
    const l = structuredClone(league);
    const [p] = activeRoster(l, l.userTeamId);
    p.morale = { level: -4, jolts: [] };
    expect(moraleView(l, p)!.effect).toBe('costing');
    p.morale = { level: 4, jolts: [] };
    expect(moraleView(l, p)!.effect).toBe('lifting');
    p.morale = { level: 0, jolts: [] };
    expect(moraleView(l, p)!.effect).toBeUndefined();
    const theirs = activeRoster(l, (l.userTeamId + 1) % 32)[0];
    theirs.morale = { level: -8, jolts: [] };
    expect(moraleView(l, theirs)).toBeNull();
  });
});

describe('morale: being heard (G4 part 1)', () => {
  /** An underpaid man on team 0 whose contract weighs on him, with no talks on file. */
  function sour() {
    const l = createLeague({ seed: 'morale-heard' });
    const ctx = moraleContext(l);
    const p = activeRoster(l, 0)
      .filter((x) => x.morale)
      .map((x) => ({ x, c: moraleFactors(l, x, ctx).contract }))
      .sort((a, b) => a.c - b.c)[0].x;
    delete p.morale!.talk;
    const clock = l.moraleAt!;
    const base = moraleFactors(l, p, ctx);
    return { l, ctx, p, clock, base };
  }

  it('an open deal promise leaves a quarter of a negative contract factor', () => {
    const { l, ctx, p, clock, base } = sour();
    expect(base.contract).toBeLessThanOrEqual(-1);
    p.morale!.talk = { club: p.teamId!, promise: { kind: 'deal', made: clock, due: clock + 20 } };
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(0.25 * base.contract, 9);
  });

  it('scales by trust: one broken leaves 0.4375, four or more all of it', () => {
    const { l, ctx, p, clock, base } = sour();
    p.morale!.talk = { club: p.teamId!, broken: 1, promise: { kind: 'deal', made: clock, due: clock + 20 } };
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(0.4375 * base.contract, 9);
    p.morale!.talk.broken = 4;
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(base.contract, 9);
  });

  it('a reassurance takes a quarter off the factor it answered until the quiet ends, an eighth the second time', () => {
    const { l, ctx, p, clock, base } = sour();
    p.morale!.talk = {
      club: p.teamId!,
      reassured: 1,
      answered: { reply: 'reassure', at: clock, ask: clock, cause: 'deal' },
    };
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(0.75 * base.contract, 9);
    p.morale!.talk.reassured = 2;
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(0.875 * base.contract, 9);
    l.moraleAt = clock + QUIET;
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(base.contract, 9);
  });

  it('softens only the factor answered, never a positive one, nothing without a cause', () => {
    const { l, ctx, p, clock, base } = sour();
    p.morale!.talk = { club: p.teamId!, promise: { kind: 'snaps', made: clock, left: 4 } };
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(base.contract, 9);
    expect(heardWeight(p, 'role', clock)).toBeCloseTo(0.25, 9);
    p.morale!.talk = { club: p.teamId!, reassured: 1, answered: { reply: 'reassure', at: clock, ask: clock } };
    expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(base.contract, 9);
    // A happy factor is never scaled down.
    const happy = activeRoster(l, 0).find((x) => x.morale && moraleFactors(l, x, ctx).team > 0.2);
    if (happy) {
      const before = moraleFactors(l, happy, ctx).team;
      happy.morale!.talk = {
        club: happy.teamId!,
        reassured: 1,
        answered: { reply: 'reassure', at: clock, ask: clock, cause: 'losing' },
      };
      expect(moraleFactors(l, happy, ctx).team).toBeCloseTo(before, 9);
    }
  });

  it('reads "Waiting on his new deal" while a deal promise is open', () => {
    const { l, ctx, p, clock } = sour();
    p.morale!.talk = { club: p.teamId!, broken: 4, promise: { kind: 'deal', made: clock, due: clock + 20 } };
    const reasons = moraleReasons(l, p, moraleFactors(l, p, ctx));
    expect(reasons).toContain('Waiting on his new deal');
    expect(reasons).not.toContain('Wants a new deal');
    expect(DOWN_REASONS.has('Waiting on his new deal')).toBe(true);
    expect(DOWN_REASONS.has('Waiting on his snaps')).toBe(true);
  });
});
