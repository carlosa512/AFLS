import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { lineupRows } from '../engine/draftNeeds';
import { createLeague } from '../engine/generate';
import { simToEndOfSeason } from '../engine/league';
import { advanceOffseason, beginOffseason, draftForUser, draftToEnd, draftToUserPick } from '../engine/offseason';
import { draftOrder, nextPick, simDraft } from '../engine/offseason/draft';
import { Rng } from '../engine/rng';
import { FRONTS, OFF_SCHEMES, offenseLabel, type TeamScheme } from '../engine/schemes';
import { tradeContext } from '../engine/trade/context';
import type { League } from '../engine/types';
import { LineupCard, NeedsLine, PickRail, PickStrip, useDraftRoom, type DraftRoom } from './draftRoom';

/** One league on draft day, before the first pick and with one of your picks made, the next one on the clock. */
const fixture = (() => {
  const l = createLeague({ seed: 'draft-room' });
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'draft') advanceOffseason(l, { autoUser: true });
  const preview = JSON.stringify(l);
  simDraft(l, new Rng('draft-room'), { stopAtUser: true });
  draftForUser(l);
  draftToUserPick(l);
  return { preview, live: JSON.stringify(l) };
})();
const live = (): League => JSON.parse(fixture.live);
const preview = (): League => JSON.parse(fixture.preview);

/** Hooks need a component: renders what `draw` makes of the league's draft room. */
function Probe({ league, draw }: { league: League; draw: (room: DraftRoom | null) => ReactNode }) {
  return <>{draw(useDraftRoom(league))}</>;
}
const render = (league: League, draw: (room: DraftRoom | null) => ReactNode) =>
  renderToStaticMarkup(<Probe league={league} draw={draw} />);
const CHECK = 'points="4 12.5 9.5 18 20 6"';

describe('your needs line', () => {
  it('shows your needs with have/want counts, a drafted position struck with a check', () => {
    const l = live();
    const html = render(l, (room) => {
      const first = room!.mine.find((n) => !n.filled)!;
      const row = room!.rows.find((r) => r.position === first.position)!;
      // The first need, drafted for: struck through with a check.
      const done = { ...room!, mine: room!.mine.map((n, i) => (i === 1 ? { ...n, filled: true } : n)) };
      return (
        <>
          <div id="counts">{`${first.position}|${row.have}/${row.want}`}</div>
          <NeedsLine room={room!} />
          <NeedsLine room={done} />
        </>
      );
    });
    const [pos, count] = /id="counts">([^<]+)</.exec(html)![1].split('|');
    expect(html).toContain('Your needs');
    expect(html).toMatch(new RegExp(`need-pill[^"]*"[^>]*>${pos}<span class="need-count[^"]*">${count}</span>`));
    expect(html).toMatch(/<s>[A-Z]+<\/s>/);
    expect(html).toContain(CHECK);
  });

  it('says No pressing needs when nothing is left unfilled', () => {
    const html = render(live(), (room) => (
      <NeedsLine room={{ ...room!, mine: room!.mine.map((n) => ({ ...n, filled: true })) }} />
    ));
    expect(html).toContain('No pressing needs');
  });
});

describe('your lineup', () => {
  it('draws the lineup in position order with have/want, your grade and the typical starter', () => {
    const l = live();
    const html = render(l, (room) => <LineupCard league={l} room={room!} id="lineup-test" />);
    expect(html).toContain('Your lineup');
    expect(html).toContain('Depth chart');
    const r = render(l, (room) => <span>{offenseLabel(room!.scheme.offense.id)}</span>);
    expect(html).toContain(/<span>([^<]+)<\/span>/.exec(r)![1]);
    const order = [...html.matchAll(/data-pos="([A-Z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S', 'K', 'P']);
    expect(html).toMatch(/\d+\/\d+/);
    expect(html).toMatch(/class="num typical"[^>]*>\d+\.\d</);
  });

  it('shows a dash for a position the scheme starts nobody at', () => {
    const l = live();
    const air: TeamScheme = { offense: OFF_SCHEMES.airRaid, front: FRONTS.fourThree, coverage: null };
    const rows = lineupRows(tradeContext(l), l.userTeamId, l.teams[l.userTeamId], air);
    const html = render(l, (room) => <LineupCard league={l} room={{ ...room!, scheme: air, rows }} id="lineup-air" />);
    const te = /<tr data-pos="TE">(.*?)<\/tr>/.exec(html)![1];
    expect(te.match(/–/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('gives no room when you are between jobs', () => {
    const l = live();
    l.gms[l.userGmId].teamId = null;
    expect(render(l, (room) => (room ? 'room' : 'none'))).toBe('none');
  });
});

describe('pick rail', () => {
  /** The rail's row for one pick, by its number. */
  const rowOf = (html: string, no: number) =>
    new RegExp(`<li class="pick-row[^"]*" data-no="${no}">(.*?)</li>`).exec(html)?.[1];

  it('lists every pick, the made ones with their player, and marks the clock', () => {
    const l = live();
    const html = render(l, (room) => <PickRail league={l} room={room} />);
    expect(html.match(/class="pick-row/g)?.length).toBe(draftOrder(l).length);
    expect(html.match(/is-clock/g)?.length).toBe(1);
    for (let r = 1; r <= 7; r++) expect(html).toContain(`Round ${r}`);
    const first = draftOrder(l)[0];
    expect(rowOf(html, 1)).toContain(l.players[first.playerId!].lastName);
  });

  it("shows a rival's needs on its picks to come, and none on yours", () => {
    const l = live();
    const clock = nextPick(l)!;
    const html = render(l, (room) => {
      const next = draftOrder(l).find((pk) => pk.overall! > clock.overall! && pk.ownerId !== l.userTeamId)!;
      const need = room!.byTeam.get(next.ownerId)!.needs[0];
      return (
        <>
          <div id="probe">{`${next.overall}|${need.position}`}</div>
          <PickRail league={l} room={room} />
        </>
      );
    });
    const [no, pos] = /id="probe">([^<]+)</.exec(html)![1].split('|');
    expect(rowOf(html, Number(no))).toMatch(new RegExp(`need-pill[^>]*>(<s>)?${pos}`));
    const mine = rowOf(html, clock.overall!)!;
    expect(mine).toContain('You&#x27;re on the clock');
    expect(mine).not.toContain('need-pill');
  });

  it('marks no clock when the draft is done', () => {
    const l = live();
    draftToEnd(l);
    const html = render(l, (room) => <PickRail league={l} room={room} />);
    expect(html).not.toContain('is-clock');
    expect(html.match(/class="pick-row made/g)?.length).toBe(draftOrder(l).length);
  });

  it('lists the order with needs before the first pick', () => {
    const l = preview();
    const html = render(l, (room) => <PickRail league={l} room={room} />);
    expect(html).not.toContain('pick-row made');
    expect(html).toContain('need-pill');
  });

  it('lists picks without needs when you are between jobs', () => {
    const l = live();
    const html = renderToStaticMarkup(<PickRail league={l} room={null} />);
    expect(html.match(/class="pick-row/g)?.length).toBe(draftOrder(l).length);
    expect(html).not.toContain('need-pill');
  });

  it('shows the strip from two picks back', () => {
    const l = live();
    const html = render(l, (room) => <PickStrip league={l} room={room} />);
    const cards = [...html.matchAll(/class="pick-card((?: [^"]*)?)"/g)].map((m) => m[1]);
    expect(cards).toHaveLength(14);
    expect(cards[2]).toContain('is-clock');
  });
});
