/**
 * The negotiation table: the agent's ask on one side, your offer on the other, and a live
 * preview of what the contract does to your cap, year by year, before you send it.
 */
import { useId, useState } from 'react';
import { capSpace } from '../engine/finance/cap';
import { capHit, isExpired, prorationIn, totalGuaranteed } from '../engine/finance/contract';
import { minSalary } from '../engine/finance/market';
import { askOffer, demand, makeOffer, negotiationFor, offerProblem, prospectiveContract, type Offer } from '../engine/offseason/negotiation';
import { playerOvr } from '../engine/positions';
import type { League, Player } from '../engine/types';
import { Dialog, PlayerAvatar, Rating } from './components';
import { money } from './format';
import { liveLock } from './live';
import { store } from './store';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>
        {label} <b className="num">{format(value)}</b>
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function NegotiationDialog({ league, player, onClose }: { league: League; player: Player; onClose: () => void }) {
  const teamId = league.userTeamId;
  const d = demand(league, player, teamId);
  const [offer, setOffer] = useState<Offer>(() => askOffer(d));
  const [result, setResult] = useState<{ accepted: boolean; message: string; summary?: string } | null>(null);
  // Peek without mutating the save: negotiationFor creates state, so read it from a scratch copy.
  const existing = league.negotiations[player.id];
  const patience = existing?.teamId === teamId ? existing.patience : d.patience;
  const broken = existing?.teamId === teamId && existing.status === 'broken' && existing.brokenPhase === league.phase;
  const own = player.teamId === teamId;
  const min = minSalary(player.experience, league.caps[league.season]);

  const set = (patch: Partial<Offer>) => {
    const next = { ...offer, ...patch };
    next.bonusPct = Math.min(next.bonusPct, next.gtdPct);
    next.voidYears = Math.min(next.voidYears, Math.max(0, 5 - next.years));
    setOffer(next);
    setResult(null);
  };
  const preview = prospectiveContract(league, player, teamId, offer);
  const problem = liveLock() ?? offerProblem(league, player, teamId, offer);
  const hitNow = capHit(preview, league.season);
  const space = capSpace(league, teamId) + (own && player.contract ? capHit(player.contract, league.season) : 0);

  const send = () => {
    // Summarize before signing: afterwards the player's new deal would read as the "prior" one.
    const summary = `${offer.years} yr, ${money(offer.apy * offer.years)} (${money(offer.apy)}/yr), ${money(Math.round(totalGuaranteed(preview)))} guaranteed.`;
    let r: { accepted: boolean; message: string } = { accepted: false, message: '' };
    store.mutate((l) => {
      const p = l.players[player.id];
      negotiationFor(l, p, teamId);
      r = makeOffer(l, p, teamId, offer);
    });
    setResult({ ...r, summary });
  };

  if (result?.accepted) {
    return (
      <Dialog key="done" title="Deal done" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose} data-autofocus>Done</button>}>
        <p style={{ margin: 0 }}>
          {player.firstName} {player.lastName} signed: {result.summary}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={`${own ? (player.contract && !isExpired(player.contract, league.season) ? 'Extend' : 'Re-sign') : 'Sign'} ${player.firstName} ${player.lastName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => set(askOffer(d))}>
            Match his ask
          </button>
          <button className="btn btn-primary" disabled={!!problem || broken} onClick={send}>
            Make offer
          </button>
        </>
      }
    >
      <div className="nego-head">
        <PlayerAvatar player={player} team={player.teamId !== null ? league.teams[player.teamId] : null} size={44} />
        <div>
          <b>
            {player.position} · age {player.age} · <Rating value={playerOvr(player)} decimals={1} />
          </b>
          <div className="muted small">Market value {money(d.market)}/yr</div>
        </div>
        <div className="patience" aria-label={`Agent patience: ${patience} of ${d.patience}`} title="Agent patience: lowball offers use it up; insults cost two">
          {Array.from({ length: d.patience }, (_, i) => (
            <i key={i} className={i < patience ? 'on' : ''} />
          ))}
        </div>
      </div>
      <p className="agent-ask">
        <span className="eyebrow">His ask</span>
        <b className="num">
          {money(d.askApy)}/yr × {d.askYears} yr
        </b>
        <span className="muted small">{pct(d.askGtdPct)} guaranteed</span>
      </p>
      {broken && <p className="callout callout-bad">His agent has ended talks for now. They reopen in the next phase of the offseason.</p>}
      {result && !result.accepted && <p className="callout callout-bad">{result.message}</p>}

      <div className="field-row">
        <span>Years</span>
        <div className="seg" role="group" aria-label="Contract years">
          {[1, 2, 3, 4, 5].map((y) => (
            <button key={y} aria-pressed={offer.years === y} onClick={() => set({ years: y })}>
              {y}
            </button>
          ))}
        </div>
      </div>
      <Slider label="Per year" value={offer.apy} min={min} max={Math.max(min * 2, Math.round(d.askApy * 1.4))} step={50} onChange={(v) => set({ apy: v })} format={(v) => money(v)} />
      <Slider label="Guaranteed" value={offer.gtdPct} min={0} max={1} step={0.05} onChange={(v) => set({ gtdPct: v })} format={pct} />
      <Slider label="Paid as signing bonus" value={offer.bonusPct} min={0} max={offer.gtdPct} step={0.05} onChange={(v) => set({ bonusPct: v })} format={pct} />
      {offer.years < 5 && (
        <div className="field-row">
          <span title="Spreads the bonus over more cap years. The player doesn't care; future you might.">Void years</span>
          <div className="seg" role="group" aria-label="Void years">
            {Array.from({ length: 5 - offer.years + 1 }, (_, v) => (
              <button key={v} aria-pressed={offer.voidYears === v} onClick={() => set({ voidYears: v })}>
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="facts">
        <span className="fact">
          <span className="eyebrow">Total</span>
          <b className="num">{money(offer.apy * offer.years)}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Guaranteed</span>
          <b className="num">{money(Math.round(totalGuaranteed(preview)))}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">{league.season} cap hit</span>
          <b className={`num${hitNow > space ? ' tone-bad' : ''}`}>{money(Math.round(hitNow))}</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Your room</span>
          <b className="num">{money(Math.round(space))}</b>
        </span>
      </div>
      <div className="cap-strip" aria-label="Cap hit by season">
        {preview.years.map((y) => (
          <span key={y.season} className={y.void ? 'void' : undefined}>
            <span className="muted small">
              {y.season}
              {y.void ? ' (void)' : ''}
            </span>
            <b className="num">{money(Math.round(capHit(preview, y.season)))}</b>
            {prorationIn(preview, y.season) > 0 && <span className="muted small">bonus {money(Math.round(prorationIn(preview, y.season)))}</span>}
          </span>
        ))}
      </div>
      {problem && <p className="callout callout-bad">{problem}</p>}
    </Dialog>
  );
}
