/**
 * Contract and cap UI shared by the player card and the Cap screen: the year-by-year ledger,
 * release / restructure previews (the doc's "star of cap management"), and the 5-year chart.
 */
import { useEffect, useId, useRef, useState } from 'react';
import {
  capFor,
  capProjection,
  POST_JUNE1_LIMIT,
  releaseBlocker,
  releasePlayer,
  releasePreview,
  restructureBlocker,
  restructureOptions,
  restructurePlayer,
} from '../engine/finance/cap';
import { capHit, guaranteedFrom, isExpired, lastSeason, prorationIn, totalGuaranteed } from '../engine/finance/contract';
import type { Contract, League, Player } from '../engine/types';
import { Dialog } from './components';
import { liveLock } from './live';
import { money } from './format';
import { store } from './store';

const name = (p: Player) => `${p.firstName} ${p.lastName}`;

/** "2029", or "Expiring" for a deal that has run out (re-sign window, before free agency opens). */
export const thruLabel = (league: League, c: Contract) => (isExpired(c, league.season) ? 'Expiring' : String(lastSeason(c)));

export function contractLabel(league: League, p: Player): string {
  const c = p.contract;
  if (!c) return p.retired ? 'Retired' : 'Free agent';
  const kind = c.kind === 'rookie' ? 'Rookie deal' : c.kind === 'tag' ? 'Franchise tag' : c.kind === 'minimum' ? 'Minimum deal' : 'Veteran deal';
  const end = isExpired(c, league.season) ? `expired after ${lastSeason(c)}` : `thru ${lastSeason(c)}`;
  return `${kind} · ${c.length} yr, ${money(c.apy * c.length)} (${money(c.apy)}/yr) · ${end}`;
}

/** Year-by-year ledger: what counts on the cap, and what's owed no matter what. */
export function ContractYears({ player }: { player: Player }) {
  const c = player.contract;
  if (!c) return null;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Season</th>
            <th className="num">Base</th>
            <th className="num">Bonus proration</th>
            <th className="num">Cap hit</th>
            <th className="num">Guaranteed</th>
          </tr>
        </thead>
        <tbody>
          {c.years.map((y) => (
            <tr key={y.season} className={y.void ? 'void-year' : undefined}>
              <td className="num">
                {y.season}
                {y.void && <span className="tag-pill">void</span>}
                {c.fifthYearOption === 'exercised' && y === c.years[c.years.length - 1] && !y.void && <span className="tag-pill">option</span>}
              </td>
              <td className="num">{y.void ? '–' : money(y.base)}</td>
              <td className="num">{money(Math.round(prorationIn(c, y.season)))}</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {money(Math.round(capHit(c, y.season)))}
              </td>
              <td className="num">{y.guaranteed ? money(y.guaranteed) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContractSummary({ league, player }: { league: League; player: Player }) {
  const c = player.contract;
  if (!c) return <p className="muted">{player.retired ? 'Retired.' : 'Free agent.'}</p>;
  return (
    <div className="facts">
      <span className="fact">
        <span className="eyebrow">{league.season} cap hit</span>
        <b className="num">{money(Math.round(capHit(c, league.season)))}</b>
      </span>
      <span className="fact">
        <span className="eyebrow">APY</span>
        <b className="num">{money(c.apy)}</b>
      </span>
      <span className="fact">
        <span className="eyebrow">Signed</span>
        <b className="num">
          {c.signedSeason} · {c.length} yr
        </b>
      </span>
      <span className="fact">
        <span className="eyebrow">Guaranteed at signing</span>
        <b className="num">{money(Math.round(totalGuaranteed(c)))}</b>
      </span>
      <span className="fact">
        <span className="eyebrow">Still guaranteed</span>
        <b className="num">{money(guaranteedFrom(c, league.season))}</b>
      </span>
    </div>
  );
}

function Num({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <span className="fact">
      <span className="eyebrow">{label}</span>
      <b className={`num${tone ? ` tone-${tone}` : ''}`}>{money(Math.round(value))}</b>
    </span>
  );
}

export function ReleaseDialog({ league, player, onClose }: { league: League; player: Player; onClose: () => void }) {
  const [designate, setDesignate] = useState(false);
  const preview = releasePreview(league, player, designate);
  const team = league.teams[player.teamId!];
  const hit = capHit(player.contract!, league.season);
  const confirm = () => {
    store.mutate((l) => releasePlayer(l, l.players[player.id], designate));
    onClose();
  };
  return (
    <Dialog
      title={`Release ${name(player)}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Keep him
          </button>
          <button className="btn btn-danger" onClick={confirm}>
            Release
          </button>
        </>
      }
    >
      <div className="facts">
        <Num label={`${league.season} cap hit now`} value={hit} />
        <Num label={`Dead money ${league.season}`} value={preview.thisYear} tone={preview.thisYear > 0 ? 'bad' : undefined} />
        <Num label={`Dead money ${league.season + 1}`} value={preview.nextYear} tone={preview.nextYear > 0 ? 'bad' : undefined} />
        <Num label="Cap room gained" value={preview.savings} tone={preview.savings >= 0 ? 'good' : 'bad'} />
      </div>
      {preview.canDesignate ? (
        <label className="check-row">
          <input type="checkbox" checked={designate} onChange={(e) => setDesignate(e.target.checked)} />
          <span>
            <b>Post-June 1 designation</b> ({POST_JUNE1_LIMIT - team.postJune1Used} of {POST_JUNE1_LIMIT} left). Only this year's bonus share counts now;
            the rest moves to {league.season + 1}. Same total, different timing.
          </span>
        </label>
      ) : preview.postJune1 ? (
        <p className="muted small">After June 1, remaining bonus money is charged to next year's cap automatically.</p>
      ) : (
        <p className="muted small">No post-June 1 designations left this league year: all remaining bonus money hits now.</p>
      )}
      <p className="muted small">He becomes a free agent. Guaranteed salary is still owed and counts as dead money.</p>
    </Dialog>
  );
}

export function RestructureDialog({ league, player, onClose }: { league: League; player: Player; onClose: () => void }) {
  const full = restructureOptions(league, player);
  const step = 100;
  const [amount, setAmount] = useState(Math.floor(full.max / step) * step);
  const preview = restructureOptions(league, player, amount);
  const c = player.contract!;
  const sliderId = useId();
  const seasons = c.years.filter((y) => y.season >= league.season).slice(0, preview.years);
  const confirm = () => {
    store.mutate((l) => restructurePlayer(l, l.players[player.id], amount));
    onClose();
  };
  return (
    <Dialog
      title={`Restructure ${name(player)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={amount <= 0} onClick={confirm}>
            Restructure
          </button>
        </>
      }
    >
      <p className="small" style={{ margin: 0 }}>
        Convert base salary into a bonus spread over {preview.years} league years. Room now, a bigger bill later, and more dead money if you ever cut him.
      </p>
      <label htmlFor={sliderId} className="eyebrow">
        Salary to convert: <b className="num">{money(amount)}</b> of {money(full.max)}
      </label>
      <input id={sliderId} type="range" min={0} max={Math.max(step, full.max)} step={step} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      <div className="facts">
        <Num label={`Room created in ${league.season}`} value={preview.savings} tone="good" />
        <Num label="Added to each later year" value={preview.addedPerYear} tone="bad" />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Season</th>
              <th className="num">Cap hit now</th>
              <th className="num">After</th>
            </tr>
          </thead>
          <tbody>
            {seasons.map((y, i) => {
              const now = capHit(c, y.season);
              const after = i === 0 ? now - preview.savings : now + preview.addedPerYear;
              return (
                <tr key={y.season}>
                  <td className="num">
                    {y.season}
                    {y.void && <span className="tag-pill">void</span>}
                  </td>
                  <td className="num">{money(Math.round(now))}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {money(Math.round(after))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/** Release / restructure buttons with their preview dialogs, for the user's own players. */
export function ContractActions({ league, player }: { league: League; player: Player }) {
  const [open, setOpen] = useState<'release' | 'restructure' | null>(null);
  if (player.teamId !== league.userTeamId || !player.contract) return null;
  const lock = liveLock();
  const cut = lock ?? releaseBlocker(league, player);
  const rs = lock ?? restructureBlocker(league, player);
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <button className="btn btn-sm" disabled={!!rs} title={rs ?? 'Convert salary to bonus for cap room now'} onClick={() => setOpen('restructure')}>
        Restructure
      </button>
      <button className="btn btn-sm" disabled={!!cut} title={cut ?? 'Preview the dead money before releasing'} onClick={() => setOpen('release')}>
        Release
      </button>
      {open === 'release' && <ReleaseDialog league={league} player={player} onClose={() => setOpen(null)} />}
      {open === 'restructure' && <RestructureDialog league={league} player={player} onClose={() => setOpen(null)} />}
    </span>
  );
}

// ───────── 5-year cap chart ─────────

const SERIES = [
  { key: 'active', label: 'Player contracts', cls: 'cap-active' },
  { key: 'dead', label: 'Dead money', cls: 'cap-dead' },
  { key: 'voids', label: 'Void-year bonus (future dead money)', cls: 'cap-void' },
] as const;

/** Stacked columns of committed cap per league year against the (projected) cap line. */
export function CapChart({ league, teamId }: { league: League; teamId: number }) {
  const rows = capProjection(league, teamId).map((r) => ({ season: r.season, cap: r.cap + r.carryover, active: r.active - r.voidCharges, dead: r.dead, voids: r.voidCharges, used: r.used, space: r.space, players: r.players }));
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  // Draw at the container's real width so axis text stays a readable 11px at any size.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  const H = 230;
  const pad = { l: 48, r: 12, t: 14, b: 28 };
  const top = Math.max(...rows.map((r) => Math.max(r.cap, r.used))) * 1.08;
  const tickStep = top > 400_000 ? 100_000 : 50_000;
  const ticks = Array.from({ length: Math.floor(top / tickStep) + 1 }, (_, i) => i * tickStep);
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / rows.length;
  const barW = Math.min(24 * 1.6, band * 0.5);
  const x = (i: number) => pad.l + band * i + band / 2;

  return (
    <div className="cap-chart">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="legend" role="list">
          {SERIES.map((s) => (
            <span key={s.key} role="listitem" className="legend-item">
              <i className={`swatch ${s.cls}`} aria-hidden="true" />
              {s.label}
            </span>
          ))}
          <span role="listitem" className="legend-item">
            <i className="swatch-line" aria-hidden="true" />
            Salary cap (projected after {league.season})
          </span>
        </div>
        <button className="btn btn-sm btn-ghost" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>
      {asTable ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Season</th>
                <th className="num">Cap</th>
                <th className="num">Contracts</th>
                <th className="num">Dead</th>
                <th className="num">Void bonus</th>
                <th className="num">Space</th>
                <th className="num">Players signed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.season}>
                  <td className="num">{r.season}</td>
                  <td className="num">{money(Math.round(r.cap))}</td>
                  <td className="num">{money(Math.round(r.active))}</td>
                  <td className="num">{money(Math.round(r.dead))}</td>
                  <td className="num">{money(Math.round(r.voids))}</td>
                  <td className="num">{money(Math.round(r.space))}</td>
                  <td className="num">{r.players}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" ref={wrapRef}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Cap commitments for the next five league years">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
                  {t === 0 ? '0' : `$${t / 1000}M`}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              let acc = 0;
              const segs = SERIES.map((s) => {
                const v = r[s.key];
                const seg = { s, y0: acc, y1: acc + v };
                acc += v;
                return seg;
              }).filter((g) => g.y1 - g.y0 > 0);
              return (
                <g key={r.season}>
                  {segs.map((g, k) => {
                    const isTop = k === segs.length - 1;
                    const yTop = y(g.y1);
                    // 2px surface gap between stacked segments.
                    const h = Math.max(0, y(g.y0) - yTop - (k > 0 ? 2 : 0));
                    const r4 = isTop ? Math.min(4, h) : 0;
                    const x0 = x(i) - barW / 2;
                    const d = `M${x0},${yTop + h}V${yTop + r4}Q${x0},${yTop} ${x0 + r4},${yTop}H${x0 + barW - r4}Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r4}V${yTop + h}Z`;
                    return <path key={g.s.key} d={d} className={g.s.cls} />;
                  })}
                  <line x1={x(i) - band * 0.42} x2={x(i) + band * 0.42} y1={y(r.cap)} y2={y(r.cap)} className="cap-line" />
                  <text x={x(i)} y={H - 8} textAnchor="middle" className="axis">
                    {r.season}
                  </text>
                  <rect
                    x={x(i) - band / 2}
                    y={pad.t}
                    width={band}
                    height={H - pad.t - pad.b}
                    className="hit"
                    tabIndex={0}
                    aria-label={`${r.season}: ${money(Math.round(r.used))} committed of ${money(Math.round(r.cap))}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover), 110), W - 110) }}>
              <b>{rows[hover].season}</b>
              <span>Cap {money(Math.round(rows[hover].cap))}</span>
              {SERIES.map((s) => (
                <span key={s.key}>
                  <i className={`swatch ${s.cls}`} aria-hidden="true" /> {s.label}: {money(Math.round(rows[hover][s.key]))}
                </span>
              ))}
              <span>
                Space <b>{money(Math.round(rows[hover].space))}</b> · {rows[hover].players} signed
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const capPct = (league: League, amount: number) => `${((amount / capFor(league, league.season)) * 100).toFixed(1)}%`;
