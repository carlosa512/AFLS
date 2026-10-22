/**
 * Offers to you and your side of the market (docs/TRADES.md, "Offers to you"): the offer card the
 * Offers tab and the inbox share, your trade block, the market's talk and the trade history. Every
 * action goes through the engine (`acceptOffer`, `counterOffer`, `shopPlayer`…) inside `store.mutate`.
 */
import { useState } from 'react';
import { capHit, isExpired, lastSeason } from '../engine/finance/contract';
import { mailForOffer, offerMailId, offerWords } from '../engine/inbox';
import { teamPlayers } from '../engine/roster';
import {
  acceptOffer,
  answerEnquiry,
  askPrice,
  dealAdvice,
  declineOffer,
  openOffers,
  pickLabel,
  playerTradeBlocker,
  replyOf,
  resolveExam,
  setTradeStatus,
  shopPlayer,
  stanceOf,
  tradeWindow,
  type Advice,
} from '../engine/trade';
import type { League, Player, Stance, TradeOffer, TradeRecord, TradeSide, TradeStatus } from '../engine/types';
import { POSITIONS } from '../engine/types';
import { LinkedText, nameIndex } from './moves';
import { useNav } from './App';
import { Panel, PlayerAvatar, PlayerLink, SortSeg, sortRows, TeamChip, useSort } from './components';
import { money, playerName } from './format';
import { Ovr, seenOvr } from './scouting';
import { store } from './store';
import { tradeDesk } from './tradeDesk';

/** How the trade asset list and your block sort: by position (depth-chart order), OVR or cap hit. */
export type ListSort = 'pos' | 'ovr' | 'cap';
export const LIST_SORT_OPTIONS: { k: ListSort; label: string; desc?: boolean }[] = [
  { k: 'pos', label: 'Position', desc: false },
  { k: 'ovr', label: 'OVR' },
  { k: 'cap', label: 'Cap hit' },
];
export const listSortValue = (league: League, p: Player, key: ListSort): number =>
  key === 'pos'
    ? POSITIONS.indexOf(p.position) * 100 - seenOvr(league, p)
    : key === 'ovr'
      ? seenOvr(league, p)
      : p.contract
        ? capHit(p.contract, league.season)
        : 0;

const WHO: Record<Advice['who'], string> = {
  coach: 'Head coach',
  scouts: 'Pro scouts',
  medical: 'Medical',
  cap: 'Cap',
};

/** A deal's side as the trade table holds it. */
const picked = (side: TradeSide) => ({
  players: [...side.players],
  picks: [...side.picks],
  ...(side.retain ? { retain: { ...side.retain } } : {}),
});

/** One side of a deal, player by player and pick by pick. */
function SideList({ league, side }: { league: League; side: TradeSide }) {
  const team = league.teams[side.teamId];
  if (!side.players.length && !side.picks.length) return <p className="muted small">Nothing</p>;
  return (
    <ul className="plain-list">
      {side.players.map((id) => {
        const p = league.players[id];
        return (
          <li key={id} className="row" style={{ gap: 8 }}>
            <PlayerAvatar player={p} team={team} size={24} />
            <PlayerLink league={league} player={p} pos />
            <Ovr league={league} player={p} />
            <span className="muted small">
              {p.contract
                ? `${money(Math.round(capHit(p.contract, league.season)))} · thru ${lastSeason(p.contract)}`
                : ''}
              {side.retain?.[id] ? ` · ${team.name} keep paying ${money(side.retain[id])}` : ''}
            </span>
          </li>
        );
      })}
      {side.picks.map((id) => {
        const pk = league.draftPicks.find((x) => x.id === id);
        return pk ? <li key={id}>{pickLabel(league, pk)}</li> : null;
      })}
    </ul>
  );
}

/**
 * A deal of yours waiting on your call after a physical flagged a player: the doctors' words, the
 * deal (or their lower offer), and your choices.
 */
export function ExamPanel({ league }: { league: League }) {
  const [note, setNote] = useState<string | null>(null);
  const exam = league.market?.exam;
  if (!exam)
    return note ? (
      <p className="callout callout-note" role="status">
        {note}
      </p>
    ) : null;
  const ai = league.teams[exam.aiId];
  const sides = exam.by === 'theirs' && exam.reduced ? exam.reduced : exam.sides;
  const [theirs, yours] = sides[0].teamId === exam.aiId ? sides : [sides[1], sides[0]];
  const answer = (choice: Parameters<typeof resolveExam>[1]) => {
    let message = '';
    store.mutate((l) => {
      message = resolveExam(l, choice).message;
    });
    setNote(message);
  };
  return (
    <Panel title={<h2>The physical: your deal with the {ai.name}</h2>}>
      <ul className="plain-list">
        {exam.exams
          .filter((e) => e.result !== 'passed')
          .map((e) => (
            <li key={e.playerId}>{e.note}</li>
          ))}
      </ul>
      <p className="muted small">
        {exam.by === 'theirs'
          ? exam.reduced
            ? 'Their lower offer:'
            : 'They want to talk price.'
          : 'The deal as agreed:'}
      </p>
      <div className="grid-2">
        <div>
          <div className="eyebrow">You get</div>
          <SideList league={league} side={theirs} />
        </div>
        <div>
          <div className="eyebrow">You send</div>
          <SideList league={league} side={yours} />
        </div>
      </div>
      {note && (
        <p className="callout callout-note" role="status">
          {note}
        </p>
      )}
      <span className="row" style={{ gap: 8 }}>
        {exam.by === 'yours' ? (
          <>
            <button className="btn" onClick={() => answer('lower')}>
              Ask for a lower price
            </button>
            <button className="btn" onClick={() => answer('anyway')}>
              Take him anyway
            </button>
            <button className="btn btn-ghost" onClick={() => answer('walk')}>
              Walk away
            </button>
          </>
        ) : (
          <>
            {exam.reduced && (
              <button className="btn btn-primary" onClick={() => answer('reduced')}>
                Take their lower offer
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => answer('keep')}>
              Keep him
            </button>
          </>
        )}
      </span>
    </Panel>
  );
}

/** How a closed offer ended, for a save from before offers kept the words. */
const FALLBACK: Record<Exclude<TradeOffer['status'], 'pending'>, string> = {
  accepted: 'You accepted.',
  declined: 'You turned it down.',
  expired: 'It lapsed.',
  withdrawn: 'They pulled it.',
  answered: 'You answered.',
};

/** How a note under an offer reads: a prompt that asks for more (who to release, the physical) is neither a yes nor a refusal. */
export function noteTone(result: { ok: boolean; release?: unknown; exam?: boolean }): 'good' | 'bad' | 'note' {
  if (result.ok) return 'good';
  return result.release || result.exam ? 'note' : 'bad';
}

/** The note shows only when it says something the card's title doesn't already (the outcome, once you've acted). */
export const showNote = (note: string | null, offer: TradeOffer): note is string => !!note && note !== offer.outcome;

/** When an offer lapses, in words. */
const lapse = (league: League) =>
  league.phase === 'regular' ? `Open until you play week ${league.week}.` : 'Open until your next step.';

/** An offer on your desk: what he sends and wants, your staff's word, and your answer. `compact` drops the heading and his words (the inbox message already says them). */
export function OfferCard({
  league,
  offer,
  compact,
  onDone,
}: {
  league: League;
  offer: TradeOffer;
  compact?: boolean;
  onDone?: (message: string) => void;
}) {
  const nav = useNav();
  const [note, setNote] = useState<string | null>(null);
  const [tone, setTone] = useState<'good' | 'bad' | 'note'>('good');
  const [release, setRelease] = useState<number[] | null>(null);
  const team = league.teams[offer.teamId];
  const { subject, body } = offerWords(league, offer);
  const open = openOffers(league).some((o) => o.id === offer.id);
  const enquiry = offer.kind === 'enquiry';
  const advice = enquiry ? [] : dealAdvice(league, offer.sides);
  // One index for every note: building it reads the whole league.
  const names = advice.length ? nameIndex(league) : undefined;
  const reply = replyOf(league, offer);

  const accept = (ids: number[] = []) => {
    let result = {
      ok: false,
      message: '',
      release: undefined as Player[] | undefined,
      exam: undefined as boolean | undefined,
    };
    store.mutate((l) => {
      result = { release: undefined, exam: undefined, ...acceptOffer(l, offer.id, ids) };
    });
    setNote(result.message);
    setTone(noteTone(result));
    setRelease(result.release ? result.release.map((p) => p.id) : null);
    if (result.ok) onDone?.(result.message);
  };
  const counter = () => {
    tradeDesk.put({
      partnerId: offer.teamId,
      mine: picked(offer.sides[1]),
      theirs: picked(offer.sides[0]),
      counterTo: offer.id,
    });
    nav.go({ view: 'office', tab: 'trades', sub: 'table' });
  };

  /** Answering an enquiry: the card keeps the words. Asking for an offer that couldn't be made is a miss. */
  const answer = (choice: 'offer' | 'notForSale') => {
    let result: ReturnType<typeof answerEnquiry> = { offer: null, message: '' };
    store.mutate((l) => {
      result = answerEnquiry(l, offer.id, choice);
    });
    setNote(result.message);
    setTone(choice === 'notForSale' || result.offer !== null ? 'good' : 'bad');
  };

  const when = (
    <span className="muted small">
      {open
        ? lapse(league)
        : offer.status === 'pending'
          ? 'This offer is no longer open.'
          : (offer.outcome ?? FALLBACK[offer.status])}
    </span>
  );
  return (
    <Panel
      title={
        compact ? (
          when
        ) : (
          <div className="row">
            <TeamChip team={team} />
            <div>
              <h3 style={{ margin: 0 }}>{subject}</h3>
              {when}
            </div>
          </div>
        )
      }
    >
      {!compact && <p>{body}</p>}
      {!enquiry && (
        <div className="grid-2">
          <div>
            <div className="eyebrow">You get</div>
            <SideList league={league} side={offer.sides[0]} />
          </div>
          <div>
            <div className="eyebrow">You send</div>
            <SideList league={league} side={offer.sides[1]} />
          </div>
        </div>
      )}
      {advice.length > 0 && (
        <ul className="plain-list small">
          {advice.map((a, i) => (
            <li key={i}>
              <b>{WHO[a.who]}:</b> <LinkedText league={league} text={a.line} index={names} />
            </li>
          ))}
        </ul>
      )}
      {release && (
        <div className="notice">
          <p style={{ marginTop: 0 }}>To make room, release:</p>
          {teamPlayers(league, league.userTeamId)
            .filter((p) => !p.ir && !offer.sides[1].players.includes(p.id))
            .sort((a, b) => seenOvr(league, a) - seenOvr(league, b))
            .slice(0, 12)
            .map((p) => (
              <label key={p.id} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={release.includes(p.id)}
                  onChange={() =>
                    setRelease(release.includes(p.id) ? release.filter((x) => x !== p.id) : [...release, p.id])
                  }
                />
                {p.position} {playerName(p)} <Ovr league={league} player={p} />
              </label>
            ))}
          <button className="btn btn-primary" onClick={() => accept(release)}>
            Release and accept
          </button>
        </div>
      )}
      {showNote(note, offer) && (
        <p className={`callout callout-${tone}`} role="status">
          {note}
        </p>
      )}
      {reply && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            nav.go({
              view: 'inbox',
              messageId: mailForOffer(league, reply)?.id ?? offerMailId(league, reply),
              focus: Date.now(),
            })
          }
        >
          See their offer →
        </button>
      )}
      {league.market?.exam?.offerId === offer.id && <ExamPanel league={league} />}
      {open && league.market?.exam?.offerId !== offer.id && (
        <span className="row" style={{ gap: 8 }}>
          {enquiry ? (
            <>
              <button className="btn btn-primary" onClick={() => answer('offer')}>
                Make me an offer
              </button>
              <button className="btn" onClick={() => answer('notForSale')}>
                Not for sale
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={() => accept()}>
                Accept
              </button>
              <button className="btn" onClick={counter}>
                Counter
              </button>
              <button className="btn btn-ghost" onClick={() => store.mutate((l) => declineOffer(l, offer.id))}>
                Decline
              </button>
            </>
          )}
        </span>
      )}
    </Panel>
  );
}

export function OffersPanel({ league }: { league: League }) {
  const [done, setDone] = useState<string | null>(null);
  const offers = openOffers(league).sort((a, b) => b.id - a.id);
  return (
    <>
      {done && (
        <p className="callout callout-good" role="status">
          {done}
        </p>
      )}
      {offers.length ? (
        offers.map((o) => <OfferCard key={o.id} league={league} offer={o} onDone={setDone} />)
      ) : (
        <Panel title={<h2>Offers</h2>}>
          <p className="muted">
            No offers on your desk. Teams call about players they've been watching; put one on the block or shop him to
            draw calls.
          </p>
        </Panel>
      )}
    </>
  );
}

const STATUS: [TradeStatus | null, string][] = [
  [null, 'Available'],
  ['listed', 'On the block'],
  ['untouchable', 'Untouchable'],
];

/** Your status picker for one player: Available, On the block, Untouchable. */
export function StatusPicker({ league, player }: { league: League; player: Player }) {
  const status = league.market?.status[player.id] ?? null;
  return (
    <div className="seg seg-sm" role="group" aria-label={`Trade status for ${player.firstName} ${player.lastName}`}>
      {STATUS.map(([s, label]) => (
        <button
          key={label}
          aria-pressed={status === s}
          onClick={() => store.mutate((l) => setTradeStatus(l, player.id, s))}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Your trade block: every player's status, and *Shop* to call every team that needs him. */
export function BlockPanel({ league }: { league: League }) {
  const [note, setNote] = useState<string | null>(null);
  const [sort, onSort] = useSort<ListSort>({ key: 'pos', desc: false });
  const players = sortRows(
    teamPlayers(league, league.userTeamId).filter((p) => p.contract && !isExpired(p.contract, league.season)),
    sort,
    (p, key) => listSortValue(league, p, key),
  );
  const shop = (p: Player) => {
    let message = '';
    store.mutate((l) => {
      message = shopPlayer(l, p.id).message;
    });
    setNote(message);
  };
  return (
    <Panel title={<h2>Your block</h2>}>
      <p className="muted small">
        On the block, interest grows fast and teams call sooner; they also know you want to sell. Untouchable, nobody
        asks. <b>Shop</b> calls every team that needs him now.
      </p>
      {note && (
        <p className="callout" role="status">
          {note}
        </p>
      )}
      <SortSeg label="Sort your block" options={LIST_SORT_OPTIONS} sort={sort} onSort={onSort} />
      <ul className="plain-list">
        {players.map((p) => {
          const blocked = playerTradeBlocker(league, p);
          return (
            <li key={p.id} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 8 }}>
                <PlayerLink league={league} player={p} pos />
                <Ovr league={league} player={p} />
              </span>
              <span className="row" style={{ gap: 8 }}>
                <StatusPicker league={league} player={p} />
                <button
                  className="btn btn-sm"
                  disabled={!!blocked || league.market?.shopped[p.id] === league.market?.moment}
                  title={blocked ?? undefined}
                  onClick={() => shop(p)}
                >
                  Shop
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const STANCE: Record<Stance, string> = {
  contend: 'Buying',
  bubble: 'Listening',
  retool: 'Selling veterans',
  rebuild: 'Selling',
};

/** What the league is saying, and who's buying and selling (in words). */
export function MarketPanel({ league }: { league: League }) {
  const rumors = [...(league.market?.rumors ?? [])].reverse().slice(0, 20);
  const ai = league.teams.filter((t) => t.id !== league.userTeamId && t.stance);
  return (
    <div className="grid-2">
      <Panel title={<h2>Around the league</h2>}>
        {rumors.length ? (
          <ul className="plain-list">
            {rumors.map((r) => (
              <li key={r.id}>
                {r.text} <span className="muted small">{r.phase === 'regular' ? `Week ${r.week}` : r.season}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Quiet so far.</p>
        )}
      </Panel>
      <Panel title={<h2>Who's dealing</h2>}>
        {(['contend', 'bubble', 'retool', 'rebuild'] as Stance[]).map((mode) => {
          const teams = ai.filter((t) => stanceOf(t) === mode);
          return teams.length ? (
            <p key={mode}>
              <b>{STANCE[mode]}:</b> {teams.map((t) => t.name).join(', ')}
            </p>
          ) : null;
        })}
      </Panel>
    </div>
  );
}

const sideText = (league: League, side: TradeSide) =>
  [
    ...side.players.map(
      (id) => `${league.players[id].position} ${league.players[id].firstName[0]}. ${league.players[id].lastName}`,
    ),
    ...side.picks
      .map((id) => league.draftPicks.find((p) => p.id === id))
      .filter((p) => !!p)
      .map((p) => `${p!.season} R${p!.round}`),
  ].join(', ') || 'nothing';

/** The league's trades, newest first: yours only, or everyone's. */
export function HistoryPanel({ league }: { league: League }) {
  const [yours, setYours] = useState(false);
  const all = [...(league.market?.history ?? [])].reverse();
  const shown = (yours ? all.filter((r) => r.sides.some((s) => s.teamId === league.userTeamId)) : all).slice(0, 60);
  const when = (r: TradeRecord) =>
    `${r.season} ${r.phase === 'regular' ? `week ${r.week}` : r.phase === 'resign' ? 'league year' : r.phase === 'freeAgency' ? 'free agency' : r.phase === 'preseason' ? 'camp' : r.phase}`;
  return (
    <Panel
      title={<h2>Trade history</h2>}
      action={
        <div className="seg seg-sm" role="group" aria-label="Whose trades">
          <button aria-pressed={!yours} onClick={() => setYours(false)}>
            League
          </button>
          <button aria-pressed={yours} onClick={() => setYours(true)}>
            Yours
          </button>
        </div>
      }
    >
      {shown.length ? (
        <ul className="plain-list">
          {shown.map((r, i) => {
            const [a, b] = r.sides.map((s) => league.teams[s.teamId]);
            return (
              <li key={i}>
                <b>{a.abbrev}</b> sent {sideText(league, r.sides[0])} to <b>{b.abbrev}</b> for{' '}
                {sideText(league, r.sides[1])}{' '}
                <span className="muted small">
                  {when(r)}
                  {r.kind !== 'user' ? ` · ${r.kind}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No trades yet.</p>
      )}
    </Panel>
  );
}

/** On a player card: your status picker and *Shop* for your players, *Ask their price* for anyone else's. */
export function TradeActions({ league, player, onClose }: { league: League; player: Player; onClose: () => void }) {
  const nav = useNav();
  const [note, setNote] = useState<string | null>(null);
  if (player.teamId === null || player.retired || !player.contract || isExpired(player.contract, league.season))
    return null;
  const closed = tradeWindow(league);
  if (player.teamId === league.userTeamId) {
    const shop = () => {
      let message = '';
      store.mutate((l) => {
        message = shopPlayer(l, player.id).message;
      });
      setNote(message);
    };
    return (
      <div className="card-actions">
        <StatusPicker league={league} player={player} />
        <button
          className="btn btn-sm"
          disabled={!!closed || league.market?.shopped[player.id] === league.market?.moment}
          title={closed ?? undefined}
          onClick={shop}
        >
          Shop him
        </button>
        {note && <span className="muted small">{note}</span>}
      </div>
    );
  }
  const ask = () => {
    const { proposal, message } = askPrice(league, player.id);
    if (!proposal) return setNote(message);
    tradeDesk.put({ partnerId: player.teamId!, mine: picked(proposal.sides[0]), theirs: picked(proposal.sides[1]) });
    onClose();
    nav.go({ view: 'office', tab: 'trades', sub: 'table' });
  };
  return (
    <div className="card-actions">
      <button className="btn btn-sm" disabled={!!closed} title={closed ?? undefined} onClick={ask}>
        Ask their price
      </button>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}
