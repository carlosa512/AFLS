/**
 * The trades tab: offers on your desk, the trade table (tick what goes each way and watch the other
 * GM's reaction, the cap impact for both teams and the dead money you'd book before you propose),
 * your block, the market's talk and the history.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { capHit, isExpired, lastSeason } from '../../engine/finance/contract';
import { teamPlayers } from '../../engine/roster';
import { GmLink } from '../gm';
import {
  counterOffer,
  dealAdvice,
  deskState,
  evaluateTrade,
  isDeadlineDay,
  maxRetain,
  openOffers,
  pickLabel,
  playerTradeBlocker,
  proposeTrade,
  suggestSweetener,
  stanceOf,
  tradeCapImpact,
  tradeContext,
  tradeWindow,
  type TradeProposal,
} from '../../engine/trade';
import type { League, Player, Team } from '../../engine/types';
import { useNav } from '../nav';
import {
  Panel,
  PlayerAvatar,
  PlayerLink,
  SortSeg,
  sortRows,
  TeamChip,
  TeamLink,
  TeamPicker,
  useSort,
} from '../components';
import { LIST_SORT_OPTIONS, listSortValue, type ListSort } from '../offers';
import { money } from '../format';
import { Ovr } from '../scouting';
import { liveLock } from '../live';
import { LinkedText } from '../moves';
import {
  BlockPanel,
  ExamPanel,
  HistoryPanel,
  MarketPanel,
  OffersPanel,
  shoppingOf,
  STANCE,
  StaffStrip,
  talksWords,
  WantsPills,
} from '../offers';
import { store } from '../store';
import { tradeDesk, type Picked } from '../tradeDesk';
import { Fact, Facts, OfficeHero, Pill } from '../office';

const empty = (): Picked => ({ players: [], picks: [] });
const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function AssetList({
  league,
  teamId,
  picked,
  onChange,
}: {
  league: League;
  teamId: number;
  picked: Picked;
  onChange: (p: Picked) => void;
}) {
  const team = league.teams[teamId];
  // By position, best first within each group, like a depth chart; or by OVR or cap hit.
  const [sort, onSort] = useSort<ListSort>({ key: 'pos', desc: false });
  const players = sortRows(teamPlayers(league, teamId), sort, (p, key) => listSortValue(league, p, key));
  const picks = league.draftPicks
    .filter((p) => p.ownerId === teamId && p.playerId === undefined)
    .sort((a, b) => a.season - b.season || a.round - b.round);
  const row = (p: Player) => {
    const blocked = playerTradeBlocker(league, p);
    const on = picked.players.includes(p.id);
    // Practice squad players have a weekly agreement, not a contract: no term and no cap hit to show.
    const c = p.contract;
    return (
      <label key={p.id} className={`asset${on ? ' on' : ''}${blocked ? ' blocked' : ''}`} title={blocked ?? undefined}>
        <input
          type="checkbox"
          checked={on}
          disabled={!!blocked}
          onChange={() => onChange({ ...picked, players: toggle(picked.players, p.id) })}
        />
        <PlayerAvatar player={p} team={team} size={24} />
        <span className="asset-name">
          <PlayerLink league={league} player={p} short />
          <span className="muted small">
            {p.position} · {p.age} ·{' '}
            {!c ? 'practice squad' : isExpired(c, league.season) ? 'expiring' : `thru ${lastSeason(c)}`}
          </span>
        </span>
        <Ovr league={league} player={p} />
        <span className="num small">{c ? money(Math.round(capHit(c, league.season))) : '—'}</span>
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
            <input
              type="checkbox"
              checked={on}
              onChange={() => onChange({ ...picked, picks: toggle(picked.picks, pk.id) })}
            />
            <span className="asset-name">{pickLabel(league, pk)}</span>
          </label>
        );
      })}
      <div className="eyebrow">Players</div>
      <SortSeg label={`Sort ${team.name} players`} options={LIST_SORT_OPTIONS} sort={sort} onSort={onSort} />
      {players.map(row)}
    </div>
  );
}

/**
 * Salary you keep paying for each player you send (*eat salary*): it lands on your cap as dead money
 * this season and comes off his new team's base, so a team that couldn't fit him can, and pays more.
 */
function KeepPaying({ league, picked, onChange }: { league: League; picked: Picked; onChange: (p: Picked) => void }) {
  const players = picked.players.map((id) => league.players[id]).filter((p) => maxRetain(league, p) >= 50);
  if (!players.length) return null;
  return (
    <div className="notice" style={{ marginBottom: 8 }}>
      <div className="eyebrow">Salary you keep paying this season</div>
      {players.map((p) => {
        const max = maxRetain(league, p);
        const v = Math.min(picked.retain?.[p.id] ?? 0, max);
        return (
          <label key={p.id} className="row" style={{ gap: 8 }}>
            <span style={{ minWidth: 120 }}>{p.lastName}</span>
            <input
              type="range"
              min={0}
              max={max}
              step={50}
              value={v}
              aria-label={`Salary you keep paying for ${p.firstName} ${p.lastName}`}
              onChange={(e) => onChange({ ...picked, retain: { ...picked.retain, [p.id]: Number(e.target.value) } })}
            />
            <span className="num small">{money(v)}</span>
          </label>
        );
      })}
    </div>
  );
}

export type TradeTab = 'offers' | 'table' | 'block' | 'market' | 'history';
export const TRADE_TABS: readonly TradeTab[] = ['offers', 'table', 'block', 'market', 'history'];

/** The view the trades tab opens on: the table when a deal is waiting for it, else the offers when any are open. */
export function defaultTradeTab(league: League): TradeTab {
  return tradeDesk.pending() ? 'table' : openOffers(league).length ? 'offers' : 'table';
}

/**
 * The view to show: the one the address names, else the one this visit opened on (`held`), else the default.
 * Holding it keeps the screen still while you work: answering the last offer or advancing a week must not
 * throw you off the Offers list or the deal you were building.
 */
export function stickyTradeTab(held: TradeTab | undefined, tab: TradeTab | undefined, league: League): TradeTab {
  return tab ?? held ?? defaultTradeTab(league);
}

/** The trade desk's hero: what needs you now, and the facts behind it (`deskState`, your view only). */
export function TradeDesk({ league }: { league: League }) {
  const nav = useNav();
  const state = deskState(league);
  return (
    <OfficeHero
      eyebrow="Trade desk"
      headline={state.text}
      urgent={state.urgent}
      action={
        state.offers > 0 ? (
          <button className="btn btn-primary" onClick={() => nav.go({ view: 'office', tab: 'trades', sub: 'offers' })}>
            Answer offers
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => nav.go({ view: 'office', tab: 'trades', sub: 'table' })}>
            Build a trade
          </button>
        )
      }
    >
      <Facts>
        <Fact label="Deadline" note={state.deadline.note}>
          {state.deadline.value}
        </Fact>
        <Fact label="Offers waiting">{state.offers}</Fact>
        <Fact label="On your block">{state.listed}</Fact>
        <Fact label="Untouchable">{state.untouchable}</Fact>
        <Fact label="Teams asking about your players">{state.asking}</Fact>
      </Facts>
    </OfficeHero>
  );
}

export function Trades({ league, tab }: { league: League; tab?: TradeTab }) {
  const nav = useNav();
  const pending = openOffers(league).length;
  const held = useRef<TradeTab | undefined>(undefined);
  const view = stickyTradeTab(held.current, tab, league);
  held.current = view;
  // A deal handed over from elsewhere (a counter, "Ask their price") opens the table.
  const version = useSyncExternalStore(tradeDesk.subscribe, tradeDesk.version);
  useEffect(() => {
    if (tradeDesk.pending() && view !== 'table') nav.go({ view: 'office', tab: 'trades', sub: 'table' });
  }, [version, view, nav]);
  const views: [TradeTab, string][] = [
    ['offers', pending ? `Offers (${pending})` : 'Offers'],
    ['table', 'Trade table'],
    ['block', 'Your block'],
    ['market', 'Market'],
    ['history', 'History'],
  ];
  return (
    <>
      <TradeDesk league={league} />
      <div className="seg" role="group" aria-label="Trades" style={{ marginBottom: 12 }}>
        {views.map(([v, label]) => (
          <button key={v} aria-pressed={view === v} onClick={() => nav.go({ view: 'office', tab: 'trades', sub: v })}>
            {label}
          </button>
        ))}
      </div>
      {league.market?.exam && league.market.exam.offerId === undefined && <ExamPanel league={league} />}
      {view === 'offers' && <OffersPanel league={league} />}
      {view === 'table' && <TradeTable league={league} />}
      {view === 'block' && <BlockPanel league={league} />}
      {view === 'market' && <MarketPanel league={league} />}
      {view === 'history' && <HistoryPanel league={league} />}
    </>
  );
}

/**
 * Who you're dealing with: whether they're buying or selling, what they want on your scouts' read, who they're
 * said to be shopping, and whether they're still taking your calls this week. Public signals and your view only.
 */
function PartnerFacts({ league, partner }: { league: League; partner: Team }) {
  // One read per partner, moment and deal: the needs read rates every starter in the league.
  const moment = league.market?.moment;
  const deals = league.transactions.length;
  const ctx = useMemo(() => tradeContext(league), [league, partner.id, moment, deals, league.week, league.phase]);
  const shopping = shoppingOf(league, partner.id).slice(0, 3);
  return (
    <div className="partner-facts">
      <Pill>{STANCE[stanceOf(partner)]}</Pill>
      <span className="partner-fact">
        <span className="eyebrow">Wants (our read)</span> <WantsPills league={league} team={partner} ctx={ctx} />
      </span>
      {shopping.length > 0 && (
        <span className="partner-fact">
          <span className="eyebrow">Shopping</span>{' '}
          {shopping.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <PlayerLink league={league} player={p} pos />
            </span>
          ))}
        </span>
      )}
      <span className="muted small">{talksWords(league, partner.id)}</span>
    </div>
  );
}

function TradeTable({ league }: { league: League }) {
  const userId = league.userTeamId;
  const others = league.teams.filter((t) => t.id !== userId).sort((a, b) => a.city.localeCompare(b.city));
  const [partnerId, setPartnerId] = useState(others[0].id);
  const [mine, setMine] = useState<Picked>(empty);
  const [theirs, setTheirs] = useState<Picked>(empty);
  const [counterTo, setCounterTo] = useState<number | undefined>();
  const [done, setDone] = useState<string | null>(null);
  const version = useSyncExternalStore(tradeDesk.subscribe, tradeDesk.version);
  useEffect(() => {
    const draft = tradeDesk.take();
    if (!draft) return;
    setPartnerId(draft.partnerId);
    setMine(draft.mine);
    setTheirs(draft.theirs);
    setCounterTo(draft.counterTo);
    setDone(null);
  }, [version]);
  const partner = league.teams[partnerId];
  const closed = tradeWindow(league) ?? liveLock();

  // Drop anything that moved since it was ticked (after a trade, a sim or a release), and salary kept for a player no longer in it.
  const valid = (p: Picked, teamId: number): Picked => {
    const players = p.players.filter((id) => league.players[id]?.teamId === teamId);
    const retain = Object.fromEntries(
      Object.entries(p.retain ?? {}).filter(([id, v]) => v > 0 && players.includes(Number(id))),
    );
    return {
      players,
      picks: p.picks.filter((id) =>
        league.draftPicks.some((x) => x.id === id && x.ownerId === teamId && x.playerId === undefined),
      ),
      ...(Object.keys(retain).length ? { retain } : {}),
    };
  };
  const a = valid(mine, userId);
  const b = valid(theirs, partnerId);
  const proposal: TradeProposal = {
    sides: [
      { teamId: userId, ...a },
      { teamId: partnerId, ...b },
    ],
  };
  const anything = a.players.length + a.picks.length + b.players.length + b.picks.length > 0;
  const verdict = anything ? evaluateTrade(league, proposal) : null;
  const impact = anything ? tradeCapImpact(league, proposal) : null;
  const need = verdict ? Math.max(1, verdict.get + verdict.shortfall) : 1;
  // The fill is coarse on purpose: a smooth bar would let you read the AI's exact valuation off it.
  // Rounding down means a full bar only ever means "they would accept".
  // A rule problem (cap, roster, window) or the GM's own line isn't about value: the bar stays empty and says so.
  const fill =
    !verdict || verdict.problem
      ? 0
      : verdict.accepts
        ? 1
        : Math.floor(Math.min(1, Math.max(0, verdict.get / need)) * 10) / 10;
  const mood = !verdict
    ? 'No offer yet'
    : verdict.problem
      ? verdict.policy
        ? 'Not interested'
        : 'Blocked by a rule'
      : verdict.accepts
        ? 'They would accept'
        : fill >= 0.8
          ? 'Close'
          : fill >= 0.4
            ? 'Some way off'
            : 'Far apart';

  // Every proposal is heard (about four a week per GM): a turned-down one costs a little of his patience.
  const propose = () => {
    let accepted = false;
    let message = '';
    store.mutate((l) => {
      if (counterTo !== undefined) {
        const r = counterOffer(l, counterTo, proposal);
        accepted = r.result === 'accepted';
        message = r.message;
        if (r.offer) message += ' See Offers.';
      } else {
        const r = proposeTrade(l, proposal);
        accepted = r.accepted;
        message = r.message;
      }
      // The deal itself, names and all (the AI side may have cut a backup after it).
      const deal = accepted && [...l.transactions].reverse().find((t) => t.kind === 'trade');
      if (deal) message = `Trade complete: ${deal.text}.`;
    });
    setDone(message);
    if (accepted || counterTo !== undefined) {
      setMine(empty());
      setTheirs(empty());
      setCounterTo(undefined);
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
      {!closed && isDeadlineDay(league) && (
        <div className="notice">Deadline day: trades close when you play week {league.week}.</div>
      )}
      {counterTo !== undefined && (
        <div className="notice">Countering the {partner.name}' offer: change the deal and propose it.</div>
      )}
      {done && (
        <p className="callout" role="status">
          <LinkedText league={league} text={done} />
        </p>
      )}
      <Panel
        title={
          <div className="row">
            <TeamChip team={partner} large />
            <div>
              <h2>
                Trade with the <TeamLink team={partner} full />
              </h2>
              <span className="muted small">
                {partner.gmId !== null && (
                  <>
                    <GmLink league={league} gm={league.gms[partner.gmId]} /> ·{' '}
                  </>
                )}
                GM style: {partner.gm.archetype} ·{' '}
                {partner.gm.pickChart === 'johnson'
                  ? 'old-school pick chart (prizes top picks)'
                  : 'analytics pick chart (values Day 2 picks highly)'}
              </span>
              <PartnerFacts league={league} partner={partner} />
            </div>
          </div>
        }
        action={
          <TeamPicker
            league={league}
            value={partnerId}
            onChange={(id) => {
              setPartnerId(id);
              setTheirs(empty());
              setCounterTo(undefined);
              setDone(null);
            }}
            label="Trade partner"
            exclude={[userId]}
          />
        }
      >
        <div className="trade-verdict" aria-live="polite">
          <div className="meter" role="img" aria-label={`Their view of the offer: ${mood}`}>
            <i style={{ width: `${fill * 100}%` }} className={verdict?.accepts ? 'yes' : ''} />
          </div>
          <span className={verdict?.accepts ? 'tone-good' : 'muted'}>
            {verdict ? (
              <LinkedText league={league} text={verdict.message} />
            ) : (
              'Tick players or picks on both sides to build an offer.'
            )}
          </span>
          {impact && (
            <span className="muted small">
              Your cap room after:{' '}
              <b className={impact[0].space < 0 ? 'tone-bad' : ''}>{money(Math.round(impact[0].space))}</b>
              {impact[0].dead > 0 && <> · dead money you'd book: {money(Math.round(impact[0].dead))}</>} · their room
              after: {money(Math.round(impact[1].space))}
            </span>
          )}
          <span className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-primary"
              disabled={!verdict || (!!verdict.problem && !verdict.policy) || !!closed}
              onClick={propose}
            >
              {counterTo !== undefined ? 'Send counter' : 'Propose trade'}
            </button>
            <button
              className="btn"
              disabled={!verdict || verdict.accepts || !!verdict.problem || !!closed}
              onClick={sweeten}
            >
              What would make it work?
            </button>
            <button
              className="btn btn-ghost"
              disabled={!anything}
              onClick={() => {
                setMine(empty());
                setTheirs(empty());
                setCounterTo(undefined);
              }}
            >
              Clear
            </button>
          </span>
          {a.players.length + a.picks.length > 0 && b.players.length + b.picks.length > 0 && (
            <StaffStrip
              league={league}
              advice={dealAdvice(league, [
                { teamId: partnerId, ...b },
                { teamId: userId, ...a },
              ])}
            />
          )}
        </div>
        <div className="grid-2">
          <div>
            <h3>You send</h3>
            <KeepPaying league={league} picked={a} onChange={setMine} />
            <AssetList league={league} teamId={userId} picked={a} onChange={setMine} />
          </div>
          <div>
            <h3>You get</h3>
            {Object.entries(b.retain ?? {}).map(([id, v]) => (
              <p key={id} className="muted small">
                The {partner.name} keep paying {money(v)} of {league.players[Number(id)].lastName}'s salary this season.
              </p>
            ))}
            <AssetList league={league} teamId={partnerId} picked={b} onChange={setTheirs} />
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Traded players take their salary with them; any bonus money stays on your cap as dead money. Teams want a
          small win in their own eyes, and each GM hears only a few proposals from you a week.
        </p>
      </Panel>
    </>
  );
}
