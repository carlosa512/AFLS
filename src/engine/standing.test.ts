import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { moraleContext } from './morale';
import { starters } from './roster';
import { nameCaptains } from './personality';
import {
  isNewcomer,
  leadersOf,
  voicesOf,
  seniority,
  sideOf,
  soundOf,
  tierOf,
  toneOf,
  unitOf,
  weightOf,
  type VoiceRef,
} from './standing';
import { activeRoster } from './roster';
import type { League } from './types';

const base = createLeague({ seed: 'standing' });
const fresh = () => structuredClone(base);
const wrOf = (l: League) => starters(l, l.teams[0], 'WR')[0];

describe('standing: weight', () => {
  it('seniority follows the table', () => {
    expect(seniority(0, false)).toBeCloseTo(0.6);
    expect(seniority(2, false)).toBeCloseTo(0.8);
    expect(seniority(4, false)).toBeCloseTo(1.0);
    expect(seniority(8, false)).toBeCloseTo(1.15);
    expect(seniority(12, false)).toBeCloseTo(1.15);
    expect(seniority(4, true)).toBeCloseTo(0.8);
  });

  it('rises with leadership, seniority and an honour', () => {
    const l = fresh();
    const p = wrOf(l);
    p.traits.leads = 8;
    const low = weightOf(l, p, moraleContext(l));
    p.traits.leads = 16;
    const high = weightOf(l, p, moraleContext(l));
    expect(high).toBeGreaterThan(low);
    p.experience = 1;
    const young = weightOf(l, p, moraleContext(l));
    p.experience = 6;
    expect(weightOf(l, p, moraleContext(l))).toBeGreaterThan(young);
    const before = weightOf(l, p, moraleContext(l));
    l.awards.push({
      season: l.season - 1,
      winners: { opoy: { playerId: p.id, teamId: p.teamId } },
      allLeague: [[], []],
    });
    expect(weightOf(l, p, moraleContext(l)) / before).toBeCloseTo(1.2);
  });

  it('a newcomer counts ×0.8 until he has a season at the club', () => {
    const l = fresh();
    const p = wrOf(l);
    p.statTeams = { [l.season - 1]: [p.teamId! + 1] };
    delete p.draft;
    expect(isNewcomer(l, p)).toBe(true);
    p.statTeams = { [l.season - 1]: [p.teamId!] };
    expect(isNewcomer(l, p)).toBe(false);
  });
});

describe('standing: tiers and sound', () => {
  it('a captain is always a leader', () => {
    const l = fresh();
    const p = wrOf(l);
    l.teams[0].captains = { season: l.season, offense: p.id, defense: -1, specialTeams: -1 };
    expect(tierOf(l, p, 0.1)).toBe('leader');
  });

  it('a rookie is never a leader unless he is a captain', () => {
    const l = fresh();
    const qb = starters(l, l.teams[0], 'QB')[0];
    qb.experience = 0;
    qb.traits.leads = 20;
    l.awards.push({
      season: l.season - 1,
      winners: { oroy: { playerId: qb.id, teamId: qb.teamId } },
      allLeague: [[], []],
    });
    expect(tierOf(l, qb, weightOf(l, qb, moraleContext(l)))).not.toBe('leader');
  });

  it('stirs, steadies, and stirs wins when both hold', () => {
    const p = wrOf(fresh());
    delete p.shifts;
    Object.assign(p.traits, { controversy: 14, leads: 10, temperament: 10 });
    expect(soundOf(p)).toBe('stirs');
    Object.assign(p.traits, { controversy: 10, leads: 14, temperament: 12.25 });
    expect(soundOf(p)).toBe('steadies');
    Object.assign(p.traits, { controversy: 14, leads: 14, temperament: 12.25 });
    expect(soundOf(p)).toBe('stirs');
  });

  it("units follow the position coaches' rooms", () => {
    expect(unitOf('TE')).toBe('WR');
    expect(unitOf('EDGE')).toBe('DL');
    expect(unitOf('K')).toBe('ST');
    expect(sideOf('OL')).toBe('offense');
    expect(sideOf('DB')).toBe('defense');
    expect(sideOf('ST')).toBe('specialTeams');
  });
});

describe('standing: tone', () => {
  const setup = () => {
    const l = fresh();
    return { l, ctx: moraleContext(l), p: wrOf(l) };
  };

  it('is zero with no voices around him', () => {
    const { ctx, p } = setup();
    ctx.voices = new Map();
    ctx.sideCaptains = new Map();
    expect(toneOf(p, ctx)).toBe(0);
  });

  it('stays inside −1…1 when the whole league is miserable', () => {
    const { ctx, p } = setup();
    for (const id of ctx.leans.keys()) ctx.leans.set(id, -1);
    expect(Math.abs(toneOf(p, ctx))).toBeLessThanOrEqual(1);
  });

  it('a voice who stirs pulls half again as hard when he is down', () => {
    const { ctx, p } = setup();
    const v: VoiceRef = { id: -7, weight: 1, sound: null };
    ctx.voices.set(`${p.teamId}:WR`, [v]);
    ctx.sideCaptains = new Map();
    ctx.leans.set(v.id, -1);
    const even = toneOf(p, ctx);
    v.sound = 'stirs';
    expect(toneOf(p, ctx) / even).toBeCloseTo(1.5);
  });

  it('a quiet unit-mate never counts', () => {
    const { l, ctx, p } = setup();
    const before = toneOf(p, ctx);
    const quiet = activeRoster(l, p.teamId!).find(
      (q) => unitOf(q.position) === 'WR' && q.id !== p.id && !tierOf(l, q, weightOf(l, q, ctx)),
    )!;
    ctx.leans.set(quiet.id, -1);
    expect(toneOf(p, ctx)).toBe(before);
  });

  it('his own mood never feeds his own tone', () => {
    const { ctx, p } = setup();
    ctx.voices.set(`${p.teamId}:WR`, [{ id: p.id, weight: 2, sound: null }]);
    ctx.sideCaptains = new Map();
    expect(toneOf(p, ctx)).toBe(0);
  });
});

describe('standing: who the room follows', () => {
  it('leadersOf leaves out the captains; voicesOf holds only voices', () => {
    const l = fresh();
    nameCaptains(l);
    const ctx = moraleContext(l);
    const c = l.teams[0].captains!;
    for (const p of leadersOf(l, 0)) {
      expect([c.offense, c.defense, c.specialTeams]).not.toContain(p.id);
      expect(tierOf(l, p, weightOf(l, p, ctx))).toBe('leader');
    }
    expect(voicesOf(l, 0).length).toBeGreaterThan(0);
    for (const p of voicesOf(l, 0)) expect(tierOf(l, p, weightOf(l, p, ctx))).toBe('voice');
  });
});
