import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { moraleContext, moraleFactors } from './morale';
import { releasePlayer } from './finance/cap';
import { nameCaptains } from './personality';
import { activeRoster, starters } from './roster';
import {
  calmOf,
  toneOf,
  TONE,
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
  unitOf,
  weightOf,
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

describe('standing: who a room listens to', () => {
  it('names only a man in that room, never a captain from another', () => {
    const l = fresh();
    for (const p of activeRoster(l, 0).filter((x) => x.position === 'QB')) p.traits.leads = 1;
    const ol = starters(l, l.teams[0], 'OL')[0];
    l.teams[0].captains = { season: l.season, offense: ol.id, defense: -1, specialTeams: -1 };
    const r = unitRead(l, 0, 'QB', moraleContext(l))!;
    expect(r.setter).toBeNull();
    expect(r.noVoice).toBe(true);
  });
});

describe('standing: moods stay each man’s own (L1)', () => {
  it("a room's voices pull a teammate's room score: a sour room's drag it, a happy one's lift it (L3)", () => {
    const l = fresh();
    const p = wrOf(l);
    const voices = voicesOf(l, p.teamId!)
      .concat(leadersOf(l, p.teamId!))
      .filter((v) => v.id !== p.id && unitOf(v.position) === 'WR');
    expect(voices.length).toBeGreaterThan(0);
    for (const v of voices) v.morale = { level: -9 };
    const sour = moraleFactors(l, p, moraleContext(l)).room;
    for (const v of voices) v.morale = { level: 9 };
    const happy = moraleFactors(l, p, moraleContext(l)).room;
    expect(happy).toBeGreaterThan(sour);
    // Worth at most a captain's 0.75 each way, and a friend's quarter on top.
    expect(happy - sour).toBeLessThanOrEqual(2 * (TONE.voices + TONE.friends) + 1e-9);
  });
});

describe('L3: what chemistry reads off a room', () => {
  it('a unit read carries its weighted mood level', async () => {
    const { unitReads } = await import('./standing');
    const { moraleStepOf } = await import('./morale');
    const l = fresh();
    const reads = unitReads(l, l.teams[0].id, moraleContext(l));
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(Number.isFinite(r.level)).toBe(true);
      expect(moraleStepOf(r.level)).toBe(r.mood);
    }
  });

  it("a Spark's mood pulls his room, an Anchor's half as hard, and an Anchor takes the edge off a Spark", () => {
    const l = fresh();
    const p = wrOf(l);
    const ctx = moraleContext(l);
    const key = `${p.teamId}:WR`;
    ctx.voiceMean = 0;
    ctx.leans.set(9001, 1).set(9002, -1).set(9003, 1);
    ctx.voices.set(key, [{ id: 9001, sound: 'stirs' }]);
    expect(toneOf(p, ctx)).toBeCloseTo(1, 9);
    ctx.voices.set(key, [
      { id: 9002, sound: 'stirs' },
      { id: 9003, sound: null },
    ]);
    const noAnchor = toneOf(p, ctx);
    expect(noAnchor).toBeCloseTo(-1 / 3, 9);
    ctx.voices.set(key, [
      { id: 9002, sound: 'stirs' },
      { id: 9003, sound: 'steadies' },
    ]);
    expect(toneOf(p, ctx)).toBeCloseTo(0, 9);
  });

  it('never pulls a man by himself', () => {
    const l = fresh();
    const p = wrOf(l);
    const ctx = moraleContext(l);
    ctx.voiceMean = 0;
    ctx.leans.set(p.id, 1);
    ctx.voices.set(`${p.teamId}:WR`, [{ id: p.id, sound: 'stirs' }]);
    expect(toneOf(p, ctx)).toBe(0);
  });

  it("an Anchor's room draws a man toward its average; no Anchor, no draw", () => {
    const l = fresh();
    const p = wrOf(l);
    const ctx = moraleContext(l);
    const key = `${p.teamId}:WR`;
    ctx.leans.set(p.id, -1);
    ctx.roomLeans.set(key, 0.2);
    ctx.voices.set(key, [{ id: 9004, sound: 'steadies' }]);
    expect(calmOf(p, ctx)).toBeCloseTo(1, 9);
    ctx.leans.set(p.id, 0.6);
    expect(calmOf(p, ctx)).toBeCloseTo(-0.4, 9);
    ctx.voices.set(key, [{ id: 9004, sound: 'stirs' }]);
    expect(calmOf(p, ctx)).toBe(0);
  });

  it('names a voice plainly', async () => {
    const { voiceName } = await import('./standing');
    expect(voiceName('stirs')).toBe('Spark');
    expect(voiceName('steadies')).toBe('Anchor');
    expect(voiceName(null)).toBeNull();
  });
});
