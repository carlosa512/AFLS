import type { ReactNode } from 'react';
import { relevantAttributes } from '../../engine/attributes';
import { capHit } from '../../engine/finance/contract';
import type { Attribute, League, Player } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar } from '../components';
import { thruLabel } from '../contracts';
import { ATTR_LABELS, money } from '../format';
import { combineRows, drillVerdict, inches, KnowledgeMeter, Ovr, potentialText, RangeValue, Stars, starsOf, viewOf } from '../scouting';

/** Side by side, with the same fog as everywhere else: you compare what your scouts believe. */
export function Compare({ league }: { league: League }) {
  const nav = useNav();
  const players = nav.compareIds.map((id) => league.players[id]).filter((p): p is Player => !!p);
  const views = players.map((p) => viewOf(league, p));

  if (players.length === 0) {
    return (
      <Panel title="Compare players">
        <p className="muted" style={{ margin: 0 }}>
          Open any player and choose <b>Compare</b> to line up to three players side by side: ratings, stars, potential and combine numbers, with the best in
          each row highlighted.
        </p>
      </Panel>
    );
  }

  // Ratings that matter for any of them, in the first player's order of importance.
  const attrs: Attribute[] = [];
  for (const p of players) for (const a of relevantAttributes(p.position)) if (!attrs.includes(a)) attrs.push(a);

  /** Index of the single best value in a row, or -1 when there's no clear winner. */
  const bestOf = (values: (number | undefined)[], lowerIsBetter = false) => {
    const known = values.map((v, i) => [v, i] as const).filter(([v]) => v !== undefined) as [number, number][];
    if (known.length < 2) return -1;
    const sorted = [...known].sort((a, b) => (lowerIsBetter ? a[0] - b[0] : b[0] - a[0]));
    return sorted[0][0] === sorted[1][0] ? -1 : sorted[0][1];
  };

  const row = (label: string, cells: ReactNode[], best = -1) => (
    <tr key={label}>
      <th scope="row" className="sticky-col">
        {label}
      </th>
      {cells.map((c, i) => (
        <td key={i} className={i === best ? 'best' : undefined}>
          {c}
          {i === best && <span className="visually-hidden"> (best)</span>}
        </td>
      ))}
    </tr>
  );

  const drills = combineRows(players[0]);

  return (
    <Panel
      title="Compare players"
      action={
        <button className="btn btn-sm" onClick={nav.clearCompare}>
          Clear all
        </button>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Your staff's view: exact for your own players, scouted ranges for everyone else. The best value in each row is shaded. Stars are measured against every
        player at that position in the league.
      </p>
      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th className="sticky-col" />
              {players.map((p) => {
                const team = p.teamId !== null ? league.teams[p.teamId] : null;
                return (
                  <th key={p.id}>
                    <span className="compare-head">
                      <button className="linklike player-link" onClick={() => nav.openPlayer(p.id)}>
                        <PlayerAvatar player={p} team={team} size={30} />
                        <span>
                          {p.firstName} {p.lastName}
                        </span>
                      </button>
                      <span className="muted small">
                        {p.position} · {team ? team.abbrev : p.scouting && !p.draft ? 'Prospect' : 'Free agent'}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => nav.toggleCompare(p.id)}
                        aria-label={`Remove ${p.firstName} ${p.lastName} from the comparison`}
                      >
                        Remove
                      </button>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {row(
              'Overall',
              players.map((p) => <Ovr league={league} player={p} />),
              bestOf(views.map((v) => v.ovr)),
            )}
            {row(
              'Stars',
              players.map((p, i) => <Stars s={starsOf(league, p, 'league', views[i])} size={16} />),
            )}
            {row(
              'Potential',
              views.map((v) => <span className="num">{potentialText(v)}</span>),
              bestOf(views.map((v) => v.potHi)),
            )}
            {row(
              'Age',
              players.map((p) => <span className="num">{p.age}</span>),
            )}
            {row(
              'Known',
              views.map((v) => (v.exact ? <span className="muted small">Your player</span> : <KnowledgeMeter value={v.knowledge} />)),
            )}
            {row(
              'Cap hit',
              players.map((p) => (
                <span className="num">
                  {p.contract ? `${money(Math.round(capHit(p.contract, league.season)))} thru ${thruLabel(league, p.contract)}` : '–'}
                </span>
              )),
            )}
            <tr className="group-row">
              <td colSpan={players.length + 1}>
                <span className="group-label">Ratings</span>
              </td>
            </tr>
            {attrs.map((a) =>
              row(
                ATTR_LABELS[a][1],
                views.map((v) => <RangeValue r={v.ratings[a]} />),
                bestOf(views.map((v) => v.ratings[a].value)),
              ),
            )}
            <tr className="group-row">
              <td colSpan={players.length + 1}>
                <span className="group-label">Combine</span>
              </td>
            </tr>
            {row(
              'Arms',
              players.map((p) => <span className="num">{p.combine ? inches(p.combine.arms) : '–'}</span>),
              bestOf(players.map((p) => p.combine?.arms)),
            )}
            {drills
              .filter((d) => players.some((p) => p.combine?.[d.key] !== undefined))
              .map((d) =>
                row(
                  d.label,
                  players.map((p) => {
                    const v = p.combine?.[d.key];
                    if (v === undefined) return <span className="muted">–</span>;
                    const verdict = drillVerdict(combineRows(p).find((x) => x.key === d.key)!, v);
                    return (
                      <span className="num">
                        {d.fmt(v)}
                        {verdict && (
                          <span className={verdict === 'good' ? 'tone-good' : 'tone-bad'} aria-hidden="true">
                            {verdict === 'good' ? ' ▲' : ' ▼'}
                          </span>
                        )}
                      </span>
                    );
                  }),
                  bestOf(
                    players.map((p) => p.combine?.[d.key]),
                    d.lowerIsBetter,
                  ),
                ),
              )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
