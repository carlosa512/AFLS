import { liveTrees, mainMentor, standingOf, treeFor, treeOf, type TreeStanding } from '../../engine/trees';
import { managesTeam } from '../../engine/employment';
import { TeamLink } from '../components';
import { coachOverview } from '../coachOverview';
import { QUIRKS, type QuirkId } from '../../engine/quirks';
import { activeCoachQuirks, coachHabitChangeText, COACH_QUIRKS, type CoachQuirkId } from '../../engine/coachQuirks';
/**
 * The coaching staff: who coaches which of your rooms, whose deal is up, and who you could hire.
 * Coach ratings are public, so they show exactly; what they do for players is shown as percentages
 * against a typical staff, never as anyone's ratings (see ui/scouting.tsx for the fog of war).
 */
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  CHAIRS,
  chairHolder,
  chairOf,
  COACH_ROLE_LABEL,
  COACH_ROOMS,
  asPromoted,
  coachAsk,
  coachBudget,
  coachesPushedOutBy,
  coachingGrades,
  coachMarket,
  coachMoveProblem,
  coachMandate,
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
  headCoachVision,
  moveOverspend,
  ownerLeeway,
  ownerTriggerNote,
  ownerTrigger,
  promoteCoach,
  poachCoach,
  poachProblem,
  poachable,
  planUnder,
  promotionFor,
  promotionProblem,
  visionFit,
  visionNotes,
  type OwnerReason,
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
  coordinatorOf,
  coveringHeadCoach,
  setHeadCoachCover,
  interimCandidates,
  relieveProblem,
  type Cover,
} from '../../engine/coaching';
import { Icon } from '../icons';
import { SIDE_ROOMS } from '../../engine/belief';
import { relieveCoordinator } from '../../engine/relieve';
import { beliefFact } from '../../engine/roomFacts';
import { beliefStaffLine } from '../../engine/roomVoice';
import { viewContext } from '../../engine/morale';
import { kickCoaching } from '../../engine/match/lineup';
import { coachRecord, formatRecord } from '../../engine/records';
import {
  coachSchemeAbout,
  coachSchemeLabel,
  defenseLabel,
  defenseNotes,
  PERSONNEL_LABEL,
  schemeWith,
} from '../../engine/schemes';
import { staffWindowOpen, type ResignOutlook } from '../../engine/staff';
import type { Coach, CoachRole, CoachRoom, League } from '../../engine/types';
import { OFFSEASON_PHASES } from '../../engine/types';
import {
  activeLearning,
  campsToReady,
  familiarity,
  holdReason,
  isReady,
  learners,
  MAX_LEARNERS,
  passMove,
  setCoachesDecide,
  startMove,
  suggestMove,
} from '../../engine/training';
import {
  familiarityTone,
  learnLine,
  planReason,
  readyText,
  reasonText,
  roleText,
  verdictText,
  verdictTone,
} from '../training';
import { useNav } from '../App';
import {
  Dialog,
  Exact,
  gradesSortValue,
  MoreLink,
  Panel,
  PlayerLink,
  Section,
  Sheet,
  SortTh,
  sortRows,
  TeamChip,
  TeamPicker,
  TipPill,
  useSort,
  type GradesSort,
} from '../components';
import { StaffAvatar } from '../staffAvatar';
import { POSITION_NAMES } from '../../engine/positions';
import { ownerBudgetNote } from '../../engine/staff';
import { StatsTable } from './PlayerCard';
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
import { leavesOverBudget, movesClosed, reSigns } from '../staffCopy';
import { store } from '../store';
import { LinkedText, moveIndex, MoveText, type Who } from '../moves';

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
const ROLES_OF: Record<RoleTab, CoachRole[]> = {
  head: ['headCoach'],
  coord: ['offCoord', 'defCoord'],
  position: ['positionCoach'],
  sc: ['strengthCoach'],
  st: ['stCoord'],
};
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
  'Balanced play-calling': 'Balances run and pass calls.',
  'Balanced on 4th down': 'Weighs fourth-down attempts, punts and field goals.',
  'Balanced defense': 'Varies defensive calls.',
  'Run-first': 'Calls more runs than the down and distance call for.',
  'Aggressive on 4th down': 'Goes for it on fourth down more often than most head coaches.',
  'Conservative on 4th down': 'Punts and kicks on fourth down more often than most head coaches.',
  'Blitz-happy': 'Sends extra rushers far more often than most defenses.',
  'Rushes four': 'Rarely blitzes: rushes four and drops seven into coverage.',
  'Press man': 'Man coverage.',
  'Two-high shell': 'Two-high safeties.',
  'Stops the run first': 'Built to stop the run, giving a little up against the pass.',
  'Built for the pass': 'Built to stop the pass, giving a little up against the run.',
};

const BALANCED: Partial<Record<CoachRole, string>> = {
  headCoach: 'Balanced on 4th down',
  offCoord: 'Balanced play-calling',
  defCoord: 'Balanced defense',
};

/**
 * A coach in a few tags: the word around the league on him as a teacher, then how he calls or builds a game
 * where it stands out: the head coach's fourth downs, the offensive coordinator's run or pass, the defensive
 * coordinator's pressure and coverage.
 */
function CoachTags({ c }: { c: Coach }) {
  const rep = coachRep(c);
  // Only the tendency his chair owns: a head coach who used to call plays keeps his pass lean, but doesn't call them now.
  const style =
    c.role === 'defCoord'
      ? defenseNotes(c)
      : c.role === 'headCoach'
        ? styleNotes({ fourthDown: c.style?.fourthDown })
        : c.role === 'offCoord'
          ? styleNotes({ passLean: c.style?.passLean })
          : [];
  const balanced = !style.length ? BALANCED[c.role] : undefined;
  if (!rep.length && !style.length && !balanced && !Object.keys(c.quirks ?? {}).length) return null;
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
      {balanced && <TipPill tip={STYLE_TIP[balanced]}>{balanced}</TipPill>}
      {(Object.entries(c.quirks ?? {}) as [CoachQuirkId, number][])
        .filter(([id]) => COACH_QUIRKS[id])
        .map(([id, grip]) => {
          const q = COACH_QUIRKS[id];
          const active = activeCoachQuirks(c).includes(id);
          const status =
            q.role !== c.role
              ? 'Inactive in this role'
              : grip === 1
                ? 'Forming'
                : !active
                  ? 'Dormant'
                  : grip === 3
                    ? 'Ingrained'
                    : 'Established';
          return (
            <TipPill
              key={id}
              className={`${q.tone === 'good' ? 'tag-good' : q.tone === 'bad' ? 'tag-warn' : ''}${grip === 1 ? ' tag-early' : ''}${!active && (q.role !== c.role || grip >= 2) ? ' tag-inactive' : ''}`}
              tip={`${status}. ${q.effect}`}
            >
              {q.label}
              <span className="visually-hidden"> ({status.toLowerCase()})</span>
            </TipPill>
          );
        })}
    </span>
  );
}

/** A head coach's vision for his staff, in a line: what he wants his coordinators to run. */
function VisionLine({ league, c }: { league: League; c: Coach }) {
  if (c.role !== 'headCoach') return null;
  const vision = headCoachVision(league, c);
  const v = visionNotes(vision);
  return (
    <p className="small staff-note" style={{ margin: 0 }}>
      Wants {v.offense}, and {v.defense}: {defenseLabel(vision.defense.front, vision.defense.coverage)}.
    </p>
  );
}

/** How a coordinator fits a head coach's vision: his own team's man, yours for someone you could hire, or one of yours as he'd be promoted. */
function FitLine({
  league,
  c,
  hc,
  whose,
  promoted = false,
}: {
  league: League;
  c: Coach;
  hc: Coach | null;
  whose: string;
  promoted?: boolean;
}) {
  const fit = visionFit(league, hc, c);
  if (fit === null || !hc) return null;
  const words = promoted
    ? fit >= 0.7
      ? `Promoted, he'd fit what ${whose} head coach wants`
      : fit <= 0.35
        ? `Promoted, he isn't what ${whose} head coach wants`
        : `Promoted, he'd be a fair fit for ${whose} head coach`
    : fit >= 0.7
      ? `Fits what ${whose} head coach wants`
      : fit <= 0.35
        ? `Not what ${whose} head coach wants`
        : `A fair fit for ${whose} head coach`;
  return (
    <p
      className={`small staff-note${fit >= 0.7 ? ' tone-good' : fit <= 0.35 ? ' tone-bad' : ''}`}
      style={{ margin: 0 }}
    >
      {words}: <CoachLink c={hc} /> wants{' '}
      {c.role === 'offCoord'
        ? visionNotes(headCoachVision(league, hc)).offense
        : `a ${defenseLabel(headCoachVision(league, hc).defense.front, headCoachVision(league, hc).defense.coverage)} defense`}
      .
    </p>
  );
}
const yourHeadCoach = (league: League) => chairHolder(teamCoaches(league, league.userTeamId), { role: 'headCoach' });

/** What the owner says, by why he will or won't go past the budget. Two lines each, picked by the move, so it never flickers. */
const OWNER_YES: Partial<Record<OwnerReason, string[]>> = {
  playoffs: [
    '“We were in the playoffs. Go get the man who takes us further.”',
    '“A title is worth a few dollars. Make the hire.”',
  ],
  winNow: ['“That was a winning season. Let’s not waste it.”', '“We’re close. Spend what it takes.”'],
  newCoach: ['“The fans need a reason to believe. Bring him in.”', '“New era, new head coach. I’ll find the money.”'],
  bigMarket: ['“This city expects the best. Done.”', '“We can afford it. Make it happen.”'],
  stretch: ['“Fine, I’ll stretch it this once.”', '“Just this once. Don’t make it a habit.”'],
  emptyChair: [
    '“We can’t play without a coordinator. I’ll cover it, but only enough for that.”',
    '“Fill the chair. I’ll find the money for the job, not for a star.”',
  ],
};
const OWNER_NO: Record<OwnerReason | 'limit', string[]> = {
  assistant: [
    '“I’ll go over for the men who run the team. Not for this chair.”',
    '“Find someone for that job who fits the budget.”',
  ],
  lastYear: ['“We blew the budget last year. Not again.”', '“I’m still paying for last year. No.”'],
  losing: ['“After that season? I’m not paying more for a coordinator.”', '“Win first. Then we’ll talk money.”'],
  tight: ['“This market can’t carry it. Find someone cheaper.”', '“The budget is the budget.”'],
  limit: ['“I said I’d stretch. Not that far.”', '“That’s more than I’m willing to add. Bring me a cheaper deal.”'],
  playoffs: [],
  winNow: [],
  newCoach: [],
  bigMarket: [],
  stretch: [],
  emptyChair: [],
};
const pickLine = (lines: string[], seed: number) => lines[Math.abs(seed) % lines.length];

/**
 * The owner's answer when a move would take you past the coaching budget: he expands it (and says why) or the move is
 * blocked. The same logic AI owners use (`ownerLeeway`): only for a head coach or coordinator, never two years running,
 * more for a contender or a big market.
 */
function OwnerDialog({
  league,
  chair,
  over,
  seed,
  action,
  onApprove,
  onClose,
}: {
  league: League;
  chair: Chair;
  over: number;
  seed: number;
  action: string;
  onApprove: () => void;
  onClose: () => void;
}) {
  const stance = ownerLeeway(league, league.userTeamId, chair);
  const ok = over <= stance.amount;
  const line = ok
    ? pickLine(OWNER_YES[stance.reason] ?? OWNER_YES.stretch!, seed)
    : pickLine(OWNER_NO[stance.amount > 0 ? 'limit' : stance.reason], seed);
  return (
    <Dialog
      title={ok ? 'Owner approves' : 'Move blocked'}
      onClose={onClose}
      footer={
        ok ? (
          <>
            <button className="btn" onClick={onClose} data-autofocus>
              Not now
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onClose();
                onApprove();
              }}
            >
              {action}
            </button>
          </>
        ) : (
          <button className="btn" onClick={onClose} data-autofocus>
            OK
          </button>
        )
      }
    >
      <p style={{ margin: 0 }}>
        {ok
          ? `The owner has agreed to expand the coaching budget by ${money(over)} (${stance.why}).`
          : `The owner won’t expand the coaching budget by ${money(over)}${stance.amount > 0 ? `. He’ll add up to ${money(stance.amount)} (${stance.why})` : ` (${stance.why})`}.`}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        <i>{line}</i>
      </p>
      {ok && (
        <p className="muted small" style={{ margin: 0 }}>
          He won’t go over again next year.
        </p>
      )}
    </Dialog>
  );
}

/** Who does what, for the chairs a list shows: one line each, true to what the engine has them do. */
function RoleGuide({ roles }: { roles: CoachRole[] }) {
  return (
    <details className="more">
      <summary>What each coach does</summary>
      <ul className="muted small role-guide">
        {roles.map((r) => (
          <li key={r}>
            <b>{COACH_ROLE_LABEL[r]}:</b> {ROLE_LINE[r].charAt(0).toLowerCase() + ROLE_LINE[r].slice(1)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** His seasons as rows to glance at, newest first: the year, the team, the record large, how it ended and the job. */
function SeasonRows({ league, c }: { league: League; c: Coach }) {
  return (
    <ul className="plain-list season-rows">
      {coachRecord(league, c).seasons.map((s) => {
        const ended = s.playoffs ? `${s.finish} (${s.playoffs.w}–${s.playoffs.l})` : s.finish;
        const interim =
          s.role === 'headCoach' && c.interimAppointments?.some((a) => a.season === s.season && a.teamId === s.teamId);
        return (
          <li key={`${s.season}:${s.teamId}:${s.role}:${s.room ?? ''}`} className="season-row">
            <span className="season-year num">{s.season}</span>
            <TeamLink team={league.teams[s.teamId]} chip />
            <b className="season-rec num">{formatRecord(s.regular)}</b>
            <span className="season-end">
              {ended && ended !== '–' && <span className={`tag-pill${s.champion ? ' tag-good' : ''}`}>{ended}</span>}
            </span>
            <span className="season-job muted small">{interim ? 'Interim head coach' : coachTitle(s)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** A coach's name that opens his card; `avatar` puts his picture beside it, as in a list. */
export function CoachLink({ c, className, avatar }: { c: Coach; className?: string; avatar?: boolean }) {
  const nav = useNav();
  return (
    <button
      className={`linklike ${avatar ? 'staff-link ' : ''}${className ?? ''}`.trim()}
      onClick={() => nav.openStaff('coach', c.id)}
    >
      {avatar ? (
        <>
          <StaffAvatar person={c} size={28} />
          <span>{coachName(c)}</span>
        </>
      ) : (
        coachName(c)
      )}
    </button>
  );
}

/** What the engine says about a coaching move, with the coaches it names linked. Your own staff first, so a name a player happens to share still means the coach. */
function CoachNote({ league, text }: { league: League; text: string }) {
  return (
    <LinkedText
      league={league}
      text={text}
      about={teamCoaches(league, league.userTeamId).map((c): Who => ({ kind: 'coach', id: c.id }))}
    />
  );
}

/** A coach's full card, like a player's: his ratings, what he runs, his deal and every season he has coached. */
/** A tree's standing, in words (never a number). */
function standingWords(league: League, standing: TreeStanding): string {
  if (standing === 'hot')
    return liveTrees(league).filter((t) => standingOf(league, t) === 'hot').length > 1
      ? 'one of the hottest trees in the league'
      : 'the hottest tree in the league';
  return standing === 'steady'
    ? 'a respected tree'
    : standing === 'withering'
      ? 'hasn’t produced a winner in years'
      : 'one of the great trees of its day';
}

/** Who a coach learned under, and his own tree if he has one. Nothing for a coach with no links. */
function CoachTree({ league, coach: c }: { league: League; coach: Coach }) {
  const nav = useNav();
  const mentor = mainMentor(league, c.id);
  const own = treeOf(league, c.id);
  const within = treeFor(league, c.id);
  const findCoach = (id: number) => league.coaches[id] ?? league.retiredCoaches[id];
  const link = (x: Coach) => (
    <button className="linklike" onClick={() => nav.openStaff('coach', x.id)}>
      {coachName(x)}
    </button>
  );
  // A former player coaching for the head coach he played for.
  const hc = c.teamId === null ? undefined : teamCoaches(league, c.teamId).find((x) => x.role === 'headCoach');
  const played = c.playerId === undefined ? undefined : league.players[c.playerId];
  const playedFor =
    hc &&
    hc !== c &&
    played &&
    Object.entries(played.statTeams ?? {}).some(([s, teams]) =>
      (hc.career ?? []).some((r) => r.role === 'headCoach' && r.season === Number(s) && teams.includes(r.teamId)),
    );
  if (!mentor && !own && !playedFor) return null;
  const root = within && within.rootId !== mentor?.id ? findCoach(within.rootId) : undefined;
  return (
    <Section id="coach-tree" title="Coaching tree">
      {mentor && (
        <p>
          Learned under {link(mentor)}
          {root ? <>, in the {root.lastName} tree</> : null}.
        </p>
      )}
      {playedFor && hc && <p>Played for {link(hc)}, now coaches for him.</p>}
      {own && (
        <>
          <p>His own tree: {standingWords(league, standingOf(league, own))}.</p>
          <ul className="plain-list">
            {own.disciples.map((id) => {
              const d = findCoach(id);
              return d ? <li key={id}>{link(d)}</li> : null;
            })}
          </ul>
        </>
      )}
    </Section>
  );
}

export function CoachCard({
  league,
  coach: c,
  onClose,
  startTab = 'bio',
}: {
  league: League;
  coach: Coach;
  onClose: () => void;
  /** The tab it opens on: Bio, unless a caller needs his record or career first. */
  startTab?: 'bio' | 'career';
}) {
  const nav = useNav();
  const team = c.teamId !== null ? league.teams[c.teamId] : null;
  const coached = coachRecord(league, c).seasons.length > 0;
  // Out of football: kept on file for his record (`league.retiredCoaches`).
  const retired = !league.coaches[c.id];
  // A former player: his playing career, a tap away from his coaching one.
  const player = c.playerId !== undefined ? league.players[c.playerId] : undefined;
  const [tab, setTab] = useState(startTab);
  const hc =
    c.teamId !== null ? chairHolder(teamCoaches(league, c.teamId), { role: 'headCoach' }) : yourHeadCoach(league);
  return (
    <Sheet
      label={coachName(c)}
      team={team}
      onClose={onClose}
      head={
        <>
          <StaffAvatar person={c} size={128} />
          <div style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.85, fontSize: 'var(--step--1)' }}>
              {c.interim ? 'Interim ' : ''}
              {coachTitle(c)}
              {team ? ` · ${team.city} ${team.name}` : retired ? ' · Retired' : ' · On the market'}
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
              <b className="num">{money(c.contract.salary)}</b>{' '}
              <span className="muted small">thru {c.contract.through}</span>
            </span>
          ) : (
            <span>{retired ? 'Retired' : 'Free agent'}</span>
          )}
        </span>
        {player && (
          <span className="fact">
            <span className="eyebrow">Played</span>
            {/* His experience ticked once more in the offseason he retired: it counts the seasons he played, before this league too. */}
            <span>
              {POSITION_NAMES[player.position]} · {player.experience} season{player.experience === 1 ? '' : 's'}
            </span>
          </span>
        )}
        {team && c.since !== undefined && (
          <span className="fact">
            <span className="eyebrow">With {team.abbrev} since</span>
            <b className="num">{c.since}</b>
          </span>
        )}
      </div>
      <div className="seg coach-tabs" role="tablist" aria-label="About him">
        {(['bio', 'career'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'bio' ? 'Bio' : 'Career'}
          </button>
        ))}
      </div>
      {tab === 'bio' && (
        <>
          {team && <OwnerMandates league={league} teamId={team.id} coachId={c.id} />}
          <div className="report coach-overview">
            <span className="eyebrow">Overview</span>
            <p>{coachOverview(league, c).join(' ')}</p>
          </div>
          {coached && <SeasonRows league={league} c={c} />}
          <CoachTags c={c} />
          <SchemeRow league={league} c={c} preview={c.teamId === null && !retired} />
          <VisionLine league={league} c={c} />
          {!retired && c.teamId !== null && c.teamId !== league.userTeamId && promotionFor(c) && (
            <PoachOffer league={league} c={c} />
          )}
          {!retired && (
            <FitLine
              league={league}
              c={c}
              hc={hc}
              whose={c.teamId === league.userTeamId || c.teamId === null ? 'your' : 'his'}
            />
          )}
          {c.teamId === null && !retired && (
            <div className="stack">
              <span className="eyebrow">If you hire him</span>
              <div className="small staff-preview">
                {previewLines(previewCoachHire(league, league.userTeamId, c, 2)).map((l) => (
                  <span key={l.words} className="preview-line">
                    {l.numbers ? <Exact numbers={l.numbers}>{l.words}</Exact> : l.words}
                  </span>
                ))}
                <span className="preview-line muted">A 2-year deal. It takes effect at next year’s development.</span>
              </div>
            </div>
          )}
        </>
      )}
      {tab === 'career' && (
        <>
          {!!c.interimAppointments?.length && (
            <ul className="coach-takeovers">
              {[...c.interimAppointments].reverse().map((a) => (
                <li key={`${a.season}:${a.teamId}:${a.week}`}>
                  {a.season} · Week {a.week}: took over as interim head coach of{' '}
                  <TeamLink team={league.teams[a.teamId]} full />.
                </li>
              ))}
            </ul>
          )}
          {player && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">As a player</span>
              {Object.keys(player.stats).length ? (
                <StatsTable league={league} player={player} />
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  He played before this league&rsquo;s first season, so there are no stats on file.
                </p>
              )}
              <div>
                <MoreLink
                  onClick={() => {
                    onClose();
                    nav.openPlayer(player.id);
                  }}
                >
                  His player card
                </MoreLink>
              </div>
            </div>
          )}
          <CoachTree league={league} coach={c} />
          {c.quirkOrigin && (
            <p className="small muted">
              His playing habit, {QUIRKS[c.quirkOrigin.source as QuirkId]?.label ?? c.quirkOrigin.source}, helped shape{' '}
              {COACH_QUIRKS[c.quirkOrigin.id].label}.
            </p>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            {ROLE_LINE[c.role]}
          </p>
          {c.lastJob && (
            <p className="muted small" style={{ margin: 0 }}>
              Last job: {c.lastJob}
            </p>
          )}
          {!!c.quirkLog?.length && (
            <Section id="coach-habits" title="Habits over time" defaultOpen={false} className="muted small">
              <ul className="habit-timeline">
                {[...c.quirkLog].reverse().map((e, i) => (
                  <li key={i}>
                    <b>
                      <span className="num">
                        {e.season}
                        {e.week ? `, wk ${e.week}` : ', offseason'}
                      </span>{' '}
                      · {coachHabitChangeText(e)}.
                    </b>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
      {team && (
        <div>
          <MoreLink
            onClick={() => {
              onClose();
              nav.openTeam(team.id);
            }}
          >
            {team.name} roster
          </MoreLink>
        </div>
      )}
    </Sheet>
  );
}

/**
 * A coordinator's scheme: the pill, and (unless compact) what it means and, for someone you could hire,
 * how your current starters would fit it.
 */
function SchemeRow({
  league,
  c,
  compact = false,
  preview = false,
}: {
  league: League;
  c: Coach;
  compact?: boolean;
  preview?: boolean;
}) {
  if (c.role === 'stCoord') return <KickRow c={c} compact={compact} />;
  // On a staff he runs his plan bent to his head coach's (an adaptable coordinator bends further): show what he runs.
  const own = coachSchemeLabel(c);
  c = planUnder(league, c);
  const label = coachSchemeLabel(c);
  if (!label) return null;
  const about = coachSchemeAbout(c);
  const tip = own && own !== label ? `${about ?? label} His own: ${own}.` : (about ?? label);
  const side = c.role === 'offCoord' ? 'offense' : 'defense';
  const scheme = schemeWith(teamScheme(league, league.userTeamId), c);
  const fit = preview ? rosterFit(league, league.userTeamId, scheme, side) : null;
  return (
    <span className="scheme-row">
      <TipPill className="scheme-pill" tip={tip}>
        {label}
        {c.role === 'offCoord' && scheme.offense.personnel !== '11' ? ` · ${scheme.offense.personnel} personnel` : ''}
      </TipPill>
      {!compact && about && (
        <span className="muted small">
          {c.role === 'offCoord' ? `${PERSONNEL_LABEL[scheme.offense.personnel]}. ` : ''}
          {about}
        </span>
      )}
      {fit && fit.asked > 0 && (
        <span className={`small${fit.poor > fit.good ? ' tone-bad' : fit.good > fit.asked / 2 ? ' tone-good' : ''}`}>
          Your {side}: {fit.good} of {fit.asked} starters fit his scheme well{fit.poor ? `, ${fit.poor} poorly` : ''}.
        </span>
      )}
    </span>
  );
}

function Term({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
}) {
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
  // Going past the budget isn't a blocker: the owner is asked (`OwnerDialog`).
  const extendProblem = expiring ? coachMoveProblem(league, teamId, c, 'extend', term, false) : null;
  const extendOver = expiring && !extendProblem ? moveOverspend(league, teamId, c, term, 'extend') : 0;
  const [ask, setAsk] = useState<{ chair: Chair; over: number; action: string; go: () => void } | null>(null);
  // One rung up, when that chair is open (or its man's deal is up): a QB coach to offensive coordinator, a coordinator to head coach.
  const up = promotionFor(c);
  const aboveHeld = !!up && mine(league).some((x) => sameChair(chairOf(x), up) && !isCoachExpiring(league, x));
  const promoProblem = up ? promotionProblem(league, teamId, c, 2, false) : null;
  const promoOver = up && !promoProblem ? moveOverspend(league, teamId, c, 2, 'promote') : 0;
  const promoTitle = up ? coachTitle(up).toLowerCase() : '';
  const doPromote = () => {
    store.mutate((l) => promoteCoach(l, l.userTeamId, c.id, 2));
    announce(`Promoted ${name} to ${promoTitle}.`, 'mine');
  };
  const doExtend = () => {
    store.mutate((l) => extendCoach(l, l.userTeamId, c.id, term));
    // The Extend button goes away with the deal: land on the section, not on the page.
    announce(`Extended ${name} for ${years(term)}.`, 'mine');
  };
  const pay = coachSeverance(league, c);
  // In season a coordinator is relieved, not dismissed (L4): one button, its own block.
  const inSeasonCoord =
    (league.phase === 'preseason' || league.phase === 'regular') && (c.role === 'offCoord' || c.role === 'defCoord');
  const why = expiring ? extendProblem : inSeasonCoord ? null : releaseProblem;
  const taker = expiring ? replaces(league, teamId, c) : null;
  const ask2 = coachAsk(league, c, 2);
  return (
    <li className={`staff-card coach-card${expiring ? ' expiring' : ''}`}>
      <div className="staff-head">
        <div className="staff-who">
          <StaffAvatar person={c} size={56} />
          <div>
            <CoachLink c={c} className="staff-name" />
            <span className="muted small">{subtitle(league, c)}</span>
          </div>
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
            <b className="num">{money(c.contract?.salary ?? 0)}</b>{' '}
            <span className="muted small">thru {c.contract?.through}</span>
          </span>
        </span>
      </div>
      <SchemeRow league={league} c={c} compact />
      {!theirs && <BeliefStaff league={league} c={c} />}
      {c.teamId !== null && <OwnerMandates league={league} teamId={c.teamId} coachId={c.id} />}
      <CoachTags c={c} />
      <VisionLine league={league} c={c} />
      {c.role !== 'headCoach' && (
        <FitLine
          league={league}
          c={c}
          hc={theirs ? chairHolder(teamCoaches(league, c.teamId!), { role: 'headCoach' }) : yourHeadCoach(league)}
          whose={theirs ? 'his' : 'your'}
        />
      )}
      {theirs ? null : expiring ? (
        <>
          <p className="small staff-note">
            {outlook === 'budget' ? (
              `Deal up: ${leavesOverBudget('coaching', 'he', 'his', money(ask2))}`
            ) : outlook === 'chair' ? (
              <>
                Deal up: he leaves when free agency opens. {taker ? <CoachLink c={taker} /> : 'Someone else'} now holds
                the {coachTitle(c).toLowerCase()} chair.
              </>
            ) : (
              `Deal up: ${reSigns(money(ask2), 'him')}`
            )}
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
              onClick={() =>
                extendOver > 0
                  ? setAsk({
                      chair: chairOf(c),
                      over: extendOver,
                      action: `Extend · ${money(coachAsk(league, c, term))}/yr`,
                      go: doExtend,
                    })
                  : doExtend()
              }
            >
              Extend · {money(coachAsk(league, c, term))}/yr
            </button>
          </div>
        </>
      ) : inSeasonCoord ? null : (
        <div className="staff-actions">
          {confirming ? (
            <>
              <button
                ref={confirmRef}
                className="btn btn-sm btn-danger"
                onClick={() => {
                  store.mutate((l) => releaseCoach(l, l.userTeamId, c.id));
                  announce(`Dismissed ${name}. ${money(pay)} severance booked.`, 'mine');
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
      {!theirs && (league.phase === 'preseason' || league.phase === 'regular') && <Relieve league={league} c={c} />}
      {!theirs && open && why && (
        <p className="small muted staff-why">
          <CoachNote league={league} text={why} />
        </p>
      )}
      {!theirs && up && !aboveHeld && (
        <div className="staff-actions">
          <button
            className="btn btn-sm"
            disabled={!!promoProblem}
            title={promoProblem ?? undefined}
            aria-label={`Promote ${name} to ${promoTitle} · ${money(coachAsk(league, asPromoted(league, c, up), 2))}/yr for 2 years`}
            onClick={() =>
              promoOver > 0
                ? setAsk({
                    chair: up,
                    over: promoOver,
                    action: `Promote · ${money(coachAsk(league, asPromoted(league, c, up), 2))}/yr`,
                    go: doPromote,
                  })
                : doPromote()
            }
          >
            Promote to {promoTitle} · {money(coachAsk(league, asPromoted(league, c, up), 2))}/yr
          </button>
        </div>
      )}
      {!theirs && up && !aboveHeld && up.role !== 'headCoach' && (
        <FitLine league={league} c={asPromoted(league, c, up)} hc={yourHeadCoach(league)} whose="your" promoted />
      )}
      {(extendOver > 0 || promoOver > 0) && (
        <p className="small muted staff-why">{money(extendOver > 0 ? extendOver : promoOver)} over budget.</p>
      )}
      {!theirs && open && up && !aboveHeld && promoProblem && (
        <p className="small muted staff-why">
          <CoachNote league={league} text={promoProblem} />
        </p>
      )}
      {ask && (
        <OwnerDialog
          league={league}
          chair={ask.chair}
          over={ask.over}
          seed={c.id + league.season}
          action={ask.action}
          onApprove={ask.go}
          onClose={() => setAsk(null)}
        />
      )}
    </li>
  );
}

/** An empty chair at another club: just that it's empty. */
function TheirOpenChair({ chair, cover }: { chair: Chair; cover: Coach | null }) {
  return (
    <li className="staff-card vacant coach-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">Open chair</b>
          <span className="muted small">{coachTitle(chair)}</span>
        </div>
      </div>
      {cover && (
        <p className="small staff-note">
          Head coach <CoachLink c={cover} /> is running the {sideNoun(chair)} himself.
        </p>
      )}
    </li>
  );
}
const sideNoun = (chair: Chair) => (chair.role === 'offCoord' ? 'offense' : 'defense');
/** The head coach covering an empty coordinator chair, if this is one. */
const coverOf = (staff: readonly Coach[], chair: Chair): Coach | null =>
  chair.role === 'offCoord' || chair.role === 'defCoord' ? coveringHeadCoach(staff, chair.role) : null;
const mine = (league: League) => teamCoaches(league, league.userTeamId);

/** The head coach still running the side of the ball he was promoted from: the chair isn't open, he's covering it. */
const actingIn = (staff: readonly Coach[], chair: Chair): Coach | null =>
  (chair.role === 'offCoord' || chair.role === 'defCoord') && !chairHolder(staff, chair)
    ? coordinatorOf(staff, chair.role)
    : null;

function ActingChair({ chair, hc, onFind }: { chair: Chair; hc: Coach; onFind?: () => void }) {
  return (
    <li className="staff-card coach-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">
            <CoachLink c={hc} />
          </b>
          <span className="muted small">{coachTitle(chair)} · acting</span>
        </div>
      </div>
      <p className="small staff-note">
        The interim head coach is also running the {chair.role === 'offCoord' ? 'offense' : 'defense'} until the
        offseason.
      </p>
      {onFind && (
        <div className="staff-actions">
          <button className="btn btn-sm" onClick={onFind}>
            Find {withArticle(chairNoun(chair))}
          </button>
        </div>
      )}
    </li>
  );
}

function OpenChair({
  chair,
  staying,
  leaving,
  onFind,
}: {
  chair: Chair;
  staying: readonly Coach[];
  leaving?: Coach;
  onFind: () => void;
}) {
  const side = chair.role === 'offCoord' || chair.role === 'defCoord' ? chair.role : null;
  const hc = side ? chairHolder(staying, { role: 'headCoach' }) : null;
  const covering = side ? coveringHeadCoach(staying, side) : null;
  return (
    <li className="staff-card vacant coach-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">Open chair</b>
          <span className="muted small">{coachTitle(chair)}</span>
        </div>
      </div>
      <p className="small staff-note">
        {leaving && (
          <>
            <CoachLink c={leaving} /> leaves.{' '}
          </>
        )}
        {covering && (
          <>
            Head coach <CoachLink c={covering} /> runs the {sideNoun(chair)} himself, teaching it a little below his own
            level.{' '}
          </>
        )}
        {vacancyText(staying, chair)}
      </p>
      {side && hc && (
        <label className="small cover-switch">
          <input
            type="checkbox"
            checked={!!covering}
            onChange={(e) => store.mutate((l) => setHeadCoachCover(l, l.userTeamId, side, e.target.checked))}
          />{' '}
          Head coach runs the {sideNoun(chair)}
        </label>
      )}
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
      <TipPill
        className="scheme-pill"
        tip="How his kick units compare with a typical coordinator's in flags, return yards and yards given up on kicks."
      >
        Kick units: {flagText}
      </TipPill>
      <span className="muted small">
        {yards(fx.kickoff)} yds a kickoff{compact ? '' : ' return'}, {yards(fx.punt)} a punt
        {compact ? '' : ' return, and as much again in coverage'}
      </span>
    </span>
  );
}

// ───────── who coaches your players ─────────

function RoomRow({
  league,
  room,
  staying,
  count,
  expanded,
  onToggle,
}: {
  league: League;
  room: Room;
  staying: readonly Coach[];
  count: RoomCount;
  expanded: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  // Kickers and punters are the special teams coordinator's room.
  const chair: Chair = room ? { role: 'positionCoach', room } : { role: 'stCoord' };
  const coach = chairHolder(staying, chair);
  // His deal is up and he doesn't stay: the room is empty come next year.
  const leaving = teamCoaches(league, league.userTeamId).find(
    (c) => sameChair(chairOf(c), chair) && isCoachExpiring(league, c) && !staying.includes(c),
  );
  const effect = roomEffect(staying, room);
  const parts = roomParts(staying, room);
  // The engine caps the combined effect; the chairs' parts are uncapped, so an extreme staff's parts can add up to more.
  const cutGrowth = effect.growth - parts.reduce((n, p) => n + p.growth, 0);
  const cutAging = effect.aging - parts.reduce((n, p) => n + p.aging, 0);
  const capped = [
    Math.abs(cutGrowth) >= CAP_SHOWN ? `${signedPct((cutGrowth < 0 ? RATE_RANGE[1] : RATE_RANGE[0]) - 1)} growth` : '',
    Math.abs(cutAging) >= CAP_SHOWN
      ? `${signedPct((cutAging < 0 ? DECLINE_RANGE[1] : DECLINE_RANGE[0]) - 1)} decline`
      : '',
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
              <span className="staff-who">
                <StaffAvatar person={coach} size={28} />
                <b>{coachName(coach)}</b>
              </span>
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
            <span className="muted small">Young players</span>{' '}
            <b className={growthVerdict(effect.growth).tone}>{growthVerdict(effect.growth).word}</b>
          </span>
          <span className="fx">
            <span className="muted small">Veterans</span>{' '}
            <b className={agingVerdict(effect.aging).tone}>{agingVerdict(effect.aging).word}</b>
          </span>
        </span>
        <span className="room-chev">
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} />
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
                      <span className="muted small part-who">
                        {p.coach ? <CoachLink c={p.coach} /> : 'Vacant'}
                        {p.covering && ' (head coach, covering)'}
                      </span>
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
            {count.young} of these players {count.young === 1 ? 'is' : 'are'} under {YOUNG_UNDER} (growth) and{' '}
            {count.old} {count.old === 1 ? 'is' : 'are'} {PAST_PRIME_WORDS} (decline). Figures are against a typical
            staff.
          </p>
        </div>
      )}
    </li>
  );
}

// ───────── candidates ─────────

/**
 * Offer another staff's coach the job one rung up on yours (`poachCoach`): the AI's rules, the owner asked past the
 * budget as for a promotion. Disabled with the reason when the move isn't open.
 */
function PoachOffer({ league, c }: { league: League; c: Coach }) {
  const teamId = league.userTeamId;
  const up = promotionFor(c);
  const announce = useContext(Announce);
  const [ask, setAsk] = useState(false);
  if (!up) return null;
  const problem = poachProblem(league, teamId, c, 2, false);
  const over = problem ? 0 : moveOverspend(league, teamId, c, 2, 'poach');
  const pay = coachAsk(league, asPromoted(league, c, up), 2);
  const title = coachTitle(up).toLowerCase();
  const from = c.teamId !== null ? league.teams[c.teamId].abbrev : '';
  const go = () => {
    store.mutate((l) => poachCoach(l, l.userTeamId, c.id, 2));
    announce(`Hired ${coachName(c)} from ${from} as ${title}.`, 'mine');
  };
  return (
    <>
      <div className="staff-actions">
        <button
          className="btn btn-sm btn-primary"
          disabled={!!problem}
          title={problem ?? undefined}
          aria-label={`Offer ${coachName(c)} the ${title} job · ${money(pay)}/yr for 2 years`}
          onClick={() => (over > 0 ? setAsk(true) : go())}
        >
          Offer the {title} job · {money(pay)}/yr
        </button>
      </div>
      {problem ? (
        <p className="small muted staff-why">
          <CoachNote league={league} text={problem} />
        </p>
      ) : (
        <p className="small muted staff-why">
          {from} can’t block a promotion, and no severance is owed.
          {over > 0 && ` ${money(over)} over budget.`}
        </p>
      )}
      {ask && (
        <OwnerDialog
          league={league}
          chair={up}
          over={over}
          seed={c.id + league.season}
          action={`Hire · ${money(pay)}/yr`}
          onApprove={go}
          onClose={() => setAsk(false)}
        />
      )}
    </>
  );
}

/** Another staff's coach in the candidates list, shown as he'd be one rung up on yours. */
function PoachCandidate({ league, c }: { league: League; c: Coach }) {
  const up = promotionFor(c)!;
  const as = asPromoted(league, c, up);
  return (
    <li className="staff-card coach-card">
      <div className="staff-head">
        <div className="staff-who">
          <StaffAvatar person={c} size={56} />
          <div>
            <CoachLink c={c} className="staff-name" />
            <span className="muted small">
              {coachTitle(c)}, {league.teams[c.teamId!].abbrev}
            </span>
          </div>
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
            <b className="num">{money(coachAsk(league, as, 2))}</b> <span className="muted small">/ yr for 2 yrs</span>
          </span>
        </span>
      </div>
      <SchemeRow league={league} c={as} compact />
      <CoachTags c={c} />
      {up.role !== 'headCoach' && <FitLine league={league} c={as} hc={yourHeadCoach(league)} whose="your" promoted />}
      <PoachOffer league={league} c={c} />
    </li>
  );
}

function Candidate({ league, c, open }: { league: League; c: Coach; open: boolean }) {
  const teamId = league.userTeamId;
  const [term, setTerm] = useState(2);
  const holder = replaces(league, teamId, c);
  // Going past the budget isn't a blocker: the owner is asked (`OwnerDialog`).
  const problem = holder
    ? replaceProblem(league, teamId, c, term, false)
    : coachMoveProblem(league, teamId, c, 'hire', term, false);
  const over = problem ? 0 : moveOverspend(league, teamId, c, term, holder ? 'replace' : 'hire');
  const [askOwner, setAskOwner] = useState(false);
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
    announce(
      `${holder ? `Replaced ${coachName(holder)} with` : 'Hired'} ${name}${holder && sev > 0 ? `; ${money(sev)} severance booked` : ''}.`,
      'candidates',
    );
  };
  return (
    <li className="staff-card coach-card">
      <div className="staff-head">
        <div className="staff-who">
          <StaffAvatar person={c} size={56} />
          <div>
            <CoachLink c={c} className="staff-name" />
            <span className="muted small">{coachTitle(c)}</span>
          </div>
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
            <b className="num">{money(ask)}</b>{' '}
            <span className="muted small">
              / yr for {term} {term === 1 ? 'yr' : 'yrs'}
            </span>
          </span>
        </span>
      </div>
      <SchemeRow league={league} c={c} compact />
      <CoachTags c={c} />
      <VisionLine league={league} c={c} />
      {c.role !== 'headCoach' && <FitLine league={league} c={c} hc={yourHeadCoach(league)} whose="your" />}
      {holder && (
        <p className="small staff-why muted">
          {/* The ratings box wraps as a unit, so no bracket is left dangling at the end of a line. */}
          Replaces <CoachLink c={holder} /> — <Rates c={holder} />.{' '}
          {sev > 0 ? `${money(sev)} severance.` : 'No severance.'}
        </p>
      )}
      {pushed.length > 0 && (
        <p className="small tone-bad staff-preview">
          Hiring him means{' '}
          {pushed.map((x, i) => (
            <Fragment key={x.id}>
              {i > 0 && ' and '}
              <CoachLink c={x} />
            </Fragment>
          ))}{' '}
          won’t be re-signed.
        </p>
      )}
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
            onClick={() => (over > 0 ? setAskOwner(true) : holder && sev > 0 ? setConfirming(true) : doHire())}
          >
            {holder ? `Replace ${holder.lastName}` : 'Hire'} · {money(ask)}/yr
          </button>
        )}
      </div>
      {over > 0 && <p className="small muted staff-why">{money(over)} over budget.</p>}
      {open && problem && (
        <p className="small muted staff-why">
          <CoachNote league={league} text={problem} />
        </p>
      )}
      {askOwner && (
        <OwnerDialog
          league={league}
          chair={chairOf(c)}
          over={over}
          seed={c.id + league.season}
          action={`${holder ? `Replace ${holder.lastName}` : 'Hire'} · ${money(ask)}/yr`}
          onApprove={() => (holder && sev > 0 ? setConfirming(true) : doHire())}
          onClose={() => setAskOwner(false)}
        />
      )}
    </li>
  );
}

/** Your owner: how he spends, and how far past the budget he'll go this year for the men who run the team. */
export function OwnerMandates({ league, teamId, coachId }: { league: League; teamId: number; coachId?: number }) {
  if (!managesTeam(league, teamId)) return null;
  const promises = teamCoaches(league, teamId).flatMap((coach) => {
    const mandate = coachMandate(league, coach);
    return mandate && (coachId === undefined || coach.id === coachId) ? [{ coach, mandate }] : [];
  });
  if (!promises.length) return null;
  return (
    <div className="callout owner-mandates" aria-label="Owner mandates">
      <b>Owner mandate</b>
      {promises.map(({ coach, mandate }) => (
        <div key={coach.id}>
          <p>
            <CoachLink c={coach} /> stays as {coachTitle(coach).toLowerCase()} through <b>{mandate.through}</b>.
          </p>
          <p className="small">{mandate.reason}</p>
          <p className="small muted">Under contract through {mandate.through}.</p>
        </div>
      ))}
    </div>
  );
}

function OwnerLine({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const head = ownerLeeway(league, teamId, { role: 'headCoach' });
  const coord = ownerLeeway(league, teamId, { role: 'offCoord' });
  const spend = ownerBudgetNote(league.teams[teamId].staffBudgetMult);
  return (
    <>
      <p className="muted small staff-lede">
        <b>Owner:</b> {spend === 'Big-spending owner' ? 'a big spender. ' : spend ? 'on a tight budget. ' : ''}
        {head.amount > 0
          ? `He’ll go ${money(Math.max(head.amount, coord.amount))} past budget.`
          : `He won’t go past the budget this year (${head.why}).`}
      </p>
      <OwnerMandates league={league} teamId={teamId} />
    </>
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
      <CoachLink c={c} avatar />
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
  const [otherStaffs, setOtherStaffs] = useState(false);
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
    if (jump)
      setTimeout(() => (jump === 'mine' ? mineHeading : candidatesHeading).current?.focus({ preventScroll: true }), 0);
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
  const emptyNow = CHAIRS.filter((ch) => !chairHolder(mine, ch) && !actingIn(mine, ch));
  // The chair whose loss costs the players you actually have the most (growth for the young, aging for the old).
  const costliest = (chairs: Chair[]) =>
    [...chairs]
      .map((ch) => {
        const cost = vacancyCost(staying, ch);
        const n = cost.rooms.reduce(
          (s, r) => ({ young: s.young + (counts.get(r)?.young ?? 0), old: s.old + (counts.get(r)?.old ?? 0) }),
          { young: 0, old: 0 },
        );
        return { ch, weight: cost.growth * n.young + cost.aging * n.old };
      })
      .sort((a, b) => b.weight - a.weight)[0]?.ch;
  const worstEmpty = costliest(emptyNow);
  const lostToBudget = costliest(mine.filter((c) => forecast.get(c.id) === 'budget').map(chairOf));
  const lostCoach =
    lostToBudget && mine.find((c) => forecast.get(c.id) === 'budget' && sameChair(chairOf(c), lostToBudget));
  let step: { text: ReactNode; button?: { label: string; go: () => void } } | null = null;
  if (open) {
    if (worstEmpty) {
      step = {
        text: (
          <>
            <b>Open chair:</b> your {chairNoun(worstEmpty)}. {vacancyText(staying, worstEmpty)}
            {emptyNow.length > 1
              ? ` ${emptyNow.length - 1} more ${emptyNow.length === 2 ? 'chair is' : 'chairs are'} open below.`
              : ''}
          </>
        ),
        button: { label: `Find ${withArticle(chairNoun(worstEmpty))}`, go: () => showCandidates(targetOf(worstEmpty)) },
      };
    } else if (lostToBudget && lostCoach) {
      step = {
        text: (
          <>
            <b>Deal up:</b> <CoachLink c={lostCoach} />, your {chairNoun(lostToBudget)}, leaves when free agency opens.
            Your coaching budget can&rsquo;t cover his ask of {money(coachAsk(league, lostCoach, 2))} a year.{' '}
            {vacancyText(staying, lostToBudget)}
          </>
        ),
        button: {
          label: `Find ${withArticle(chairNoun(lostToBudget))}`,
          go: () => showCandidates(targetOf(lostToBudget)),
        },
      };
    } else if (dueCount > 0) {
      const stays = mine.filter((c) => forecast.get(c.id) === 'stays').length;
      step = {
        text: (
          <>
            <b>{dueCount === 1 ? 'One deal is up' : `${dueCount} deals are up`}:</b>{' '}
            {stays === dueCount
              ? `${dueCount === 1 ? 'he re-signs' : 'they re-sign'} for 2 years automatically unless you let ${dueCount === 1 ? 'him' : 'them'} go.`
              : 'extend the ones you want, or let them go.'}
          </>
        ),
        button: { label: 'Review deals', go: () => goTo(mineRef, mineHeading) },
      };
    } else {
      // The best affordable hire for the roster you actually have.
      const best = coachMarket(league)
        .map((c) => {
          const holder = replaces(league, teamId, c);
          return {
            c,
            holder,
            problem: holder ? replaceProblem(league, teamId, c, 2) : coachMoveProblem(league, teamId, c, 'hire', 2),
          };
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
                  <b>Biggest upgrade:</b> <CoachLink c={best.c} /> as {chairNoun(chairOf(best.c))}
                  {best.holder && (
                    <>
                      , instead of <CoachLink c={best.holder} />
                    </>
                  )}
                  . {previewLines(best.changes)[0].words}
                </>
              ),
              button: { label: 'Show him', go: () => showCandidates(targetOf(chairOf(best.c))) },
            }
          : { text: <>Your staff is in good shape. Nobody you can afford would clearly improve it.</> };
    }
  }

  // ── candidates ──
  const fits = (c: Pick<Coach, 'role' | 'room'>) =>
    ROLES_OF[tab].includes(c.role) &&
    (tab !== 'position' || room === 'any' || c.room === room) &&
    (tab !== 'coord' || side === 'both' || c.role === side);
  // Other staffs' coaches, judged as they'd be one rung up on yours (`poachable`); only for the chairs above a room.
  const poached =
    otherStaffs && open
      ? poachable(league, teamId).map((c) => ({ c, as: asPromoted(league, c, promotionFor(c)!) }))
      : [];
  const ranked = [
    ...coachMarket(league)
      .filter(fits)
      .map((c) => ({ c, as: c })),
    ...poached.filter((x) => fits(x.as)),
  ]
    .map(({ c, as }) => ({
      c,
      score: sort === 'roster' ? gainScore(previewCoachHire(league, teamId, as, 2), counts) : 0,
      value: coachValue(as),
    }))
    .sort((a, b) => b.score - a.score || b.value - a.value);
  const candidates = sort === 'roster' ? ranked : [...ranked].sort((a, b) => b.value - a.value);
  const shown = showAll ? candidates : candidates.slice(0, LIMIT);

  // ── your coaches, in groups ──
  const leavers = mine.filter((c) => isCoachExpiring(league, c) && forecast.get(c.id) !== 'stays');
  const seated = (ch: Chair) =>
    [...mine.filter((c) => sameChair(chairOf(c), ch))].sort(
      (a, b) => Number(isCoachExpiring(league, a)) - Number(isCoachExpiring(league, b)),
    );

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
        {!open && (
          <div className="notice">
            {movesClosed('Coaching')}
            {league.phase === 'preseason' || league.phase === 'regular'
              ? ' From camp through the regular season you can relieve a coordinator.'
              : ''}
          </div>
        )}

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
                <span className={`grade grade-${grade}`}>{grade}</span> {ordinal(mineGrade.rank)} of{' '}
                {league.teams.length}
              </b>
            </span>
            {dead > 0 && (
              <span className="fact">
                <span className="eyebrow">Severance this year</span>
                <b className="num">{money(dead)}</b>
              </span>
            )}
          </div>
          <div
            className={`staff-bar${payroll > budget ? ' over' : ''}`}
            role="img"
            aria-label={`Coaching payroll is ${Math.round(pct)}% of the coaching budget`}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <OwnerLine league={league} />
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
          <ul className="room-list">
            {ALL_ROOMS.map((r) => (
              <RoomRow
                key={r ?? 'kp'}
                league={league}
                room={r}
                staying={staying}
                count={counts.get(r)!}
                expanded={expanded.has(r ?? 'kp')}
                onToggle={() => toggleRoom(r ?? 'kp')}
              />
            ))}
          </ul>
        </Panel>

        <PositionWork league={league} />

        <div ref={mineRef} className="staff-anchor">
          <Panel
            title={
              <h2 ref={mineHeading} tabIndex={-1}>
                {viewTeam === teamId
                  ? 'Your coaches'
                  : `${league.teams[viewTeam].city} ${league.teams[viewTeam].name} coaches`}
              </h2>
            }
            action={<TeamPicker league={league} value={viewTeam} onChange={setViewTeam} />}
          >
            <RoleGuide roles={[...new Set(GROUPS.flatMap(([, chairs]) => chairs.map((ch) => ch.role)))]} />
            <div className="stack coach-groups">
              {GROUPS.map(([title, chairs]) => (
                <section key={title} aria-label={title}>
                  <h3 className="coach-group-title">{title}</h3>
                  <ul className="staff-grid">
                    {chairs.flatMap((ch) => {
                      const key = `${ch.role}-${ch.room ?? ''}`;
                      if (viewTeam !== teamId) {
                        const theirs = teamCoaches(league, viewTeam);
                        const holder = chairHolder(theirs, ch);
                        const acting = actingIn(theirs, ch);
                        return holder
                          ? [<Member key={holder.id} league={league} c={holder} open={false} />]
                          : acting
                            ? [<ActingChair key={`acting-${key}`} chair={ch} hc={acting} />]
                            : [<TheirOpenChair key={`open-${key}`} chair={ch} cover={coverOf(theirs, ch)} />];
                      }
                      const cards = seated(ch).map((c) => (
                        <Member key={c.id} league={league} c={c} open={open} outlook={forecast.get(c.id)} />
                      ));
                      const acting = actingIn(staying, ch);
                      if (acting)
                        cards.push(
                          <ActingChair
                            key={`acting-${key}`}
                            chair={ch}
                            hc={acting}
                            onFind={() => showCandidates(targetOf(ch))}
                          />,
                        );
                      else if (!chairHolder(staying, ch)) {
                        const gone = leavers.find((c) => sameChair(chairOf(c), ch));
                        cards.push(
                          <OpenChair
                            key={`open-${key}`}
                            chair={ch}
                            staying={staying}
                            leaving={gone}
                            onFind={() => showCandidates(targetOf(ch))}
                          />,
                        );
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
              {(tab === 'head' || tab === 'coord') && (
                <label
                  className="small cover-switch"
                  title="Coaches on other staffs who would take a promotion to this job."
                >
                  <input
                    type="checkbox"
                    checked={otherStaffs}
                    onChange={(e) => {
                      setOtherStaffs(e.target.checked);
                      setShowAll(false);
                    }}
                  />{' '}
                  Include other staffs
                </label>
              )}
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>
              {sort === 'roster' ? 'Best first, by effect on your roster.' : 'Best first.'}
            </p>
            {candidates.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nobody on the market fits that filter.
              </p>
            ) : (
              <>
                <ul className="staff-grid">
                  {shown.map(({ c }) =>
                    c.teamId === null ? (
                      <Candidate key={c.id} league={league} c={c} open={open} />
                    ) : (
                      <PoachCandidate key={c.id} league={league} c={c} />
                    ),
                  )}
                </ul>
                {candidates.length > LIMIT && (
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ marginTop: 10 }}
                    onClick={() => setShowAll(!showAll)}
                  >
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

/** An owner's streaks, where they stand out: his spending and his patience with head coaches. */
/**
 * Position work: who is learning a new position and how far along, the coaches' suggestion while a plan can
 * still start (the offseason), and your one setting, whether the coaches may start their own.
 */
function PositionWork({ league }: { league: League }) {
  const team = league.teams[league.userTeamId];
  const decide = !!team.training?.coachesDecide;
  const now = learners(league, team.id);
  // The suggestion only while a plan can start, and only when you decide: otherwise the coaches start it themselves.
  const pick = OFFSEASON_PHASES.includes(league.phase) && !decide ? suggestMove(league, team.id) : null;
  return (
    <Panel
      title="Position work"
      action={
        <label
          className="row"
          style={{ gap: 6, cursor: 'pointer' }}
          title="Your coaches start the move they like best once the draft is over."
        >
          <input
            type="checkbox"
            checked={decide}
            onChange={(e) => store.mutate((l) => setCoachesDecide(l, e.target.checked))}
          />
          Coaches may start position moves
        </label>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Up to {MAX_LEARNERS} at a time. Start one from a player&rsquo;s card.
      </p>
      {now.length > 0 ? (
        <ul className="move-list">
          {now.map((p) => {
            const l = activeLearning(p)!;
            const f = familiarity(p);
            const held = isReady(p) ? holdReason(league, p) : null;
            const why = planReason(league, p);
            return (
              <li key={p.id} className="move-head">
                <PlayerLink league={league} player={p} pos bold />
                <span className={`tag-pill ${familiarityTone(f)}`}>{learnLine(p.position, l.to, f)}</span>
                <span className="muted small">
                  {why ? `${why} · ` : ''}
                  {held ??
                    (isReady(p) ? 'Moves on cut-down day' : readyText(campsToReady(league, p, l.to), league.phase))}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">No one is learning a new position.</p>
      )}
      {pick && (
        <div className="callout staff-next">
          <span>
            The coaches suggest teaching <PlayerLink league={league} player={pick.player} pos /> to play {pick.read.to}:{' '}
            {reasonText({ ...pick.read, reason: pick.why })}. {roleText(pick.read)}.{' '}
            <span className={`tag-pill ${verdictTone(pick.read.verdict)}`}>{verdictText(pick.read.verdict)}</span>
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => store.mutate((l) => startMove(l, pick.player.id, pick.read.to, pick.why))}
            >
              Start
            </button>
            <button className="btn btn-sm" onClick={() => store.mutate((l) => passMove(l, pick.player.id))}>
              Not now
            </button>
          </span>
        </div>
      )}
    </Panel>
  );
}

function OwnerNotes({ league, teamId }: { league: League; teamId: number }) {
  const notes = [
    ownerBudgetNote(league.teams[teamId].staffBudgetMult),
    ownerTriggerNote(ownerTrigger(league, teamId)),
  ].filter(Boolean);
  return notes.length ? <small className="muted owner-notes">{notes.join(' · ')}</small> : null;
}

function AroundTheLeague({ league, grades }: { league: League; grades: ReturnType<typeof coachingGrades> }) {
  const teamId = league.userTeamId;
  // League-wide head coach and coordinator moves this league year (the user's own are in Cap & transactions).
  const moves = league.transactions
    .filter((t) => t.kind === 'coach' && t.season === league.season && !t.teamIds.includes(teamId))
    .slice(-20)
    .reverse();
  const names = moveIndex(league);
  const [open, setOpen] = useState<number | null>(null);
  const [gradeSort, onGradeSort] = useSort<GradesSort>({ key: 'rank', desc: false });
  return (
    <Panel>
      <details className="more">
        <summary>Around the league: how all {league.teams.length} coaching staffs grade</summary>
        <p className="muted small">Ratings are youth development / veteran care.</p>
        <div className="table-scroll">
          <table className="league-grades league-coaches">
            <thead>
              <tr>
                <SortTh label="Rank" k="rank" sort={gradeSort} onSort={onGradeSort} desc={false} className="num" />
                <SortTh
                  label="Team"
                  k="team"
                  sort={gradeSort}
                  onSort={onGradeSort}
                  desc={false}
                  className="sticky-col"
                />
                <th>Grade</th>
                <th>Head coach</th>
                <th>Offensive coordinator</th>
                <th>Defensive coordinator</th>
              </tr>
            </thead>
            <tbody>
              {sortRows([...grades], gradeSort, ([id, g], key) => gradesSortValue(league, id, g.rank, key)).flatMap(
                ([id, g]) => {
                  const t = league.teams[id];
                  const staff = teamCoaches(league, id);
                  const row = (
                    <tr key={id} className={id === teamId ? 'is-user' : undefined}>
                      <td className="num">{g.rank}</td>
                      <td className="sticky-col">
                        {/* Tap a team for the rest of its staff: position coaches and S&C. */}
                        <button
                          className="linklike team-inline"
                          aria-expanded={open === id}
                          onClick={() => setOpen(open === id ? null : id)}
                        >
                          <TeamChip team={t} />
                          <span>
                            <span className="team-name">{t.name}</span>
                            {id === teamId && <span className="tag-pill">You</span>}
                            <OwnerNotes league={league} teamId={id} />
                          </span>
                          <span className="muted">
                            <Icon name={open === id ? 'chevron-up' : 'chevron-down'} />
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
                        <Rival league={league} c={coordinatorOf(staff, 'offCoord')} />
                      </td>
                      <td>
                        <Rival league={league} c={coordinatorOf(staff, 'defCoord')} />
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
                                {c ? <CoachLink c={c} avatar /> : <span className="tone-bad">Vacant</span>}
                                <span className="muted small">{coachTitle(ch)}</span>
                                {c && <RatePair c={c} />}
                              </li>
                            );
                          })}
                        </ul>
                      </td>
                    </tr>,
                  ];
                },
              )}
            </tbody>
          </table>
        </div>
        <h3 className="coach-group-title">Head coach and coordinator moves this year</h3>
        {moves.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No moves yet. Teams change coaches when the re-sign window closes.
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

// ───────── backing the staff (L4) ─────────

/** How your coordinator's rooms take him, in words; nothing when every room is steady. */
function BeliefStaff({ league, c }: { league: League; c: Coach }) {
  if (c.role !== 'offCoord' && c.role !== 'defCoord') return null;
  const ctx = viewContext(league);
  const facts = SIDE_ROOMS[c.role].flatMap((room) => {
    const f = beliefFact(league, league.userTeamId, room, ctx);
    return f ? [f] : [];
  });
  const line = beliefStaffLine(facts);
  return line ? <p className="small staff-note belief-line">{line}</p> : null;
}

/**
 * Relieve a coordinator in season (L4): who runs his side for the rest of it (the head coach, or a position coach who'd
 * step up), the severance shown before you confirm, or why it can't be done.
 */
function Relieve({ league, c }: { league: League; c: Coach }) {
  const [cover, setCover] = useState<Cover>('headCoach');
  const [confirming, setConfirming] = useState(false);
  const announce = useContext(Announce);
  if (c.role !== 'offCoord' && c.role !== 'defCoord') return null;
  const teamId = league.userTeamId;
  const side = c.role === 'offCoord' ? 'offense' : 'defense';
  const candidates = interimCandidates(league, teamId, c.role);
  const problem = relieveProblem(league, teamId, c.id, cover);
  const pay = coachSeverance(league, c);
  const name = coachName(c);
  const go = () => {
    store.mutate((l) => relieveCoordinator(l, l.userTeamId, c.id, cover));
    announce(`Relieved ${name}${pay > 0 ? `; ${money(pay)} severance booked` : ''}.`, 'mine');
  };
  return (
    <div className="relieve">
      {confirming && (
        <div className="seg seg-sm" role="group" aria-label={`Who runs the ${side} if ${name} goes`}>
          <button aria-pressed={cover === 'headCoach'} onClick={() => setCover('headCoach')}>
            Head coach
          </button>
          {candidates.map((pc) => (
            <button key={pc.id} aria-pressed={cover === pc.id} onClick={() => setCover(pc.id)}>
              {pc.lastName} steps up
            </button>
          ))}
        </div>
      )}
      <div className="staff-actions">
        {confirming ? (
          <>
            <button className="btn btn-sm btn-danger" disabled={!!problem} title={problem ?? undefined} onClick={go}>
              {pay > 0 ? `Pay ${money(pay)} and relieve ${c.firstName}` : `Relieve ${c.firstName}`}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
              Keep him
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm"
            aria-label={`Relieve him${pay > 0 ? ` · ${money(pay)} severance` : ''}, ${name}`}
            disabled={!!problem}
            title={problem ?? undefined}
            onClick={() => setConfirming(true)}
          >
            Relieve him{pay > 0 ? ` · ${money(pay)} severance` : ''}
          </button>
        )}
      </div>
      {problem && <p className="small muted staff-why">{problem}</p>}
    </div>
  );
}
