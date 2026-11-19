import { readFileSync } from 'node:fs';
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
import { Draft } from './screens/Draft';
import { drawn, LineupCard, NeedsLine, PickRail, PickStrip, useDraftRoom, type DraftRoom } from './draftRoom';

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
    new RegExp(`<li class="pick-row[^"]*" data-no="${no}"[^>]*>(.*?)</li>`).exec(html)?.[1];

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

describe('draft room', () => {
  it('lays out the room with the rail, the needs line and no old ticker', () => {
    const html = renderToStaticMarkup(<Draft league={live()} />);
    for (const part of ['draft-room', 'draft-rail', 'pick-rail', 'pick-strip', 'Your needs'])
      expect(html).toContain(part);
    expect(html.match(/Your lineup/g)?.length).toBe(2);
    expect(html).not.toContain('draft-ticker');
    expect(html).not.toContain('Latest picks');
  });

  it('tags board rows at a position you need, and offers Needs only', () => {
    const html = renderToStaticMarkup(<Draft league={live()} />);
    expect(html).toMatch(/class="need-tag (big|need)"/);
    expect(html).toContain('Needs only');
  });

  it('opens your draft history on the last two drafts', () => {
    const html = renderToStaticMarkup(<Draft league={live()} />);
    expect(html).toMatch(/<option value="recent" selected="">Last two drafts<\/option>/);
  });
});

describe('final review fixes', () => {
  const css = readFileSync('src/styles.css', 'utf8');

  it('keeps the rail below the sticky top bar', () => {
    const rail = /\.draft-rail \{[^}]*position: sticky;[^}]*\}/.exec(css)![0];
    expect(rail).toContain('var(--topbar-h');
    expect(readFileSync('src/ui/screens/Draft.tsx', 'utf8')).toContain("'--topbar-h'");
  });

  it('refreshes the room when the league changes, not only when a pick is made', () => {
    // The league is mutated in place: the store's version is what says it changed (a day of free agency, a trade).
    expect(readFileSync('src/ui/draftRoom.tsx', 'utf8')).toMatch(
      /useSyncExternalStore\(store\.subscribe, store\.version/,
    );
  });

  it('colors a need apart from a minor one', () => {
    const rule = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[2] ?? '';
    expect(rule('.need-pill.need')).toContain('background');
    expect(rule('.need-swatch.need')).toContain('background');
    expect(rule('.need-pill')).not.toContain('var(--surface-2)');
  });

  it('shows Needs only as a pressed toggle', () => {
    const html = renderToStaticMarkup(<Draft league={live()} />);
    expect(html).toMatch(/<div class="seg seg-sm"[^>]*><button aria-pressed="false">Needs only<\/button><\/div>/);
  });

  it('marks the first pick of each round for the round jump', () => {
    const l = live();
    const html = render(l, (room) => <PickRail league={l} room={room} />);
    for (let r = 1; r <= 7; r++) expect(html).toContain(`data-first="${r}"`);
  });
});

describe('small fixes', () => {
  it('marks no pick as yours when you are between jobs', () => {
    const l = live();
    l.gms[l.userGmId].teamId = null;
    const html = renderToStaticMarkup(
      <>
        <PickRail league={l} room={null} />
        <PickStrip league={l} room={null} />
      </>,
    );
    expect(html).not.toContain('is-mine');
    expect(html).not.toContain('Your pick');
    expect(html).not.toContain('You&#x27;re on the clock');
  });

  it('draws the rail on a wide screen and the strip on a narrow one, both before it knows', () => {
    expect(drawn(true)).toEqual({ rail: true, narrow: false });
    expect(drawn(false)).toEqual({ rail: false, narrow: true });
    expect(drawn(null)).toEqual({ rail: true, narrow: true });
  });

  it('works nothing out when it is off', () => {
    expect(render(live(), () => null)).toBe('');
    expect(renderToStaticMarkup(<Off league={live()} />)).toBe('none');
  });

  it('names an ideal fit in the key', () => {
    const l = live();
    const html = render(l, (room) => <LineupCard league={l} room={room!} id="key-test" />);
    expect(html).toContain('Ideal or good fit');
  });

  it("opens on your team's last two drafts, not the league's", () => {
    const l = live();
    const mine = Object.values(l.players).find((p) => p.draft?.teamId === l.userTeamId && p.scouting)!;
    const other = Object.values(l.players).find((p) => p.draft && p.scouting && p.draft.teamId !== l.userTeamId)!;
    other.draft!.season = l.season - 1;
    mine.draft!.season = l.season - 3;
    const html = renderToStaticMarkup(<Draft league={l} />);
    const history = html.slice(html.indexOf('Draft history'), html.indexOf('<aside'));
    expect(history).toContain(mine.lastName);
  });

  it('keeps the draft-day pill comment out of Draft.tsx', () => {
    expect(readFileSync('src/ui/screens/Draft.tsx', 'utf8')).not.toContain("Draft day's own judgment");
  });
});

/** useDraftRoom switched off. */
function Off({ league }: { league: League }) {
  return <>{useDraftRoom(league, false) ? 'room' : 'none'}</>;
}

describe('phone width', () => {
  it("keeps a table's hidden labels inside its scroller, so a phone page never grows sideways", () => {
    // A `.visually-hidden` label is absolutely placed: with no positioned scroller around it, a wide table's labels
    // escape the scroll and stretch the whole page (the draft board made a phone page 887 pixels wide).
    const rule = /(^|\n)\.table-scroll \{([^}]*)\}/.exec(readFileSync('src/styles.css', 'utf8'))![2];
    expect(rule).toContain('position: relative');
  });
});
