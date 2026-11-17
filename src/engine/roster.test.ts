import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { beginOffseason } from './offseason/index';
import { activePlayers, addPlayer, retirePlayer, setTeam, unsignedPlayers } from './roster';
import { advanceOffseason } from './offseason/index';
import { freeAgents } from './offseason/negotiation';
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

describe('the unsigned and free agents (long-league speed)', () => {
  const unsignedTruth = (l: League) =>
    Object.values(l.players)
      .filter((p) => !p.retired && p.teamId === null)
      .map((p) => p.id);

  it('lists the unsigned, in id order, through signings and cuts', () => {
    const l = fresh();
    expect(ids(unsignedPlayers(l))).toEqual(unsignedTruth(l));
    const fa = unsignedPlayers(l)[0];
    setTeam(l, fa, 3);
    expect(ids(unsignedPlayers(l))).toEqual(unsignedTruth(l));
    const rostered = Object.values(l.players).find((p) => p.teamId === 5 && !p.retired)!;
    setTeam(l, rostered, null);
    expect(ids(unsignedPlayers(l))).toEqual(unsignedTruth(l));
    retirePlayer(l, rostered);
    expect(ids(unsignedPlayers(l))).toEqual(unsignedTruth(l));
  });

  it('heals when a player signs behind its back', () => {
    const l = fresh();
    const fa = unsignedPlayers(l)[1];
    fa.teamId = 4;
    expect(ids(unsignedPlayers(l))).toEqual(unsignedTruth(l));
  });

  it('freeAgents is what it always was, prospects never in it', () => {
    const l = fresh();
    while (l.phase !== 'draft') advanceOffseason(l, { autoUser: true });
    expect(l.draftClass.length).toBeGreaterThan(0);
    const prospects = new Set(l.draftClass);
    const old = Object.values(l.players).filter(
      (p) => p.teamId === null && !p.retired && !p.squad && !p.waiver && !prospects.has(p.id),
    );
    expect(ids(freeAgents(l))).toEqual(ids(old));
    for (const id of l.draftClass) expect(ids(freeAgents(l))).not.toContain(id);
  }, 120_000);
});
