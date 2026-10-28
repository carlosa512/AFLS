import { useEffect, useState } from 'react';
import { staffBoardValue } from '../../engine/draftGrade';
import { draftForUser, draftNextPick, draftToEnd, draftToUserPick } from '../../engine/offseason';
import {
  availableProspects,
  boardValue,
  draftOrder,
  nextPick,
  reachOrSteal,
  ROUNDS,
} from '../../engine/offseason/draft';
import type { League, Player, Position } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import {
  Panel,
  PlayerLink,
  PositionFilter,
  Rating,
  Section,
  SortTh,
  sortRows,
  TeamChip,
  TeamPicker,
  useSort,
} from '../components';
import { OriginTag, originName } from '../origin';
import {
  combineRows,
  drillVerdict,
  KnowledgeMeter,
  MakeupPills,
  makeupOf,
  Ovr,
  QuirkPills,
  quirksOf,
  potentialText,
  ScoutButton,
  Stars,
  starsOf,
  viewOf,
} from '../scouting';
import { store } from '../store';

type BoardSort =
  | 'rank'
  | 'mine'
  | 'pos'
  | 'age'
  | 'school'
  | 'drill'
  | 'grade'
  | 'ceiling'
  | 'stars'
  | 'consensus'
  | 'known';

/** The combine drills the board's drill column can show, with their short headers. */
const BOARD_DRILLS = [
  ['forty', '40', '40-yard dash'],
  ['shuttle', 'Shuttle', '20-yard shuttle'],
  ['cone', '3-cone', '3-cone drill'],
  ['vertical', 'Vertical', 'Vertical jump'],
  ['broad', 'Broad', 'Broad jump'],
  ['bench', 'Bench', 'Bench press'],
] as const;
type BoardDrill = (typeof BOARD_DRILLS)[number][0];

/** Board rows shown at a time: a round's worth, so the board stays a screen or two tall. */
const BOARD_PAGE = 32;

export function Draft({ league }: { league: League }) {
  const [pos, setPos] = useState<Position | 'ALL'>('ALL');
  const [sort, onSort, setSort] = useSort<BoardSort>({ key: 'rank', desc: false });
  const [drill, setDrill] = useState<BoardDrill>('forty');
  const [shown, setShown] = useState(BOARD_PAGE);
  // A new filter or ranking starts back at the top of the board.
  useEffect(() => setShown(BOARD_PAGE), [pos, sort]);
  const teamId = league.userTeamId;
  const all = availableProspects(league);
  // Consensus rank across the whole class: roughly where the league will take him.
  const rank = new Map([...all].sort((a, b) => boardValue(b) - boardValue(a)).map((p, i) => [p.id, i + 1]));
  // Sort the whole class before paging it, so "fastest" or "best ceiling" reaches past the first page.
  const prospects = sortRows(
    all.filter((p) => pos === 'ALL' || p.position === pos),
    sort,
    (p, key) => {
      const v = viewOf(league, p);
      return key === 'mine'
        ? staffBoardValue(league, p)
        : key === 'pos'
          ? POSITIONS.indexOf(p.position)
          : key === 'age'
            ? p.age
            : key === 'school'
              ? originName(p)
              : key === 'drill'
                ? (p.combine?.[drill] ?? (sort.desc ? -Infinity : Infinity))
                : key === 'grade'
                  ? v.ovr
                  : key === 'ceiling'
                    ? v.potMid
                    : key === 'stars'
                      ? starsOf(league, p, 'league', v).ability
                      : key === 'consensus'
                        ? p.scouting!.grade
                        : key === 'known'
                          ? v.knowledge
                          : rank.get(p.id)!;
    },
  );
  const onClock = league.phase === 'draft' ? nextPick(league) : undefined;
  const userUp = onClock?.ownerId === teamId;
  const order = draftOrder(league);
  const myNext = onClock && order.find((pk) => pk.ownerId === teamId && pk.playerId === undefined);
  const last = order.filter((pk) => pk.playerId !== undefined).at(-1);
  const lastP = last && league.players[last.playerId!];

  return (
    <>
      {league.phase === 'draft' && (
        <Panel
          title={
            onClock ? (
              <div className="row">
                <TeamChip team={league.teams[onClock.ownerId]} large />
                <div>
                  <h2>{userUp ? "You're on the clock" : `${league.teams[onClock.ownerId].name} on the clock`}</h2>
                  <span className="muted">
                    Round {onClock.round}, pick {onClock.overall}
                  </span>
                </div>
              </div>
            ) : (
              <h2>The draft is complete</h2>
            )
          }
          action={
            onClock && (
              <span className="row" style={{ gap: 8 }}>
                {!userUp && (
                  <>
                    <button className="btn" onClick={() => store.mutate(draftNextPick)}>
                      Next pick
                    </button>
                    <button className="btn" onClick={() => store.mutate(draftToUserPick)}>
                      Sim to my pick
                    </button>
                  </>
                )}
                {userUp && (
                  <button className="btn" onClick={() => store.mutate((l) => draftForUser(l))}>
                    Auto-pick for me
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => store.mutate(draftToEnd)}>
                  Sim the rest (AI picks for you)
                </button>
              </span>
            )
          }
        >
          <p className="muted small" style={{ margin: 0 }}>
            {last && lastP && (
              <>
                Last pick: No. {last.overall} {league.teams[last.ownerId].abbrev}, {lastP.position}{' '}
                <PlayerLink league={league} player={lastP} /> (consensus #{last.consRank}).{' '}
              </>
            )}
            {!onClock
              ? 'Every pick is in.'
              : userUp
                ? 'Pick from the board below, or let your staff choose.'
                : myNext
                  ? `Your next pick: round ${myNext.round}, No. ${myNext.overall} (${myNext.overall! - onClock.overall!} picks away).`
                  : 'You have no picks left in this draft.'}
          </p>
        </Panel>
      )}

      {prospects.length > 0 && (
        <Panel
          title={league.phase === 'draft' ? 'Big board' : `${league.season} draft class`}
          action={
            <span className="board-sort">
              <div className="seg seg-sm" role="group" aria-label="Rank prospects by">
                <button aria-pressed={sort.key === 'rank'} onClick={() => setSort({ key: 'rank', desc: false })}>
                  Consensus
                </button>
                <button aria-pressed={sort.key === 'mine'} onClick={() => setSort({ key: 'mine', desc: true })}>
                  Your board
                </button>
              </div>
              <select
                aria-label="Combine drill to show"
                value={drill}
                onChange={(e) => {
                  const next = e.target.value as BoardDrill;
                  setDrill(next);
                  // Sorted by the drill: keep sorting by it, best first (times low, reps and jumps high).
                  if (sort.key === 'drill') setSort({ key: 'drill', desc: !isTimed(next) });
                }}
              >
                {BOARD_DRILLS.map(([k, , label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <PositionFilter value={pos} onChange={setPos} />
            </span>
          }
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            Each scouting visit narrows a range:{' '}
            <b>
              {league.scoutPoints} visit{league.scoutPoints === 1 ? '' : 's'} left
            </b>{' '}
            this year.
          </p>
          <details className="more">
            <summary>How to read the board</summary>
            <p className="muted small">
              <b>Your grade</b> and <b>ceiling</b> are your scouts' estimates (a dashed grade is a guess). <b>Makeup</b>{' '}
              shows once your scouts know a prospect, usually after a visit or two ("?" means not yet; dashed tags are
              early word). <b>Habits</b> are what shows on film: a few in the tape, more with visits. <b>Consensus</b>{' '}
              is how the rest of the league rates him. Rivals blend it with their own scouts' reads, and trust their
              scouts more when those scouts are good, so he can go earlier or later than his rank. When your read beats
              the consensus, you've found a sleeper; when it's worse, let someone else take the bust.
            </p>
          </details>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh label="Player" k="rank" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
                  <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} desc={false} />
                  <SortTh label="Age" k="age" sort={sort} onSort={onSort} desc={false} className="num" />
                  <SortTh label="School" k="school" sort={sort} onSort={onSort} desc={false} />
                  <SortTh
                    label={BOARD_DRILLS.find(([k]) => k === drill)![1]}
                    k="drill"
                    sort={sort}
                    onSort={onSort}
                    desc={!isTimed(drill)}
                    className="num"
                  />
                  <SortTh label="Your grade" k="grade" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Ceiling" k="ceiling" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Stars" k="stars" sort={sort} onSort={onSort} />
                  <SortTh label="Consensus" k="consensus" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Known" k="known" sort={sort} onSort={onSort} />
                  <th>Makeup</th>
                  <th>Habits</th>
                  <th className="sticky-end" />
                </tr>
              </thead>
              <tbody>
                {prospects.slice(0, shown).map((p) => {
                  const v = viewOf(league, p);
                  return (
                    <tr key={p.id}>
                      <td className="sticky-col">
                        {/* The rank rides in the sticky cell: as a column of its own, the name would slide over it. */}
                        <span className="board-rank muted small">{rank.get(p.id)}</span>
                        <PlayerLink league={league} player={p} avatar={26} />
                      </td>
                      <td>{p.position}</td>
                      <td className="num">{p.age}</td>
                      <td>
                        <OriginTag player={p} />
                      </td>
                      <BoardDrillCell player={p} drill={drill} />
                      <td className="num">
                        <Ovr league={league} player={p} />
                      </td>
                      <td className="num">{potentialText(v)}</td>
                      <td>
                        <Stars s={starsOf(league, p, 'league', v)} size={13} />
                      </td>
                      <td className="num">
                        <Rating value={p.scouting!.grade} decimals={1} />
                      </td>
                      <td>
                        <KnowledgeMeter value={v.knowledge} />
                      </td>
                      <td>
                        <BoardMakeup league={league} player={p} />
                      </td>
                      <td>
                        <BoardHabits league={league} player={p} />
                      </td>
                      {/* Pinned right, so Scout and Draft stay in reach on a phone without scrolling the table. */}
                      <td className="sticky-end">
                        <ScoutButton league={league} player={p} />{' '}
                        {userUp && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => store.mutate((l) => draftForUser(l, p.id))}
                          >
                            Draft
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {prospects.length > shown && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button className="btn btn-sm" onClick={() => setShown((n) => n + BOARD_PAGE)}>
                Show {Math.min(BOARD_PAGE, prospects.length - shown)} more
              </button>
              <span className="muted small">
                {shown} of {prospects.length}
              </span>
            </div>
          )}
        </Panel>
      )}

      <DraftHistory league={league} live={onClock?.round} />

      <YourPicks league={league} />
    </>
  );
}

/**
 * Your picks in the next draft (or the one under way), with the later years folded away. Picks you
 * traded off stay listed, so a missing round reads as "traded to", not as a gap.
 */
function YourPicks({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const next =
    league.phase === 'resign' || league.phase === 'freeAgency' || league.phase === 'draft'
      ? league.season
      : league.season + 1;
  const picks = league.draftPicks
    .filter((pk) => pk.season >= next && (pk.ownerId === teamId || pk.originalTeamId === teamId))
    .sort((a, b) => a.season - b.season || (a.overall ?? a.round * 32) - (b.overall ?? b.round * 32));
  const now = picks.filter((pk) => pk.season === next);
  const later = picks.filter((pk) => pk.season > next);
  const gained = later.filter((pk) => pk.originalTeamId !== teamId).length;
  const lost = later.filter((pk) => pk.ownerId !== teamId).length;
  const table = (rows: typeof picks) => (
    <div className="table-scroll">
      <table>
        <tbody>
          {rows.map((pk) => {
            const used = pk.playerId !== undefined ? league.players[pk.playerId] : null;
            const gone = pk.ownerId !== teamId;
            return (
              <tr key={pk.id} className={gone ? 'muted' : undefined}>
                <td className="num">{pk.season}</td>
                <td>Round {pk.round}</td>
                <td className="num">{pk.overall ? `No. ${pk.overall}` : '–'}</td>
                <td>
                  {gone ? (
                    <span className="tag-pill tag-warn">traded to {league.teams[pk.ownerId].abbrev}</span>
                  ) : pk.originalTeamId !== teamId ? (
                    <span className="tag-pill tag-good">from {league.teams[pk.originalTeamId].abbrev}</span>
                  ) : null}
                </td>
                <td>{used && !gone && <PlayerLink league={league} player={used} pos />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <Panel title="Your picks">
      {now.length ? (
        table(now)
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No picks in the {next} draft.
        </p>
      )}
      {later.length > 0 && (
        <details className="more">
          <summary>
            Future picks ({later[0].season}–{later.at(-1)!.season}): {later.length - lost} yours
            {gained > 0 && `, ${gained} acquired`}
            {lost > 0 && `, ${lost} traded away`}
          </summary>
          {table(later)}
        </details>
      )}
    </Panel>
  );
}

/**
 * Every draft this league has held, a year and a round at a time: who went where, and where the
 * consensus had him then. Built from the players (their `draft` stays; old picks are pruned).
 * `live` is the round on the clock, which the league-wide table follows (newest pick first) until you choose a
 * round. It opens on your own team: every year and round of your drafting at a glance.
 */
function DraftHistory({ league, live }: { league: League; live?: number }) {
  // Drafts this league held: those players keep the consensus read. A new league's veterans come with made-up draft lines.
  const drafted = Object.values(league.players).filter((p) => p.draft && p.scouting);
  const years = [...new Set(drafted.map((p) => p.draft!.season))].sort((a, b) => b - a);
  const [team, setTeam] = useState<number | 'all'>(league.userTeamId);
  const [pickedYear, setYear] = useState<number | 'all' | null>(null);
  const [pickedRound, setRound] = useState<number | 'all' | null>(null);
  if (!years.length) return null;
  // One team's history is short enough to show whole; the league's goes a year and a round at a time.
  const year = pickedYear ?? (team === 'all' ? years[0] : 'all');
  const following = live !== undefined && year === league.season;
  const round = pickedRound ?? (team !== 'all' ? 'all' : following ? live : 1);
  const rows = drafted
    .filter(
      (p) =>
        (team === 'all' || p.draft!.teamId === team) &&
        (year === 'all' || p.draft!.season === year) &&
        (round === 'all' || p.draft!.round === round),
    )
    .sort(
      (a, b) =>
        b.draft!.season - a.draft!.season ||
        (following ? b.draft!.pick - a.draft!.pick : a.draft!.pick - b.draft!.pick),
    );
  return (
    <Panel className="draft-history">
      <Section id="draft-history" title="Draft history">
        <span className="row" style={{ gap: 8 }}>
          <TeamPicker league={league} value={team} onChange={setTeam} label="Team" allowLeague />
          <select
            aria-label="Draft year"
            value={year}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y} draft
              </option>
            ))}
          </select>
          <select
            aria-label="Round"
            value={round}
            onChange={(e) => setRound(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All rounds</option>
            {Array.from({ length: ROUNDS }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Round {i + 1}
              </option>
            ))}
          </select>
        </span>
        {rows.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            {team === league.userTeamId ? 'You have no picks here yet.' : 'No picks here yet.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {year === 'all' && <th className="num">Year</th>}
                  <th className="num">Pick</th>
                  <th className="sticky-col">Player</th>
                  <th>Pos</th>
                  <th>Team</th>
                  <th className="num" title="Where the league consensus ranked him in his class when he was taken">
                    Consensus
                  </th>
                  <th className="num" title="The consensus grade and ceiling when he was taken">
                    Grade
                  </th>
                  <th className="num">Ceiling</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const d = p.draft!;
                  const value = reachOrSteal(d);
                  return (
                    <tr key={p.id} className={d.teamId === league.userTeamId && team === 'all' ? 'is-user' : undefined}>
                      {year === 'all' && <td className="num">{d.season}</td>}
                      <td className="num muted">
                        {d.round}.{d.pick - (d.round - 1) * 32} <span className="small">(No. {d.pick})</span>
                      </td>
                      <td className="sticky-col">
                        <PlayerLink league={league} player={p} />
                        {value === 'reach' && <span className="tag-pill tag-warn">reach</span>}
                        {value === 'steal' && <span className="tag-pill tag-good">steal</span>}
                      </td>
                      <td>{p.position}</td>
                      <td>
                        <TeamChip team={league.teams[d.teamId]} />
                      </td>
                      <td className="num">{d.rank !== undefined ? `#${d.rank}` : '–'}</td>
                      <td className="num">{p.scouting ? <Rating value={p.scouting.grade} decimals={1} /> : '–'}</td>
                      <td className="num muted">{p.scouting?.ceiling.toFixed(1) ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Panel>
  );
}

const isTimed = (d: BoardDrill) => d === 'forty' || d === 'shuttle' || d === 'cone';

/** A drill result on the board, coloured against a typical starter at his position (a 4.6 is slow for a corner, fast for a guard). */
function BoardDrillCell({ player: p, drill }: { player: Player; drill: BoardDrill }) {
  const v = p.combine?.[drill];
  const d = combineRows(p).find((r) => r.key === drill)!;
  if (v === undefined) return <td className="num muted">–</td>;
  const verdict = drillVerdict(d, v);
  return (
    <td
      className={`num ${verdict ? `tone-${verdict}` : 'muted'}`}
      title={d.typical !== undefined ? `Typical ${p.position}: ${d.fmt(d.typical)}` : undefined}
    >
      {d.fmt(v)}
    </td>
  );
}

/** A prospect's makeup in a board cell: "?" until your scouts know him, a dash when nothing stands out. */
function BoardMakeup({ league, player }: { league: League; player: Player }) {
  const m = makeupOf(league, player);
  if (!m.known)
    return (
      <span className="muted" title="Not known yet: a scouting visit or two">
        ?<span className="visually-hidden">Makeup unknown</span>
      </span>
    );
  if (!m.notes.length)
    return (
      <span className="muted" title="Nothing stands out">
        –<span className="visually-hidden">Nothing stands out</span>
      </span>
    );
  return <MakeupPills notes={m.notes} hedged={m.hedged} limit={1} oneLine />;
}

/** A prospect's habits on film in a board cell: "?" until your scouts have seen enough, a dash when none show. */
function BoardHabits({ league, player }: { league: League; player: Player }) {
  const h = quirksOf(league, player);
  if (!h.known)
    return (
      <span className="muted" title="Not seen enough of him yet">
        ?<span className="visually-hidden">Habits unknown</span>
      </span>
    );
  if (!h.notes.length)
    return (
      <span className="muted" title="None on film">
        –<span className="visually-hidden">None on film</span>
      </span>
    );
  return <QuirkPills notes={h.notes} limit={1} oneLine />;
}
