import { useEffect, useState } from 'react';
import {
  clockState,
  markOrder,
  pickMark,
  riskOf,
  staffBoardValue,
  staffGaps,
  verdictRecord,
  type ClockState,
  type Gap,
  type PickMark,
  type Risk,
} from '../../engine/draftGrade';
import { draftForUser, draftNextPick, draftToEnd, draftToUserPick } from '../../engine/offseason';
import { availableProspects, draftOrder, reachOrSteal, ROUNDS } from '../../engine/offseason/draft';
import { callAhead, draftDayOffers, shopPick } from '../../engine/trade/draft';
import type { DraftPick, League, PickDeal, Player, Position } from '../../engine/types';
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
import { OfferCard } from '../offers';
import { CardRow, Fact, Facts, OfficeCard, OfficeHero } from '../office';
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
  ScoutButton,
  viewOf,
} from '../scouting';
import { store } from '../store';

type BoardSort = 'rank' | 'mine' | 'pos' | 'school' | 'drill' | 'grade' | 'ceiling' | 'gap' | 'known';

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
  const all = availableProspects(league);
  // Both boards across the whole class: the consensus rank is roughly where the league will take him.
  const gaps = staffGaps(league, all);
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
          : key === 'school'
            ? originName(p)
            : key === 'drill'
              ? (p.combine?.[drill] ?? (sort.desc ? -Infinity : Infinity))
              : key === 'grade'
                ? v.ovr
                : key === 'ceiling'
                  ? v.potMid
                  : key === 'gap'
                    ? gaps.get(p.id)!.diff
                    : key === 'known'
                      ? v.knowledge
                      : gaps.get(p.id)!.consensus;
    },
  );
  const clock = clockState(league);
  const userUp = clock.kind === 'live' && clock.userUp;
  const offers = draftDayOffers(league);
  const hasHistory = Object.values(league.players).some((p) => p.draft && p.scouting);

  return (
    <div className="home-grid">
      {clock.kind !== 'none' && (
        <div className="home-cell span-12">
          <DraftClock league={league} clock={clock} />
        </div>
      )}

      {offers.length > 0 && (
        <div className="home-cell span-12">
          <CardRow label="Draft-day offers" className="draft-offers">
            {offers.map((o) => (
              <OfferCard key={o.id} league={league} offer={o} />
            ))}
          </CardRow>
        </div>
      )}

      {(clock.kind === 'live' || clock.kind === 'preview') && all.length > 0 && (
        <div className="home-cell span-12">
          <StaffTop5 league={league} pool={all} gaps={gaps} userUp={userUp} />
        </div>
      )}

      {prospects.length > 0 && (
        <div className="home-cell span-12">
          <Panel
            title="Big board"
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
                <b>Your grade</b> is your scouts' estimate (a dashed grade is a guess). <b>Risk</b> runs from that grade
                to his ceiling: solid to where your scouts think he lands, faded to the best case. Short and solid is a
                ready player, long and fading a project; <b>Safe</b> and <b>Boom-or-bust</b> mark the ends. The number
                before his name is his <b>consensus</b> rank, roughly where the league will take him; the pill says how
                far your staff's board parts from it (▲ when your staff likes him more). A dozen spots or more makes him
                a <b>Sleeper</b> or a <b>Fade</b>. <b>Notes</b> are his makeup and his habits on film, once your scouts
                know him ("?" means not yet; dashed tags are early word).
              </p>
            </details>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <SortTh label="Player" k="rank" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
                    <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} desc={false} />
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
                    <SortTh label="Risk" k="ceiling" sort={sort} onSort={onSort} />
                    <SortTh label="Consensus" k="gap" sort={sort} onSort={onSort} />
                    <SortTh label="Known" k="known" sort={sort} onSort={onSort} />
                    <th>Notes</th>
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
                          <span className="board-rank muted small">{gaps.get(p.id)!.consensus}</span>
                          <PlayerLink league={league} player={p} avatar={26} />
                        </td>
                        <td>{p.position}</td>
                        <td>
                          <OriginTag player={p} />
                        </td>
                        <BoardDrillCell player={p} drill={drill} />
                        <td className="num">
                          <Ovr league={league} player={p} />
                        </td>
                        <td>
                          <RiskBar risk={riskOf(v)} />
                        </td>
                        <td>
                          <GapPill gap={gaps.get(p.id)!} />
                        </td>
                        <td>
                          <KnowledgeMeter value={v.knowledge} />
                        </td>
                        <td>
                          <BoardNotes league={league} player={p} />
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
        </div>
      )}

      <div className={`home-cell ${hasHistory ? 'span-4' : 'span-12'}`}>
        <YourPicks league={league} />
      </div>
      {hasHistory && (
        <div className="home-cell span-8">
          <DraftHistory league={league} live={clock.kind === 'live' ? clock.pick.round : undefined} />
        </div>
      )}
    </div>
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
  const record = verdictRecord(league, teamId);
  return (
    <Panel title="Your picks">
      {record.length > 0 && (
        <ul className="verdict-record">
          {record.map((y) => (
            <li key={y.season}>
              <b>{y.season}</b>{' '}
              {(
                [
                  [y.steal, 'steal', 'steals'],
                  [y.hit, 'hit', 'hits'],
                  [y.miss, 'miss', 'misses'],
                ] as const
              )
                .filter(([n]) => n)
                .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
                .join(', ')}
            </li>
          ))}
        </ul>
      )}
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
  const [sort, onSort] = useSort<'pick' | 'verdict'>({ key: 'pick', desc: false });
  if (!years.length) return null;
  // One team's history is short enough to show whole; the league's goes a year and a round at a time.
  const year = pickedYear ?? (team === 'all' ? years[0] : 'all');
  const following = live !== undefined && year === league.season;
  const round = pickedRound ?? (team !== 'all' ? 'all' : following ? live : 1);
  const filtered = drafted
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
  const marks = new Map(filtered.map((p) => [p.id, pickMark(league, p)]));
  // Pick order is the draft's own (newest first while following the clock); a second click turns it around.
  const rows =
    sort.key === 'verdict'
      ? sortRows(filtered, sort, (p) => markOrder(marks.get(p.id)!))
      : sort.desc
        ? [...filtered].reverse()
        : filtered;
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
                  <SortTh label="Pick" k="pick" sort={sort} onSort={onSort} desc={false} className="num" />
                  <th className="sticky-col">Player</th>
                  <SortTh label="Verdict" k="verdict" sort={sort} onSort={onSort} desc={false} />
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
                        <DraftDayPill value={value} />
                      </td>
                      <td>
                        <VerdictPill mark={marks.get(p.id)!} />
                      </td>
                      <td>{p.position}</td>
                      <td>
                        <TeamChip team={league.teams[d.teamId]} />
                        {d.via !== undefined && <span className="muted small"> via {league.teams[d.via].abbrev}</span>}
                        {d.deal && <DealPill league={league} pick={d.pick} deal={d.deal} />}
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

/** A pick traded on draft day: a pill that opens the deal in one line (a tap on a phone, where nothing hovers). */
function DealPill({ league, pick, deal }: { league: League; pick: number; deal: PickDeal }) {
  return (
    <details className="deal-pill">
      <summary className="tag-pill">Draft-day trade</summary>
      <span className="muted small">
        {league.teams[deal.from].abbrev} sent No. {pick} for {deal.got.join(' and ')}.
      </span>
    </details>
  );
}

/** "Round 2, No. 41" for a pick on the order. */
const pickName = (pk: DraftPick) => `Round ${pk.round}, No. ${pk.overall}`;

/**
 * The draft room's hero: the class ahead before the draft, the pick on the clock during it (your own in gold), the
 * last few picks as a ticker, and where your next pick stands.
 */
function DraftClock({ league, clock }: { league: League; clock: Exclude<ClockState, { kind: 'none' }> }) {
  // What the league said when you shopped your pick or called the teams ahead, until the pick on the clock moves.
  const [heard, setHeard] = useState<{ at: number; text: string } | null>(null);
  const visits = <Fact label="Scouting visits left">{league.scoutPoints}</Fact>;
  if (clock.kind === 'preview')
    return (
      <OfficeHero headline={`${league.season} draft class`}>
        <Facts>
          <Fact label="Prospects">{clock.prospects}</Fact>
          <Fact label="Your first pick">{clock.firstPick ? pickName(clock.firstPick) : 'None'}</Fact>
          {visits}
        </Facts>
      </OfficeHero>
    );
  const order = draftOrder(league);
  const mine = order.filter((pk) => pk.ownerId === league.userTeamId);
  if (clock.kind === 'done')
    return (
      <OfficeHero headline="The draft is complete">
        <Facts>
          <Fact label="Your picks made">{mine.filter((pk) => pk.playerId !== undefined).length}</Fact>
        </Facts>
      </OfficeHero>
    );
  const { pick, userUp, myNext } = clock;
  const team = league.teams[pick.ownerId];
  const market = league.market;
  const onYours = userUp ? draftDayOffers(league).filter((o) => o.sides[1].picks.includes(pick.id)) : [];
  const ask = (call: typeof shopPick) => {
    let text = '';
    store.mutate((l) => {
      text = call(l).message;
    });
    setHeard({ at: pick.id, text });
  };
  const recent = order
    .filter((pk) => pk.playerId !== undefined)
    .slice(-3)
    .reverse();
  return (
    <OfficeHero
      urgent={userUp}
      team={team}
      eyebrow={
        <>
          Round {pick.round} · Pick {pick.overall}
        </>
      }
      headline={userUp ? "You're on the clock" : `${team.name} on the clock`}
      action={
        <span className="row" style={{ gap: 8 }}>
          {userUp ? (
            <>
              <button className="btn" onClick={() => store.mutate((l) => draftForUser(l))}>
                Auto-pick for me
              </button>
              <button className="btn" disabled={market?.shoppedPick === pick.id} onClick={() => ask(shopPick)}>
                Shop this pick
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => store.mutate(draftNextPick)}>
                Next pick
              </button>
              {myNext && (
                <button className="btn" disabled={market?.calledAhead === pick.overall} onClick={() => ask(callAhead)}>
                  Call teams ahead
                </button>
              )}
              {myNext && (
                <button className="btn btn-primary" onClick={() => store.mutate(draftToUserPick)}>
                  Sim to my pick
                </button>
              )}
            </>
          )}
          <button className="btn btn-ghost" onClick={() => store.mutate(draftToEnd)}>
            Sim the rest (AI picks for you)
          </button>
        </span>
      }
    >
      {onYours.length > 0 && (
        <p className="callout callout-gold" role="status">
          {onYours.length > 1 ? `${onYours.length} teams want` : '1 team wants'} No. {pick.overall} · gone when you pick
        </p>
      )}
      {heard?.at === pick.id && (
        <p className="muted small" role="status">
          {heard.text}
        </p>
      )}
      {recent.length > 0 && (
        <ol className="draft-ticker" aria-label="Latest picks">
          {recent.map((pk) => {
            const p = league.players[pk.playerId!];
            const value = reachOrSteal({ pick: pk.overall!, rank: pk.consRank });
            return (
              <li key={pk.id}>
                <span className="muted small num">No. {pk.overall}</span>
                <TeamChip team={league.teams[pk.ownerId]} />
                {pk.originalTeamId !== pk.ownerId && (
                  <span className="muted small">via {league.teams[pk.originalTeamId].abbrev}</span>
                )}
                <span className="muted small">{p.position}</span>
                <PlayerLink league={league} player={p} />
                <DraftDayPill value={value} />
              </li>
            );
          })}
        </ol>
      )}
      <Facts>
        <Fact label="Your next pick">
          {myNext ? (
            <>
              No. {myNext.overall}
              {!userUp && <span className="muted small"> ({myNext.overall! - pick.overall!} away)</span>}
            </>
          ) : (
            'None left'
          )}
        </Fact>
        <Fact label="Your picks left">{mine.filter((pk) => pk.playerId === undefined).length}</Fact>
        {visits}
      </Facts>
    </OfficeHero>
  );
}

/** The five best prospects still on your staff's board, as cards: the first place to look when you're up. */
function StaffTop5({
  league,
  pool,
  gaps,
  userUp,
}: {
  league: League;
  pool: Player[];
  gaps: Map<number, Gap>;
  userUp: boolean;
}) {
  const top = [...pool].sort((a, b) => gaps.get(a.id)!.ours - gaps.get(b.id)!.ours).slice(0, 5);
  return (
    <Panel title="Your staff's top 5">
      <CardRow label="Your staff's top 5">
        {top.map((p) => (
          <OfficeCard key={p.id}>
            <PlayerLink league={league} player={p} avatar={28} />
            <span className="muted small">
              {p.position} · <OriginTag player={p} />
            </span>
            <span className="prospect-grade">
              <span className="eyebrow">Your grade</span> <Ovr league={league} player={p} />
            </span>
            <RiskBar risk={riskOf(viewOf(league, p))} />
            <span>
              <GapPill gap={gaps.get(p.id)!} />
            </span>
            {userUp && (
              <button className="btn btn-sm btn-primary" onClick={() => store.mutate((l) => draftForUser(l, p.id))}>
                Draft
              </button>
            )}
          </OfficeCard>
        ))}
      </CardRow>
    </Panel>
  );
}

const RISK_WORDS = { safe: 'Safe', 'boom-or-bust': 'Boom-or-bust' } as const;
/** Where a rating sits on the 1–20 track, as a percentage. */
const onTrack = (x: number) => `${((Math.min(20, Math.max(1, x)) - 1) / 19) * 100}%`;
const between = (a: number, b: number) => ({ left: onTrack(a), width: `calc(${onTrack(b)} - ${onTrack(a)})` });

/**
 * A prospect's floor-to-ceiling read: solid from his grade now to the ceiling's best guess, faded on to the top of
 * the range. Short and solid is a ready player; long and fading is a project. A word only at the ends.
 */
function RiskBar({ risk }: { risk: Risk }) {
  const label = `Now about ${Math.round(risk.lo)}, likely ${Math.round(risk.mid)}, could reach ${Math.round(risk.hi)}`;
  return (
    <span className="risk" title={label}>
      <span className="risk-track" role="img" aria-label={label}>
        <span className="risk-solid" style={between(risk.lo, risk.mid)} />
        <span className="risk-fade" style={between(risk.mid, risk.hi)} />
      </span>
      {risk.word && <span className={`risk-word risk-${risk.word}`}>{RISK_WORDS[risk.word]}</span>}
    </span>
  );
}

/** Where your staff's board parts from the league's: always a pill, coloured past a round's worth of spots. */
function GapPill({ gap }: { gap: Gap }) {
  const n = Math.abs(gap.diff);
  const arrow = gap.diff > 0 ? `▲${n}` : gap.diff < 0 ? `▼${n}` : '=';
  return (
    <span
      className={`tag-pill gap-pill${gap.tag === 'sleeper' ? ' tag-good' : gap.tag === 'fade' ? ' tag-warn' : ''}`}
      title={`Your staff: #${gap.ours}. League consensus: #${gap.consensus}.`}
    >
      {gap.tag === 'sleeper' ? `Sleeper ${arrow}` : gap.tag === 'fade' ? `Fade ${arrow}` : arrow}
    </span>
  );
}

/** Draft day's own judgment: taken a dozen picks ahead of the consensus (a reach) or after it (value). */
function DraftDayPill({ value }: { value: 'reach' | 'steal' | null }) {
  if (value === 'reach')
    return (
      <span className="tag-pill tag-warn" title="Taken a dozen picks or more ahead of his consensus rank">
        reach
      </span>
    );
  if (value === 'steal')
    return (
      <span className="tag-pill tag-good" title="Taken a dozen picks or more after his consensus rank">
        value
      </span>
    );
  return null;
}

const VERDICT_TEXT = { steal: 'Steal', hit: 'Hit', miss: 'Miss' } as const;
const VERDICT_TONE = { steal: ' tag-good', hit: '', miss: ' tag-bad' } as const;

/**
 * How a pick turned out in your scouts' eyes: solid once locked after his third season, dashed while it's an early
 * read, grey before his rookie season is in.
 */
function VerdictPill({ mark }: { mark: PickMark | null }) {
  if (!mark) return null;
  if (!mark.verdict)
    return (
      <span className="tag-pill tag-inactive verdict-pill" title="His rookie season isn't in yet">
        Too early
      </span>
    );
  return (
    <span
      className={`tag-pill verdict-pill${VERDICT_TONE[mark.verdict]}${mark.locked ? '' : ' tag-early verdict-early'}`}
      title={mark.locked ? 'Judged after his third season' : 'Early read: locks after his third season'}
    >
      {VERDICT_TEXT[mark.verdict]}
    </span>
  );
}

/** Makeup then habits in one cell: a single "?" while your scouts know neither. */
function BoardNotes({ league, player }: { league: League; player: Player }) {
  if (!makeupOf(league, player).known && !quirksOf(league, player).known)
    return (
      <span className="muted" title="Not known yet: a scouting visit or two">
        ?<span className="visually-hidden">Not known yet</span>
      </span>
    );
  return (
    <span className="board-notes">
      <BoardMakeup league={league} player={player} />
      <BoardHabits league={league} player={player} />
    </span>
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
