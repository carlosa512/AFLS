/**
 * The coaching staff: who coaches which of your rooms, whose deal is up, and who you could hire.
 * Coach ratings are public, so they show exactly; what they do for players is shown as percentages
 * against a typical staff, never as anyone's ratings (see ui/scouting.tsx for the fog of war).
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  CHAIRS,
  chairHolder,
  chairOf,
  COACH_ROLE_LABEL,
  COACH_ROOMS,
  coachAsk,
  coachBudget,
  coachesPushedOutBy,
  coachingGrades,
  coachMarket,
  coachMoveProblem,
  coachName,
  coachPayroll,
  coachResignForecast,
  coachRoomAfterResigns,
  coachSeverance,
  coachSeverancePaid,
  coachTitle,
  coachTrendLabel,
  coachValue,
  DECLINE_RANGE,
  extendCoach,
  hireCoach,
  isCoachExpiring,
  maxYears,
  previewCoachHire,
  RATE_RANGE,
  releaseCoach,
  replaceCoach,
  replaceProblem,
  replaces,
  ROOM_LABEL,
  roomEffect,
  sameChair,
  styleNotes,
  teamCoaches,
  teamScheme,
  TYPICAL,
  type Chair,
} from '../../engine/coaching';
import { kickCoaching } from '../../engine/match/lineup';
import { coachRecord, formatRecord } from '../../engine/records';
import { coachSchemeAbout, coachSchemeLabel, defenseNotes, PERSONNEL_LABEL, schemeWith } from '../../engine/schemes';
import { staffWindowOpen, type ResignOutlook } from '../../engine/staff';
import type { Coach, CoachRole, CoachRoom, League } from '../../engine/types';
import { useNav } from '../App';
import { Exact, Panel, Section, Sheet, TeamChip, TeamPicker, TipPill } from '../components';
import {
  agingTone,
  chairNoun,
  gainScore,
  growthTone,
  partLabel,
  previewLines,
  roomCounts,
  roomLabel,
  roomParts,
  signedPct,
  stayingCoaches,
  vacancyCost,
  vacancyText,
  withArticle,
  ALL_ROOMS,
  PAST_PRIME_WORDS,
  ROLE_LINE,
  coachRep,
  growthVerdict,
  agingVerdict,
  YOUNG_UNDER,
  type Room,
  type RoomCount,
} from '../coaching';
import { band, money, ordinal, PHASE_LABELS } from '../format';
import { rosterFit, StaffNum, StaffSkill } from '../scouting';
import { store } from '../store';
import { moveIndex, MoveText } from '../moves';

type RoleTab = 'head' | 'coord' | 'position' | 'sc' | 'st';
type Side = 'both' | 'offCoord' | 'defCoord';
type Sort = 'roster' | 'rated';
type Jump = 'mine' | 'candidates';
/** Where "Find a receivers coach" lands in the candidate list. */
interface Target {
  tab: RoleTab;
  room?: CoachRoom | 'any';
  side?: Side;
}

const ROLE_TABS: [RoleTab, string][] = [
  ['head', 'Head coach'],
  ['coord', 'Coordinators'],
  ['position', 'Position'],
  ['sc', 'S&C'],
  ['st', 'Special teams'],
];
const ROLES_OF: Record<RoleTab, CoachRole[]> = { head: ['headCoach'], coord: ['offCoord', 'defCoord'], position: ['positionCoach'], sc: ['strengthCoach'], st: ['stCoord'] };
const targetOf = (ch: Chair): Target =>
  ch.role === 'headCoach'
    ? { tab: 'head' }
    : ch.role === 'strengthCoach'
      ? { tab: 'sc' }
      : ch.role === 'stCoord'
        ? { tab: 'st' }
        : ch.role === 'positionCoach'
          ? { tab: 'position', room: ch.room }
          : { tab: 'coord', side: ch.role };

const LEADERSHIP: Chair[] = [{ role: 'headCoach' }, { role: 'offCoord' }, { role: 'defCoord' }];
const POSITION_ROOMS: Chair[] = COACH_ROOMS.map((room) => ({ role: 'positionCoach' as const, room }));
const CONDITIONING: Chair[] = [{ role: 'strengthCoach' }];
const SPECIAL_TEAMS: Chair[] = [{ role: 'stCoord' }];
const GROUPS: [string, Chair[]][] = [
  ['Leadership', LEADERSHIP],
  ['Position rooms', POSITION_ROOMS],
  ['Strength & conditioning', CONDITIONING],
  ['Special teams', SPECIAL_TEAMS],
];
const LIMIT = 6;
/** Half a percent: the smallest gap between the chairs' parts and the capped total that shows on a rounded screen. */
const CAP_SHOWN = 0.005;

/** One polite live region for the screen: what the last coaching move did. Moves that remove a card also say where focus should land. */
const Announce = createContext<(text: string, jump?: Jump) => void>(() => {});

/** "Head coach · 2 yrs with you": tenure rides in the subtitle so the card stays short. */
const subtitle = (league: League, c: Coach) => {
  const t = c.since === undefined ? 0 : league.season - c.since;
  const where = c.teamId === league.userTeamId || c.teamId === null ? 'you' : league.teams[c.teamId].abbrev;
  return `${coachTitle(c)}${c.since === undefined ? '' : t <= 0 ? ' · new hire' : ` · ${t} yr${t > 1 ? 's' : ''} with ${where}`}`;
};
const years = (n: number) => `${n} year${n > 1 ? 's' : ''}`;

function Trend({ age }: { age: number }) {
  const t = coachTrendLabel(age);
  return <span className={t === 'Rising' ? 'tone-good' : t === 'Declining' ? 'tone-bad' : 'muted'}>{t}</span>;
}

/** Both public ratings as a phrase: "Youth 15 · Veteran care 9", banded like every other rating. */
function Rates({ c }: { c: Pick<Coach, 'youth' | 'veterans'> }) {
  return (
    <span className="coach-rates">
      <span>
        Youth <b className={`num ${band(c.youth)}`}>{c.youth}</b>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        Veteran care <b className={`num ${band(c.veterans)}`}>{c.veterans}</b>
      </span>
    </span>
  );
}

/** What each play-calling or defensive style tag means on the field. */
const STYLE_TIP: Record<string, string> = {
  'Pass-first': 'Calls more passes than the down and distance call for.',
  'Run-first': 'Calls more runs than the down and distance call for.',
  'Aggressive on 4th down': 'Goes for it on fourth down more often than most head coaches.',
  'Conservative on 4th down': 'Punts and kicks on fourth down more often than most head coaches.',
  'Blitz-happy': 'Sends extra rushers far more often than most defenses.',
  'Rushes four': 'Rarely blitzes: rushes four and drops seven into coverage.',
  'Press man': 'Man-to-man coverage: the matchups decide more, and defenders play with their backs to the ball.',
  'Two-high shell': 'Two safeties deep: harder to beat over the top, one fewer defender near the line against the run.',
  'Stops the run first': 'Built to stop the run, giving a little up against the pass.',
  'Built for the pass': 'Built to stop the pass, giving a little up against the run.',
};

const BALANCED: Partial<Record<CoachRole, string>> = { headCoach: 'Balanced on 4th down', offCoord: 'Balanced play-calling', defCoord: 'Balanced defense' };

/**
 * A coach in a few tags: the word around the league on him as a teacher, then how he calls or builds a game
 * where it stands out: the head coach's fourth downs, the offensive coordinator's run or pass, the defensive
 * coordinator's pressure and coverage.
 */
function CoachTags({ c }: { c: Coach }) {
  const rep = coachRep(c);
  const style = c.role === 'defCoord' ? defenseNotes(c) : c.role === 'headCoach' || c.role === 'offCoord' ? styleNotes(c.style) : [];
  const balanced = !style.length ? BALANCED[c.role] : undefined;
  if (!rep.length && !style.length && !balanced) return null;
  return (
    <span className="pill-row">
      {rep.map((n) => (
        <TipPill key={n.label} className={n.tone === 'good' ? 'tag-good' : 'tag-warn'} tip={n.line}>
          {n.label}
        </TipPill>
      ))}
      {style.map((n) => (
        <TipPill key={n} tip={STYLE_TIP[n] ?? n}>
          {n}
        </TipPill>
      ))}
      {balanced && <span className="muted small">{balanced}</span>}
    </span>
  );
}

/** Who does what, for the chairs a list shows: one line each, true to what the engine has them do. */
function RoleGuide({ roles }: { roles: CoachRole[] }) {
  return (
    <ul className="muted small role-guide">
      {roles.map((r) => (
        <li key={r}>
          <b>{COACH_ROLE_LABEL[r]}:</b> {ROLE_LINE[r].charAt(0).toLowerCase() + ROLE_LINE[r].slice(1)}
        </li>
      ))}
    </ul>
  );
}

/**
 * A coach's record in one line: his teams' results in the seasons he finished on their staff, with the
 * head-coaching seasons counted on their own (that's the record people quote). The seasons are on his card.
 */
function CoachRecord({ league, c }: { league: League; c: Coach }) {
  const all = coachRecord(league, c);
  if (!all.seasons.length) return null;
  const head = coachRecord(league, c, ['headCoach']);
  const main = head.seasons.length ? head : all;
  const yrs = main.seasons.length;
  const extras = [main.playoffTrips ? `${main.playoffTrips} playoff trip${main.playoffTrips > 1 ? 's' : ''}` : '', main.titles ? `${main.titles} title${main.titles > 1 ? 's' : ''}` : ''].filter(Boolean);
  return (
    <span className="small muted">
      {head.seasons.length ? 'As head coach' : 'His teams'}: {formatRecord(main.regular)} ({yrs} season{yrs > 1 ? 's' : ''})
      {main.playoffs.w + main.playoffs.l ? `, ${main.playoffs.w}–${main.playoffs.l} playoffs` : ''}
      {extras.length ? ` · ${extras.join(', ')}` : ''}
    </span>
  );
}

/** Every season a coach finished on a staff, newest first, with his team's record. */
function CareerTable({ league, c }: { league: League; c: Coach }) {
  return (
    <div className="table-scroll">
      <table className="small">
        <thead>
          <tr>
            <th className="num">Season</th>
            <th>Team</th>
            <th>Job</th>
            <th className="num">Record</th>
            <th>Playoffs</th>
          </tr>
        </thead>
        <tbody>
          {coachRecord(league, c).seasons.map((s) => (
            <tr key={s.season}>
              <td className="num">{s.season}</td>
              <td>{league.teams[s.teamId].abbrev}</td>
              <td>{coachTitle(s)}</td>
              <td className="num">{formatRecord(s.regular)}</td>
              <td className={s.champion ? 'tone-good' : 'muted'}>{s.playoffs ? `${s.finish} (${s.playoffs.w}–${s.playoffs.l})` : s.finish || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A coach's name that opens his card. */
function CoachLink({ c, className }: { c: Coach; className?: string }) {
  const nav = useNav();
  return (
    <button className={`linklike ${className ?? ''}`.trim()} onClick={() => nav.openStaff('coach', c.id)}>
      {coachName(c)}
    </button>
  );
}

/** A coach's full card, like a player's: his ratings, what he runs, his deal and every season he has coached. */
export function CoachCard({ league, coach: c, onClose }: { league: League; coach: Coach; onClose: () => void }) {
  const nav = useNav();
  const team = c.teamId !== null ? league.teams[c.teamId] : null;
  const coached = coachRecord(league, c).seasons.length > 0;
  return (
    <Sheet
      label={coachName(c)}
      team={team}
      onClose={onClose}
      head={
        <>
          {team && <TeamChip team={team} large />}
          <div style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.85, fontSize: 'var(--step--1)' }}>
              {coachTitle(c)}
              {team ? ` · ${team.city} ${team.name}` : ' · On the market'}
            </span>
            <h2 style={{ fontSize: 'var(--step-3)' }}>{coachName(c)}</h2>
          </div>
        </>
      }
    >
      <div className="facts">
        <StaffSkill label="Youth development" value={c.youth} />
        <StaffSkill label="Veteran care" value={c.veterans} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{c.age}</b> <Trend age={c.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">{c.contract ? 'Salary' : 'Status'}</span>
          {c.contract ? (
            <span className="staff-age">
              <b className="num">{money(c.contract.salary)}</b> <span className="muted small">thru {c.contract.through}</span>
            </span>
          ) : (
            <span>Free agent</span>
          )}
        </span>
        {team && c.since !== undefined && (
          <span className="fact">
            <span className="eyebrow">With {team.abbrev} since</span>
            <b className="num">{c.since}</b>
          </span>
        )}
      </div>
      <SchemeRow league={league} c={c} preview={c.teamId === null} />
      <CoachTags c={c} />
      <p className="muted small" style={{ margin: 0 }}>
        {ROLE_LINE[c.role]}
      </p>
      {c.lastJob && (
        <p className="muted small" style={{ margin: 0 }}>
          Last job: {c.lastJob}
        </p>
      )}
      <Section id="coach-career" title="Career">
        {coached ? (
          <>
            <CoachRecord league={league} c={c} />
            <CareerTable league={league} c={c} />
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            No finished seasons on a staff yet.
          </p>
        )}
      </Section>
      {c.teamId === null && (
        <Section id="staff-hire" title="If you hire him">
          <div className="small staff-preview">
            {previewLines(previewCoachHire(league, league.userTeamId, c, 2)).map((l) => (
              <span key={l.words} className="preview-line">
                {l.numbers ? <Exact numbers={l.numbers}>{l.words}</Exact> : l.words}
              </span>
            ))}
            <span className="preview-line muted">On a 2-year deal; takes effect at next year’s development.</span>
          </div>
        </Section>
      )}
      {team && (
        <div>
          <button
            className="btn btn-sm"
            onClick={() => {
              onClose();
              nav.openTeam(team.id);
            }}
          >
            View {team.name} roster
          </button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * A coordinator's scheme: the pill, and (unless compact) what it means and, for someone you could hire,
 * how your current starters would fit it.
 */
function SchemeRow({ league, c, compact = false, preview = false }: { league: League; c: Coach; compact?: boolean; preview?: boolean }) {
  if (c.role === 'stCoord') return <KickRow c={c} compact={compact} />;
  const label = coachSchemeLabel(c);
  if (!label) return null;
  const about = coachSchemeAbout(c);
  const side = c.role === 'offCoord' ? 'offense' : 'defense';
  const scheme = schemeWith(teamScheme(league, league.userTeamId), c);
  const fit = preview ? rosterFit(league, league.userTeamId, scheme, side) : null;
  return (
    <span className="scheme-row">
      <TipPill className="scheme-pill" tip={about ?? label}>
        {label}
        {c.role === 'offCoord' && scheme.offense.personnel !== '11' ? ` · ${scheme.offense.personnel} personnel` : ''}
      </TipPill>
      {!compact && about && <span className="muted small">{c.role === 'offCoord' ? `${PERSONNEL_LABEL[scheme.offense.personnel]}. ` : ''}{about}</span>}
      {fit && fit.asked > 0 && (
        <span className={`small${fit.poor > fit.good ? ' tone-bad' : fit.good > fit.asked / 2 ? ' tone-good' : ''}`}>
          Your {side}: {fit.good} of {fit.asked} starters fit his scheme well{fit.poor ? `, ${fit.poor} poorly` : ''}.
        </span>
      )}
    </span>
  );
}

function Term({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="seg seg-sm" role="group" aria-label={label}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button key={n} aria-pressed={value === n} onClick={() => onChange(n)}>
          {n} yr
        </button>
      ))}
    </div>
  );
}

// ───────── your coaches ─────────

function Member({ league, c, open, outlook }: { league: League; c: Coach; open: boolean; outlook?: ResignOutlook }) {
  const teamId = league.userTeamId;
  // Another club's coach: the same card to read, without the deal notes and buttons (those are his club's).
  const theirs = c.teamId !== league.userTeamId;
  const expiring = !theirs && isCoachExpiring(league, c);
  const [term, setTerm] = useState(2);
  // Dismissing someone under contract costs real money: ask once more.
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const backToDismiss = useRef(false);
  // The button that was pressed unmounts either way: follow focus to the confirm step, and back to Dismiss on "Keep him".
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (backToDismiss.current) {
      backToDismiss.current = false;
      dismissRef.current?.focus();
    }
  }, [confirming]);
  const announce = useContext(Announce);
  const name = coachName(c);
  const releaseProblem = coachMoveProblem(league, teamId, c, 'release');
  const extendProblem = expiring ? coachMoveProblem(league, teamId, c, 'extend', term) : null;
  const pay = coachSeverance(league, c);
  const why = expiring ? extendProblem : releaseProblem;
  const taker = expiring ? replaces(league, teamId, c) : null;
  const ask2 = coachAsk(league, c, 2);
  return (
    <li className={`staff-card coach-card${expiring ? ' expiring' : ''}`}>
      <div className="staff-head">
        <div>
          <CoachLink c={c} className="staff-name" />
          <span className="muted small">{subtitle(league, c)}</span>
        </div>
        {expiring && <span className="tag-pill tag-warn">Deal up</span>}
      </div>
      <div className="facts">
        <StaffSkill label="Youth development" value={c.youth} />
        <StaffSkill label="Veteran care" value={c.veterans} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{c.age}</b> <Trend age={c.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Salary</span>
          <span className="staff-age">
            <b className="num">{money(c.contract?.salary ?? 0)}</b> <span className="muted small">thru {c.contract?.through}</span>
          </span>
        </span>
      </div>
      <SchemeRow league={league} c={c} compact />
      <CoachTags c={c} />
      {theirs ? null : expiring ? (
        <>
          <p className="small staff-note">
            {outlook === 'budget'
              ? `Deal up: he leaves when free agency opens. Your coaching budget can't cover his ask of ${money(ask2)} a year for 2 years.`
              : outlook === 'chair'
                ? `Deal up: he leaves when free agency opens. ${taker ? `${coachName(taker)} now holds` : 'Someone else now holds'} the ${coachTitle(c).toLowerCase()} chair.`
                : `Deal up: re-signs for 2 years at ${money(ask2)} a year when free agency opens unless you let him go.`}
          </p>
          <div className="staff-actions">
            <button
              className="btn btn-sm"
              aria-label={`Let go, ${name}`}
              disabled={!!releaseProblem}
              title={releaseProblem ?? undefined}
              onClick={() => {
                store.mutate((l) => releaseCoach(l, l.userTeamId, c.id));
                announce(`Let ${name} go.`, 'mine');
              }}
            >
              Let go
            </button>
            <Term value={term} max={maxYears(c.role)} onChange={setTerm} label={`Extension length for ${name}`} />
            <button
              className="btn btn-sm btn-primary"
              aria-label={`Extend · ${money(coachAsk(league, c, term))}/yr, ${name} for ${years(term)}`}
              disabled={!!extendProblem}
              title={extendProblem ?? undefined}
              onClick={() => {
                store.mutate((l) => extendCoach(l, l.userTeamId, c.id, term));
                // The Extend button goes away with the deal: land on the section, not on the page.
                announce(`Extended ${name} for ${years(term)}.`, 'mine');
              }}
            >
              Extend · {money(coachAsk(league, c, term))}/yr
            </button>
          </div>
        </>
      ) : (
        <div className="staff-actions">
          {confirming ? (
            <>
              <button
                ref={confirmRef}
                className="btn btn-sm btn-danger"
                onClick={() => {
                  store.mutate((l) => releaseCoach(l, l.userTeamId, c.id));
                  announce(`Dismissed ${name}; ${money(pay)} severance booked.`, 'mine');
                }}
              >
                Pay {money(pay)} and dismiss {c.firstName}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  backToDismiss.current = true;
                  setConfirming(false);
                }}
              >
                Keep him
              </button>
            </>
          ) : (
            <button
              ref={dismissRef}
              className="btn btn-sm"
              aria-label={`Dismiss${pay > 0 ? ` · ${money(pay)} severance` : ''}, ${name}`}
              disabled={!!releaseProblem}
              title={releaseProblem ?? undefined}
              onClick={() => {
                if (pay > 0) return setConfirming(true);
                store.mutate((l) => releaseCoach(l, l.userTeamId, c.id));
                announce(`Dismissed ${name}.`, 'mine');
              }}
            >
              Dismiss{pay > 0 ? ` · ${money(pay)} severance` : ''}
            </button>
          )}
        </div>
      )}
      {!theirs && open && why && <p className="small muted staff-why">{why}</p>}
    </li>
  );
}

/** An empty chair at another club: just that it's empty. */
function TheirOpenChair({ chair }: { chair: Chair }) {
  return (
    <li className="staff-card vacant coach-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">Open chair</b>
          <span className="muted small">{coachTitle(chair)}</span>
        </div>
      </div>
    </li>
  );
}

function OpenChair({ chair, staying, leaving, onFind }: { chair: Chair; staying: readonly Coach[]; leaving?: Coach; onFind: () => void }) {
  return (
    <li className="staff-card vacant coach-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">Open chair</b>
          <span className="muted small">{coachTitle(chair)}</span>
        </div>
      </div>
      <p className="small staff-note">
        {leaving ? `${coachName(leaving)} leaves. ` : ''}
        {vacancyText(staying, chair)}
      </p>
      <div className="staff-actions">
        <button className="btn btn-sm" onClick={onFind}>
          Find {withArticle(chairNoun(chair))}
        </button>
      </div>
    </li>
  );
}

/**
 * A special teams coordinator on game day, against a typical one: his kick units' flags and the yards they
 * win on returns and in coverage. The engine's own numbers (`kickCoaching`), rounded.
 */
function KickRow({ c, compact }: { c: Coach; compact: boolean }) {
  const fx = kickCoaching(coachValue(c) - TYPICAL);
  const flags = Math.round(100 * (1 - fx.flags));
  const yards = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
  const flagText = flags === 0 ? 'as many flags as most' : `${Math.abs(flags)}% ${flags > 0 ? 'fewer' : 'more'} flags`;
  return (
    <span className="scheme-row">
      <TipPill className="scheme-pill" tip="Against a typical special teams coordinator: his kick units' flags, and the yards they win on each return and give up on each kick they cover.">
        Kick units: {flagText}
      </TipPill>
      <span className="muted small">
        {yards(fx.kickoff)} yds a kickoff{compact ? '' : ' return'}, {yards(fx.punt)} a punt{compact ? '' : ' return; as much again in coverage'}
      </span>
    </span>
  );
}

// ───────── who coaches your players ─────────

function RoomRow({ league, room, staying, count, expanded, onToggle }: { league: League; room: Room; staying: readonly Coach[]; count: RoomCount; expanded: boolean; onToggle: () => void }) {
  const id = useId();
  // Kickers and punters are the special teams coordinator's room.
  const chair: Chair = room ? { role: 'positionCoach', room } : { role: 'stCoord' };
  const coach = chairHolder(staying, chair);
  // His deal is up and he doesn't stay: the room is empty come next year.
  const leaving = teamCoaches(league, league.userTeamId).find((c) => sameChair(chairOf(c), chair) && isCoachExpiring(league, c) && !staying.includes(c));
  const effect = roomEffect(staying, room);
  const parts = roomParts(staying, room);
  // The engine caps the combined effect; the chairs' parts are uncapped, so an extreme staff's parts can add up to more.
  const cutGrowth = effect.growth - parts.reduce((n, p) => n + p.growth, 0);
  const cutAging = effect.aging - parts.reduce((n, p) => n + p.aging, 0);
  const capped = [
    Math.abs(cutGrowth) >= CAP_SHOWN ? `${signedPct((cutGrowth < 0 ? RATE_RANGE[1] : RATE_RANGE[0]) - 1)} growth` : '',
    Math.abs(cutAging) >= CAP_SHOWN ? `${signedPct((cutAging < 0 ? DECLINE_RANGE[1] : DECLINE_RANGE[0]) - 1)} decline` : '',
  ].filter(Boolean);
  return (
    <li className="room-row">
      <button className="room-toggle" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
        <span className="room-name">
          <b>{roomLabel(room)}</b>
          <span className="muted small">
            {count.total} player{count.total === 1 ? '' : 's'} · {count.young} under {YOUNG_UNDER}
          </span>
        </span>
        <span className="room-coach">
          {coach ? (
            <>
              <b>{coachName(coach)}</b>
              <Rates c={coach} />
            </>
          ) : (
            <>
              <b className="tone-bad">Vacant</b>
              {leaving && <span className="muted small">{leaving.lastName}’s deal is up and he leaves</span>}
            </>
          )}
        </span>
        <span className="room-fx">
          <span className="fx">
            <span className="muted small">Young players</span> <b className={growthVerdict(effect.growth).tone}>{growthVerdict(effect.growth).word}</b>
          </span>
          <span className="fx">
            <span className="muted small">Veterans</span> <b className={agingVerdict(effect.aging).tone}>{agingVerdict(effect.aging).word}</b>
          </span>
        </span>
        <span className="room-chev" aria-hidden="true">
          {expanded ? '▴' : '▾'}
        </span>
      </button>
      {expanded && (
        <div id={id} className="room-detail">
          <div className="table-scroll">
            <table className="parts-table">
              <thead>
                <tr>
                  <th>Who counts</th>
                  <th className="num">Growth</th>
                  <th className="num">Decline</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.source}>
                    <td>
                      {partLabel(p)}
                      <span className="muted small part-who">{p.coach ? coachName(p.coach) : 'Vacant'}</span>
                    </td>
                    <td className={`num ${growthTone(p.growth)}`}>{signedPct(p.growth)}</td>
                    <td className={`num ${agingTone(p.aging)}`}>{signedPct(p.aging)}</td>
                  </tr>
                ))}
                {capped.length > 0 && (
                  <tr>
                    <td>
                      Capped at {capped.join(' / ')}
                      <span className="muted small part-who">More rating buys nothing past the cap.</span>
                    </td>
                    <td className="num muted">{Math.abs(cutGrowth) >= CAP_SHOWN ? signedPct(cutGrowth) : ''}</td>
                    <td className="num muted">{Math.abs(cutAging) >= CAP_SHOWN ? signedPct(cutAging) : ''}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Together</th>
                  <td className={`num ${growthTone(effect.growth)}`}>{signedPct(effect.growth)}</td>
                  <td className={`num ${agingTone(effect.aging)}`}>{signedPct(effect.aging)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted small room-detail-note">
            {room === null
              ? 'The special teams coordinator coaches the kickers and punters, with the head coach and the S&C coach beside him.'
              : 'A position coach counts most for his room, a coordinator for his side of the ball, the head coach a little for everyone, and the S&C coach most for the body.'}{' '}
            {count.young} of these players {count.young === 1 ? 'is' : 'are'} under {YOUNG_UNDER} (growth) and {count.old} {count.old === 1 ? 'is' : 'are'} {PAST_PRIME_WORDS} (decline). The exact figures, against a typical staff, rounded.
          </p>
        </div>
      )}
    </li>
  );
}

// ───────── candidates ─────────

function Candidate({ league, c, open }: { league: League; c: Coach; open: boolean }) {
  const teamId = league.userTeamId;
  const [term, setTerm] = useState(2);
  const holder = replaces(league, teamId, c);
  const problem = holder ? replaceProblem(league, teamId, c, term) : coachMoveProblem(league, teamId, c, 'hire', term);
  // Replacing a man under contract dismisses him and books severance: the first tap asks, like Dismiss does.
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  const backToReplace = useRef(false);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (backToReplace.current) {
      backToReplace.current = false;
      replaceRef.current?.focus();
    }
  }, [confirming]);
  // Hiring now can cost an expiring man his re-signing: his chair or his money goes to the new hire.
  const pushed = problem ? [] : coachesPushedOutBy(league, teamId, c, term);
  const announce = useContext(Announce);
  const name = coachName(c);
  const ask = coachAsk(league, c, term);
  const sev = holder ? coachSeverance(league, holder) : 0;
  // Only while the move is still allowed: if the money or the chair changes underneath, the question goes with it.
  const asking = confirming && !!holder && !problem;
  const doHire = () => {
    store.mutate((l) => (holder ? replaceCoach(l, l.userTeamId, c.id, term) : hireCoach(l, l.userTeamId, c.id, term)));
    announce(`${holder ? `Replaced ${coachName(holder)} with` : 'Hired'} ${name}${holder && sev > 0 ? `; ${money(sev)} severance booked` : ''}.`, 'candidates');
  };
  return (
    <li className="staff-card coach-card">
      <div className="staff-head">
        <div>
          <CoachLink c={c} className="staff-name" />
          <span className="muted small">{coachTitle(c)}</span>
        </div>
      </div>
      <div className="facts">
        <StaffSkill label="Youth development" value={c.youth} />
        <StaffSkill label="Veteran care" value={c.veterans} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{c.age}</b> <Trend age={c.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Asks</span>
          <span className="staff-age">
            <b className="num">{money(ask)}</b> <span className="muted small">
              / yr for {term} {term === 1 ? 'yr' : 'yrs'}
            </span>
          </span>
        </span>
      </div>
      <SchemeRow league={league} c={c} compact />
      <CoachTags c={c} />
      {holder && (
        <p className="small staff-why muted">
          {/* The ratings box wraps as a unit, so no bracket is left dangling at the end of a line. */}
          Replaces {coachName(holder)} — <Rates c={holder} />. {sev > 0 ? `${money(sev)} severance books against this year’s coaching budget.` : 'No severance.'}
        </p>
      )}
      {pushed.length > 0 && <p className="small tone-bad staff-preview">Hiring him means {pushed.map(coachName).join(' and ')} won’t be re-signed.</p>}
      <div className="staff-actions">
        <Term
          value={term}
          max={maxYears(c.role)}
          onChange={(n) => {
            setTerm(n);
            setConfirming(false);
          }}
          label={`Contract length for ${name}`}
        />
        {asking ? (
          <>
            <button
              ref={confirmRef}
              className="btn btn-sm btn-danger"
              aria-label={`Pay ${money(sev)} severance and replace ${holder!.lastName}, hiring ${name} for ${years(term)} at ${money(ask)} a year`}
              onClick={doHire}
            >
              Pay {money(sev)} severance and replace {holder!.lastName}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                backToReplace.current = true;
                setConfirming(false);
              }}
            >
              Keep him
            </button>
          </>
        ) : (
          <button
            ref={replaceRef}
            className="btn btn-sm btn-primary"
            aria-label={
              holder
                ? `Replace ${holder.lastName} · ${money(ask)}/yr, hire ${name} for ${years(term)}${sev > 0 ? `, then confirm ${money(sev)} severance for ${coachName(holder)}` : ''}`
                : `Hire · ${money(ask)}/yr, ${name} for ${years(term)}`
            }
            disabled={!!problem}
            title={problem ?? undefined}
            onClick={() => (holder && sev > 0 ? setConfirming(true) : doHire())}
          >
            {holder ? `Replace ${holder.lastName}` : 'Hire'} · {money(ask)}/yr
          </button>
        )}
      </div>
      {open && problem && <p className="small muted staff-why">{problem}</p>}
    </li>
  );
}

// ───────── around the league ─────────

/** "12 / 9": youth development / veteran care, for a table. */
function RatePair({ c }: { c: Coach }) {
  return (
    <span className="small muted num">
      <StaffNum value={c.youth} /> / <StaffNum value={c.veterans} />
    </span>
  );
}

function Rival({ league, c }: { league: League; c: Coach | null }) {
  if (!c) return <span className="tone-bad small">Vacant</span>;
  return (
    <span className="lc-cell">
      <CoachLink c={c} />
      <RatePair c={c} />
      <SchemeRow league={league} c={c} compact />
      <CoachTags c={c} />
    </span>
  );
}

// ───────── the screen ─────────

export function CoachesScreen({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const open = staffWindowOpen(league);
  const mine = teamCoaches(league, teamId);
  const staying = stayingCoaches(league, teamId);
  const forecast = coachResignForecast(league, teamId);
  const counts = roomCounts(league, teamId);
  const [tab, setTab] = useState<RoleTab>('position');
  const [room, setRoom] = useState<CoachRoom | 'any'>('any');
  const [side, setSide] = useState<Side>('both');
  const [sort, setSort] = useState<Sort>('roster');
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');
  // Whose staff the staff panel shows: yours, or any club's to look at.
  const [viewTeam, setViewTeam] = useState(league.userTeamId);
  const candidatesRef = useRef<HTMLDivElement>(null);
  const candidatesHeading = useRef<HTMLHeadingElement>(null);
  const mineRef = useRef<HTMLDivElement>(null);
  const mineHeading = useRef<HTMLHeadingElement>(null);

  const calm = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** Scroll to a section and put keyboard and screen-reader users at its start, not back on the button they pressed. */
  const goTo = (box: RefObject<HTMLDivElement | null>, heading: RefObject<HTMLHeadingElement | null>) => {
    box.current?.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
    heading.current?.focus({ preventScroll: true });
  };
  const showCandidates = (t: Target) => {
    setTab(t.tab);
    setRoom(t.room ?? 'any');
    setSide(t.side ?? 'both');
    setShowAll(false);
    goTo(candidatesRef, candidatesHeading);
  };
  // A card that disappears takes keyboard focus with it: land on the section's heading instead.
  const announce = (text: string, jump?: Jump) => {
    setStatus(text);
    if (jump) setTimeout(() => (jump === 'mine' ? mineHeading : candidatesHeading).current?.focus({ preventScroll: true }), 0);
  };

  const payroll = coachPayroll(league, teamId);
  const budget = coachBudget(league, teamId);
  // What's really left once the deals that are up re-sign, as they will unless let go.
  const left = coachRoomAfterResigns(league, teamId);
  const dead = coachSeverancePaid(league, teamId);
  const grades = coachingGrades(league);
  const mineGrade = grades.get(teamId)!;
  const dueCount = mine.filter((c) => isCoachExpiring(league, c)).length;
  const pct = budget > 0 ? Math.min(100, Math.max(0, (payroll / budget) * 100)) : 100;

  // ── the one next step ──
  const emptyNow = CHAIRS.filter((ch) => !chairHolder(mine, ch));
  // The chair whose loss costs the players you actually have the most (growth for the young, aging for the old).
  const costliest = (chairs: Chair[]) =>
    [...chairs]
      .map((ch) => {
        const cost = vacancyCost(staying, ch);
        const n = cost.rooms.reduce((s, r) => ({ young: s.young + (counts.get(r)?.young ?? 0), old: s.old + (counts.get(r)?.old ?? 0) }), { young: 0, old: 0 });
        return { ch, weight: cost.growth * n.young + cost.aging * n.old };
      })
      .sort((a, b) => b.weight - a.weight)[0]?.ch;
  const worstEmpty = costliest(emptyNow);
  const lostToBudget = costliest(mine.filter((c) => forecast.get(c.id) === 'budget').map(chairOf));
  const lostCoach = lostToBudget && mine.find((c) => forecast.get(c.id) === 'budget' && sameChair(chairOf(c), lostToBudget));
  let step: { text: ReactNode; button?: { label: string; go: () => void } } | null = null;
  if (open) {
    if (worstEmpty) {
      step = {
        text: (
          <>
            <b>Open chair:</b> your {chairNoun(worstEmpty)}. {vacancyText(staying, worstEmpty)}
            {emptyNow.length > 1 ? ` ${emptyNow.length - 1} more ${emptyNow.length === 2 ? 'chair is' : 'chairs are'} open below.` : ''}
          </>
        ),
        button: { label: `Find ${withArticle(chairNoun(worstEmpty))}`, go: () => showCandidates(targetOf(worstEmpty)) },
      };
    } else if (lostToBudget && lostCoach) {
      step = {
        text: (
          <>
            <b>Deal up:</b> {coachName(lostCoach)}, your {chairNoun(lostToBudget)}, leaves when free agency opens: your coaching budget can&rsquo;t cover his ask of {money(coachAsk(league, lostCoach, 2))} a year.{' '}
            {vacancyText(staying, lostToBudget)}
          </>
        ),
        button: { label: `Find ${withArticle(chairNoun(lostToBudget))}`, go: () => showCandidates(targetOf(lostToBudget)) },
      };
    } else if (dueCount > 0) {
      const stays = mine.filter((c) => forecast.get(c.id) === 'stays').length;
      step = {
        text: (
          <>
            <b>{dueCount === 1 ? 'One deal is up' : `${dueCount} deals are up`}:</b>{' '}
            {stays === dueCount ? `${dueCount === 1 ? 'he re-signs' : 'they re-sign'} for 2 years automatically unless you let ${dueCount === 1 ? 'him' : 'them'} go.` : 'extend the ones you want, or let them go.'}
          </>
        ),
        button: { label: 'Review deals', go: () => goTo(mineRef, mineHeading) },
      };
    } else {
      // The best affordable hire for the roster you actually have.
      const best = coachMarket(league)
        .map((c) => {
          const holder = replaces(league, teamId, c);
          return { c, holder, problem: holder ? replaceProblem(league, teamId, c, 2) : coachMoveProblem(league, teamId, c, 'hire', 2) };
        })
        .filter((x) => !x.problem)
        .map((x) => ({ ...x, changes: previewCoachHire(league, teamId, x.c, 2) }))
        .map((x) => ({ ...x, score: gainScore(x.changes, counts) }))
        .sort((a, b) => b.score - a.score)[0];
      step =
        best && best.score >= 0.15
          ? {
              text: (
                <>
                  <b>Biggest upgrade:</b> {coachName(best.c)} as {chairNoun(chairOf(best.c))}
                  {best.holder ? `, instead of ${coachName(best.holder)}` : ''}. {previewLines(best.changes)[0].words}
                </>
              ),
              button: { label: 'Show him', go: () => showCandidates(targetOf(chairOf(best.c))) },
            }
          : { text: <>Your staff is in good shape: nobody you can afford would clearly improve it.</> };
    }
  }

  // ── candidates ──
  const wanted = coachMarket(league).filter((c) => ROLES_OF[tab].includes(c.role) && (tab !== 'position' || room === 'any' || c.room === room) && (tab !== 'coord' || side === 'both' || c.role === side));
  const ranked = wanted
    .map((c) => ({ c, score: sort === 'roster' ? gainScore(previewCoachHire(league, teamId, c, 2), counts) : 0, value: coachValue(c) }))
    .sort((a, b) => b.score - a.score || b.value - a.value);
  const candidates = sort === 'roster' ? ranked : [...ranked].sort((a, b) => b.value - a.value);
  const shown = showAll ? candidates : candidates.slice(0, LIMIT);
  const totals = ALL_ROOMS.reduce((s, r) => ({ young: s.young + (counts.get(r)?.young ?? 0), old: s.old + (counts.get(r)?.old ?? 0) }), { young: 0, old: 0 });

  // ── your coaches, in groups ──
  const leavers = mine.filter((c) => isCoachExpiring(league, c) && forecast.get(c.id) !== 'stays');
  const seated = (ch: Chair) => [...mine.filter((c) => sameChair(chairOf(c), ch))].sort((a, b) => Number(isCoachExpiring(league, a)) - Number(isCoachExpiring(league, b)));

  const toggleRoom = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const grade = mineGrade.grade;
  return (
    <Announce.Provider value={announce}>
      <div className="coaches">
        <p className="visually-hidden" role="status" aria-live="polite">
          {status}
        </p>
        {!open && <div className="notice">Coaching moves open in the re-sign window and free agency.</div>}

        <Panel title="Coaching staff">
          <div className="facts">
            <span className="fact">
              <span className="eyebrow">Coaching budget</span>
              <b className="num">
                {money(payroll)} / {money(budget)}
              </b>
            </span>
            <span className="fact">
              <span className="eyebrow">{dueCount > 0 ? 'Room after re-signs' : 'Room left'}</span>
              <b className={`num${left < 0 ? ' tone-bad' : ''}`}>{money(left)}</b>
            </span>
            <span className="fact">
              <span className="eyebrow">Staff</span>
              <b className="num">
                <span className={`grade grade-${grade}`}>{grade}</span> {ordinal(mineGrade.rank)} of {league.teams.length}
              </b>
            </span>
            {dead > 0 && (
              <span className="fact">
                <span className="eyebrow">Severance this year</span>
                <b className="num">{money(dead)}</b>
              </span>
            )}
          </div>
          <div className={`staff-bar${payroll > budget ? ' over' : ''}`} role="img" aria-label={`Coaching payroll is ${Math.round(pct)}% of the coaching budget`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small staff-lede">
            Coaches are paid from their own budget, not the cap{dead > 0 ? ` (${money(dead)} of this year's is severance)` : ''}. <b>Youth development</b> speeds up players under {YOUNG_UNDER}; <b>Veteran care</b> slows
            the decline of players past their prime. A coach rated {TYPICAL} is typical and changes nothing. Development runs once a year, so a new hire takes effect at next year&rsquo;s.
          </p>
          {step && (
            <div className="callout staff-next">
              <span>{step.text}</span>
              {step.button && (
                <button className="btn btn-sm" onClick={step.button.go}>
                  {step.button.label}
                </button>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Who coaches your players">
          <p className="muted small" style={{ marginTop: 0 }}>
            Against a typical staff, once the re-sign window closes. <b>Young players</b>: how fast your players under {YOUNG_UNDER} develop. <b>Veterans</b>: how well your players past their prime
            hold up. Tap a room to see who counts, with the exact figures.
          </p>
          <ul className="room-list">
            {ALL_ROOMS.map((r) => (
              <RoomRow key={r ?? 'kp'} league={league} room={r} staying={staying} count={counts.get(r)!} expanded={expanded.has(r ?? 'kp')} onToggle={() => toggleRoom(r ?? 'kp')} />
            ))}
          </ul>
        </Panel>

        <div ref={mineRef} className="staff-anchor">
          <Panel
            title={
              <h2 ref={mineHeading} tabIndex={-1}>
                {viewTeam === teamId ? 'Your coaches' : `${league.teams[viewTeam].city} ${league.teams[viewTeam].name} coaches`}
              </h2>
            }
            action={<TeamPicker league={league} value={viewTeam} onChange={setViewTeam} />}
          >
            <div className="stack coach-groups">
              {GROUPS.map(([title, chairs]) => (
                <section key={title} aria-label={title}>
                  <h3 className="coach-group-title">{title}</h3>
                  <RoleGuide roles={[...new Set(chairs.map((ch) => ch.role))]} />
                  <ul className="staff-grid">
                    {chairs.flatMap((ch) => {
                      const key = `${ch.role}-${ch.room ?? ''}`;
                      if (viewTeam !== teamId) {
                        const holder = chairHolder(teamCoaches(league, viewTeam), ch);
                        return holder ? [<Member key={holder.id} league={league} c={holder} open={false} />] : [<TheirOpenChair key={`open-${key}`} chair={ch} />];
                      }
                      const cards = seated(ch).map((c) => <Member key={c.id} league={league} c={c} open={open} outlook={forecast.get(c.id)} />);
                      if (!chairHolder(staying, ch)) {
                        const gone = leavers.find((c) => sameChair(chairOf(c), ch));
                        cards.push(<OpenChair key={`open-${key}`} chair={ch} staying={staying} leaving={gone} onFind={() => showCandidates(targetOf(ch))} />);
                      }
                      return cards;
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </Panel>
        </div>

        <div ref={candidatesRef} className="staff-anchor">
          <Panel
            title={
              <h2 ref={candidatesHeading} tabIndex={-1}>
                Candidates
              </h2>
            }
            action={
              <span className="board-sort">
                <div className="seg seg-sm coach-roles" role="group" aria-label="Candidate role">
                  {ROLE_TABS.map(([key, label]) => (
                    <button
                      key={key}
                      aria-pressed={tab === key}
                      onClick={() => {
                        setTab(key);
                        setShowAll(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === 'position' && (
                  <select
                    aria-label="Filter by room"
                    value={room}
                    onChange={(e) => {
                      setRoom(e.target.value as CoachRoom | 'any');
                      setShowAll(false);
                    }}
                  >
                    <option value="any">All rooms</option>
                    {COACH_ROOMS.map((r) => (
                      <option key={r} value={r}>
                        {ROOM_LABEL[r]}
                      </option>
                    ))}
                  </select>
                )}
                {tab === 'coord' && (
                  <select
                    aria-label="Filter by side of the ball"
                    value={side}
                    onChange={(e) => {
                      setSide(e.target.value as Side);
                      setShowAll(false);
                    }}
                  >
                    <option value="both">Both coordinators</option>
                    <option value="offCoord">Offensive</option>
                    <option value="defCoord">Defensive</option>
                  </select>
                )}
              </span>
            }
          >
            <div className="candidate-sort">
              <div className="seg seg-sm" role="group" aria-label="Rank candidates by">
                <button aria-pressed={sort === 'roster'} onClick={() => setSort('roster')}>
                  Best for your roster
                </button>
                <button aria-pressed={sort === 'rated'} onClick={() => setSort('rated')}>
                  Highest rated
                </button>
              </div>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              {sort === 'roster'
                ? `Ranked by what each hire would do for the players you have: faster growth for your ${totals.young} under ${YOUNG_UNDER}, slower decline for your ${totals.old} ${PAST_PRIME_WORDS}. It takes effect at next year’s development. Tap a name to see what he would do.`
                : 'Ranked by overall quality in the job: youth development and veteran care, weighted for what the job leans on.'}
            </p>
            <RoleGuide roles={ROLES_OF[tab]} />
            {candidates.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nobody on the market fits that filter.
              </p>
            ) : (
              <>
                <ul className="staff-grid">
                  {shown.map(({ c }) => (
                    <Candidate key={c.id} league={league} c={c} open={open} />
                  ))}
                </ul>
                {candidates.length > LIMIT && (
                  <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAll(!showAll)}>
                    {showAll ? `Show the top ${LIMIT}` : `Show all ${candidates.length}`}
                  </button>
                )}
              </>
            )}
          </Panel>
        </div>

        <AroundTheLeague league={league} grades={grades} />
      </div>
    </Announce.Provider>
  );
}

function AroundTheLeague({ league, grades }: { league: League; grades: ReturnType<typeof coachingGrades> }) {
  const teamId = league.userTeamId;
  // League-wide head coach and coordinator moves this league year (the user's own are in Cap & transactions).
  const moves = league.transactions
    .filter((t) => t.kind === 'coach' && t.season === league.season && !t.teamIds.includes(teamId))
    .slice(-12)
    .reverse();
  const names = moveIndex(league);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Panel>
      <details className="more">
        <summary>Around the league: how all {league.teams.length} coaching staffs grade</summary>
        <p className="muted small">Ratings are youth development / veteran care.</p>
        <RoleGuide roles={['headCoach', 'offCoord', 'defCoord']} />
        <div className="table-scroll">
          <table className="league-grades league-coaches">
            <thead>
              <tr>
                <th className="num">Rank</th>
                <th className="sticky-col">Team</th>
                <th>Grade</th>
                <th>Head coach</th>
                <th>Offensive coordinator</th>
                <th>Defensive coordinator</th>
              </tr>
            </thead>
            <tbody>
              {[...grades]
                .sort((a, b) => a[1].rank - b[1].rank)
                .flatMap(([id, g]) => {
                  const t = league.teams[id];
                  const staff = teamCoaches(league, id);
                  const row = (
                    <tr key={id} className={id === teamId ? 'me' : undefined}>
                      <td className="num">{g.rank}</td>
                      <td className="sticky-col">
                        {/* Tap a team for the rest of its staff: position coaches and S&C. */}
                        <button className="linklike team-inline" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
                          <TeamChip team={t} />
                          <span>
                            <span className="team-name">{t.name}</span>
                            {id === teamId && <span className="tag-pill">You</span>}
                          </span>
                          <span className="muted" aria-hidden="true">
                            {open === id ? '▴' : '▾'}
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className={`grade grade-${g.grade}`}>{g.grade}</span>
                      </td>
                      <td>
                        <Rival league={league} c={chairHolder(staff, { role: 'headCoach' })} />
                      </td>
                      <td>
                        <Rival league={league} c={chairHolder(staff, { role: 'offCoord' })} />
                      </td>
                      <td>
                        <Rival league={league} c={chairHolder(staff, { role: 'defCoord' })} />
                      </td>
                    </tr>
                  );
                  if (open !== id) return [row];
                  const rest = CHAIRS.filter((ch) => !LEADERSHIP.some((l) => sameChair(l, ch)));
                  return [
                    row,
                    <tr key={`${id}-staff`} className="team-staff-row">
                      <td colSpan={6}>
                        <ul className="team-staff">
                          {rest.map((ch) => {
                            const c = chairHolder(staff, ch);
                            return (
                              <li key={`${ch.role}-${ch.room ?? ''}`}>
                                {c ? <CoachLink c={c} /> : <span className="tone-bad">Vacant</span>}
                                <span className="muted small">{coachTitle(ch)}</span>
                                {c && <RatePair c={c} />}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    </tr>,
                  ];
                })}
            </tbody>
          </table>
        </div>
        <h3 className="coach-group-title">Head coach and coordinator moves this year</h3>
        {moves.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Quiet so far. Teams change coaches when the re-sign window closes.
          </p>
        ) : (
          <ul className="moves">
            {moves.map((m, i) => (
              <li key={i}>
                <span className="muted small">{PHASE_LABELS[m.phase]}</span>
                <span>
                  <MoveText move={m} index={names} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </Panel>
  );
}
