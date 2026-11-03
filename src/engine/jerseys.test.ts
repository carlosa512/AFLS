import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import {
  chooseJersey,
  favoriteJersey,
  jerseyAllowed,
  JERSEY_RULES,
  JERSEY_TASTE,
  nearJerseys,
  numberOnArrival,
  numberSwitches,
} from './jerseys';
import { setTeam, teamPlayers } from './roster';
import { changePosition } from './training';
import { POSITIONS, type Player, type Position } from './types';

const leagues = ['jersey-a', 'jersey-b', 'jersey-c'].map((seed) => createLeague({ seed }));
const signed = leagues.flatMap((l) => l.teams.flatMap((t) => teamPlayers(l, t.id)));
const at = (pos: Position) => signed.filter((p) => p.position === pos);
const share = (pos: Position, lo: number, hi: number) =>
  at(pos).filter((p) => p.jersey >= lo && p.jersey <= hi).length / at(pos).length;

describe('jersey numbers', () => {
  it('chooses only what the rules allow, and every band of taste is inside them', () => {
    for (const pos of POSITIONS) {
      for (const [lo, hi, w] of JERSEY_TASTE[pos]) {
        expect(w).toBeGreaterThan(0);
        for (let n = lo; n <= hi; n++) expect(jerseyAllowed(pos, n), `${pos} ${n}`).toBe(true);
      }
      for (let id = 0; id < 300; id++)
        expect(jerseyAllowed(pos, favoriteJersey('s', { id, position: pos }))).toBe(true);
      expect(JERSEY_RULES[pos].length).toBeGreaterThan(0);
    }
    for (const p of signed) expect(jerseyAllowed(p.position, p.jersey), `${p.position} #${p.jersey}`).toBe(true);
  });

  it('never gives two teammates one number', () => {
    for (const l of leagues)
      for (const t of l.teams) {
        const squad = teamPlayers(l, t.id);
        expect(new Set(squad.map((p) => p.jersey)).size).toBe(squad.length);
      }
  });

  it("spreads numbers the way the NFL's rosters do: 80s receivers, single-digit corners, linemen in the 50s", () => {
    // Shares a little under the NFL's where a band is small or crowded: a favourite taken goes to a number near it.
    expect(share('WR', 80, 89)).toBeGreaterThan(0.18);
    expect(share('WR', 80, 89)).toBeLessThan(0.4);
    expect(share('WR', 0, 9)).toBeGreaterThan(0.12);
    expect(share('WR', 10, 19)).toBeGreaterThan(0.3);
    expect(share('CB', 0, 9)).toBeGreaterThan(0.08);
    expect(share('CB', 20, 39)).toBeGreaterThan(0.55);
    expect(share('S', 0, 9)).toBeGreaterThan(0.08);
    expect(share('OL', 50, 59)).toBeGreaterThan(0.04);
    expect(share('OL', 50, 59)).toBeLessThan(0.2);
    expect(share('TE', 80, 89)).toBeGreaterThan(0.7);
    expect(share('DT', 90, 99)).toBeGreaterThan(0.6);
    expect(share('EDGE', 90, 99)).toBeGreaterThan(0.25);
    expect(share('EDGE', 40, 59)).toBeGreaterThan(0.3);
    expect(share('LB', 40, 59)).toBeGreaterThan(0.55);
    expect(share('LB', 0, 39)).toBeGreaterThan(0.1);
    expect(share('RB', 20, 39)).toBeGreaterThan(0.55);
    expect(share('QB', 0, 9)).toBeGreaterThan(0.3);
  });

  it('a newcomer takes a number of his own, not the lowest one free (the old 90, 91, 92…)', () => {
    const l = createLeague({ seed: 'jersey-arrivals' });
    let lowest = 0;
    let n = 0;
    for (const t of l.teams) {
      const room = teamPlayers(l, t.id).filter((p) => p.position === 'DT');
      for (const p of room) setTeam(l, p, null);
      for (const p of room) {
        setTeam(l, p, t.id);
        numberOnArrival(l, p);
        const used = new Set(
          teamPlayers(l, t.id)
            .filter((x) => x.id !== p.id)
            .map((x) => x.jersey),
        );
        const first = [...Array(100).keys()].find((k) => jerseyAllowed('DT', k) && k >= 90 && !used.has(k));
        if (p.jersey === first) lowest++;
        n++;
      }
    }
    expect(lowest / n).toBeLessThan(0.3);
  });

  it('numbers the same league the same way, and another league its own way', () => {
    const again = createLeague({ seed: 'jersey-a' });
    for (const p of Object.values(again.players)) expect(p.jersey).toBe(leagues[0].players[p.id].jersey);
    const differ = Object.values(leagues[1].players).filter((p) => leagues[0].players[p.id]?.jersey !== p.jersey);
    expect(differ.length).toBeGreaterThan(500);
  });

  it('reaches for a number close to a favourite that is taken', () => {
    expect(nearJerseys(13)).toEqual([31, 3, 23, 14, 12]);
    expect(nearJerseys(7)).toEqual([70, 17, 77, 8, 6]);
    expect(nearJerseys(0)).toEqual([10, 1]);
    expect(nearJerseys(99)).toEqual([89, 98]);
    const p = { id: 42, position: 'WR' as Position };
    const fav = favoriteJersey('s', p);
    expect(chooseJersey('s', p, new Set())).toBe(fav);
    const taken = new Set([fav]);
    const near = nearJerseys(fav).filter((n) => jerseyAllowed('WR', n));
    expect(chooseJersey('s', p, taken)).toBe(near[0]);
    // His own number comes before one near his favourite.
    const own = [1, 11, 81, 18].find((n) => n !== fav && !near.includes(n))!;
    expect(chooseJersey('s', p, taken, own)).toBe(own);
  });

  it('a player joining a club takes his favourite if it is free, and leaves a number the user gave him behind', () => {
    const l = createLeague({ seed: 'jersey-move' });
    const p = teamPlayers(l, 0).find((x) => x.position === 'WR')!;
    p.numberEdited = true;
    setTeam(l, p, 1);
    numberOnArrival(l, p);
    const squad = teamPlayers(l, 1);
    expect(new Set(squad.map((x) => x.jersey)).size).toBe(squad.length);
    expect(p.numberEdited).toBeUndefined();
    const fav = favoriteJersey(l.seed, p);
    if (!squad.some((x) => x.id !== p.id && x.jersey === fav)) expect(p.jersey).toBe(fav);
  });

  it('a position change keeps his number when the rules allow it there, else gives him one like the new position', () => {
    const l = createLeague({ seed: 'jersey-pos' });
    const squad = teamPlayers(l, 0);
    const wr = squad.find((x) => x.position === 'WR')!;
    wr.jersey = [15, 16, 17, 18, 19, 14, 13, 12].find((n) => !squad.some((x) => x.jersey === n))!;
    const kept = wr.jersey;
    changePosition(l, wr, 'CB');
    expect(wr.jersey).toBe(kept);
    const te = squad.find((x) => x.position === 'TE')!;
    te.jersey = [80, 81, 82, 83, 84, 85, 86, 87, 88, 89].find((n) => !squad.some((x) => x.jersey === n))!;
    changePosition(l, te, 'OL');
    expect(te.jersey).toBeGreaterThanOrEqual(50);
    expect(te.jersey).toBeLessThanOrEqual(79);
    const after = teamPlayers(l, 0);
    expect(new Set(after.map((x) => x.jersey)).size).toBe(after.length);
  });

  it('at the new league year, a bunched room spreads out to its favourites, leaving numbers the user chose', () => {
    const l = createLeague({ seed: 'jersey-switch' });
    // An older save's line: the first picker's 90, 91, 92… down the room.
    const bunched = (t: number) =>
      teamPlayers(l, t)
        .filter((p) => p.position === 'DT' || p.position === 'EDGE')
        .sort((a, b) => a.id - b.id);
    const free = (t: number) => {
      const others = new Set(
        teamPlayers(l, t)
          .filter((p) => p.position !== 'DT' && p.position !== 'EDGE')
          .map((p) => p.jersey),
      );
      return [...Array(100).keys()].filter((n) => n >= 90 || (n >= 50 && n <= 79)).filter((n) => !others.has(n));
    };
    for (const t of l.teams) bunched(t.id).forEach((p, i) => (p.jersey = free(t.id)[i]));
    const mine = bunched(0)[0];
    mine.numberEdited = true;
    const before = new Map(Object.values(l.players).map((p) => [p.id, p.jersey]));
    const onFavorite = () => signedIn(l).filter((p) => p.jersey === favoriteJersey(l.seed, p)).length;
    const start = onFavorite();
    for (let y = 0; y < 3; y++) {
      numberSwitches(l);
      l.season++;
    }
    expect(onFavorite()).toBeGreaterThan(start);
    expect(mine.jersey).toBe(before.get(mine.id));
    for (const t of l.teams) {
      const squad = teamPlayers(l, t.id);
      expect(new Set(squad.map((p) => p.jersey)).size).toBe(squad.length);
      for (const p of squad) expect(jerseyAllowed(p.position, p.jersey)).toBe(true);
    }
  });
});

const signedIn = (l: ReturnType<typeof createLeague>): Player[] => l.teams.flatMap((t) => teamPlayers(l, t.id));
