import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { teamPlayers } from '../engine/roster';
import type { Injury } from '../engine/types';
import { shortName } from './format';
import { NavContext } from './nav';
import { outFor } from './pregame';
import { PregameCard } from './screens/PregameCard';

const league = createLeague({ seed: 'pregame-card' });
const game = league.games.find((g) => g.week === 1)!;
const home = league.teams[game.homeId];
const away = league.teams[game.awayId];
const hurt = (weeks: [number, number], extra: Partial<Injury> = {}): Injury => ({
  type: 'hamstring',
  severity: 'moderate',
  weeksRemaining: weeks[0],
  estimate: weeks,
  season: league.season,
  week: 0,
  where: 'practice',
  ...extra,
});
const [a, b, c, d, e] = teamPlayers(league, home.id).filter((p) => !p.injury && !p.ir);
a.injury = hurt([1, 2]);
b.injury = hurt([4, 6]);
c.injury = hurt([2, 3]);
d.injury = hurt([3, 3]);
// Playing through it: he is on the field, so he is not out.
e.injury = hurt([1, 1], { treatment: 'injection' });

const nav = { go: () => {}, openPlayer: () => {}, openTeam: () => {}, openGame: () => {}, watchGame: () => {} };
const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<NavContext.Provider value={nav as never}>{node}</NavContext.Provider>);

describe('who is out', () => {
  it('lists a club’s hurt men who can’t play, longest layoff first by the doctor’s estimate', () => {
    expect(outFor(league, home.id).map((o) => o.id)).toEqual([b.id, d.id, c.id, a.id]);
    expect(outFor(league, home.id)[0].what).toBe('hamstring strain');
    expect(outFor(league, away.id)).toEqual([]);
  });
});

describe('the pregame card', () => {
  const out = { home: outFor(league, home.id), away: outFor(league, away.id) };

  it('shows the matchup, the kickoff conditions and three men out a side, and no more', () => {
    const html = render(<PregameCard league={league} game={game} home={home} away={away} out={out} label="Week 1" />);
    expect(html).toContain('moment-card');
    expect(html).toContain(home.abbrev);
    expect(html).toContain(away.abbrev);
    expect(html).toContain('Week 1');
    expect(html).toContain('SNN');
    for (const p of [b, d, c]) expect(html).toContain(shortName(p));
    expect(html).not.toContain(shortName(a));
    expect(html).toContain('and 1 more');
    // A phone's card says how many, not who.
    expect(html).toContain(`${home.abbrev} 4 out`);
    expect(html).not.toContain(`${away.abbrev} 0 out`);
  });

  it('has buttons only when the screen gives them: a live game waits for Kick off, a replay shows none', () => {
    const live = render(
      <PregameCard
        league={league}
        game={game}
        home={home}
        away={away}
        out={out}
        label="Week 1"
        onKickoff={() => {}}
        onSim={() => {}}
      />,
    );
    expect(live).toContain('Kick off');
    expect(live).toContain('Sim to final');
    const replay = render(<PregameCard league={league} game={game} home={home} away={away} label="Week 1" />);
    expect(replay).not.toContain('<button');
    // A finished game's save doesn't keep who sat out: the replay's card leaves the list off.
    expect(replay).not.toContain('pg-out');
  });
});
