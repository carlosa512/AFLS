import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { simToEndOfSeason } from '../engine/league';
import { advanceOffseason, beginOffseason, draftForUser, draftNextPick, draftToUserPick } from '../engine/offseason';
import { nextPick } from '../engine/offseason/draft';
import { draftDayOffers } from '../engine/trade/draft';
import type { League } from '../engine/types';
import { Draft } from './screens/Draft';

const atDraft = (() => {
  const league = createLeague({ seed: 'draft-trades' });
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'draft') advanceOffseason(league, { autoUser: true });
  return JSON.stringify(league);
})();
const draftDay = (): League => JSON.parse(atDraft);

/** Your first pick that draws offers, on the clock. */
function offered(): League {
  const l = draftDay();
  for (let i = 0; i < 7; i++) {
    draftToUserPick(l);
    if (draftDayOffers(l).length) return l;
    draftForUser(l);
  }
  throw new Error('No pick of yours drew an offer');
}

describe('draft room on draft day', () => {
  it('shows the banner and an offer card for each team that wants your pick', () => {
    const l = offered();
    const html = renderToStaticMarkup(<Draft league={l} />);
    const n = draftDayOffers(l).length;
    expect(html).toContain(
      `${n > 1 ? `${n} teams want` : '1 team wants'} No. ${nextPick(l)!.overall} · gone when you pick`,
    );
    expect(html.match(/class="[^"]*offer-card/g)?.length).toBe(n);
    expect(html).toContain('Shop this pick');
    expect(html).not.toContain('Call teams ahead');
  });

  it('offers Call teams ahead only while you wait on your next pick', () => {
    const l = draftDay();
    if (nextPick(l)!.ownerId === l.userTeamId) draftForUser(l);
    draftNextPick(l);
    const html = renderToStaticMarkup(<Draft league={l} />);
    expect(nextPick(l)!.ownerId).not.toBe(l.userTeamId);
    expect(html).toContain('Call teams ahead');
    expect(html).not.toContain('Shop this pick');
  });

  it('shows who a pick came from and the draft-day deal in your history', () => {
    const l = draftDay();
    const other = l.teams.find((t) => t.id !== l.userTeamId)!;
    const p = l.players[l.draftClass[0]];
    p.teamId = l.userTeamId;
    p.draft = {
      season: l.season,
      round: 1,
      pick: 5,
      teamId: l.userTeamId,
      via: other.id,
      deal: { from: other.id, got: ['No. 9', `${l.season + 1} round 2`] },
    };
    const html = renderToStaticMarkup(<Draft league={l} />);
    expect(html).toContain(`via ${other.abbrev}`);
    expect(html).toContain('Draft-day trade');
    expect(html).toContain(`${other.abbrev} sent No. 5 for No. 9 and ${l.season + 1} round 2.`);
  });
});
