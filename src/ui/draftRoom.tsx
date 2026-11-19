/**
 * The draft room's pieces (spec `docs/superpowers/specs/2026-11-19-draft-room-rail-design.md`): your needs line, your
 * lineup behind it, the pick rail and the phone's pick strip. Everything is your scouts' read (`engine/draftNeeds.ts`).
 */
import { useMemo } from 'react';
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
import { draftOrder } from '../engine/offseason/draft';
import { defenseLabel, offenseLabel, PERSONNEL_LABEL, type TeamScheme } from '../engine/schemes';
import { tradeContext } from '../engine/trade/context';
import type { League } from '../engine/types';
import { MoreLink, Panel, PlayerLink, Section } from './components';
import { Icon } from './icons';
import { Ovr, schemeFitOf } from './scouting';

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
  }, [league, league.season, league.phase, made, on]); // the league itself is mutated in place: these say when it changed
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
