import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { beginOffseason } from './offseason/index';
import { activePlayers, addPlayer, retirePlayer } from './roster';
import type { League } from './types';

let base: string;
beforeAll(() => {
  const l = createLeague({ seed: 'roster-index' });
  simToEndOfSeason(l);
  beginOffseason(l);
  base = JSON.stringify(l);
});
const fresh = (): League => JSON.parse(base);
const truth = (l: League) =>
  Object.values(l.players)
    .filter((p) => !p.retired)
    .map((p) => p.id);
const ids = (xs: readonly { id: number }[]) => xs.map((p) => p.id);

describe('players still in football (long-league speed)', () => {
  it('lists every player still in football, in id order', () => {
    const l = fresh();
    expect(ids(activePlayers(l))).toEqual(truth(l));
  });

  it('drops a player retirePlayer retires and adds one addPlayer adds, in id order', () => {
    const l = fresh();
    activePlayers(l);
    const p = activePlayers(l)[10];
    retirePlayer(l, p);
    expect(p.retired).toBe(true);
    expect(ids(activePlayers(l))).toEqual(truth(l));
    const gone = Object.values(l.players).find((x) => x.retired && x.id !== p.id)!;
    const back = { ...structuredClone(gone), retired: undefined, teamId: null };
    addPlayer(l, back);
    expect(ids(activePlayers(l))).toEqual(truth(l));
  });

  it('heals when a player is retired behind its back', () => {
    const l = fresh();
    const p = activePlayers(l)[5];
    p.retired = true;
    expect(ids(activePlayers(l))).not.toContain(p.id);
    expect(ids(activePlayers(l))).toEqual(truth(l));
  });

  it('a copied league builds its own list', () => {
    const l = fresh();
    const p = activePlayers(l)[3];
    const copy = structuredClone(l);
    retirePlayer(copy, copy.players[p.id]);
    expect(ids(activePlayers(l))).toContain(p.id);
    expect(ids(activePlayers(copy))).not.toContain(p.id);
  });
});
