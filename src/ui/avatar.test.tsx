import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TEAM_SEEDS } from '../engine/data/teams';
import { createLeague } from '../engine/generate';
import { gamesInWeek } from '../engine/league';
import type { League, Player, Team } from '../engine/types';
import { contrast, kitFor, mix, readableOn, shade } from './color';
import { FREE_AGENT, PlayerAvatar, wearsWhite } from './components';
import { COLD_KICKOFF_F, lookOf, StaffAvatar, StaffFigure, staffDay } from './staffAvatar';
import { pick, STAFF_FAMILY, staffLook } from './staffLook';
import { gameWeather } from '../engine/weather';

const BLUE = { id: 0, colors: ['#1D4ED8', '#FFFFFF'] } as Team;
const pearson = { firstName: 'Mario', lastName: 'Pearson', jersey: 7 } as Player;
const html = (size: number, player = pearson) =>
  renderToStaticMarkup(<PlayerAvatar player={player} team={BLUE} size={size} />);
const seeds = TEAM_SEEDS.map((t) => ({ abbrev: t.abbrev, primary: t.colors[0], secondary: t.colors[1] }));

describe('color', () => {
  it('matches WCAG contrast', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#1D4ED8', '#1D4ED8')).toBe(1);
  });
  it('keeps a readable secondary and swaps an unreadable one', () => {
    expect(readableOn('#0B2265', '#FFFFFF')).toBe('#FFFFFF'); // navy + white
    expect(readableOn('#FFFFFF', '#FFD700')).toBe('#0F172A'); // white + gold
    expect(readableOn('#101820', '#203731')).toBe('#F8FAFC'); // black + dark green
    expect(readableOn('#003594', '#869397')).toBe('#F8FAFC'); // royal + silver: 3.4:1 is too faint for a small number
  });
  it('always finds a readable colour, even on mid grey', () => {
    for (let v = 0; v < 256; v++) {
      const grey = '#' + v.toString(16).padStart(2, '0').repeat(3);
      // light or dark: the pair bottoms out near 4.2:1 on mid grey
      expect(contrast(grey, readableOn(grey, grey))).toBeGreaterThanOrEqual(4);
    }
  });
  it('mixes', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('kits', () => {
  it('letters every team readably, home and away', () => {
    for (const t of seeds) {
      for (const away of [false, true]) {
        const kit = kitFor(t, away);
        expect(contrast(kit.jersey, kit.ink), `${t.abbrev} ${away ? 'away' : 'home'}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
  it('keeps a secondary that cannot carry the number as its twill and stripe', () => {
    const buffalo = kitFor({ primary: '#00338d', secondary: '#c60c30' }); // red doesn't read on royal blue
    expect(buffalo).toEqual({ jersey: '#00338d', ink: '#F8FAFC', trim: '#c60c30', accent: '#c60c30' });
    const jets = kitFor({ primary: '#125740', secondary: '#ffffff' }); // white reads on green: no twill colour needed
    expect(jets.ink).toBe('#ffffff');
    expect(jets.trim).not.toBe('#ffffff');
  });
  it('letters the white jersey in the primary', () => {
    const kit = kitFor({ primary: '#00338d', secondary: '#c60c30' }, true);
    expect(kit.jersey).toBe('#FFFFFF');
    expect(kit.ink).toBe('#00338d');
  });
});

describe('wearsWhite', () => {
  let league: League;
  beforeAll(() => {
    league = createLeague({ seed: 'kits' });
  });
  const team = (id: number) => league.teams[id].abbrev;

  it('dresses the visitors in the other jersey, every game', () => {
    for (const g of league.games) expect(wearsWhite(league, g.homeId, g)).not.toBe(wearsWhite(league, g.awayId, g));
  });
  it('keeps the home team in colours but for the odd hot open-air day', () => {
    // ten seasons of the same schedule: weather rolls fresh each season
    let games = 0;
    const white: string[] = [];
    for (let season = league.season; season < league.season + 10; season++) {
      for (const g of league.games) {
        games++;
        if (wearsWhite(league, g.homeId, { ...g, season })) white.push(team(g.homeId));
      }
    }
    expect(white.length / games).toBeGreaterThan(0.005);
    expect(white.length / games).toBeLessThan(0.04);
    expect(white).toContain('MIA');
    for (const dome of ['LV', 'LAC', 'DET', 'MIN', 'NO', 'LAS']) expect(white).not.toContain(dome);
  });
  it("follows this week's game, and is home colours without one", () => {
    const g = gamesInWeek(league)[0];
    expect(wearsWhite(league, g.awayId)).toBe(wearsWhite(league, g.awayId, g));
    const byeWeek = [...Array(18).keys()].map((w) => w + 1).find((w) => gamesInWeek(league, w).length < 16)!;
    const playing = new Set(gamesInWeek(league, byeWeek).flatMap((x) => [x.homeId, x.awayId]));
    const bye = league.teams.find((t) => !playing.has(t.id))!;
    expect(wearsWhite({ ...league, week: byeWeek }, bye.id)).toBe(false);
    expect(wearsWhite({ ...league, phase: 'freeAgency' }, g.awayId)).toBe(false);
    expect(wearsWhite(null, g.awayId)).toBe(false);
  });
  it('dresses a played game as it was played, even in the offseason', () => {
    const g = league.games.find((x) => team(x.homeId) === 'NO')!; // a dome: the visitors are in white
    expect(wearsWhite({ ...league, phase: 'draft' }, g.awayId, g)).toBe(true);
  });
});

describe('PlayerAvatar', () => {
  it('adds detail as it grows', () => {
    expect(html(24)).not.toContain('<text');
    expect(html(32)).toContain('>7</text>');
    expect(html(32)).not.toContain('PEARSON');
    expect(html(96)).toContain('PEARSON');
  });
  it('is decorative: the name always sits beside it', () => {
    expect(html(48)).toContain('aria-hidden="true"');
  });
  it('keeps a long surname on the jersey', () => {
    const long = html(128, { ...pearson, lastName: 'Washington-Reyes' });
    const width = Number(long.match(/textLength="([\d.]+)"/)![1]);
    expect(width).toBeGreaterThan(30);
    expect(width).toBeLessThanOrEqual(40);
  });
  it('gives every avatar its own clip id', () => {
    const two = renderToStaticMarkup(
      <>
        <PlayerAvatar player={pearson} team={BLUE} />
        <PlayerAvatar player={pearson} team={null} />
      </>,
    );
    const ids = [...two.matchAll(/clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });
  it("shows a mod's portrait instead", () => {
    expect(html(48, { ...pearson, portrait: 'p.png' })).toContain('<img');
  });
});

const DAL = { primary: '#003594', secondary: '#869397' };
const staffIds = Array.from({ length: 400 }, (_, i) => `staff-${i}`);

describe('staffLook', () => {
  it('is stable: same person, same day, same look', () => {
    expect(staffLook('s1', 'coach', false, 'game')).toEqual(staffLook('s1', 'coach', false, 'game'));
  });
  it('varies across people', () => {
    expect(new Set(staffIds.map((id) => staffLook(id, 'coach', false, 'game').garment)).size).toBe(4);
    expect(new Set(staffIds.map((id) => staffLook(id, 'scout', false, 'game').head)).size).toBe(5);
    expect(new Set(staffIds.map((id) => staffLook(id, 'medical', true, 'game').head)).size).toBe(3);
  });
  it('dresses for the weather and the calendar', () => {
    expect(staffLook('s1', 'scout', false, 'cold')).toMatchObject({ garment: 'jacket', headwear: 'beanie' });
    expect(staffLook('s1', 'coach', false, 'hot')).toMatchObject({
      garment: 'polo',
      headwear: 'visor',
      gear: 'headset',
    });
    expect(staffLook('s1', 'coach', false, 'offseason')).toMatchObject({ garment: 'quarterzip', gear: 'none' });
    expect(staffLook('s1', 'medical', false, 'offseason')).toMatchObject({ garment: 'labcoat', gear: 'stethoscope' });
  });
  it('keeps the fixed rules', () => {
    for (const id of staffIds.slice(0, 50)) {
      expect(staffLook(id, 'director', true, 'game')).toMatchObject({ garment: 'blazer', hair: 'long' });
      const m = staffLook(id, 'medical', false, 'game');
      if (m.gear === 'cross') expect(['polo', 'jacket']).toContain(m.garment);
    }
  });
  it('gives the strength coach a whistle, never a headset, and his tee in the heat and the offseason', () => {
    const gears = new Set(
      staffIds.flatMap((id) =>
        (['game', 'cold', 'hot', 'offseason'] as const).map((day) => staffLook(id, 'strength', false, day).gear),
      ),
    );
    expect([...gears]).toEqual(['whistle']);
    expect(staffLook('s1', 'strength', false, 'hot')).toMatchObject({ garment: 'tee', headwear: 'visor' });
    expect(staffLook('s1', 'strength', false, 'offseason')).toMatchObject({ garment: 'tee', gear: 'whistle' });
    expect(staffLook('s1', 'strength', false, 'cold')).toMatchObject({ garment: 'jacket', headwear: 'beanie' });
  });
  it('dresses every chair from its own wardrobe', () => {
    expect(STAFF_FAMILY.strengthCoach).toBe('strength');
    expect(STAFF_FAMILY.stCoord).toBe('coach');
    expect(STAFF_FAMILY.director).toBe('director');
    expect(STAFF_FAMILY.proScout).toBe('scout');
    expect(STAFF_FAMILY.physio).toBe('medical');
  });
  it('picks evenly enough', () => {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) counts[pick(`p${i}`, 'head', 5)]++;
    for (const c of counts) expect(c).toBeGreaterThan(850);
  });
});

describe('staffDay', () => {
  let league: League;
  beforeAll(() => {
    league = createLeague({ seed: 'kits' });
  });

  it('is the offseason between seasons, and once the title game is played', () => {
    for (const phase of ['resign', 'freeAgency', 'draft', 'preseason', 'complete'] as const)
      expect(staffDay({ ...league, phase }, 0)).toBe('offseason');
    expect(staffDay(null, 0)).toBe('game');
  });
  it("follows this week's game: jackets on cold open-air days, polos on hot ones, own outfits indoors and on a bye", () => {
    const days = { game: 0, cold: 0, hot: 0, offseason: 0 };
    for (let week = 1; week <= 18; week++) {
      const now = { ...league, week };
      const games = gamesInWeek(now);
      for (const t of league.teams) {
        const g = games.find((x) => x.homeId === t.id || x.awayId === t.id);
        const day = staffDay(now, t.id);
        days[day]++;
        if (!g) {
          expect(day, `${t.abbrev} on a bye`).toBe('game');
          continue;
        }
        const w = gameWeather(league, g);
        const open = w.roof === 'outdoors' || w.roof === 'open';
        expect(day === 'cold', `${t.abbrev} week ${week}`).toBe(open && w.tempF <= COLD_KICKOFF_F);
        expect(day === 'hot', `${t.abbrev} week ${week}`).toBe(open && w.tempF >= 85);
      }
    }
    expect(days.cold).toBeGreaterThan(0);
    expect(days.cold / (18 * 32)).toBeLessThan(0.25);
    expect(staffDay(league, null)).toBe('game'); // on the market: no game to dress for
  });
});

describe('lookOf', () => {
  let league: League;
  beforeAll(() => {
    league = createLeague({ seed: 'looks' });
  });

  it('keeps a scout and a coach with the same number apart', () => {
    const coach = league.coaches[1];
    const scout = league.staff[1];
    const day = staffDay(league, coach.teamId);
    expect(lookOf(league, coach)).toEqual(staffLook('coaches:1', STAFF_FAMILY[coach.role], false, day));
    expect(lookOf(league, scout)).toEqual(
      staffLook('staff:1', STAFF_FAMILY[scout.role], false, staffDay(league, scout.teamId)),
    );
  });
  it('dresses a retired coach for the offseason, whatever the week', () => {
    const coach = Object.values(league.coaches).find((c) => c.role === 'headCoach')!;
    const { [coach.id]: gone, ...rest } = league.coaches;
    const retired = { ...league, coaches: rest, retiredCoaches: { [coach.id]: gone } };
    expect(lookOf(retired, coach)).toMatchObject({ garment: 'quarterzip', gear: 'none' });
  });
  it('reads the woman flag off the record, and nothing else', () => {
    const medic = Object.values(league.medics)[0];
    expect(lookOf(league, medic).woman).toBe(false);
    expect(lookOf(league, { ...medic, woman: true }).woman).toBe(true);
  });
});

describe('StaffFigure', () => {
  const html = (size: number, woman = false) =>
    renderToStaticMarkup(<StaffFigure colors={DAL} look={staffLook('s7', 'medical', woman, 'game')} size={size} />);
  it('adds detail as it grows', () => {
    expect(html(28)).not.toContain('stroke-linejoin="round"'); // no face line at list-row size
    expect(html(56)).toContain('stroke-linejoin="round"');
    expect(html(56, true)).toContain('stroke-linejoin="round"');
  });
  it('is decorative, and every avatar gets its own ids', () => {
    expect(html(56)).toContain('aria-hidden="true"');
    const two = renderToStaticMarkup(
      <>
        <StaffFigure colors={DAL} look={staffLook('a', 'coach', false, 'game')} />
        <StaffFigure colors={DAL} look={staffLook('b', 'strength', false, 'game')} />
      </>,
    );
    const clips = [...two.matchAll(/clipPath id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(clips).size).toBe(2);
  });
  it('draws every team, every outfit', () => {
    for (const t of seeds) {
      for (const family of ['coach', 'strength', 'scout', 'director', 'medical'] as const) {
        for (const day of ['game', 'cold', 'hot', 'offseason'] as const) {
          expect(
            renderToStaticMarkup(
              <StaffFigure
                colors={t}
                look={staffLook(`${t.abbrev}${family}`, family, family !== 'coach' && family !== 'strength', day)}
                size={56}
              />,
            ),
          ).toContain('</svg>');
        }
      }
    }
  });
});

describe('StaffAvatar', () => {
  it('puts staff on the market in the grey-green', () => {
    const scout = {
      id: 3,
      firstName: 'Dana',
      lastName: 'Reyes',
      role: 'collegeScout',
      age: 34,
      evaluation: 12,
      projection: 11,
      teamId: null,
      contract: null,
    } as const;
    const html = renderToStaticMarkup(<StaffAvatar person={scout} size={56} />);
    expect(html).toContain(`stroke="${shade(FREE_AGENT.primary, 0.35)}"`); // the ring
  });
});
