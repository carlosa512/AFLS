import { describe, expect, it } from 'vitest';
import { LEGACY_FIRST_NAMES, LEGACY_LAST_NAMES } from './data/legacyNames';
import { createLeague, SAVE_VERSION } from './generate';
import { migrateLeague } from './migrate';
import { Rng } from './rng';
import { editPlayerIdentity } from './roster';
import { generateTraits } from './traits';
import type { Game, InboxMessage, League, Player } from './types';

const full = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/** A player's traits as a v26 save kept them: Versatility only arrives with v31. */
function v26Traits(p: Player): Player['traits'] {
  const { versatility: _, ...traits } = generateTraits(p);
  return traits as Player['traits'];
}

/** A v26 save as the old uniform pools named it: traits seeded by those names, no women, no flags. */
function oldSave(seed: string): League {
  const l = createLeague({ seed });
  const rng = new Rng(`old:${seed}`);
  const name = (p: { firstName: string; lastName: string }) => {
    p.firstName = rng.pick(LEGACY_FIRST_NAMES);
    p.lastName = rng.pick(LEGACY_LAST_NAMES);
  };
  for (const p of Object.values(l.players)) {
    name(p);
    p.traits = v26Traits(p);
  }
  for (const x of [...Object.values(l.coaches), ...Object.values(l.staff), ...Object.values(l.medics)]) {
    name(x);
    delete (x as { woman?: true }).woman;
  }
  const used = new Set<string>();
  for (const c of l.crews) {
    do name(c);
    while (used.has(c.lastName));
    used.add(c.lastName);
  }
  return { ...(JSON.parse(JSON.stringify(l)) as League), version: 26 };
}

const mail = (subject: string, body: string, from = 'League office'): InboxMessage => ({
  id: `test:${subject}`,
  season: 2026,
  phase: 'regular',
  week: 1,
  from,
  category: 'league',
  subject,
  body,
  read: false,
  actions: [],
});

describe('the v27 names pass on an old save', () => {
  const old = oldSave('rename');
  const players = Object.values(old.players);
  const [kept, typed, mover, twinA, twinB, coachPlayer] = players;
  // typed in through the editor before v27: no flag, so the traits give it away
  kept.firstName = 'Marcus';
  kept.lastName = players.find((p) => p.lastName !== kept.lastName)!.lastName;
  typed.firstName = 'Al';
  typed.lastName = 'Bee';
  twinB.firstName = twinA.firstName;
  twinB.lastName = twinA.lastName;
  twinB.traits = v26Traits(twinB);
  const scout = Object.values(old.staff)[0];
  const before = {
    kept: full(kept),
    typed: full(typed),
    mover: full(mover),
    moverShort: `${mover.firstName[0]}.${mover.lastName}`,
    twin: full(twinA),
    scout: full(scout),
    names: new Map(players.map((p) => [p.id, full(p)])),
  };
  // a former player now coaching, under his playing name
  const exPlayer = Object.values(old.coaches)[0];
  exPlayer.playerId = coachPlayer.id;
  exPlayer.firstName = coachPlayer.firstName;
  exPlayer.lastName = coachPlayer.lastName;
  old.transactions.push({ season: 2026, phase: 'regular', week: 1, teamIds: [0], kind: 'sign', text: `DAL signed QB ${before.mover}, and ${before.typed}'s agent called` });
  old.transactions.push({ season: 2026, phase: 'regular', week: 1, teamIds: [0], kind: 'release', text: `DAL released ${before.twin}` });
  old.inbox = [mail(`${before.mover}: Torn ACL`, `${before.mover}'s knee will cost him the season.`, `${before.scout}, Director of scouting`)];
  const game = old.games[0] as Game;
  game.result = { playerTeams: { [mover.id]: game.homeId }, plays: [{ text: `${before.moverShort} rush right end for 7 yards` }] } as unknown as Game['result'];

  const up = migrateLeague(JSON.parse(JSON.stringify(old)) as League)!;
  const now = (p: Player) => up.players[p.id];

  it('reaches the current version', () => {
    expect(up.version).toBe(SAVE_VERSION);
  });
  it('renames the generated, and keeps and flags what the user typed', () => {
    expect(full(now(kept))).toBe(before.kept);
    expect(full(now(typed))).toBe(before.typed);
    expect(now(kept).nameEdited).toBe(true);
    expect(now(typed).nameEdited).toBe(true);
    const renamed = players.filter((p) => full(now(p)) !== before.names.get(p.id)).length;
    expect(renamed / players.length).toBeGreaterThan(0.9);
    expect(now(mover).nameEdited).toBeUndefined();
  });
  it('rewrites the stored text to the new names, but leaves a name two people shared', () => {
    const [signed, released] = up.transactions.slice(-2).map((t) => t.text);
    expect(signed).toBe(`DAL signed QB ${full(now(mover))}, and ${before.typed}'s agent called`);
    expect(released).toBe(`DAL released ${before.twin}`);
    const m = up.inbox!.at(-1)!;
    expect(m.subject).toBe(`${full(now(mover))}: Torn ACL`);
    expect(m.body).toContain(`${full(now(mover))}'s knee`);
    expect(m.from).toBe(`${full(up.staff[scout.id])}, Director of scouting`);
    const p = now(mover);
    expect(up.games[0].result!.plays![0].text).toBe(`${p.firstName[0]}.${p.lastName} rush right end for 7 yards`);
  });
  it('gives a former player coaching his new name', () => {
    expect(full(up.coaches[exPlayer.id])).toBe(full(now(coachPlayer)));
  });
  it('rolls women among the scouts and medical staff, keeps the crews apart, and leaves the coaches men', () => {
    expect([...Object.values(up.staff), ...Object.values(up.medics)].some((p) => p.woman)).toBe(true);
    expect(Object.values(up.coaches).some((c) => 'woman' in c)).toBe(false);
    expect(new Set(up.crews.map((c) => c.lastName)).size).toBe(up.crews.length);
  });
  it('is the same every time it runs on the same save', () => {
    const again = migrateLeague(JSON.parse(JSON.stringify(old)) as League)!;
    expect(Object.values(again.players).map(full)).toEqual(Object.values(up.players).map(full));
  });
});

describe('the identity editor', () => {
  it('flags a renamed player, so no names pass replaces him', () => {
    const l = createLeague({ seed: 'edit' });
    const p = Object.values(l.players)[0];
    editPlayerIdentity(l, p.id, { firstName: p.firstName, lastName: p.lastName, jersey: p.jersey });
    expect(p.nameEdited).toBeUndefined(); // a new number alone isn't a new name
    editPlayerIdentity(l, p.id, { firstName: 'Al', lastName: 'Bee', jersey: p.jersey });
    expect(p.nameEdited).toBe(true);
  });
});
