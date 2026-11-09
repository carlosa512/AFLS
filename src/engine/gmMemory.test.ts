import { describe, expect, it, beforeEach } from 'vitest';
import { createLeague } from './generate';
import { aiGm } from './gmHabits';
import { marginFor } from './trade/judge';
import { simToEndOfSeason } from './league';
import { beginOffseason } from './offseason';
import { setTeam, teamPlayers } from './roster';
import { seasonRole } from './scouting';
import {
  KEEP_MOMENTS,
  judgeTrade,
  KEEP_SEASONS,
  memoryNewYear,
  pieceRole,
  type PieceRead,
  noteMoment,
  pruneMoments,
  standingBand,
  standingStep,
  standingWith,
  WEIGHTS,
} from './gmMemory';
import type { GeneralManager, League, YouMoment } from './types';

let l: League;
let gm: GeneralManager;
const mk = (over: Partial<YouMoment>): YouMoment => ({ kind: 'trade', season: l.season, phase: l.phase, ...over });

beforeEach(() => {
  l = createLeague({ seed: 'gm-memory' });
  gm = aiGm(l, l.teams[1])!;
});

describe('standing', () => {
  it('is neutral with no moments, and for no GM', () => {
    expect(standingWith(l, gm)).toBe(0);
    expect(standingWith(l, undefined)).toBe(0);
  });
  it('orders the weights', () => {
    expect(WEIGHTS.heWon).toBeGreaterThan(WEIGHTS.tookOffer);
    expect(WEIGHTS.tookOffer).toBeGreaterThan(0);
    expect(WEIGHTS.ledOn).toBeLessThan(0);
    expect(WEIGHTS.finalNo).toBeLessThan(WEIGHTS.ledOn);
    expect(WEIGHTS.youWon).toBeLessThan(WEIGHTS.finalNo);
  });
  it('stays within −1 … 1', () => {
    gm.withYou = Array.from({ length: 12 }, () => mk({ kind: 'finalNo' }));
    expect(standingWith(l, gm)).toBe(-1);
    gm.withYou = Array.from({ length: 12 }, () => mk({ kind: 'trade', verdict: 'heWon' }));
    expect(standingWith(l, gm)).toBe(1);
  });
  it("a stubborn GM's moment outlasts a flexible GM's", () => {
    const at = (s: number) => {
      gm.traits = { ...(gm.traits ?? l.teams[1].gm), stubbornness: s };
      gm.withYou = [mk({ kind: 'trade', season: l.season - 2, verdict: 'youWon' })];
      return standingWith(l, gm);
    };
    const stubborn = at(1);
    const flexible = at(0);
    expect(Math.abs(stubborn)).toBeGreaterThan(Math.abs(flexible));
  });
  it("a big trade's verdict counts one and a half times", () => {
    const one = (big: boolean) => {
      gm.withYou = [mk({ kind: 'trade', verdict: 'youWon', big })];
      return standingWith(l, gm) - WEIGHTS.trade;
    };
    expect(one(true)).toBeCloseTo(1.5 * one(false), 5);
  });
  it('bands and steps', () => {
    expect([0.4, 0.2, 0, -0.2, -0.4].map(standingBand)).toEqual(['warm', 'easy', 'neutral', 'cool', 'sour']);
    expect([0.35, 0.34, -0.34, -0.35].map(standingStep)).toEqual([1, 0, 0, -1]);
  });
});

describe('keeping moments', () => {
  it('keeps six seasons and twelve moments, a big trade the last to go', () => {
    gm.withYou = [mk({ kind: 'trade', big: true }), ...Array.from({ length: 12 }, () => mk({ kind: 'ledOn' }))];
    gm.withYou.push(mk({ kind: 'finalNo', season: l.season - KEEP_SEASONS - 1 }));
    pruneMoments(l, gm);
    expect(gm.withYou).toHaveLength(KEEP_MOMENTS);
    expect(gm.withYou.some((m) => m.big)).toBe(true);
    expect(gm.withYou.some((m) => m.season < l.season - KEEP_SEASONS)).toBe(false);
  });
  it('notes a moment for an AI GM, never for yours or for nobody', () => {
    noteMoment(l, gm, { kind: 'tookOffer' });
    expect(gm.withYou).toHaveLength(1);
    expect(gm.withYou![0]).toMatchObject({ kind: 'tookOffer', season: l.season, phase: l.phase });
    noteMoment(l, l.gms[l.userGmId], { kind: 'tookOffer' });
    expect(l.gms[l.userGmId].withYou).toBeUndefined();
    expect(() => noteMoment(l, undefined, { kind: 'tookOffer' })).not.toThrow();
  });
});

describe('his price', () => {
  it('moves his price with you at most six percent either way', () => {
    const t = l.teams[1];
    const o = l.teams[l.userTeamId];
    expect(marginFor(t, o, true, 1) - marginFor(t, o, true, 0)).toBeCloseTo(-0.06, 9);
    expect(marginFor(t, o, true, -1) - marginFor(t, o, true, 0)).toBeCloseTo(0.06, 9);
  });
});

describe('judged a season later', () => {
  const mkTrade = (over: Partial<YouMoment> = {}) =>
    mk({ got: { players: [1], picks: [] }, gave: { players: [2], picks: [] }, ...over });
  const reads =
    (table: Record<string, PieceRead | null>) =>
    (kind: 'player' | 'pick', id: number): PieceRead | null =>
      table[`${kind}${id}`] ?? null;
  const star: PieceRead = { role: 3, hurt: false };
  const bench: PieceRead = { role: 1, hurt: false };

  it('a starter he got against a man who barely played reads heWon', () => {
    const m = mkTrade();
    expect(judgeTrade(m, m.season + 1, reads({ player1: star, player2: bench }))).toBe('heWon');
    expect(judgeTrade(m, m.season + 1, reads({ player1: bench, player2: star }))).toBe('youWon');
  });
  it("a pick waits for its player's first season", () => {
    const m = mkTrade({ gave: { players: [], picks: [9] } });
    const r = reads({ player1: star });
    expect(judgeTrade(m, m.season + 1, r)).toBeNull();
    expect(judgeTrade(m, m.season + 2, r)).toBeNull();
  });
  it('three league years on, an unknown piece is left out', () => {
    const m = mkTrade({ gave: { players: [], picks: [9] } });
    expect(judgeTrade(m, m.season + 3, reads({ player1: star }))).toBe('heWon');
  });
  it('a man he got who barely played through injury reads brokeDown', () => {
    const m = mkTrade();
    expect(judgeTrade(m, m.season + 1, reads({ player1: { role: 1, hurt: true }, player2: star }))).toBe('brokeDown');
  });
  it('each side getting a starter or better reads both', () => {
    const m = mkTrade();
    expect(judgeTrade(m, m.season + 1, reads({ player1: star, player2: star }))).toBe('both');
  });
  it('nothing yet in the season it was made', () => {
    const m = mkTrade();
    expect(judgeTrade(m, m.season, reads({ player1: star, player2: bench }))).toBeNull();
  });
  it('a verdict never changes once set', () => {
    const m = mkTrade({ verdict: 'heWon' });
    expect(judgeTrade(m, m.season + 1, reads({ player1: bench, player2: star }))).toBeNull();
    gm.withYou = [m];
    l.season += 1;
    memoryNewYear(l);
    memoryNewYear(l);
    expect(gm.withYou[0].verdict).toBe('heWon');
  });
  it('a traded player who retired or was cut reads as gone, not unknown', () => {
    const p = Object.values(l.players).find((q) => q.teamId !== null)!;
    expect(pieceRole(l, 'player', p.id)).toEqual({ role: 0, hurt: false });
    setTeam(l, p, null);
    expect(pieceRole(l, 'player', p.id)).toEqual({ role: 0, hurt: false });
    p.retired = true;
    expect(pieceRole(l, 'player', p.id)).toEqual({ role: 0, hurt: false });
    expect(pieceRole(l, 'player', 99999999)).toEqual({ role: 0, hurt: false });
  });
  it('a pick not yet used, or missing, is unknown', () => {
    const pick = l.draftPicks[0];
    expect(pieceRole(l, 'pick', pick.id)).toBeNull();
    expect(pieceRole(l, 'pick', -5)).toBeNull();
  });
  it("judges last season's trades at the new league year", () => {
    const season = l.season;
    const mine = l.teams[l.userTeamId];
    const got = teamPlayers(l, mine.id)[0];
    const gave = teamPlayers(l, 1)[0];
    noteMoment(l, gm, {
      kind: 'trade',
      got: { players: [got.id], picks: [] },
      gave: { players: [gave.id], picks: [] },
    });
    simToEndOfSeason(l);
    beginOffseason(l);
    expect(l.season).toBe(season + 1);
    expect(gm.withYou![0].verdict).toBeDefined();
  }, 300_000);
  it('a man he got who started and then retires at the new league year still counts as a starter', () => {
    simToEndOfSeason(l);
    const starter = Object.values(l.players).find(
      (q) => q.teamId !== null && !q.retired && seasonRole(l, q, l.season)?.role === 'starter',
    )!;
    starter.age = 70; // retires for certain in the step that ages him
    noteMoment(l, gm, { kind: 'trade', got: { players: [starter.id], picks: [] } });
    l.season++;
    console.log(
      'DBG',
      JSON.stringify(pieceRole(l, 'player', starter.id)),
      JSON.stringify(seasonRole(l, starter)),
      JSON.stringify(starter.stats[l.season - 1]),
      starter.position,
    );
    l.season--;
    beginOffseason(l);
    expect(starter.retired).toBe(true);
    expect(gm.withYou![0].verdict).toBe('heWon');
  }, 300_000);
});
