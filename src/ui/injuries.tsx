/**
 * Injuries on screen: status pills, condition and risk for roster rows, and the health section of
 * the player card. An injury and its estimate are public (the league's injury report); condition is
 * your own staff's number, so it shows for your players only; injury risk is a read in words (your
 * medical staff's for your players, your scouts' for everyone else), never the hidden trait.
 */
import { useState } from 'react';
import {
  activateFromIr,
  activateProblem,
  braceWait,
  concussionCount,
  concussionWindow,
  holdAfterProtocol,
  injuryLabel,
  injuryRisk,
  injuryTag,
  injuryType,
  IR_MIN_WEEKS,
  IR_RETURNS,
  irProblem,
  irReturnsUsed,
  outlookText,
  placeOnIr,
  proposeTreatment,
  SEVERITY_LABEL,
  stopTreatment,
  treatmentLabel,
  treatmentProblem,
  treatmentsFor,
  weeksLeft,
  type InjuryRiskRead,
  type TreatmentAnswer,
} from '../engine/injuries';
import { ATTRIBUTE_INFO, contestsFor } from '../engine/attributes';
import { isAvailable, playingHurt, teamPlayers } from '../engine/roster';
import type { Attribute, League, Player, TreatmentId } from '../engine/types';
import { Section, TipPill } from './components';
import { store } from './store';

/** What `league`'s user believes about a player's injury risk. */
export const riskOf = (league: League, p: Player): InjuryRiskRead => injuryRisk(league, league.userTeamId, p);

/** A pill for a hurt player: on reserve, out for a while, or playing through it. Nothing when healthy. */
export function InjuryTag({ league, p, sub = false }: { league: League; p: Player; sub?: boolean }) {
  const tag = injuryTag(p);
  if (!tag || !p.injury)
    return tag === 'IR' ? (
      <TipPill
        className={`tag-bad${sub ? ' name-sub' : ''}`}
        tip="On injured reserve: off the 53 for at least four weeks."
      >
        IR
      </TipPill>
    ) : null;
  const title = `${injuryLabel(p.injury.type)}: ${outlookText(p.injury, weeksLeft(league))}${p.ir ? ' · on injured reserve' : ''}`;
  return (
    <TipPill className={`${playingHurt(p.injury) ? 'tag-warn' : 'tag-bad'}${sub ? ' name-sub' : ''}`} tip={`${title}.`}>
      {tag}
    </TipPill>
  );
}

/** A coloured dot for an injury-risk read: green, amber, red; hollow when it's early word. */
export function RiskDot({ read }: { read: InjuryRiskRead }) {
  if (!read.known) return <span className="muted small">–</span>;
  const label = `Injury risk: ${read.tier.toLowerCase()}${read.hedged ? ' (early word)' : ''}`;
  return (
    <span
      className={`risk-dot risk-${read.tier.toLowerCase()}${read.hedged ? ' risk-early' : ''}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

/** Below this condition a healthy player is worn down: a week off brings most of it back. */
export const WORN_DOWN = 80;

/**
 * A team's hurt players, longest layoff first by the doctor's estimate (never the true weeks: even the order would
 * give the real layoff away); a healed man still on reserve last.
 */
export function hurtList(league: League, teamId: number): Player[] {
  const est = (p: Player) => (p.injury ? p.injury.estimate[1] * 100 + p.injury.estimate[0] : -1);
  return teamPlayers(league, teamId)
    .filter((p) => p.injury || p.ir)
    .sort((a, b) => est(b) - est(a));
}

/** A team's healthy players running low on condition, the most tired first. */
export function wornDown(league: League, teamId: number): Player[] {
  return teamPlayers(league, teamId)
    .filter((p) => !p.injury && !p.ir && (p.condition ?? 100) < WORN_DOWN)
    .sort((a, b) => (a.condition ?? 100) - (b.condition ?? 100));
}

/** Condition band: fresh, a little worn, worn down. */
export const conditionTone = (c: number) => (c >= 90 ? 'tone-good' : c < 78 ? 'tone-bad' : undefined);

/**
 * What a fitness column sorts by: your players by condition, anyone's by how injury-prone your read says he
 * is (never the hidden trait), the unavailable sinking to the bottom.
 */
export const fitnessSort = (league: League, p: Player) =>
  (isAvailable(p) ? 0 : -1000) +
  (p.teamId === league.userTeamId ? (p.condition ?? 100) : 0) -
  { Low: 0, Medium: 1, High: 2 }[riskOf(league, p).tier];

/** The roster's fitness cell: condition (your own players) and the injury-risk dot. */
export function FitnessCell({ league, p }: { league: League; p: Player }) {
  const mine = p.teamId === league.userTeamId;
  const c = Math.round(p.condition ?? 100);
  return (
    <span className="fitness-cell">
      {mine ? (
        <b
          className={`num ${conditionTone(c) ?? ''}`}
          title="Match condition: a game takes some, a week of rest brings most of it back"
        >
          {c}%
        </b>
      ) : null}
      <RiskDot read={riskOf(league, p)} />
    </span>
  );
}

/** What a scar cost him: points for your own players (their ratings are open to you), words for anyone else's. */
function scarText(scar: Partial<Record<Attribute, number>>, exact: boolean): string {
  const parts = (Object.entries(scar) as [Attribute, number][]).map(
    ([a, n]) =>
      `${exact ? (n > 1 ? `${n} points of ` : 'a point of ') : 'some '}${ATTRIBUTE_INFO[a].label.toLowerCase()}`,
  );
  return `cost him ${parts.join(' and ')} for good`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "catching and carrying": the ratings a brace costs him that his position actually uses. */
function costWords(p: Player, cost: Partial<Record<Attribute, number>>): string {
  const words = (Object.keys(cost) as Attribute[])
    .filter((a) => contestsFor(a, p.position).length)
    .map((a) => ATTRIBUTE_INFO[a].label.toLowerCase());
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? 'nothing he uses');
}

/** What a treatment means for him, for its button. */
function treatmentTip(p: Player, id: TreatmentId): string {
  const inj = p.injury!;
  const type = injuryType(inj.type);
  if (id === 'injection')
    return 'Available now, but far likelier to get hurt, and an aggravated injury lasts much longer.';
  if (id === 'brace' && type.brace) {
    const wait = braceWait(inj, type.brace);
    const when = wait <= 0 ? 'Available now' : `Back in about ${wait === 1 ? 'a week' : `${wait} weeks`}`;
    return `${when} in ${type.brace.gear}${type.brace.note ? `, ${type.brace.note}` : ''}: a step down on ${costWords(p, type.brace.cost)} until it heals, and likelier to make it worse.`;
  }
  return 'Back sooner, but far likelier to go again in his first weeks back.';
}

/** His answer, in a sentence. */
const answerText = (a: TreatmentAnswer) => (a.yes ? `He’s in${a.why ? `: ${a.why}` : ''}.` : `He won’t: ${a.why}.`);

/** The health section of a player card: what he has, how long, his risk, his history, and your moves. */
export function HealthSection({ league, player: p }: { league: League; player: Player }) {
  const mine = p.teamId === league.userTeamId;
  const risk = riskOf(league, p);
  const inj = p.injury;
  const type = inj ? injuryType(inj.type) : null;
  const history = [...(p.injuries ?? [])].reverse();
  const irBlock = mine ? irProblem(league, p) : 'not yours';
  const activateBlock = mine && p.ir ? activateProblem(league, p) : null;
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  const concussions = concussionCount(p);
  const lastConcussion = (p.injuries ?? []).filter((r) => r.type === 'concussion').at(-1)?.season;
  const backWeeks = concussionWindow(league, p);
  // His last answer, for this injury only (asking again gets the same one).
  const injKey = inj ? `${p.id}:${inj.season}:${inj.week}:${inj.type}` : '';
  const [asked, setAsked] = useState<{ key: string; id: TreatmentId; answer: TreatmentAnswer } | null>(null);
  const answer = asked?.key === injKey ? asked : null;
  // On reserve he can only rehab: the gear and the needle are for playing.
  const options = inj && type && !inj.treatment ? treatmentsFor(type).filter((id) => !p.ir || id === 'fastTrack') : [];
  const blocks = options.map((id) => ({
    id,
    why: treatmentProblem(p, id) ?? (answer?.id === id && !answer.answer.yes ? 'He said no.' : null),
  }));
  const ask = (id: TreatmentId) => {
    let reply: TreatmentAnswer | null = null;
    store.mutate((l) => {
      reply = proposeTreatment(l, l.players[p.id], id);
    });
    if (reply) setAsked({ key: injKey, id, answer: reply });
  };
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
            <span>
              {capital(outlookText(inj, weeksLeft(league)))}
              {type?.gear && !inj.treatment && <span className="muted small"> · back in {type.gear}</span>}
              {inj.protocol?.setbackWeek !== undefined && (
                <span className="muted small"> · a setback in week {inj.protocol.setbackWeek}</span>
              )}
              {inj.protocol?.hold && <span className="muted small"> · he sits a week once he's cleared</span>}
            </span>
          </span>
        )}
        {concussions > 0 && (
          <span className="fact">
            <span className="eyebrow">Concussions</span>
            <span>
              {concussions}
              <span className="muted small">
                {' '}
                · last in {lastConcussion}
                {backWeeks > 0 &&
                  ` · just back: a second one is likelier for ${backWeeks === 1 ? 'another week' : `${backWeeks} more weeks`}`}
              </span>
            </span>
          </span>
        )}
        {p.ir && (
          <span className="fact">
            <span className="eyebrow">Injured reserve</span>
            <span>
              {p.ir.weeks} week{p.ir.weeks === 1 ? '' : 's'} served{' '}
              <span className="muted small">· {IR_MIN_WEEKS} minimum</span>
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
              <span className="muted small">
                {mine ? '· your medical staff' : '· your scouts and his injury reports'}
              </span>
            </span>
          ) : (
            <span className="muted">Unknown</span>
          )}
        </span>
      </div>
      {mine && !p.retired && (inj || p.ir) && (
        <div className="card-actions">
          {!p.ir && (
            <button
              className="btn btn-sm"
              disabled={!!irBlock}
              title={irBlock ?? `Off the 53 for at least ${IR_MIN_WEEKS} weeks: the spot is free for a replacement.`}
              onClick={() => store.mutate((l) => placeOnIr(l, l.players[p.id]))}
            >
              Place on injured reserve
            </button>
          )}
          {p.ir && (
            <button
              className="btn btn-sm btn-primary"
              disabled={!!activateBlock}
              title={activateBlock ?? 'Back on the 53 (uses a return designation).'}
              onClick={() => store.mutate((l) => activateFromIr(l, l.players[p.id]))}
            >
              Activate from reserve
            </button>
          )}
          {inj && type && (inj.treatment === 'injection' || inj.treatment === 'brace') && (
            <button
              className="btn btn-sm"
              title="Back to resting it until it heals."
              onClick={() => store.mutate((l) => stopTreatment(l, l.players[p.id]))}
            >
              {inj.treatment === 'injection' ? 'Stop the injections' : 'Rest him instead'}
            </button>
          )}
          {inj?.protocol && !inj.protocol.shutdown && (
            <button
              className="btn btn-sm"
              title="A second concussion is twice as likely in his first two weeks back: holding him spends one of them on the sideline."
              onClick={() => store.mutate((l) => holdAfterProtocol(l.players[p.id], !inj.protocol!.hold))}
            >
              {inj.protocol.hold ? 'Play him once he’s cleared' : 'Hold him a week after he clears'}
            </button>
          )}
          {type &&
            blocks.map(({ id, why }) => (
              <button
                key={id}
                className="btn btn-sm"
                disabled={!!why}
                title={why ?? treatmentTip(p, id)}
                onClick={() => ask(id)}
              >
                {treatmentLabel(id, type)}
              </button>
            ))}
          {team && (
            <span className="muted small">
              {IR_RETURNS - irReturnsUsed(league, team.id)} of {IR_RETURNS} return designations left this season
            </span>
          )}
          {answer && (
            <p
              className={`small ${answer.answer.yes ? 'tone-good' : 'tone-bad'}`}
              style={{ margin: 0, flexBasis: '100%' }}
            >
              {answerText(answer.answer)}
            </p>
          )}
          {/* Why a button is greyed out, on screen: its title tooltip never shows on a phone. */}
          {[
            !p.ir && irBlock,
            p.ir && activateBlock,
            ...blocks
              .filter((b) => b.why !== 'He said no.')
              .map((b) => b.why && `${treatmentLabel(b.id, type!)}: ${b.why}`),
          ]
            .filter((why): why is string => !!why)
            .map((why) => (
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
                  <td className="muted small">
                    {[
                      SEVERITY_LABEL[r.severity],
                      r.aggravated ? 'aggravated by playing through it' : '',
                      r.fastTracked ? 'fast-tracked' : '',
                      r.scar ? scarText(r.scar, mine) : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
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
