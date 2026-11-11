import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { releaseBlocker, releasePlayer, releasePreview } from '../engine/finance/cap';
import { createLeague } from '../engine/generate';
import { startLiveGame, userGame } from '../engine/league';
import { personnelMoveLock } from '../engine/personnel/elevations';
import { teamPlayers } from '../engine/roster';
import { NavContext, type Nav } from './nav';
import { Finances } from './screens/Finances';

/**
 * A live game freezes its two rosters until it is recorded. Reading what a cut would cost is not a move: the Cap
 * screen prices every contract on every draw, and once blanked the whole app when opened during your game.
 */
describe('the cap screen while your game is being played', () => {
  const league = createLeague({ seed: 'cap-live', personnel: true });
  startLiveGame(league, userGame(league)!);
  const mine = teamPlayers(league, league.userTeamId!).filter((p) => p.contract && !p.squad);
  const frozen = mine.filter((p) => personnelMoveLock(league, p));

  it('has a frozen roster to price', () => {
    expect(frozen.length).toBeGreaterThan(40);
  });

  it('prices a cut for a frozen man, and still refuses the cut itself', () => {
    const man = frozen[0];
    const cut = releasePreview(league, man);
    expect(cut.thisYear + cut.nextYear).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(cut.savings)).toBe(true);
    expect(releaseBlocker(league, man)).toBe('Finish the game before changing its roster.');
    expect(() => releasePlayer(league, man)).toThrow('Finish the game before changing its roster.');
  });

  it('opens, with every contract on it', () => {
    const nav = new Proxy({}, { get: () => () => {} }) as Nav;
    const html = renderToStaticMarkup(
      <NavContext.Provider value={nav}>
        <Finances league={league} teamId={league.userTeamId!} />
      </NavContext.Provider>,
    );
    expect(html).toContain('salary cap');
    expect(html).toContain(frozen[0].lastName);
  });
});
