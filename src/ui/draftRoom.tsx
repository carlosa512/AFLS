/**
 * The draft room's pieces (spec `docs/superpowers/specs/2026-11-19-draft-room-rail-design.md`): your needs line, your
 * lineup behind it, the pick rail and the phone's pick strip. Everything is your scouts' read (`engine/draftNeeds.ts`).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { teamScheme } from '../engine/coaching';
import {
  draftNeeds,
  lineupRows,
  schemeStarters,
  shownNeeds,
  type DraftNeed,
  type LineupRow,
  type TeamDraftNeeds,
} from '../engine/draftNeeds';
import { employed } from '../engine/employment';
import { draftOrder, nextPick, reachOrSteal, ROUNDS } from '../engine/offseason/draft';
import { defenseLabel, offenseLabel, PERSONNEL_LABEL, type TeamScheme } from '../engine/schemes';
import { tradeContext } from '../engine/trade/context';
import type { DraftPick, League } from '../engine/types';
import { MoreLink, Panel, PlayerLink, Section, TeamChip, TeamLink } from './components';
import { Icon } from './icons';
import { Ovr, schemeFitOf } from './scouting';
import { store } from './store';

export interface DraftRoom {
  /** Your needs, on your schemes' starting spots. */
  mine: DraftNeed[];
  rows: LineupRow[];
  scheme: TeamScheme;
  /** Every other team's needs, on the usual starter counts. */
  byTeam: Map<number, TeamDraftNeeds>;
}

/**
 * The draft room's reads for this moment of the draft, or null when you have no team to draft for. The league is
 * changed in place, so the memo keys on the season, the phase and how many picks are in.
 */
export function useDraftRoom(league: League): DraftRoom | null {
  // The league is changed in place: the store's version says it changed (a pick, a trade, a day of free agency).
  const version = useSyncExternalStore(store.subscribe, store.version, store.version);
  const made = draftOrder(league).filter((pk) => pk.playerId !== undefined).length;
  const on = employed(league);
  return useMemo(() => {
    if (!on) return null;
    const ctx = tradeContext(league);
    const you = league.userTeamId;
    const scheme = teamScheme(league, you);
    const byTeam = new Map<number, TeamDraftNeeds>();
    for (const t of league.teams) if (t.id !== you) byTeam.set(t.id, draftNeeds(ctx, you, t));
    return {
      mine: draftNeeds(ctx, you, league.teams[you], schemeStarters(scheme)).needs,
      rows: lineupRows(ctx, you, league.teams[you], scheme),
      scheme,
      byTeam,
    };
  }, [league, version, league.season, league.phase, made, on]); // the league itself is mutated in place: these say when it changed
}

const TIER_CLASS = { big: ' big', need: ' need', minor: '' } as const;

/** One need as a pill: its position, colored by how hard it presses, struck with a check once drafted for. */
export function NeedPill({
  need,
  count,
  large,
  plain,
  early,
}: {
  need: DraftNeed;
  count?: { have: number; want: number };
  large?: boolean;
  /** No color, whatever the tier: another team's needs stay simple. */
  plain?: boolean;
  /** Dashed: our scouts barely know the team. */
  early?: boolean;
}) {
  const cls = [
    'need-pill',
    need.filled ? ' done' : plain ? '' : TIER_CLASS[need.tier],
    need.reason === 'nextYear' || early ? ' early' : '',
    large ? ' large' : '',
  ].join('');
  return (
    <span className={cls}>
      {need.filled ? <s>{need.position}</s> : need.position}
      {count && (
        <span className={`need-count${count.have < count.want ? ' short' : ''}`}>{`${count.have}/${count.want}`}</span>
      )}
      {need.reason === 'nextYear' && !need.filled && ' next year'}
      {need.filled && <Icon name="check" />}
    </span>
  );
}

/** Your needs in the clock panel: the five that press most, then what you've drafted for, each with its counts. */
export function NeedsLine({ room }: { room: DraftRoom }) {
  const shown = shownNeeds(room.mine);
  const open = shown.some((n) => !n.filled);
  const count = (n: DraftNeed) => {
    const r = room.rows.find((x) => x.position === n.position);
    return r && { have: r.have, want: r.want };
  };
  return (
    <div className="needs-line">
      <span className="eyebrow">Your needs</span>
      <span className="pill-row">
        {!open && <span className="muted">No pressing needs</span>}
        {shown.map((n) => (
          <NeedPill key={n.position} need={n} count={count(n)} large />
        ))}
      </span>
      <span className="need-key small muted">
        <span>
          <i className="need-swatch big" />
          Big need
        </span>
        <span>
          <i className="need-swatch need" />
          Need
        </span>
        <span>
          <i className="need-swatch done" />
          Drafted <Icon name="check" />
        </span>
      </span>
    </div>
  );
}

const FIT_CLASS = { Ideal: 'good', Good: 'good', Average: 'average', Poor: 'poor' } as const;
const GROUPS = [
  ['QB', 'RB', 'WR', 'TE', 'OL'],
  ['DT', 'EDGE', 'LB', 'CB', 'S'],
  ['K', 'P'],
] as const;

/**
 * Your lineup behind your needs: a row a position in the game's order (fixed on purpose, like the depth chart), the
 * starter each need is about, your grade of him and the league's typical starter there as your scouts read it.
 */
export function LineupCard({
  league,
  room,
  id,
  defaultOpen,
}: {
  league: League;
  room: DraftRoom;
  id: string;
  defaultOpen?: boolean;
}) {
  const { scheme } = room;
  const row = (r: LineupRow) => {
    const need = r.need && (r.need.filled || r.need.tier !== 'minor') ? r.need : null;
    const pick = r.need?.filled ? r.picks[0] : undefined;
    const fit = r.weakest && !pick ? schemeFitOf(league, r.weakest, scheme) : null;
    return (
      <tr key={r.position} data-pos={r.position}>
        <td>{need ? <NeedPill need={need} /> : <span className="need-pill plain">{r.position}</span>}</td>
        <td className={`num${r.have < r.want ? ' short' : ''}`} title="On the roster / what your schemes call for">
          {r.have}/{r.want}
        </td>
        <td className="lineup-man">
          {pick ? (
            <PlayerLink league={league} player={pick} />
          ) : r.weakest ? (
            <>
              <span
                className={`fit-dot${fit ? ` ${FIT_CLASS[fit.grade]}` : ''}`}
                title={fit ? `${fit.grade} fit` : undefined}
              />
              <PlayerLink league={league} player={r.weakest} />
            </>
          ) : (
            '–'
          )}
        </td>
        <td className="num">{r.weakest && !pick ? <Ovr league={league} player={r.weakest} /> : '–'}</td>
        <td className="num typical" title="The league's typical starter here, as your scouts read the league">
          {r.typical === null ? '–' : r.typical.toFixed(1)}
        </td>
      </tr>
    );
  };
  return (
    <Panel className="lineup-card">
      <Section id={id} title="Your lineup" defaultOpen={defaultOpen}>
        <div className="lineup-head">
          <span className="small muted">
            {offenseLabel(scheme.offense.id)} · {PERSONNEL_LABEL[scheme.offense.personnel]} ·{' '}
            {defenseLabel(scheme.front.id, scheme.coverage?.id)}
          </span>
          <MoreLink to={{ view: 'roster' }}>Depth chart</MoreLink>
        </div>
        <table className="lineup">
          <thead>
            <tr>
              <th>Pos</th>
              <th className="num" title="On the roster / what your schemes call for">
                Have
              </th>
              <th>Weakest starter</th>
              <th className="num">Grade</th>
              <th className="num" title="The league's typical starter here, as your scouts read the league">
                Typical
              </th>
            </tr>
          </thead>
          {GROUPS.map((g) => (
            <tbody key={g[0]}>{room.rows.filter((r) => (g as readonly string[]).includes(r.position)).map(row)}</tbody>
          ))}
        </table>
        <span className="need-key small muted">
          <span>
            <i className="fit-dot good" />
            Good fit
          </span>
          <span>
            <i className="fit-dot average" />
            Average fit
          </span>
          <span>
            <i className="fit-dot poor" />
            Poor fit
          </span>
        </span>
      </Section>
    </Panel>
  );
}

/** What a pick still to come shows: whose it is and, for another team, the needs our scouts see. */
function PickToCome({
  league,
  room,
  pick,
  clock,
}: {
  league: League;
  room: DraftRoom | null;
  pick: DraftPick;
  clock: boolean;
}) {
  const mine = pick.ownerId === league.userTeamId;
  const theirs = room?.byTeam.get(pick.ownerId);
  return (
    <>
      <span className="pick-who">
        {mine ? (
          <b>{clock ? "You're on the clock" : 'Your pick'}</b>
        ) : (
          <>
            <TeamLink team={league.teams[pick.ownerId]} />
            {clock && <b> On the clock</b>}
          </>
        )}
      </span>
      {!mine && theirs && (
        <span className="pill-row">
          {theirs.needs.slice(0, 3).map((n) => (
            <NeedPill key={n.position} need={n} plain early={theirs.littleFilm} />
          ))}
        </span>
      )}
    </>
  );
}

/** "via DAL" when a pick changed hands. */
const via = (league: League, pk: DraftPick) =>
  pk.originalTeamId !== pk.ownerId && (
    <span className="muted small"> via {league.teams[pk.originalTeamId].abbrev}</span>
  );

/**
 * Every pick of the draft beside the page, made and to come, in a list that scrolls on its own. It keeps the pick on
 * the clock a third of the way down as the draft moves, by its own scroll so the page stays put.
 */
export function PickRail({ league, room }: { league: League; room: DraftRoom | null }) {
  const order = draftOrder(league);
  const clock = nextPick(league);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const ol = list.current;
    const row = ol?.querySelector<HTMLElement>('.is-clock');
    if (ol && row) ol.scrollTop = row.offsetTop - ol.clientHeight / 3;
  }, [clock?.id]);
  const [round, setRound] = useState(clock?.round ?? 1);
  useEffect(() => setRound(clock?.round ?? 1), [clock?.round]);
  // A sticky round header reports where it sticks, not where it sits: jump to the round's first pick instead.
  const jump = (r: number) => {
    setRound(r);
    const ol = list.current;
    const first = ol?.querySelector<HTMLElement>(`[data-first="${r}"]`);
    const head = first?.previousElementSibling as HTMLElement | null;
    if (ol && first) ol.scrollTop = first.offsetTop - (head?.offsetHeight ?? 0);
  };
  return (
    <section className="panel pick-rail">
      <div className="panel-head">
        <h2>Picks</h2>
        <select aria-label="Jump to round" value={round} onChange={(e) => jump(Number(e.target.value))}>
          {Array.from({ length: ROUNDS }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              Round {i + 1}
            </option>
          ))}
        </select>
      </div>
      <ol className="pick-list" ref={list}>
        {order.map((pk, i) => {
          const made = pk.playerId !== undefined ? league.players[pk.playerId] : null;
          const cls = `pick-row${made ? ' made' : ''}${pk.ownerId === league.userTeamId ? ' is-mine' : ''}${pk === clock ? ' is-clock' : ''}`;
          return [
            (i === 0 || order[i - 1].round !== pk.round) && (
              <li key={`r${pk.round}`} className="pick-round eyebrow-sm">
                Round {pk.round}
              </li>
            ),
            <li
              key={pk.id}
              className={cls}
              data-no={pk.overall}
              data-first={i === 0 || order[i - 1].round !== pk.round ? pk.round : undefined}
            >
              <span className="pick-no">{pk.overall}</span>
              <TeamChip team={league.teams[pk.ownerId]} />
              <span className="pick-body">
                {made ? (
                  <span className="pick-who">
                    <span className="muted small">{made.position}</span> <PlayerLink league={league} player={made} />
                    <DraftDayPill value={reachOrSteal({ pick: pk.overall!, rank: pk.consRank })} />
                    {via(league, pk)}
                  </span>
                ) : (
                  <>
                    <PickToCome league={league} room={room} pick={pk} clock={pk === clock} />
                    {via(league, pk)}
                  </>
                )}
              </span>
            </li>,
          ];
        })}
      </ol>
    </section>
  );
}

/** The rail on a narrow screen: a strip of picks to swipe, from two before the clock to a dozen after it. */
export function PickStrip({ league, room }: { league: League; room: DraftRoom | null }) {
  const order = draftOrder(league);
  const clock = nextPick(league);
  const at = clock ? order.indexOf(clock) : -1;
  const from = at >= 0 ? Math.max(0, at - 2) : Math.max(0, order.length - 14);
  return (
    <div className="pick-strip" aria-label="Picks">
      {order.slice(from, from + 14).map((pk) => {
        const made = pk.playerId !== undefined ? league.players[pk.playerId] : null;
        return (
          <div
            key={pk.id}
            className={`pick-card${pk.ownerId === league.userTeamId ? ' is-mine' : ''}${pk === clock ? ' is-clock' : ''}`}
          >
            <span className="pick-card-top">
              <span className="pick-no">{pk.overall}</span>
              <TeamChip team={league.teams[pk.ownerId]} />
            </span>
            {made ? (
              <span className="pick-who">
                <span className="muted small">{made.position}</span> <PlayerLink league={league} player={made} />
              </span>
            ) : (
              <PickToCome league={league} room={room} pick={pk} clock={pk === clock} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A pick taken well ahead of or after his consensus rank. */
export function DraftDayPill({ value }: { value: 'reach' | 'steal' | null }) {
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
