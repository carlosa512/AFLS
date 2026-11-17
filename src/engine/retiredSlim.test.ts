import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { playWeek } from './league';
import { advanceOffseason, beginOffseason } from './offseason/index';
import { lockVerdicts, pickMark, VERDICT_YEARS } from './draftGrade';
import { activeRoster, RETIRED_KEEP } from './roster';
import { deliverMail } from './inbox';
import type { League, Player } from './types';

/** Every retired player reduced to what he keeps (`RETIRED_KEEP`), as `slimRetired` and the save upgrade leave him. */
export function slimAll(league: League): void {
  for (const p of Object.values(league.players))
    if (p.retired)
      for (const k of Object.keys(p))
        if (!RETIRED_KEEP.includes(k as keyof Player)) delete (p as unknown as Record<string, unknown>)[k];
}

// A week (or an offseason step) at a time with a yield between: played in one stretch, a season kept the test worker
// from reporting for minutes (vitest's onTaskUpdate RPC timeout), as in awards.test.ts.
const tick = () => new Promise((done) => setTimeout(done, 0));
const simToEndOfSeason = async (l: League) => {
  while (l.phase !== 'complete') {
    playWeek(l);
    await tick();
  }
};
const toPhase = async (l: League, phase: League['phase']) => {
  while (l.phase !== phase) {
    advanceOffseason(l, { autoUser: true });
    await tick();
  }
};
const season = async (l: League) => {
  await simToEndOfSeason(l);
  beginOffseason(l);
  await toPhase(l, 'regular');
};

describe('the census: a league plays on with its retired players slimmed (2026-11-17)', () => {
  // Practice squads on: the most code that walks players. Two seasons retire a class; one more plays every step over it.
  it('plays a season and its offseason over slimmed retirees', async () => {
    const l = createLeague({ seed: 'census', personnel: true });
    for (let s = 0; s < 2; s++) await season(l);
    expect(Object.values(l.players).filter((p) => p.retired).length).toBeGreaterThan(100);
    slimAll(l);
    await season(l);
  }, 600_000);
});

describe('retirement slims a player (2026-11-17)', () => {
  it('a camp castoff keeps his record through the season (a friend left behind still misses him), slimmed at the new league year', async () => {
    const l = createLeague({ seed: 'slim-castoffs', personnel: true });
    // The first camp that sends a castoff out of football (finds the scene rather than pinning a seed).
    let gone: Player[] = [];
    for (let s = 0; s < 4 && !gone.length; s++) {
      await simToEndOfSeason(l);
      beginOffseason(l);
      await toPhase(l, 'preseason');
      const released = [...(l.personnel!.futures?.released ?? [])];
      await toPhase(l, 'regular');
      gone = released.map((id) => l.players[id]).filter((p) => p.retired);
    }
    expect(gone.length).toBeGreaterThan(0);
    for (const p of gone) expect(p.ratings, `${p.id}`).toBeDefined();
    await simToEndOfSeason(l);
    beginOffseason(l);
    for (const p of gone)
      expect(
        Object.keys(p).filter((k) => !RETIRED_KEEP.includes(k as keyof Player)),
        `${p.id}`,
      ).toEqual([]);
  }, 600_000);

  it('at the new league year every retired player keeps only what he keeps', async () => {
    const l = createLeague({ seed: 'slim-at-retirement', personnel: true });
    await season(l);
    await season(l);
    await simToEndOfSeason(l);
    beginOffseason(l);
    const retired = Object.values(l.players).filter((p) => p.retired);
    expect(retired.length).toBeGreaterThan(50);
    // `ties` aside: a mentor who retired can still befriend his mentee when their pair ends a few weeks on (older
    // behaviour, left alone here because changing it changes play).
    for (const p of retired)
      expect(
        Object.keys(p).filter((k) => !RETIRED_KEEP.includes(k as keyof Player) && k !== 'ties'),
        `${p.id}`,
      ).toEqual([]);
  }, 600_000);
});

describe("a retired pick's draft grade (2026-11-17)", () => {
  it('locks when he retires, before slimming, and his card reads it after', async () => {
    const l = createLeague({ seed: 'slim-at-retirement', personnel: true });
    await season(l);
    await season(l);
    // At the new league year, when the year's retirees and last camp's castoffs are slimmed.
    await simToEndOfSeason(l);
    beginOffseason(l);
    // Picks from this league's own drafts (a founding veteran's draft line is made up and never graded).
    const first = createLeague({ seed: 'slim-at-retirement', personnel: true }).season;
    const early = Object.values(l.players).filter((p) => p.retired && p.draft && p.draft.season > first);
    expect(early.length).toBeGreaterThan(0);
    // A pick who never played is graded by nobody (`pickMark`), retired or not.
    for (const p of early.filter((x) => x.experience > 0)) {
      expect(p.draft!.verdict, `${p.id}`).toBeDefined();
      expect(pickMark(l, p)).toEqual({ verdict: p.draft!.verdict, locked: true });
    }
    // His draft day stays in the draft history: the consensus read when he was taken.
    for (const p of early) expect(p.scouting, `${p.id}`).toBeDefined();
    // Three years on, the yearly lock passes over a slimmed pick it can no longer read; his card still answers.
    l.season += VERDICT_YEARS;
    expect(() => lockVerdicts(l)).not.toThrow();
    for (const p of early) expect(() => pickMark(l, p)).not.toThrow();
  }, 600_000);
});

describe('what a retirement letter still knows (2026-11-17)', () => {
  it('a player who retires over his concussions says so in his letter, after he is slimmed', async () => {
    const l = createLeague({ seed: 'slim-concussions' });
    const p = activeRoster(l, l.userTeamId).find((x) => x.position === 'LB')!;
    p.age = 44;
    // He finished the season with us: the letter is ours.
    p.statTeams = { [l.season]: [l.userTeamId] };
    p.stats = { [l.season]: { gp: 17 } };
    p.injuries = [1, 2, 3, 4].map((w) => ({
      type: 'concussion',
      severity: 'moderate' as const,
      season: l.season,
      week: w * 3,
      weeks: 2,
    }));
    l.phase = 'complete';
    beginOffseason(l);
    expect(p.retired).toBe(true);
    deliverMail(l);
    const letter = l.inbox!.find((m) => m.id === `retirement:${l.season}:${p.id}`)!;
    expect(letter.body).toContain('4 concussions');
  });
});
