/**
 * Injuries on screen: status pills, condition and risk for roster rows, and the health section of
 * the player card. An injury and its estimate are public (the league's injury report); condition is
 * your own staff's number, so it shows for your players only; injury risk is a read in words (your
 * medical staff's for your players, your scouts' for everyone else), never the hidden trait.
 */
import {
  activateFromIr,
  activateProblem,
  estimateText,
  injectProblem,
  injuryLabel,
  injuryRisk,
  injuryTag,
  IR_MIN_WEEKS,
  IR_RETURNS,
  irProblem,
  irReturnsUsed,
  placeOnIr,
  playThrough,
  SEVERITY_LABEL,
  weeksLeft,
  type InjuryRiskRead,
} from '../engine/injuries';
import { ATTRIBUTE_INFO } from '../engine/attributes';
import type { Attribute, League, Player } from '../engine/types';
import { Section, TipPill } from './components';
import { store } from './store';

/** What `league`'s user believes about a player's injury risk. */
export const riskOf = (league: League, p: Player): InjuryRiskRead => injuryRisk(league, league.userTeamId, p);

/** A pill for a hurt player: on reserve, out for a while, or playing through it. Nothing when healthy. */
export function InjuryTag({ league, p, sub = false }: { league: League; p: Player; sub?: boolean }) {
  const tag = injuryTag(p);
  if (!tag || !p.injury) return tag === 'IR' ? <TipPill className={`tag-bad${sub ? ' name-sub' : ''}`} tip="On injured reserve: off the 53 for at least four weeks.">IR</TipPill> : null;
  const title = `${injuryLabel(p.injury.type)}: ${p.injury.injected ? 'playing through it on injections' : estimateText(p.injury, weeksLeft(league))}${p.ir ? ' · on injured reserve' : ''}`;
  return (
    <TipPill className={`${p.injury.injected ? 'tag-warn' : 'tag-bad'}${sub ? ' name-sub' : ''}`} tip={`${title}.`}>
      {tag}
    </TipPill>
  );
}

/** A coloured dot for an injury-risk read: green, amber, red; hollow when it's early word. */
export function RiskDot({ read }: { read: InjuryRiskRead }) {
  if (!read.known) return <span className="muted small">–</span>;
  const label = `Injury risk: ${read.tier.toLowerCase()}${read.hedged ? ' (early word)' : ''}`;
  return <span className={`risk-dot risk-${read.tier.toLowerCase()}${read.hedged ? ' risk-early' : ''}`} role="img" aria-label={label} title={label} />;
}

/** Condition band: fresh, a little worn, worn down. */
export const conditionTone = (c: number) => (c >= 90 ? 'tone-good' : c < 78 ? 'tone-bad' : undefined);

/** The roster's fitness cell: condition (your own players) and the injury-risk dot. */
export function FitnessCell({ league, p }: { league: League; p: Player }) {
  const mine = p.teamId === league.userTeamId;
  const c = Math.round(p.condition ?? 100);
  return (
    <span className="fitness-cell">
      {mine ? (
        <b className={`num ${conditionTone(c) ?? ''}`} title="Match condition: a game takes some, a week of rest brings most of it back">
          {c}%
        </b>
      ) : null}
      <RiskDot read={riskOf(league, p)} />
    </span>
  );
}

/** What a scar cost him: points for your own players (their ratings are open to you), words for anyone else's. */
function scarText(scar: Partial<Record<Attribute, number>>, exact: boolean): string {
  const parts = (Object.entries(scar) as [Attribute, number][]).map(([a, n]) => `${exact ? (n > 1 ? `${n} points of ` : 'a point of ') : 'some '}${ATTRIBUTE_INFO[a].label.toLowerCase()}`);
  return `cost him ${parts.join(' and ')} for good`;
}

/** The health section of a player card: what he has, how long, his risk, his history, and your moves. */
export function HealthSection({ league, player: p }: { league: League; player: Player }) {
  const mine = p.teamId === league.userTeamId;
  const risk = riskOf(league, p);
  const inj = p.injury;
  const history = [...(p.injuries ?? [])].reverse();
  const irBlock = mine ? irProblem(league, p) : 'not yours';
  const activateBlock = mine && p.ir ? activateProblem(league, p) : null;
  const injectBlock = mine ? injectProblem(p) : 'not yours';
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  return (
    <Section id="health" title="Health" className="health">
      <div className="facts">
        <span className="fact">
          <span className="eyebrow">Status</span>
          {inj ? (
            <span className="tone-bad">
              {injuryLabel(inj.type)} <span className="muted small">· {SEVERITY_LABEL[inj.severity]}</span>
            </span>
          ) : p.ir ? (
            <span>Healthy, on injured reserve</span>
          ) : (
            <span className="tone-good">Healthy</span>
          )}
        </span>
        {inj && (
          <span className="fact">
            <span className="eyebrow">Outlook</span>
            <span>{inj.injected ? 'Playing through it on injections' : estimateText(inj, weeksLeft(league))}</span>
          </span>
        )}
        {p.ir && (
          <span className="fact">
            <span className="eyebrow">Injured reserve</span>
            <span>
              {p.ir.weeks} week{p.ir.weeks === 1 ? '' : 's'} served <span className="muted small">· {IR_MIN_WEEKS} minimum</span>
            </span>
          </span>
        )}
        {mine && (
          <span className="fact">
            <span className="eyebrow">Condition</span>
            <b className={`num ${conditionTone(p.condition ?? 100) ?? ''}`}>{Math.round(p.condition ?? 100)}%</b>
          </span>
        )}
        <span className="fact">
          <span className="eyebrow">{risk.known && risk.hedged ? 'Injury risk · early word' : 'Injury risk'}</span>
          {risk.known ? (
            <span className="row" style={{ gap: 6 }}>
              <RiskDot read={risk} /> {risk.tier}
              <span className="muted small">{mine ? '· your medical staff' : '· your scouts and his injury reports'}</span>
            </span>
          ) : (
            <span className="muted">Unknown</span>
          )}
        </span>
      </div>
      {mine && !p.retired && (inj || p.ir) && (
        <div className="card-actions">
          {!p.ir && (
            <button className="btn btn-sm" disabled={!!irBlock} title={irBlock ?? `Off the 53 for at least ${IR_MIN_WEEKS} weeks: the spot is free for a replacement.`} onClick={() => store.mutate((l) => placeOnIr(l, l.players[p.id]))}>
              Place on injured reserve
            </button>
          )}
          {p.ir && (
            <button className="btn btn-sm btn-primary" disabled={!!activateBlock} title={activateBlock ?? 'Back on the 53 (uses a return designation).'} onClick={() => store.mutate((l) => activateFromIr(l, l.players[p.id]))}>
              Activate from reserve
            </button>
          )}
          {inj && !p.ir && (
            <button
              className="btn btn-sm"
              disabled={!inj.injected && !!injectBlock}
              title={inj.injected ? 'Rest him until it heals.' : injectBlock ?? 'Available now, but far likelier to get hurt, and an aggravated injury lasts much longer.'}
              onClick={() => store.mutate((l) => playThrough(l, l.players[p.id], !inj.injected))}
            >
              {inj.injected ? 'Stop the injections' : 'Play through it (injections)'}
            </button>
          )}
          {team && <span className="muted small">{IR_RETURNS - irReturnsUsed(league, team.id)} of {IR_RETURNS} return designations left this season</span>}
          {/* Why a button is greyed out, on screen: its title tooltip never shows on a phone. */}
          {[!p.ir && irBlock, p.ir && activateBlock, inj && !p.ir && !inj.injected && injectBlock].filter((why): why is string => !!why).map((why) => (
            <p key={why} className="muted small" style={{ margin: 0, flexBasis: '100%' }}>
              {why}
            </p>
          ))}
        </div>
      )}
      {history.length > 0 ? (
        <div className="table-scroll">
          <table className="injury-history">
            <thead>
              <tr>
                <th>When</th>
                <th>Injury</th>
                <th className="num">Out</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r, i) => (
                <tr key={i}>
                  <td className="num">
                    {r.season}
                    {r.week ? `, wk ${r.week}` : ''}
                  </td>
                  <td>{injuryLabel(r.type)}</td>
                  <td className="num">{r.weeks >= 30 ? 'season+' : `${r.weeks} wk`}</td>
                  <td className="muted small">{[SEVERITY_LABEL[r.severity], r.aggravated ? 'aggravated by playing through it' : '', r.scar ? scarText(r.scar, mine) : ''].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          No injuries on file.
        </p>
      )}
    </Section>
  );
}
