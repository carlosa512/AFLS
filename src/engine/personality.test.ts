import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import {
  characterLine,
  leadersOf,
  nameCaptains,
  personalityOf,
  personalityTone,
  TRAITS_ON,
  trueCharacter,
  type Character,
  type CharacterKey,
  type PersonalityName,
} from './personality';

const ALL = new Set<CharacterKey>([
  'workEthic',
  'temperament',
  'leads',
  'poise',
  'controversy',
  'sportsmanship',
  'loyalty',
  'winning',
  'greed',
  'patience',
]);

/** A character at the league average on everything that names a personality. */
const average = (over: Partial<Character> = {}): Character => ({
  workEthic: 10.5,
  durability: 10.5,
  temperament: 10.5,
  injuryResistance: 10.5,
  naturalFitness: 10.5,
  versatility: 10.5,
  leads: 10.5,
  poise: 10.5,
  controversy: 10.5,
  sportsmanship: 10.5,
  loyalty: 0.5,
  winning: 0.5,
  greed: 0.5,
  patience: 0.55,
  ...over,
});

describe('personality', () => {
  const league = createLeague({ seed: 'personality-spread' });
  const players = Object.values(league.players).filter((p) => !p.retired);

  it('spreads names like FM: Even-Keeled for a quarter or so, every other name 1.5–9%', () => {
    for (const on of [TRAITS_ON, ALL]) {
      // Until mentoring and feuds ship, five names are switched off and their players read as Even-Keeled.
      const partial = on !== ALL;
      const counts = new Map<string, number>();
      for (const p of players) {
        const name = personalityOf(trueCharacter(p), on);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const share = (n: string) => (counts.get(n) ?? 0) / players.length;
      expect(share('Even-Keeled')).toBeGreaterThan(0.2);
      expect(share('Even-Keeled')).toBeLessThan(partial ? 0.45 : 0.35);
      for (const [n] of counts)
        if (n !== 'Even-Keeled') {
          expect(share(n), n).toBeLessThan(0.09);
          if (!partial) expect(share(n), n).toBeGreaterThan(0.015);
        }
    }
  });

  it('never names a trait whose job has not shipped', () => {
    // Every trait has its job now: all eighteen names are in play.
    expect([...TRAITS_ON].sort()).toEqual([...ALL].sort());
    const names = players.map((p) => personalityOf(trueCharacter(p)));
    for (const n of ['Born Leader', 'Locker-Room Lawyer', 'Volatile', 'Diva'] as PersonalityName[])
      expect(names).toContain(n);
  });

  it.each<[PersonalityName, Partial<Character>]>([
    ['Locker-Room Lawyer', { leads: 18, controversy: 16 }],
    ['Born Leader', { leads: 17 }],
    ['Dirty Player', { sportsmanship: 4 }],
    ['Volatile', { temperament: 6, controversy: 15 }],
    ['Diva', { greed: 0.85, controversy: 13 }],
    ['Consummate Pro', { workEthic: 15, temperament: 13 }],
    ['Clutch', { poise: 17 }],
    ['Jittery', { poise: 4 }],
    ['Mercenary', { greed: 0.85, loyalty: 0.35 }],
    ['Ring Chaser', { winning: 0.75, loyalty: 0.35 }],
    ['Company Man', { loyalty: 0.85 }],
    ['Hothead', { temperament: 4 }],
    ['Driven', { workEthic: 15, winning: 0.65 }],
    ['Fiery Competitor', { winning: 0.75, temperament: 8.5 }],
    ['Quiet Pro', { workEthic: 15, leads: 8 }],
    ['Coaster', { workEthic: 6 }],
    ['Easygoing', { greed: 0.3, patience: 0.7, winning: 0.45 }],
    ['Even-Keeled', {}],
  ])('names %s', (name, over) => {
    expect(personalityOf(average(over), ALL)).toBe(name);
  });

  it('says one sentence on what stands out, in plain words', () => {
    expect(characterLine(average({ workEthic: 18, temperament: 17 }))).toBe('Outworks everyone and keeps his cool.');
    expect(characterLine(average({ poise: 3 }))).toBe('Tightens up when it counts.');
    expect(characterLine(average())).toBe('Nothing about him stands out.');
    expect(characterLine(average({ leads: 19 }))).toBe('The room follows him.');
    expect(characterLine(average({ controversy: 19 }))).toBe('Says what he thinks, to anyone.');
    for (const p of players) expect(characterLine(trueCharacter(p))).not.toMatch(/marble|trait|z-score|\bsd\b/i);
  });

  it('tints a name by what it means for a club: good, a warning, or neither', () => {
    expect(personalityTone('Consummate Pro')).toBe('good');
    expect(personalityTone('Dirty Player')).toBe('warn');
    expect(personalityTone('Ring Chaser')).toBe('neutral');
    expect(personalityTone('Even-Keeled')).toBe('neutral');
  });

  it('names three different captains at camp: a starter on each side, and one for the kicking game', () => {
    const l = createLeague({ seed: 'captains' });
    nameCaptains(l);
    for (const t of l.teams) {
      const c = t.captains!;
      expect(c.season).toBe(l.season);
      expect(new Set([c.offense, c.defense, c.specialTeams]).size).toBe(3);
      expect(['QB', 'RB', 'WR', 'TE', 'OL']).toContain(l.players[c.offense].position);
      expect(['DT', 'EDGE', 'LB', 'CB', 'S']).toContain(l.players[c.defense].position);
      for (const id of [c.offense, c.defense, c.specialTeams]) expect(l.players[id].teamId).toBe(t.id);
    }
  });

  it("keeps each captain's seasons once, for his patch", () => {
    const l = createLeague({ seed: 'captains' });
    nameCaptains(l);
    nameCaptains(l);
    const c = l.teams[0].captains!;
    expect(l.players[c.offense].captainSeasons).toEqual([l.season]);
  });

  it("lists up to five more men the room follows, captains aside, by the staff's read", () => {
    const l = createLeague({ seed: 'captains' });
    nameCaptains(l);
    const c = l.teams[0].captains!;
    const more = leadersOf(l, 0);
    expect(more.length).toBeLessThanOrEqual(5);
    for (const p of more) {
      expect([c.offense, c.defense, c.specialTeams]).not.toContain(p.id);
      expect(p.teamId).toBe(0);
      expect(p.traits.leads).toBeGreaterThanOrEqual(12);
    }
  });
});
