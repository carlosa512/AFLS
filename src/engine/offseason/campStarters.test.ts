import { describe, expect, it } from 'vitest';
import { retireChance } from '../aging';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr, STARTERS } from '../positions';
import { setTeam, teamPlayers } from '../roster';
import { RETIRE_BODY } from '../aging';
import { campStarterSignings, startedLastSeason } from './ai';

describe("last season's starters stay in football (market and exits)", () => {
  const l = createLeague({ seed: 'camp-starters' });
  simToEndOfSeason(l);
  const season = l.season;

  it('a starter at 31 retires less than a backup with the same body and age, and a backup as before', () => {
    expect(RETIRE_BODY.starterLean).toBeGreaterThan(0);
    const p = Object.values(l.players).find((x) => x.position === 'OL' && x.age >= 33 && x.teamId !== null)!;
    const ovr = playerOvr(p);
    const before = retireChance(p, ovr);
    expect(retireChance(p, ovr, false)).toBe(before);
    if (before > 0) expect(retireChance(p, ovr, true)).toBeLessThan(before);
  });

  it('the lean starts at 31 at half strength and is whole from 32: the 30s exits and the age linemen retire both hold (2026-11-16)', () => {
    const p = structuredClone(Object.values(l.players).find((x) => x.position === 'OL' && x.teamId !== null)!);
    const at = (age: number) => {
      p.age = age;
      const base = retireChance(p, playerOvr(p));
      expect(base).toBeGreaterThan(0);
      return 1 - retireChance(p, playerOvr(p), true) / base;
    };
    expect(at(30)).toBeCloseTo(0);
    expect(at(31)).toBeCloseTo(RETIRE_BODY.starterLean * 0.5);
    expect(at(32)).toBeCloseTo(RETIRE_BODY.starterLean);
  });

  it('startedLastSeason reads snaps, and kickers and punters by games', () => {
    const started = startedLastSeason(l, season);
    const team = l.teams[3];
    for (const pos of ['QB', 'K', 'P'] as const) {
      const ps = teamPlayers(l, team.id).filter((x) => x.position === pos);
      const key = pos === 'QB' ? 'snaps' : 'gp';
      const top = [...ps].sort((a, b) => (b.stats[season]?.[key] ?? 0) - (a.stats[season]?.[key] ?? 0))[0];
      expect(started.has(top.id)).toBe(true);
    }
    expect(started.size).toBeGreaterThan(l.teams.length * 20);
  });

  it('an unsigned starter in camp is signed by a club with the need, inside its cap', () => {
    const w = structuredClone(l);
    const started = startedLastSeason(w, season);
    const p = Object.values(w.players).find(
      (x) => started.has(x.id) && x.teamId !== null && x.teamId !== w.userTeamId && x.position === 'WR',
    )!;
    setTeam(w, p, null);
    p.contract = null;
    // Camp: every AI club has a spot open (its lowest-rated player gone).
    for (const t of w.teams) {
      if (t.id === w.userTeamId) continue;
      const low = teamPlayers(w, t.id).sort((a, b) => playerOvr(a) - playerOvr(b))[0];
      setTeam(w, low, null);
    }
    const signed = campStarterSignings(w, started);
    expect(signed.map((x) => x.id)).toContain(p.id);
    const team = w.teams[w.players[p.id].teamId!];
    expect(team.id).not.toBe(w.userTeamId);
  });

  it('nobody signs him past the cap', () => {
    const w = structuredClone(l);
    const started = startedLastSeason(w, season);
    const p = Object.values(w.players).find((x) => started.has(x.id) && x.teamId !== null && x.position === 'WR')!;
    setTeam(w, p, null);
    p.contract = null;
    for (const t of w.teams) t.deadMoney.push({ season: w.season, amount: 10_000_000, playerId: -1, note: 'test' });
    expect(campStarterSignings(w, started)).toEqual([]);
    expect(w.players[p.id].teamId).toBeNull();
    expect(STARTERS.WR).toBeGreaterThan(0);
  });
});

describe('the retirement lean skips specialists', () => {
  it('a kicker or punter who started retires as before', () => {
    const l = createLeague({ seed: 'camp-starters-kp' });
    const k = Object.values(l.players).find((x) => x.position === 'P')!;
    expect(retireChance(k, playerOvr(k), true)).toBe(retireChance(k, playerOvr(k), false));
  });
});

describe('startedLastSeason reads the club he played for (final review)', () => {
  it('a starter who has since moved still counts at the club he started for, not his new one', () => {
    const l = createLeague({ seed: 'camp-starters-moved' });
    simToEndOfSeason(l);
    const season = l.season;
    const before = startedLastSeason(l, season);
    const p = Object.values(l.players).find((x) => before.has(x.id) && x.position === 'WR' && x.teamId !== null)!;
    const from = p.teamId!;
    setTeam(l, p, (from + 1) % l.teams.length);
    const after = startedLastSeason(l, season);
    // Nothing about last season changed: the same men started it, wherever they are now.
    expect([...after].sort()).toEqual([...before].sort());
  });
});
