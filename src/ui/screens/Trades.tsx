/**
 * The trade table: tick what goes each way and watch the other GM's reaction, the cap impact
 * for both teams, and the dead money you'd book, before you ever press propose.
 */
import { useState } from 'react';
import { capHit, isExpired, lastSeason } from '../../engine/finance/contract';
import { playerOvr } from '../../engine/positions';
import { teamPlayers } from '../../engine/roster';
import { evaluateTrade, executeTrade, pickLabel, playerTradeBlocker, suggestSweetener, tradeCapImpact, tradeWindow, type TradeProposal } from '../../engine/trade';
import type { League, Player } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar, Rating, TeamChip } from '../components';
import { money } from '../format';
import { liveLock } from '../live';
import { store } from '../store';

interface Picked {
  players: number[];
  picks: number[];
}
const empty = (): Picked => ({ players: [], picks: [] });
const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

function AssetList({ league, teamId, picked, onChange }: { league: League; teamId: number; picked: Picked; onChange: (p: Picked) => void }) {
  const nav = useNav();
  const team = league.teams[teamId];
  // Grouped by position, best first within each group, like a depth chart.
  const players = teamPlayers(league, teamId).sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) || playerOvr(b) - playerOvr(a));
  const picks = league.draftPicks.filter((p) => p.ownerId === teamId && p.playerId === undefined).sort((a, b) => a.season - b.season || a.round - b.round);
  const row = (p: Player) => {
    const blocked = playerTradeBlocker(league, p);
    const on = picked.players.includes(p.id);
    return (
      <label key={p.id} className={`asset${on ? ' on' : ''}${blocked ? ' blocked' : ''}`} title={blocked ?? undefined}>
        <input type="checkbox" checked={on} disabled={!!blocked} onChange={() => onChange({ ...picked, players: toggle(picked.players, p.id) })} />
        <PlayerAvatar player={p} team={team} size={24} />
        <span className="asset-name">
          <button type="button" className="linklike" onClick={() => nav.openPlayer(p.id)}>
            {p.firstName[0]}. {p.lastName}
          </button>
          <span className="muted small">
            {p.position} · {p.age} · {isExpired(p.contract!, league.season) ? 'expiring' : `thru ${lastSeason(p.contract!)}`}
          </span>
        </span>
        <Rating value={playerOvr(p)} decimals={1} />
        <span className="num small">{money(Math.round(capHit(p.contract!, league.season)))}</span>
      </label>
    );
  };
  return (
    <div className="asset-list">
      <div className="eyebrow">Draft picks</div>
      {picks.map((pk) => {
        const on = picked.picks.includes(pk.id);
        return (
          <label key={pk.id} className={`asset${on ? ' on' : ''}`}>
            <input type="checkbox" checked={on} onChange={() => onChange({ ...picked, picks: toggle(picked.picks, pk.id) })} />
            <span className="asset-name">{pickLabel(league, pk)}</span>
          </label>
        );
      })}
      <div className="eyebrow">Players</div>
      {players.map(row)}
    </div>
  );
}

export function Trades({ league }: { league: League }) {
  const userId = league.userTeamId;
  const others = league.teams.filter((t) => t.id !== userId).sort((a, b) => a.city.localeCompare(b.city));
  const [partnerId, setPartnerId] = useState(others[0].id);
  const [mine, setMine] = useState<Picked>(empty);
  const [theirs, setTheirs] = useState<Picked>(empty);
  const [done, setDone] = useState<string | null>(null);
  const partner = league.teams[partnerId];
  const closed = tradeWindow(league) ?? liveLock();

  // Drop anything that moved since it was ticked (after a trade, a sim or a release).
  const valid = (p: Picked, teamId: number): Picked => ({
    players: p.players.filter((id) => league.players[id]?.teamId === teamId),
    picks: p.picks.filter((id) => league.draftPicks.some((x) => x.id === id && x.ownerId === teamId && x.playerId === undefined)),
  });
  const a = valid(mine, userId);
  const b = valid(theirs, partnerId);
  const proposal: TradeProposal = { sides: [{ teamId: userId, ...a }, { teamId: partnerId, ...b }] };
  const anything = a.players.length + a.picks.length + b.players.length + b.picks.length > 0;
  const verdict = anything ? evaluateTrade(league, proposal) : null;
  const impact = anything ? tradeCapImpact(league, proposal) : null;
  const need = verdict ? Math.max(1, verdict.get + verdict.shortfall) : 1;
  const fill = verdict ? Math.min(1, Math.max(0, verdict.get / need)) : 0;

  const propose = () => {
    let text = '';
    store.mutate((l) => {
      if (!evaluateTrade(l, proposal).accepts) return;
      executeTrade(l, proposal);
      text = l.transactions[l.transactions.length - 1].text;
    });
    if (text) {
      setDone(text);
      setMine(empty());
      setTheirs(empty());
    }
  };
  const sweeten = () => {
    const add = suggestSweetener(league, proposal);
    if (!add) return;
    setMine(add.kind === 'pick' ? { ...a, picks: [...a.picks, add.id] } : { ...a, players: [...a.players, add.id] });
  };

  return (
    <>
      {closed && <div className="notice">{closed}</div>}
      {done && (
        <p className="callout callout-good" role="status">
          Trade complete: {done}.
        </p>
      )}
      <Panel
        title={
          <div className="row">
            <TeamChip team={partner} large />
            <div>
              <h2>
                Trade with the {partner.city} {partner.name}
              </h2>
              <span className="muted small">
                GM style: {partner.gm.archetype} · {partner.gm.pickChart === 'johnson' ? 'old-school pick chart (prizes top picks)' : 'analytics pick chart (values Day 2 picks highly)'}
              </span>
            </div>
          </div>
        }
        action={
          <select
            aria-label="Trade partner"
            value={partnerId}
            onChange={(e) => {
              setPartnerId(Number(e.target.value));
              setTheirs(empty());
              setDone(null);
            }}
          >
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.city} {t.name}
              </option>
            ))}
          </select>
        }
      >
        <div className="trade-verdict" aria-live="polite">
          <div className="meter" role="img" aria-label={verdict ? `Their view: ${Math.round(fill * 100)}% of what they need` : 'No offer yet'}>
            <i style={{ width: `${fill * 100}%` }} className={verdict?.accepts ? 'yes' : ''} />
          </div>
          <span className={verdict?.accepts ? 'tone-good' : 'muted'}>{verdict ? verdict.message : 'Tick players or picks on both sides to build an offer.'}</span>
          {impact && (
            <span className="muted small">
              Your cap room after: <b className={impact[0].space < 0 ? 'tone-bad' : ''}>{money(Math.round(impact[0].space))}</b>
              {impact[0].dead > 0 && <> · dead money you'd book: {money(Math.round(impact[0].dead))}</>} · their room after: {money(Math.round(impact[1].space))}
            </span>
          )}
          <span className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" disabled={!verdict?.accepts || !!closed} onClick={propose}>
              Propose trade
            </button>
            <button className="btn" disabled={!verdict || verdict.accepts || !!verdict.problem || !!closed} onClick={sweeten}>
              What would make it work?
            </button>
            <button
              className="btn btn-ghost"
              disabled={!anything}
              onClick={() => {
                setMine(empty());
                setTheirs(empty());
              }}
            >
              Clear
            </button>
          </span>
        </div>
        <div className="grid-2">
          <div>
            <h3>You send</h3>
            <AssetList league={league} teamId={userId} picked={a} onChange={setMine} />
          </div>
          <div>
            <h3>You get</h3>
            <AssetList league={league} teamId={partnerId} picked={b} onChange={setTheirs} />
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Traded players take their salary with them; any bonus money stays on your cap as dead money. Players signed this year can't be dealt for six
          weeks, and teams want a small win in their own eyes.
        </p>
      </Panel>
    </>
  );
}
