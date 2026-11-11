import { describe, expect, it } from 'vitest';
import { at, DECKS, wallLine } from './bowl';
import { toFrame } from './camera';
import { lum } from './colour';
import { crowdPalette, sectionFill, turnoutOf } from './crowd';
import { STADIUMS } from '../../engine/data/stadiums';
import { TEAM_SEEDS } from '../../engine/data/teams';
import { Rng } from '../../engine/rng';
import { BUILDINGS, buildingFor, LATER, roofKindOf } from './buildings';
import { FEATURES } from './features';
import { SETTINGS } from './land';
import { outsideWeather } from './outside';
import { paintStadium } from './paint';
import { recorder } from './pen';
import type { Building, Look, Scene } from './types';

describe('the camera', () => {
  it('puts the field where the owner approved it', () => {
    expect(toFrame(60, 0, 0).x).toBeCloseTo(327.93, 1);
    expect(toFrame(60, 0, 0).y).toBeCloseTo(171.98, 1);
    expect(toFrame(-60, 0, 0).x).toBeCloseTo(32.07, 1);
    expect(toFrame(60, 0, 53.33).x).toBeCloseTo(280, 1);
    expect(toFrame(60, 0, 53.33).y).toBeCloseTo(90, 1);
  });
  it('draws what is further away smaller and higher, and what is taller higher', () => {
    expect(toFrame(0, 0, 53.33).depth).toBeGreaterThan(toFrame(0, 0, 0).depth);
    expect(toFrame(0, 0, 26.665).y).toBeCloseTo(123.06, 1); // midfield is not halfway up: the far half is shorter
    expect(toFrame(0, 10, 26.665).y).toBeLessThan(toFrame(0, 0, 26.665).y);
  });
});

describe('the bowl', () => {
  it('runs from the near-left end, round the far side, to the near-right end', () => {
    const w = wallLine();
    expect(w[0]).toMatchObject({ x: -67, z: -12, part: 'L' });
    expect(w[w.length - 1]).toMatchObject({ x: 67, part: 'R' });
    expect(w[w.length - 1].z).toBeCloseTo(-12, 0); // the right end steps down from the corner, so it ends a third of a yard short
    expect(w.filter((p) => p.part === 'F').every((p) => Math.abs(p.z - 60.33) < 0.01)).toBe(true);
    expect(w.every((p, i) => p.i === i && (i === 0 || p.u > w[i - 1].u))).toBe(true);
    expect(at(w[0], 0, 0)).toEqual(toFrame(-67, 0, -12));
  });
  it('keeps the decks low: the top row is 21.4 yards up, 31 yards back', () => {
    expect(DECKS.map((d) => d.rows)).toEqual([14, 6, 14]);
    expect(DECKS[2]).toMatchObject({ d1: 31, y1: 21.4 });
  });
});

describe('the pen', () => {
  it('records what was drawn, in order', () => {
    const r = recorder();
    r.poly(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      '#fff',
    );
    r.dot(1, 1, 1, '#000');
    expect(r.shapes.map((s) => s.kind)).toEqual(['poly', 'dot']);
  });
});

describe('who turns up', () => {
  const rec = (w: number, l: number, t = 0) => ({ w, l, t });
  it('reads the record: .600 fills the ground, under .400 half of it', () => {
    expect(turnoutOf(rec(6, 4), 5, false)).toBe('winning');
    expect(turnoutOf(rec(5, 5), 5, false)).toBe('even');
    expect(turnoutOf(rec(4, 6), 5, false)).toBe('even');
    expect(turnoutOf(rec(3, 7), 5, false)).toBe('losing');
  });
  it('treats no record as even, a tie as half a win, the early home games kindly and the playoffs as full', () => {
    expect(turnoutOf(rec(0, 0), 0, false)).toBe('even');
    expect(turnoutOf(rec(5, 4, 1), 5, false)).toBe('even'); // .550
    expect(turnoutOf(rec(0, 4), 2, false)).toBe('even'); // a third home game
    expect(turnoutOf(rec(0, 5), 3, false)).toBe('losing');
    expect(turnoutOf(rec(9, 8), 8, true)).toBe('winning');
  });
  it('empties the upper deck and the ends first, and never fills or empties a section outright', () => {
    expect(sectionFill(0.52, 2, 'L', 0)).toBeLessThan(sectionFill(0.52, 0, 'F', 0));
    expect(sectionFill(0.97, 2, 'L', -0.5)).toBeGreaterThan(0.9);
    expect(sectionFill(0.03, 2, 'L', -0.5)).toBeGreaterThanOrEqual(0.03);
    expect(sectionFill(1, 0, 'F', 0.5)).toBeLessThanOrEqual(0.985);
  });
  it('dresses a crowd you can see, whatever the club’s colours', () => {
    expect(crowdPalette(['#000000', '#101010']).every((c) => lum(c) > 0.2)).toBe(true);
    expect(crowdPalette(['#fb4f14', '#002244'])[0]).toBe('#fb4f14');
  });
  it('dresses a themed night in the jersey the club wears: its colour, white for a whiteout, black for a blackout', () => {
    const own = crowdPalette(['#101820', '#ffb612'], '#ffb612');
    expect(own[0]).toBe('#ffb612');
    expect(own[1]).toBe('#ffb612');
    expect(crowdPalette(['#0b162a', '#c83803'], '#F8FAFC').slice(0, 2)).toEqual(['#F8FAFC', '#F8FAFC']);
    expect(lum(crowdPalette(['#0b162a', '#c83803'], '#000000')[0])).toBeLessThan(0.3);
    // a dark jersey still makes a crowd you can see
    expect(lum(crowdPalette(['#203731', '#ffb612'], '#203731')[0])).toBeGreaterThan(0.2);
    // the same five places either way, so a seat's draw picks the same slot
    expect(own).toHaveLength(crowdPalette(['#101820', '#ffb612']).length);
  });
});

describe('the stands', () => {
  const bowl: Building = {
    id: 'TEST',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#16283a',
    wall: '#a39c8c',
    ground: '#7a7f83',
    features: [],
    setting: { kind: 'none' },
  };
  const look = (fill: number): Look => ({ night: false, precip: 'none', roof: 'none', fill });
  const seats = (fill: number) => {
    const r = recorder();
    paintStadium(r, bowl, ['#fb4f14', '#002244'], look(fill), 'TEST');
    return r.shapes.filter((s) => s.kind === 'dot' || (s.kind === 'box' && s.fill !== '#f7f7f2'));
  };
  it('draws the same seats at every turnout, more of them taken as it rises', () => {
    const thin = seats(0.52);
    const full = seats(0.97);
    expect(thin.length).toBe(full.length);
    expect(thin.length).toBeGreaterThan(8000);
    expect(thin.every((s, i) => s.kind === 'box' || full[i].kind === 'dot')).toBe(true);
    expect(full.filter((s) => s.kind === 'dot').length).toBeGreaterThan(thin.filter((s) => s.kind === 'dot').length);
  });
  it('is the same picture every time for the same club', () => {
    const a = recorder();
    const b = recorder();
    paintStadium(a, bowl, ['#fb4f14', '#002244'], look(0.8), 'TEST');
    paintStadium(b, bowl, ['#fb4f14', '#002244'], look(0.8), 'TEST');
    expect(a.shapes).toEqual(b.shapes);
  });
  it('draws a roof that opens open or shut as the game has it', () => {
    const roofed: Building = {
      ...bowl,
      roof: {
        kind: 'slab',
        profile: { kind: 'flat', h: 38.5, crown: 2.5, fall: 3 },
        th: 3.6,
        skin: '#33373c',
        section: '#c9ccd0',
        opening: { x0: -44, x1: 44, z1: 70 },
      },
    };
    const count = (roof: Look['roof']) => {
      const r = recorder();
      paintStadium(r, roofed, ['#a71930', '#000000'], { ...look(0.97), roof }, 'T');
      return r.shapes.length;
    };
    expect(count('closed')).toBeGreaterThan(count('open')); // shut, the roof over the opening is drawn too
    expect(count('none')).toBe(count('closed')); // a dome's weather names no roof: it is whole
  });
});

describe('the land outside', () => {
  const scene = () => {
    const pen = recorder();
    const s: Scene = {
      pen,
      rng: new Rng('land'),
      look: { night: false, precip: 'none', roof: 'none', fill: 1 },
      colors: ['#ffffff', '#000000'],
      snowy: false,
      tone: (h) => h,
      lamp: (h) => h,
    };
    return { pen, s };
  };
  it('has a painter for every kind of setting and every feature a building asks for', () => {
    // read off the buildings themselves, so a new kind cannot be used without being drawn
    for (const b of [...Object.values(BUILDINGS), ...Object.values(LATER).flatMap((l) => l.map((x) => x.building))]) {
      expect(SETTINGS[b.setting.kind], `${b.id} ${b.setting.kind}`).toBeTypeOf('function');
      for (const f of b.features) expect(FEATURES[f.kind].paint, `${b.id} ${f.kind}`).toBeTypeOf('function');
    }
  });
  it('draws a town with windows on its buildings and no people', () => {
    const { pen, s } = scene();
    SETTINGS.town(s, { kind: 'town', height: 'mid', palette: ['#9a6b55'], lots: true });
    expect(pen.shapes.filter((x) => x.kind === 'poly').length).toBeGreaterThan(1500); // floors of windows
    expect(pen.shapes.some((x) => x.kind === 'dot')).toBe(false); // dots are people, and people are in the stadium
  });
});

describe('the buildings', () => {
  it('draws every club done so far', () => {
    const done = [
      'BUF',
      'MIA',
      'NE',
      'NYK',
      'BAL',
      'CIN',
      'CLE',
      'PIT',
      'HOU',
      'IND',
      'JAX',
      'TEN',
      'DEN',
      'KC',
      'LV',
      'LAC',
    ];
    done.push('DAL', 'NYE', 'PHI', 'WAS'); // Frontier East
    done.push('CHI', 'DET', 'GB'); // Frontier North
    done.push('CAR', 'NO', 'TB'); // Frontier South
    done.push('ARI', 'LAS', 'SF', 'SEA'); // Frontier West
    // next division
    done.push('MIN', 'ATL'); // agreed ahead of their divisions
    expect(Object.keys(BUILDINGS).sort()).toEqual([...done].sort());
    for (const [abbrev, b] of Object.entries(BUILDINGS)) expect(b.id).toBe(abbrev);
  });
  it('gives every listed building the roof the game says its club has', () => {
    for (const [abbrev, b] of Object.entries(BUILDINGS)) expect(roofKindOf(b), abbrev).toBe(STADIUMS[abbrev].roof);
    for (const [abbrev, list] of Object.entries(LATER))
      for (const { season, building } of list)
        expect(roofKindOf(building), `${abbrev} ${season}`).toBe(
          STADIUMS[abbrev].changes!.find((c) => c.season === season)!.roof,
        );
  });
  it('gives a club the game does not know a plain bowl, with a crowd that shows against the seats', () => {
    const b = buildingFor('XYZ', 2026, ['#000000', '#101010']);
    expect(b.id).toBe('plain');
    expect(lum(b.chair!)).toBeGreaterThan(lum(b.seat)); // an empty chair shows against the bank it sits on
    expect(roofKindOf(b)).toBe('outdoors');
  });
  it('uses the building of the game’s season, not today’s', () => {
    const c: [string, string] = ['#0c2340', '#4b92db'];
    expect(buildingFor('TEN', 2026, c).id).toBe('TEN');
    expect(buildingFor('TEN', 2027, c).id).toBe('TEN:2027');
    expect(buildingFor('TEN', 2040, c).id).toBe('TEN:2027');
    expect(buildingFor('DEN', 2040, c).id).toBe('DEN');
  });
  it('has a building for every club, and for every stadium the game has coming', () => {
    for (const t of TEAM_SEEDS) expect(BUILDINGS[t.abbrev], t.abbrev).toBeDefined();
    for (const [abbrev, st] of Object.entries(STADIUMS))
      for (const ch of st.changes ?? [])
        expect(
          LATER[abbrev]?.some((l) => l.season === ch.season),
          `${abbrev} ${ch.season}`,
        ).toBe(true);
  });
});

describe('the day outside a roofed ground', () => {
  it('is the same every time for a game, and only ever for show', () => {
    expect(outsideWeather('s', 'MIN', 2026, 7, 16)).toEqual(outsideWeather('s', 'MIN', 2026, 7, 16));
  });
  it('snows in Minnesota in winter and never in Arizona', () => {
    const days = (abbrev: string, week: number) =>
      Array.from({ length: 300 }, (_, g) => outsideWeather('s', abbrev, 2026, g, week));
    expect(days('MIN', 17).some((d) => d.precip === 'snow')).toBe(true);
    expect(days('MIN', 17).some((d) => d.lying)).toBe(true);
    expect(days('MIN', 1).some((d) => d.precip === 'snow' || d.lying)).toBe(false);
    expect(days('ARI', 17).some((d) => d.precip === 'snow' || d.lying)).toBe(false);
    expect(days('LV', 17).every((d) => d.precip !== 'snow')).toBe(true); // no climate of its own: the nearest it knows
  });
  it('says nothing of a place it does not know', () => {
    expect(outsideWeather('s', 'XYZ', 2026, 1, 10)).toEqual({ precip: 'none', lying: false });
  });
});
