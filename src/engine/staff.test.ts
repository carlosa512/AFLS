import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { simToEndOfSeason } from './league';
import { migrateLeague } from './migrate';
import { advanceOffseason, beginOffseason, simOffseason } from './offseason';
import { boardOf, draftOrder, simDraft } from './offseason/draft';
import { playerOvr } from './positions';
import { Rng } from './rng';
import { isProspect, knowledge, perceive } from './scouting';
import {
  accuracy,
  departmentScore,
  ensureStaffed,
  extendStaff,
  hireStaff,
  isExpiring,
  previewHire,
  pushedOutBy,
  readFor,
  releaseStaff,
  resignForecast,
  staffAsk,
  staffBudget,
  staffMarket,
  staffMoveProblem,
  staffPayroll,
  STAFF_SLOTS,
  staffValue,
  teamStaff,
} from './staff';
import { grossWorth, playerValue, tradeContext } from './trade';
import type { League, Player, Staff } from './types';
import { ATTRIBUTES } from './types';

/** A league one season in. Playing that season takes a couple of seconds, so suites that use it allow 30. */
const offseason = (seed: string) => {
  const league = createLeague({ seed });
  simToEndOfSeason(league);
  beginOffseason(league);
  return league;
};

/** Give the user's department a uniform quality, keeping its people and foci. */
function setQuality(league: League, rating: number) {
  for (const s of teamStaff(league, league.userTeamId)) {
    s.evaluation = rating;
    s.projection = rating;
  }
}

const errorAndWidth = (league: League, players: Player[]) => {
  let err = 0;
  let width = 0;
  for (const p of players) {
    const v = perceive(league, league.userTeamId, p);
    err += Math.abs(v.ovr - playerOvr(p));
    width += v.ovrHi - v.ovrLo;
  }
  return { err: err / players.length, width: width / players.length };
};

describe('scouting departments', () => {
  const league = createLeague({ seed: 'staff' });

  it('gives every team a Director and scouts, inside its budget', () => {
    for (const team of league.teams) {
      const staff = teamStaff(league, team.id);
      expect(staff.filter((s) => s.role === 'director')).toHaveLength(1);
      expect(staff.filter((s) => s.role === 'collegeScout').length).toBeGreaterThanOrEqual(3);
      expect(staff.filter((s) => s.role === 'proScout').length).toBeGreaterThanOrEqual(2);
      expect(staffPayroll(league, team.id)).toBeLessThanOrEqual(staffBudget(league, team.id));
    }
    expect(staffMarket(league).length).toBeGreaterThan(20);
  });

  it("starts the user's department near the league's typical sharpness", () => {
    const scores = league.teams.map((t) => departmentScore(league, t.id));
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(Math.abs(mean)).toBeLessThan(0.12);
    expect(Math.abs(departmentScore(league, league.userTeamId) - mean)).toBeLessThan(0.15);
  });

  it('reads a group with its specialist, an off-focus scout poorly, and the Director as fallback', () => {
    const mk = (role: Staff['role'], evaluation: number, focus?: Staff['focus']): Staff => ({
      id: 0,
      firstName: 'A',
      lastName: 'B',
      role,
      age: 40,
      evaluation,
      projection: evaluation,
      focus,
      teamId: 0,
      contract: null,
    });
    const director = mk('director', 12);
    const line = mk('collegeScout', 13, 'line');
    const back = mk('collegeScout', 16, 'back');
    const staff = [director, line, back];
    expect(readFor(staff, 'college', 'line', 'evaluation')).toEqual({ rating: 16, by: line });
    // Off his group the back scout reads 16 - 3 = 13, which beats the Director's 12 - 1 = 11.
    expect(readFor(staff, 'college', 'skill', 'evaluation')).toEqual({ rating: 13, by: back });
    // No pro scouts: the Director reads every pro group.
    expect(readFor(staff, 'pro', 'line', 'evaluation')).toEqual({ rating: 11, by: director });
    expect(readFor(staff, 'college', null, 'evaluation').by).toBe(director);
    // Two Directors overlap in the re-sign window: the better one reads.
    const newDirector = mk('director', 15);
    expect(readFor([director, newDirector], 'pro', 'back', 'evaluation').by).toBe(newDirector);
    expect(readFor([], 'pro', 'back', 'evaluation')).toEqual({ rating: 4, by: null });
    expect(accuracy(18)).toBeLessThan(accuracy(12));
    expect(accuracy(30)).toBeGreaterThanOrEqual(0.45);
  });

  it('makes reads sharper and ranges narrower with better staff, without hiding the truth', () => {
    const l = offseason('sharp');
    const prospects = l.draftClass
      .map((id) => l.players[id])
      .filter(isProspect)
      .slice(0, 120);
    setQuality(l, 6);
    const poor = errorAndWidth(l, prospects);
    setQuality(l, 17);
    const elite = errorAndWidth(l, prospects);
    expect(elite.err).toBeLessThan(poor.err * 0.7);
    expect(elite.width).toBeLessThan(poor.width * 0.6);
    // Ranges still bracket the truth most of the time at either end.
    for (const q of [6, 17]) {
      setQuality(l, q);
      let inside = 0;
      let total = 0;
      for (const p of prospects) {
        const v = perceive(l, l.userTeamId, p);
        for (const a of ATTRIBUTES) {
          total++;
          if (p.ratings[a] >= v.ratings[a].lo && p.ratings[a] <= v.ratings[a].hi) inside++;
        }
      }
      expect(inside / total).toBeGreaterThan(0.8);
    }
  });

  it('keeps the evaluator’s opinion when only the ceiling reader changes', () => {
    const l = offseason('readers');
    // A young pro (he gets a ceiling read) on another team.
    const p = Object.values(l.players).find((x) => x.teamId !== null && x.teamId !== l.userTeamId && x.age <= 23)!;
    const before = perceive(l, l.userTeamId, p);
    const copy = createLeagueCopy(l);
    // A projection-only specialist in his group takes the ceiling read and nothing else.
    const seer: Staff = {
      id: copy.nextStaffId++,
      firstName: 'C',
      lastName: 'Seer',
      role: 'proScout',
      age: 40,
      evaluation: 1,
      projection: 20,
      focus: undefined,
      teamId: copy.userTeamId,
      contract: { salary: 1, through: copy.season + 1 },
    };
    seer.focus = (['skill', 'line', 'front', 'back'] as const).find(
      (f) =>
        f ===
        (
          {
            QB: 'skill',
            RB: 'skill',
            WR: 'skill',
            TE: 'skill',
            OL: 'line',
            DT: 'front',
            EDGE: 'front',
            LB: 'front',
            CB: 'back',
            S: 'back',
          } as Record<string, string>
        )[p.position],
    );
    copy.staff[seer.id] = seer;
    const after = perceive(createLeagueCopy(copy), copy.userTeamId, p);
    if (p.position !== 'K' && p.position !== 'P') expect(after.potReaderId).toBe(seer.id);
    expect(after.readerId).toBe(before.readerId);
    expect(after.ovr).toBe(before.ovr);
    expect(after.ratings).toEqual(before.ratings);
  });

  it('gives a new reader his own opinion instead of just rescaling the old one', () => {
    const l = offseason('opinion');
    const p = l.players[l.draftClass[5]];
    const before = perceive(l, l.userTeamId, p);
    const reader = l.staff[before.readerId!];
    // A different man with identical ratings takes his chair: same sharpness, a partly different read.
    const swap: Staff = { ...reader, id: l.nextStaffId++ };
    l.staff[swap.id] = swap;
    reader.teamId = null;
    const after = perceive(createLeagueCopy(l), l.userTeamId, p);
    expect(after.accuracy).toBeCloseTo(before.accuracy, 6);
    expect(after.ovr).not.toBeCloseTo(before.ovr, 6);
  });

  it('never touches the league random stream when reading players', () => {
    const l = offseason('stream');
    const before = [...l.rngState];
    for (const id of l.draftClass.slice(0, 40)) for (const t of [0, 5, 9]) perceive(l, t, l.players[id]);
    expect(l.rngState).toEqual(before);
  });
});

/** JSON round trip: what a save and reload produces (and a fresh staff index). */
const createLeagueCopy = (l: League): League => JSON.parse(JSON.stringify(l)) as League;

describe('staff moves', () => {
  it('only happen in the re-sign window and free agency', () => {
    const l = createLeague({ seed: 'window' });
    const candidate = staffMarket(l)[0];
    expect(staffMoveProblem(l, l.userTeamId, candidate, 'hire')).toMatch(/re-sign window/);
    expect(() => hireStaff(l, l.userTeamId, candidate.id)).toThrow();
  });

  it('hire within budget and slots, dismiss with severance, extend only expiring deals', () => {
    const l = offseason('moves');
    const user = l.userTeamId;
    const mine = teamStaff(l, user);
    // A second Director needs the first one gone (an expiring one can be replaced, so extend him first).
    const mine0 = mine.find((s) => s.role === 'director')!;
    if (isExpiring(l, mine0)) extendStaff(l, user, mine0.id, 2);
    const director = staffMarket(l).find((s) => s.role === 'director')!;
    expect(staffMoveProblem(l, user, director, 'hire')).toMatch(/already have a Director/);
    // A scout under contract: dismissing him books half a year's salary.
    const scout = mine.find((s) => s.role !== 'director' && !isExpiring(l, s))!;
    const payrollBefore = staffPayroll(l, user);
    const salary = scout.contract!.salary;
    releaseStaff(l, user, scout.id);
    expect(scout.teamId).toBeNull();
    expect(staffPayroll(l, user)).toBe(payrollBefore - salary + Math.round(salary * 0.5));
    expect(l.teams[user].staffDead.at(-1)!.amount).toBe(Math.round(salary * 0.5));
    // Hire the cheapest candidate of that role into the open chair.
    const cheapest = staffMarket(l)
      .filter((s) => s.role === scout.role)
      .sort((a, b) => staffAsk(l, a) - staffAsk(l, b))[0];
    hireStaff(l, user, cheapest.id, 3);
    expect(cheapest.teamId).toBe(user);
    expect(cheapest.contract!.through).toBe(l.season + 2);
    // Over budget is refused with the reason.
    l.teams[user].staffBudgetMult = 0.1;
    const pricey = staffMarket(l).find((s) => s.role === scout.role)!;
    expect(staffMoveProblem(l, user, pricey, 'hire')).toMatch(/Over your staff budget/);
    l.teams[user].staffBudgetMult = 1;
    // Only expiring deals extend.
    const signed = teamStaff(l, user).find((s) => !isExpiring(l, s))!;
    expect(() => extendStaff(l, user, signed.id)).toThrow(/expiring/);
  });

  it('re-signs the user’s expiring staff when the window closes, unless he let them go', () => {
    const l = offseason('renew');
    const user = l.userTeamId;
    const expiring = teamStaff(l, user).filter((s) => isExpiring(l, s));
    expect(expiring.length).toBeGreaterThan(0);
    const [letGo, ...keep] = expiring;
    releaseStaff(l, user, letGo.id);
    advanceOffseason(l); // resign -> free agency
    expect(letGo.teamId).not.toBe(user);
    for (const s of keep) {
      expect(s.teamId).toBe(user);
      expect(s.contract!.through).toBe(l.season + 1);
    }
  });

  it('previews what a hire would change, losses included', () => {
    const l = offseason('preview');
    const user = l.userTeamId;
    const star = staffMarket(l).find((s) => s.role === 'collegeScout')!;
    star.evaluation = 20;
    star.projection = 20;
    const changes = previewHire(l, user, star);
    expect(changes.some((c) => c.to > c.from)).toBe(true);
    // Only someone he pushes out can make a read worse.
    if (!pushedOutBy(l, user, star).length) for (const c of changes) expect(c.to).toBeGreaterThan(c.from);
    // A worse Director than the incumbent shows as losses (he would replace him).
    const weak = staffMarket(l).find((s) => s.role === 'director')!;
    weak.evaluation = 2;
    weak.projection = 2;
    expect(previewHire(l, user, weak).some((c) => c.to < c.from)).toBe(true);
  });

  it('applies exactly what the re-sign forecast promised', () => {
    const l = offseason('forecast');
    const user = l.userTeamId;
    const expiring = teamStaff(l, user).filter((s) => isExpiring(l, s));
    const scout = expiring.find((s) => s.role !== 'director')!;
    expect(scout).toBeDefined();
    // Fill every chair of his role with hires: his chair is gone, and he can't be extended into it.
    while (
      teamStaff(l, user).filter((s) => s.role === scout.role && !isExpiring(l, s)).length < STAFF_SLOTS[scout.role]
    ) {
      const cheap = staffMarket(l)
        .filter((s) => s.role === scout.role)
        .sort((a, b) => staffAsk(l, a) - staffAsk(l, b))[0];
      l.teams[user].staffBudgetMult = 5; // money is not the question here
      hireStaff(l, user, cheap.id, 1);
    }
    expect(resignForecast(l, user).get(scout.id)).toBe('chair');
    expect(staffMoveProblem(l, user, scout, 'extend')).toMatch(/chair is taken/);
    // And a budget too small for anyone's raise.
    l.teams[user].staffBudgetMult = 0.05;
    const forecast = resignForecast(l, user);
    for (const s of expiring) if (s !== scout) expect(forecast.get(s.id)).toBe('budget');
    advanceOffseason(l); // the window closes
    for (const [id, outlook] of forecast) {
      const s = l.staff[id];
      if (outlook === 'stays') expect(s.teamId).toBe(user);
      else expect(s?.teamId ?? null).not.toBe(user);
    }
    for (const role of ['director', 'collegeScout', 'proScout'] as const)
      expect(teamStaff(l, user).filter((s) => s.role === role).length).toBeLessThanOrEqual(STAFF_SLOTS[role]);
  });

  it('fills an AI team’s empty chairs before the season', () => {
    const l = offseason('chairs');
    const ai = l.teams.find((t) => t.id !== l.userTeamId)!;
    const director = teamStaff(l, ai.id).find((s) => s.role === 'director')!;
    delete l.staff[director.id];
    const copy = createLeagueCopy(l); // a fresh staff index, as after a reload
    ensureStaffed(copy);
    expect(teamStaff(copy, ai.id).some((s) => s.role === 'director')).toBe(true);
  });

  // Four full seasons with every team run by the AI: about a minute here, longer on a loaded runner (CI timed out at 90 s).
  it('keeps the staff economy steady over several offseasons', () => {
    const l = createLeague({ seed: 'economy' });
    for (let y = 0; y < 4; y++) {
      simToEndOfSeason(l);
      simOffseason(l);
      const employed = Object.values(l.staff).filter((s) => s.teamId !== null);
      const mean = employed.reduce((a, s) => a + staffValue(s), 0) / employed.length;
      expect(mean).toBeGreaterThan(9);
      expect(mean).toBeLessThan(11.5);
      expect(staffMarket(l).length).toBeLessThan(60);
      for (const team of l.teams) {
        expect(teamStaff(l, team.id).some((s) => s.role === 'director')).toBe(true);
        expect(staffPayroll(l, team.id)).toBeLessThanOrEqual(staffBudget(l, team.id) * 1.05);
      }
    }
  }, 300_000);
});

describe('AI front offices on their own reads', () => {
  it('draft from boards that blend the consensus with their scouts, deterministically', () => {
    const a = offseason('ai-draft');
    while (a.phase !== 'draft') advanceOffseason(a, { autoUser: true });
    const b = createLeagueCopy(a);
    simDraft(a, new Rng('d'), { stopAtUser: false });
    simDraft(b, new Rng('d'), { stopAtUser: false });
    const picks = (l: League) => draftOrder(l).map((p) => p.playerId);
    expect(picks(a)).toEqual(picks(b));
    // Close to the consensus, but not a copy of it.
    const early = draftOrder(a).slice(0, 64);
    for (const pk of early) expect(pk.consRank).toBeDefined();
    const offBy = early.map((pk) => Math.abs(pk.overall! - pk.consRank!));
    const mean = offBy.reduce((x, y) => x + y, 0) / offBy.length;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(25);
  });

  it("misjudge other teams' players in trades only within a narrow band", () => {
    const l = createLeague({ seed: 'band' });
    const ctx = tradeContext(l);
    // A team's misread as a share of the player's stakes (his play and its market price, before his
    // salary). What he adds to a roster depends on who's already there (a small upgrade adds little,
    // a fairly paid backup about nothing), so a ratio of that would say little.
    const errors: number[] = [];
    for (const p of Object.values(l.players).filter((x) => x.teamId === l.userTeamId)) {
      for (const t of l.teams) {
        if (t.id === l.userTeamId) continue;
        const stakes = grossWorth(ctx, t, p, true);
        if (stakes > 50)
          errors.push((playerValue(l, p, t, { ctx }) - playerValue(l, p, t, { truth: true, ctx })) / stakes);
      }
    }
    errors.sort((x, y) => x - y);
    const at = (q: number) => errors[Math.min(errors.length - 1, Math.floor(errors.length * q))];
    expect(Math.abs(at(0.5))).toBeLessThan(0.02);
    // Both tails: underrating is bounded the same way.
    expect(at(0.05)).toBeGreaterThan(-0.12);
    expect(at(0.95)).toBeLessThan(0.12);
    expect(at(0.01)).toBeGreaterThan(-0.25);
    expect(at(0.99)).toBeLessThan(0.25);
    // The rare tail: a misread that tips him over a team's starter line. Shopping him to 31 teams finds
    // the one that likes him most, as it should, but for at most half his stakes again, not a fantasy price.
    expect(errors.at(-1)!).toBeLessThan(0.5);
    expect(errors[0]).toBeGreaterThan(-1);
  });

  it('build boards no worse than the consensus, and scout prospects near their own picks', () => {
    const l = offseason('boards');
    const prospects = l.draftClass.map((id) => l.players[id]).filter(isProspect);
    const rms = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
    const consensus = rms(prospects.map((p) => p.scouting!.grade - playerOvr(p)));
    for (const team of l.teams.filter((t) => t.id !== l.userTeamId)) {
      const own = rms(prospects.map((p) => boardOf(l, team.id, p).grade - playerOvr(p)));
      expect(own, team.abbrev).toBeLessThan(consensus);
    }
    // A team knows prospects around its first-round slot better than ones far from any of its picks.
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    const slots = l.draftPicks
      .filter((pk) => pk.season === l.season && pk.ownerId === team.id && pk.round <= 2)
      .map((pk) => pk.overall!);
    const ranked = [...prospects].sort(
      (a, b) =>
        0.6 * b.scouting!.grade + 0.4 * b.scouting!.ceiling - (0.6 * a.scouting!.grade + 0.4 * a.scouting!.ceiling),
    );
    const near = ranked[slots[0] - 1];
    const far = ranked.find((_, i) => slots.every((s) => i + 1 < s - 10 || i + 1 > s + 30) && i > 60 && i < 200)!;
    expect(knowledge(l, team.id, near)).toBeGreaterThan(0.45);
    expect(knowledge(l, team.id, far)).toBeLessThan(0.4);
  });

  it('keeps AI-only belief helpers out of the screens', () => {
    const dir = new URL('../ui/', import.meta.url);
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => /\.tsx?$/.test(f));
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(/\b(boardOf|viewCache)\b/);
      expect(src, f).not.toMatch(/truth:\s*true/);
    }
  });
});

describe('save migration to v4', () => {
  it('adds scouting departments and a staff market to an older save', () => {
    const league = createLeague({ seed: 'migrate-v4' });
    const v3 = createLeagueCopy(league);
    v3.version = 3;
    delete (v3 as Partial<League>).staff;
    delete (v3 as Partial<League>).nextStaffId;
    for (const t of v3.teams) {
      delete (t as Partial<typeof t>).staffBudgetMult;
      delete (t as Partial<typeof t>).staffDead;
    }
    const up = migrateLeague(v3)!;
    expect(up.version).toBe(SAVE_VERSION);
    for (const t of up.teams) expect(teamStaff(up, t.id).some((s) => s.role === 'director')).toBe(true);
    expect(staffMarket(up).length).toBeGreaterThan(0);
    // Same seed, same departments as a new league.
    expect(teamStaff(up, 3).map((s) => s.lastName)).toEqual(teamStaff(league, 3).map((s) => s.lastName));
    expect(up.rngState).toEqual(league.rngState);
  });
});
