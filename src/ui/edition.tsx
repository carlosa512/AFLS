/**
 * SNN's weekly edition in the inbox (`engine/snnWeek.ts`): a front page whose tiles open into stories. Everything it
 * shows was saved with the mail as filed, so a later game, a trade or a pruned box score cannot change it; a man or a
 * coach who has left the league since is simply not drawn. Every tile starts closed so the week fits one screen, and
 * one story is open at a time. Spec: docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md §4.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import type { Edition, EditionScore, EditionStory, InboxAction, InboxMessage, League } from '../engine/types';
import { useNav } from './App';
import { inkOn } from './color';
import { PlayerAvatar, PlayerLink, TeamChip, TeamLink } from './components';
import { LinkedText, nameIndex, type MoveIndex, type Who } from './moves';
import { StaffAvatar } from './staffAvatar';

const club = (league: League, id: number) => league.teams[id];
/** A club's colours as the two custom properties the edition's bands and borders read. */
const colours = (league: League, id: number) =>
  ({ '--c1': club(league, id).colors[0], '--c2': club(league, id).colors[1] }) as CSSProperties;

export function EditionCards({
  league,
  message,
  open: initial,
}: {
  league: League;
  message: InboxMessage;
  /** A story to show open from the start (its `key`). */
  open?: string;
}) {
  const e = message.edition!;
  const [open, setOpen] = useState<string | null>(initial ?? null);
  // One index for every paragraph on the page: building it walks the whole league.
  const index = useMemo(() => nameIndex(league), [league]);
  const tiles = [...(e.club ? [e.club] : []), ...e.tiles];
  const story = (s: EditionStory, lead = false) => (
    <StoryBlock key={s.key} league={league} story={s} lead={lead} index={index} onClose={() => setOpen(null)} />
  );
  return (
    <div className="ed">
      <ScoreStrip league={league} scores={e.scores} />
      {open === e.lead.key ? (
        story(e.lead, true)
      ) : (
        <Front league={league} story={e.lead} index={index} onOpen={setOpen} />
      )}
      {tiles.length > 0 && (
        <div className="ed-tiles">
          {tiles.map((s) =>
            open === s.key ? story(s) : <Tile key={s.key} league={league} story={s} index={index} onOpen={setOpen} />,
          )}
        </div>
      )}
      {e.race && <RaceTable league={league} race={e.race} />}
      {e.bracket && <Bracket league={league} bracket={e.bracket} />}
      {e.next && <NextGame league={league} next={e.next} />}
    </div>
  );
}

/** Every final of the week; the reader's own is marked, and each opens its box score. */
export function ScoreStrip({ league, scores }: { league: League; scores: EditionScore[] }) {
  const nav = useNav();
  const user = league.userTeamId;
  return (
    <div className="ed-ticker">
      {scores.map((s) => {
        const mine = s.homeId === user || s.awayId === user;
        const [top, bottom] =
          s.away > s.home
            ? [
                [s.awayId, s.away],
                [s.homeId, s.home],
              ]
            : [
                [s.homeId, s.home],
                [s.awayId, s.away],
              ];
        return (
          <button
            type="button"
            key={s.gameId}
            className={`ed-score${mine ? ' is-user' : ''}`}
            onClick={() => nav.openGame(s.gameId)}
            aria-label={`${club(league, top[0]).name} ${top[1]}, ${club(league, bottom[0]).name} ${bottom[1]}: box score`}
          >
            <span>
              <b>{club(league, top[0]).abbrev}</b> {top[1]}
            </span>
            <span>
              {club(league, bottom[0]).abbrev} {bottom[1]}
              {s.overtime ? ' OT' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The men a story names, for linking them in its paragraphs. */
const about = (story: EditionStory): Who[] => story.cast.map((id) => ({ kind: 'player' as const, id }));

/** Who a story's picture is of: the man, or the clubs' chips when it is about a game or a club. */
function Picture({ league, story, size }: { league: League; story: EditionStory; size: number }) {
  const p = story.picture.playerId === undefined ? undefined : league.players[story.picture.playerId];
  if (p) {
    const game =
      story.picture.gameId === undefined ? undefined : league.games.find((g) => g.id === story.picture.gameId);
    // In the uniform of the club he played that game for.
    const teamId = game?.result?.playerTeams[p.id] ?? p.teamId;
    return (
      <div className="ed-who">
        <PlayerAvatar player={p} team={teamId === null ? null : club(league, teamId)} size={size} game={game} />
        <PlayerLink league={league} player={p} pos />
      </div>
    );
  }
  const ids = story.picture.teamIds ?? [story.clubId];
  return (
    <div className="ed-who ed-who-clubs">
      {ids.map((id) => (
        <TeamChip key={id} team={club(league, id)} large />
      ))}
    </div>
  );
}

/** "L 18–28" for the reader's own game, as the Your club tile's kicker has it. */
function resultFor(league: League, story: EditionStory): string {
  const s = story.score;
  if (!s) return '';
  const home = s.homeId === league.userTeamId;
  const [us, them] = home ? [s.home, s.away] : [s.away, s.home];
  return ` · ${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}–${them}`;
}

/** The lead story, closed: its headline and summary beside the man it is about. */
function Front({
  league,
  story,
  index,
  onOpen,
}: {
  league: League;
  story: EditionStory;
  index: MoveIndex;
  onOpen: (key: string) => void;
}) {
  const ink = inkOn(club(league, story.clubId).colors[0]);
  return (
    <section className="ed-front" style={colours(league, story.clubId)}>
      <div className="ed-front-text">
        <div className="eyebrow">Lead story{story.yours ? ' · Your club' : ''}</div>
        <h3 className="ed-headline">{story.headline}</h3>
        <p className="ed-summary">
          <LinkedText league={league} text={story.summary} about={about(story)} index={index} />
        </p>
        <button type="button" className="ed-more" onClick={() => onOpen(story.key)}>
          Read the story ▾
        </button>
      </div>
      <div className="ed-front-pic" style={{ color: ink, '--ed-ink': ink } as CSSProperties}>
        <Picture league={league} story={story} size={96} />
        {story.numbers.length > 0 && (
          <div className="ed-front-stats">
            {story.numbers.map((n) => (
              <span key={n.label}>
                <b>{n.value}</b> {n.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** A story, closed: who, what, one or two sentences. */
function Tile({
  league,
  story,
  index,
  onOpen,
}: {
  league: League;
  story: EditionStory;
  index: MoveIndex;
  onOpen: (key: string) => void;
}) {
  return (
    <section
      className={`ed-tile${story.yours ? ' is-yours' : ''}`}
      style={colours(league, story.yours ? league.userTeamId : story.clubId)}
    >
      <div className="ed-kicker">
        <TeamChip team={club(league, story.yours ? league.userTeamId : story.clubId)} />
        {story.yours ? `Your club${resultFor(league, story)}` : story.kicker}
      </div>
      <h4 className="ed-tile-head">{story.headline}</h4>
      <p className="ed-tile-text">
        <LinkedText league={league} text={story.summary} about={about(story)} index={index} />
      </p>
      <button type="button" className="ed-more" onClick={() => onOpen(story.key)}>
        Read ▾
      </button>
    </section>
  );
}

const label = (league: League, a: InboxAction): string => {
  switch (a.kind) {
    case 'game':
      return 'Box score';
    case 'player':
      return league.players[a.playerId] ? `${league.players[a.playerId].lastName}'s player card` : '';
    case 'team':
      return a.teamId === league.userTeamId ? 'Your roster' : `${club(league, a.teamId).name} roster`;
    case 'standings':
      return 'Standings';
    default:
      return '';
  }
};

/** A story, open: the band in its club's colours, the headline, the numbers, the paragraphs, the quote, where to go. */
export function StoryBlock({
  league,
  story,
  lead = false,
  index,
  onClose,
}: {
  league: League;
  story: EditionStory;
  lead?: boolean;
  index?: MoveIndex;
  onClose?: () => void;
}) {
  const nav = useNav();
  const s = story.score;
  const ink = inkOn(club(league, story.clubId).colors[0]);
  const act = (a: InboxAction) => {
    if (a.kind === 'game') nav.openGame(a.gameId);
    else if (a.kind === 'player') nav.openPlayer(a.playerId);
    else if (a.kind === 'team') nav.openTeam(a.teamId);
    else if (a.kind === 'standings') nav.go({ view: 'standings' });
  };
  // The winner first, as a headline has it; the home club first on a tie.
  const [first, second] = !s
    ? []
    : s.away > s.home
      ? [
          [s.awayId, s.away],
          [s.homeId, s.home],
        ]
      : [
          [s.homeId, s.home],
          [s.awayId, s.away],
        ];
  const coach = story.quote?.coachId === undefined ? undefined : league.coaches[story.quote.coachId];
  const links = story.links.filter((a) => label(league, a));
  return (
    <article className="ed-story">
      <div
        className="ed-hero"
        style={{ ...colours(league, story.clubId), color: ink, '--ed-ink': ink } as CSSProperties}
      >
        <div>
          <div className="ed-hero-kicker">
            {lead ? 'Lead story · ' : ''}
            {story.yours ? 'Your club · ' : ''}
            {story.kicker}
          </div>
          {s && first && second && (
            <>
              <div className="ed-hero-score">
                <TeamChip team={club(league, first[0])} large />
                <span>{first[1]}</span>
                <i aria-hidden="true">—</i>
                <span>{second[1]}</span>
                <TeamChip team={club(league, second[0])} large />
              </div>
              <div className="ed-hero-sub">
                {club(league, s.awayId).city} at {club(league, s.homeId).city} · Final{s.overtime ? ' · OT' : ''}
              </div>
            </>
          )}
        </div>
        <Picture league={league} story={story} size={104} />
      </div>
      <h3 className="ed-headline">{story.headline}</h3>
      {story.numbers.length > 0 && (
        <div className="ed-stats">
          {story.numbers.map((n) => (
            <div className="ed-stat" key={n.label}>
              <b>{n.value}</b>
              <span>{n.label}</span>
            </div>
          ))}
        </div>
      )}
      {story.paragraphs.map((p, i) => (
        <p className="ed-p" key={i}>
          <LinkedText league={league} text={p} about={about(story)} index={index} />
        </p>
      ))}
      {story.quote && (
        <blockquote className="ed-quote" style={colours(league, story.yours ? league.userTeamId : story.clubId)}>
          {coach && <StaffAvatar person={coach} size={48} />}
          <div>
            <q>{story.quote.text}</q>
            <cite>
              {story.quote.name}, {story.quote.role}
            </cite>
          </div>
        </blockquote>
      )}
      <div className="ed-foot">
        <div className="row">
          {links.map((a, i) => (
            <button
              type="button"
              key={i}
              className={`btn btn-sm${i === 0 ? ' btn-primary' : ''}`}
              onClick={() => act(a)}
            >
              {label(league, a)}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className="ed-more" onClick={onClose}>
            Close ▴
          </button>
        )}
      </div>
    </article>
  );
}

/** The reader's division after the week. */
export function RaceTable({ league, race }: { league: League; race: NonNullable<Edition['race']> }) {
  const ties = race.rows.some((r) => r.t > 0);
  return (
    <section>
      <h4 className="ed-section">The race</h4>
      <table className="ed-race">
        <thead>
          <tr>
            <th>{race.division}</th>
            <th>W</th>
            <th>L</th>
            {ties && <th>T</th>}
            <th>Last</th>
            <th>Next</th>
          </tr>
        </thead>
        <tbody>
          {race.rows.map((r) => (
            <tr key={r.teamId} className={r.teamId === league.userTeamId ? 'is-user' : undefined}>
              <td>
                <TeamLink team={club(league, r.teamId)} chip />
              </td>
              <td className="num">{r.w}</td>
              <td className="num">{r.l}</td>
              {ties && <td className="num">{r.t}</td>}
              <td className={`num${r.last.startsWith('W') ? ' is-win' : r.last.startsWith('L') ? ' is-loss' : ''}`}>
                {r.last}
              </td>
              <td className="num">{r.next}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** A playoff round: its results, and who meets next. */
function Bracket({ league, bracket }: { league: League; bracket: NonNullable<Edition['bracket']> }) {
  return (
    <section className="ed-bracket">
      <h4 className="ed-section">The bracket</h4>
      <ScoreStrip league={league} scores={bracket.results} />
      {bracket.next.map((g) => (
        <div className="ed-next-line" key={`${g.awayId}:${g.homeId}`}>
          <TeamLink team={club(league, g.awayId)} chip /> at <TeamLink team={club(league, g.homeId)} chip />
        </div>
      ))}
    </section>
  );
}

/** Next week's game of the week. */
function NextGame({ league, next }: { league: League; next: NonNullable<Edition['next']> }) {
  return (
    <section className="ed-next">
      <TeamChip team={club(league, next.awayId)} large />
      <div>
        <div className="eyebrow">Game of the week</div>
        <b>
          <TeamLink team={club(league, next.awayId)} /> ({next.away}) at <TeamLink team={club(league, next.homeId)} /> (
          {next.home})
        </b>
      </div>
      <TeamChip team={club(league, next.homeId)} large />
    </section>
  );
}
