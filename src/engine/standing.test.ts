import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { moraleContext } from './morale';
import { releasePlayer } from './finance/cap';
import { nameCaptains } from './personality';
import { activeRoster, starters } from './roster';
import {
  isNewcomer,
  roomView,
  standingView,
  unitRead,
  type Unit,
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
import type { League, Player } from './types';

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

  it("last season's captains still lead the room until camp names new ones", () => {
    const l = fresh();
    const p = wrOf(l);
    l.phase = 'resign';
    l.teams[0].captains = { season: l.season - 1, offense: p.id, defense: -1, specialTeams: -1 };
    expect(tierOf(l, p, 0.1)).toBe('leader');
    l.phase = 'regular';
    expect(tierOf(l, p, 0.1)).toBeNull();
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

describe('standing: a unit read', () => {
  const levels = (l: League, unit: Unit, f: (i: number) => number) =>
    activeRoster(l, 0)
      .filter((p) => unitOf(p.position) === unit)
      .forEach((p, i) => {
        p.morale = { level: f(i) };
      });

  it('reads Tight, Down and Split off the weighted levels', () => {
    const l = fresh();
    levels(l, 'OL', () => 2);
    expect(unitRead(l, 0, 'OL', moraleContext(l))!.word).toBe('Tight');
    levels(l, 'OL', () => -4);
    expect(unitRead(l, 0, 'OL', moraleContext(l))!.word).toBe('Down');
    levels(l, 'OL', (i) => (i % 2 ? 2 : -2));
    expect(unitRead(l, 0, 'OL', moraleContext(l))!.word).toBe('Split');
  });

  it('gives no read to the specialists or a room below three men', () => {
    const l = fresh();
    expect(unitRead(l, 0, 'ST', moraleContext(l))).toBeNull();
    const qbs = activeRoster(l, 0).filter((p) => p.position === 'QB');
    for (const q of qbs.slice(2)) q.teamId = null;
    expect(unitRead(l, 0, 'QB', moraleContext(l))).toBeNull();
  });

  it('flags a unit with no voice of its own', () => {
    const l = fresh();
    for (const p of activeRoster(l, 0).filter((p) => unitOf(p.position) === 'DB')) p.traits.leads = 1;
    l.teams[0].captains = undefined;
    expect(unitRead(l, 0, 'DB', moraleContext(l))!.noVoice).toBe(true);
  });
});

describe('standing: your views', () => {
  it('shows your club only', () => {
    const l = fresh();
    const other = activeRoster(l, (l.userTeamId + 1) % l.teams.length)[0];
    expect(standingView(l, other)).toBeNull();
    const view = roomView(l);
    expect(view.units.length).toBeGreaterThan(0);
    expect(view.units.every((u) => u.unit !== 'ST')).toBe(true);
  });

  it('drops a released voice at once', () => {
    const l = fresh();
    const v = voicesOf(l, l.userTeamId)[0];
    expect(roomView(l).voices).toContain(v.id);
    releasePlayer(l, v);
    expect(roomView(l).voices).not.toContain(v.id);
  });
});

describe('standing: the vets and the young guys', () => {
  const set = (l: League, f: (p: Player) => number) => {
    for (const p of activeRoster(l, l.userTeamId)) {
      p.morale = { level: f(p) };
    }
  };
  it('says the young guys are down only when they read Poor or worse', () => {
    const l = fresh();
    set(l, (p) => (p.experience >= 6 ? 4 : p.experience <= 2 ? 0 : 1));
    expect(roomView(l, moraleContext(l)).apart).toBeNull();
    set(l, (p) => (p.experience >= 6 ? 4 : p.experience <= 2 ? -2 : 1));
    expect(roomView(l, moraleContext(l)).apart).toBe('young down');
  });
});
