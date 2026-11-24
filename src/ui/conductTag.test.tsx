import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { setConductByCoach } from '../engine/conduct';
import { createLeague } from '../engine/generate';
import { activeRoster } from '../engine/roster';
import { ConductTag, DisciplineSection } from './conductTag';
import { DisciplineByCoach } from './meetings';

describe('discipline on the screens', () => {
  const league = createLeague({ seed: 'conduct-ui' });
  const [a, b, c] = activeRoster(league, league.userTeamId);

  it('shows a suspension and a night on the bench as a pill, and nothing for a man who can play', () => {
    a.suspension = { games: 1, by: 'league', reason: 'fight' };
    b.suspension = { games: 2, by: 'team', reason: 'curfew' };
    expect(renderToStaticMarkup(<ConductTag p={a} />)).toContain('Suspended · 1 game<');
    expect(renderToStaticMarkup(<ConductTag p={b} />)).toContain('Sat by the team · 2 games');
    expect(renderToStaticMarkup(<ConductTag p={c} />)).toBe('');
  });

  it('lists his discipline on the card, and no section for a clean record', () => {
    a.discipline = {
      entries: [
        {
          season: league.season,
          week: 15,
          kind: 'fight',
          outcome: 'suspended',
          games: 1,
          public: true,
          teamId: a.teamId!,
        },
      ],
    };
    const html = renderToStaticMarkup(<DisciplineSection league={league} p={a} />);
    expect(html).toContain('Discipline');
    expect(html).toContain('A fight away from the stadium, suspended 1 game.');
    expect(renderToStaticMarkup(<DisciplineSection league={league} p={c} />)).toBe('');
  });

  it('has the checkbox that hands discipline to the head coach', () => {
    expect(renderToStaticMarkup(<DisciplineByCoach league={league} />)).toContain(
      'Let the head coach handle discipline',
    );
    expect(renderToStaticMarkup(<DisciplineByCoach league={league} />)).not.toContain('checked');
    setConductByCoach(league, true);
    expect(renderToStaticMarkup(<DisciplineByCoach league={league} />)).toContain('checked');
  });
});
