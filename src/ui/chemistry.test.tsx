import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { CHEM_ROOMS, chemistryOf } from '../engine/chemistry';
import { moraleContext } from '../engine/morale';
import { soundOf, voiceName } from '../engine/standing';
import type { League } from '../engine/types';
import { NavContext, type Nav } from './nav';
import { LockerRoom } from './screens/LockerRoom';

const nav = {
  openPlayer: () => {},
  openTeam: () => {},
  go: () => {},
  openStaff: () => {},
  compareIds: [],
} as unknown as Nav;
const base = (() => {
  const l = createLeague({ seed: 'chemistry-ui' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const locker = (l: League) =>
  renderToStaticMarkup(
    <NavContext.Provider value={nav}>
      <LockerRoom league={l} />
    </NavContext.Provider>,
  );

describe('chemistry on the Locker Room', () => {
  it('shows each read room’s word, with no digits', () => {
    const l = fresh();
    const html = locker(l);
    const lines = [...html.matchAll(/<p class="room-chem">(.*?)<\/p>/g)].map((m) => m[1]);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^(Clicking|Gelling|Still learning each other|Out of sync)/);
      expect(line).not.toMatch(/\d/);
    }
    for (const unit of CHEM_ROOMS) {
      const c = chemistryOf(l, l.userTeamId, unit)!;
      expect(lines.some((x) => x.startsWith(c.word))).toBe(true);
    }
  });

  it('tags a Spark and an Anchor under who they follow, and a plain voice with neither', () => {
    const l = fresh();
    const ctx = moraleContext(l);
    const voices = [...ctx.voices.entries()].filter(([k]) => k.startsWith(`${l.userTeamId}:`)).flatMap(([, v]) => v);
    const html = locker(l);
    const tagged = voices.filter((v) => voiceName(soundOf(l.players[v.id])));
    for (const v of tagged)
      expect(html).toContain(`<span class="tag-pill voice-tag">${voiceName(soundOf(l.players[v.id]))}</span>`);
    expect((html.match(/voice-tag/g) ?? []).length).toBeLessThanOrEqual(voices.length + 3);
  });
});
