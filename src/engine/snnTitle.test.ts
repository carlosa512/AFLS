/** The final's most valuable player is the winning side's best line of the game, whoever had the bigger day. */
import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { activeRoster } from './roster';
import { titleEdition, titleMvp } from './snnTitle';
import type { Game } from './types';

describe('the final’s most valuable player', () => {
  it('comes from the winning team, by the line he had', () => {
    const l = createLeague({ seed: 'title-mvp' });
    const [home, away] = [l.teams[0].id, l.teams[1].id];
    const pick = (teamId: number, pos: string) => activeRoster(l, teamId).find((p) => p.position === pos)!;
    const [winnerQb, winnerEdge, loserQb] = [pick(home, 'QB'), pick(home, 'EDGE'), pick(away, 'QB')];
    const g = {
      id: 9001,
      season: l.season,
      week: 22,
      homeId: home,
      awayId: away,
      playoffRound: 'FINAL',
      result: {
        homeScore: 27,
        awayScore: 24,
        playerTeams: { [winnerQb.id]: home, [winnerEdge.id]: home, [loserQb.id]: away },
        playerStats: {
          [winnerQb.id]: { passYds: 240, passTd: 2 },
          [winnerEdge.id]: { sacks: 1, tackles: 4 },
          // The bigger day, on the losing side.
          [loserQb.id]: { passYds: 410, passTd: 4 },
        },
      },
    } as unknown as Game;
    expect(titleMvp(l, g)?.p.id).toBe(winnerQb.id);
    g.result!.playerStats[winnerEdge.id] = { sacks: 4, forcedFum: 2, tackles: 9 };
    expect(titleMvp(l, g)?.p.id).toBe(winnerEdge.id);
    // Once the honor is on the record, the page tells the man who was named.
    l.awards.push({
      season: l.season,
      winners: {},
      allLeague: [[], []],
      finalMvp: { playerId: winnerQb.id, teamId: home },
    });
    expect(titleMvp(l, g)?.p.id).toBe(winnerQb.id);
    l.awards.length = 0;
    g.result!.playerStats = {};
    expect(titleMvp(l, g)).toBeNull();
  });

  it('adds the awards and the lists even when the page did not tell the final’s own story', () => {
    const l = createLeague({ seed: 'title-none' });
    const g = { id: 9002, season: l.season, week: 22, homeId: 0, awayId: 1, playoffRound: 'FINAL' } as unknown as Game;
    g.result = { homeScore: 20, awayScore: 17, playerStats: {} } as unknown as Game['result'];
    const page = titleEdition(l, g, undefined, []);
    expect(page.story).toBeUndefined();
    expect(Array.isArray(page.tiles)).toBe(true);
    expect(Array.isArray(page.lists)).toBe(true);
  });
});
