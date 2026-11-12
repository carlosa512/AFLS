import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLeague } from '../engine/generate';
import { playWeek } from '../engine/league';
import { buildEdition, SNN } from '../engine/snnWeek';
import type { Edition, InboxMessage, League } from '../engine/types';
import { EditionCards, StoryBlock } from './edition';
import { MailCards } from './mail';

let l: League;
let edition: Edition;
let message: InboxMessage;
const count = (html: string, needle: string) => html.split(needle).length - 1;
/** Closed tiles on the page (not the grid that holds them, or a tile's own headline). */
const tilesIn = (html: string) => (html.match(/class="ed-tile( is-yours)?"/g) ?? []).length;
const mail = (e: Edition): InboxMessage => ({
  id: `snn:${l.season}:w4`,
  season: l.season,
  phase: 'regular',
  week: 4,
  from: SNN,
  category: 'league',
  subject: e.lead.headline,
  body: e.lead.summary,
  edition: e,
  read: false,
  actions: [],
});
beforeAll(() => {
  l = createLeague({ seed: 'edition-screen' });
  for (let w = 0; w < 4; w++) playWeek(l);
  edition = buildEdition(l, 4)!;
  message = mail(edition);
}, 120_000);

describe('the weekly edition in the inbox', () => {
  it('opens closed, with every slot the edition has', () => {
    const html = renderToStaticMarkup(<EditionCards league={l} message={message} />);
    expect(count(html, 'class="ed-score')).toBe(edition.scores.length);
    expect(html).toContain('class="ed-front"');
    expect(tilesIn(html)).toBe((edition.club ? 1 : 0) + edition.tiles.length);
    expect(html).not.toContain('class="ed-story"');
    // React writes an apostrophe as an entity.
    for (const t of [edition.lead, ...edition.tiles]) expect(html).toContain(t.headline.replace(/'/g, '&#x27;'));
    expect(html).toContain('class="ed-race"');
    expect(html).toContain('class="ed-next"');
    expect(html).not.toContain('class="ed-bracket"');
  });

  it('is what the inbox draws for a message that carries an edition', () => {
    expect(renderToStaticMarkup(<MailCards league={l} message={message} />)).toContain('class="ed-front"');
  });

  it('opens one story in place: the lead’s front gives way to the story, the tiles stay', () => {
    const html = renderToStaticMarkup(<EditionCards league={l} message={message} open={edition.lead.key} />);
    expect(count(html, 'class="ed-story"')).toBe(1);
    expect(html).not.toContain('class="ed-front"');
    expect(tilesIn(html)).toBe((edition.club ? 1 : 0) + edition.tiles.length);
    expect(count(html, 'class="ed-p"')).toBe(edition.lead.paragraphs.length);
    expect(html).toContain('>Close');
    expect(html).toContain('>Box score<');
  });

  it('opens a tile in place of its tile', () => {
    const tile = edition.tiles[0];
    const html = renderToStaticMarkup(<EditionCards league={l} message={message} open={tile.key} />);
    expect(count(html, 'class="ed-story"')).toBe(1);
    expect(html).toContain('class="ed-front"');
    expect(tilesIn(html)).toBe((edition.club ? 1 : 0) + edition.tiles.length - 1);
  });

  it('marks the reader’s game in the strip and his row in the race', () => {
    const html = renderToStaticMarkup(<EditionCards league={l} message={message} />);
    const played = edition.scores.some((s) => s.homeId === l.userTeamId || s.awayId === l.userTeamId);
    expect(count(html, 'ed-score is-user')).toBe(played ? 1 : 0);
    expect(count(html, '<tr class="is-user"')).toBe(1);
  });

  it('links names and shows no rating', () => {
    const html = renderToStaticMarkup(<EditionCards league={l} message={message} open={edition.lead.key} />);
    expect(html).toMatch(/<button type="button" class="linklike[^"]*"[^>]*>(<span>)?[A-Z]/);
    expect(html).not.toMatch(/\bOVR\b|★|potential/i);
  });

  it('renders an edition whose man is no longer in the league', () => {
    const withMan = [edition.lead, ...edition.tiles].find((s) => s.picture.playerId !== undefined) ?? edition.lead;
    const copy: League = { ...l, players: { ...l.players } };
    if (withMan.picture.playerId !== undefined) delete copy.players[withMan.picture.playerId];
    for (const id of withMan.cast) delete copy.players[id];
    const html = renderToStaticMarkup(<EditionCards league={copy} message={message} open={withMan.key} />);
    expect(html).toContain('class="ed-story"');
    expect(html).toContain(withMan.paragraphs[0].slice(0, 12));
  });

  it('draws a player who is quoted, and sends a trade story to the trade screen', () => {
    const p = Object.values(l.players).find((x) => x.teamId !== null && x.position === 'WR')!;
    const html = renderToStaticMarkup(
      <StoryBlock
        league={l}
        story={{
          ...edition.lead,
          kind: 'trade',
          picture: { playerId: p.id },
          score: undefined,
          quote: {
            playerId: p.id,
            name: 'A Player',
            role: 'wide receiver',
            text: 'I gave that club everything I had.',
          },
          links: [{ kind: 'player', playerId: p.id }, { kind: 'trades' }, { kind: 'gms' }],
        }}
      />,
    );
    expect(html).toContain('I gave that club everything I had.');
    expect(html).toMatch(/class="ed-quote"[^>]*><svg/);
    expect(html).toContain('>Trades<');
    expect(html).toContain('>GM careers and jobs<');
    expect(html).not.toContain('ed-hero-score');
    // With no score to show, the band carries the headline and the numbers: no empty band, no lone number box.
    expect(html).toMatch(/class="ed-hero[^"]*"[^>]*>[\s\S]*?<h3 class="ed-headline">[\s\S]*?class="ed-who/);
    expect(html).not.toContain('class="ed-stats"');
    expect(count(html, '<h3 class="ed-headline">')).toBe(1);
  });

  it('gives a closed tile its numbers as figures with their labels, two at most', () => {
    const html = renderToStaticMarkup(<EditionCards league={l} message={message} />);
    expect(count(html, 'class="ed-tile-meta')).toBeGreaterThan(0);
    // Each is a figure and what it counts: never a bare run of text, never an empty one.
    expect(count(html, 'class="ed-tile-stat"')).toBeGreaterThan(0);
    expect(html).toMatch(/class="ed-tile-stat"><b>[^<]+<\/b><span>[^<]+<\/span>/);
    for (const meta of html.match(/class="ed-tile-meta">.*?<\/div>/g) ?? [])
      expect(count(meta, 'class="ed-tile-stat"')).toBeLessThanOrEqual(2);
  });

  it('labels a Column and sets its evidence in a table when it is open', () => {
    const column = {
      ...edition.tiles[0],
      key: 'column:2026:unit:3:run game:1-',
      kind: 'column' as const,
      kicker: 'Column',
      headline: 'Houston’s problem is its run game',
      score: undefined,
      quote: undefined,
      table: {
        head: ['', 'Weeks 1–5', 'Since'],
        rows: [
          ['Yards a carry', '4.4', '2.9'],
          ['Record', '3–2', '1–3'],
        ],
      },
    };
    const e: Edition = { ...edition, tiles: [...edition.tiles.slice(0, 2), column] };
    const closed = renderToStaticMarkup(<EditionCards league={l} message={mail(e)} />);
    expect(closed).toContain('Column');
    expect(closed).not.toContain('class="ed-evidence"');
    const open = renderToStaticMarkup(<EditionCards league={l} message={mail(e)} open={column.key} />);
    expect(count(open, 'class="ed-evidence"')).toBe(1);
    expect(open).toContain('Weeks 1–5');
    expect(open).toMatch(/<td class="num is-claim">2\.9<\/td>/);
    // A story with no table draws none.
    const plain = renderToStaticMarkup(<EditionCards league={l} message={message} open={edition.lead.key} />);
    expect(plain).not.toContain('class="ed-evidence"');
  });

  it('draws the bracket in the playoffs and no race', () => {
    const playoff: Edition = {
      ...edition,
      label: 'Wild Card',
      race: undefined,
      next: undefined,
      bracket: { results: edition.scores.slice(0, 2), next: [{ homeId: 0, awayId: 1 }] },
    };
    const html = renderToStaticMarkup(<EditionCards league={l} message={mail(playoff)} />);
    expect(html).toContain('class="ed-bracket"');
    expect(html).not.toContain('class="ed-race"');
    expect(html).not.toContain('class="ed-next"');
    // The round's scores are told once, in the strip at the top.
    expect(count(html, 'class="ed-ticker')).toBe(1);
    // After the final there is no next round to draw.
    const last = renderToStaticMarkup(
      <EditionCards
        league={l}
        message={mail({ ...playoff, bracket: { results: edition.scores.slice(0, 1), next: [] } })}
      />,
    );
    expect(last).not.toContain('class="ed-bracket"');
  });
});
