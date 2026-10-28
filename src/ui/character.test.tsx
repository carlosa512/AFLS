import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { characterRead } from '../engine/scouting';
import { personalityRead } from '../engine/personality';
import { CharacterFact } from './scouting';

describe('the character block', () => {
  const league = createLeague({ seed: 'character-card' });

  it('names your player and says one sentence, in place of the work and temper tags', () => {
    const p = Object.values(league.players).find((x) => x.teamId === league.userTeamId)!;
    const read = personalityRead(league, league.userTeamId, p)!;
    const html = renderToStaticMarkup(<CharacterFact league={league} player={p} />);
    expect(html).toContain(read.name);
    expect(html).toContain(read.line);
    for (const tag of ['Model pro', 'Driven', 'Coasts', 'Needs a push', 'Hothead', 'Even-keeled'])
      expect(html).not.toContain(`>${tag}<`);
  });

  it('says Unknown for a player your scouts have not met', () => {
    const p = Object.values(league.players).find((x) => !characterRead(league, league.userTeamId, x))!;
    const html = renderToStaticMarkup(<CharacterFact league={league} player={p} />);
    expect(html).toContain('Unknown');
  });
});
