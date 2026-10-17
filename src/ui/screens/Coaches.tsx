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
  coachTitle,
  coachTrendLabel,
  coachValue,
  extendCoach,
  hireCoach,
  isCoachExpiring,
  maxYears,
  previewCoachHire,
  releaseCoach,
  replaceCoach,
  replaceProblem,
  replaces,
  ROOM_LABEL,
  roomEffect,
  sameChair,
  styleNotes,
  teamCoaches,
  type Chair,
} from '../../engine/coaching';
import { staffWindowOpen, type ResignOutlook } from '../../engine/staff';
import type { Coach, CoachRole, CoachRoom, League } from '../../engine/types';
import { Panel, TeamChip } from '../components';
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
  VETERAN_FROM,
  YOUNG_UNDER,
  type Room,
  type RoomCount,
} from '../coaching';
import { band, money, ordinal, PHASE_LABELS } from '../format';
import { store } from '../store';

type RoleTab = 'head' | 'coord' | 'position' | 'sc';
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
];
const ROLES_OF: Record<RoleTab, CoachRole[]> = { head: ['headCoach'], coord: ['offCoord', 'defCoord'], position: ['positionCoach'], sc: ['strengthCoach'] };
const targetOf = (ch: Chair): Target =>
  ch.role === 'headCoach' ? { tab: 'head' } : ch.role === 'strengthCoach' ? { tab: 'sc' } : ch.role === 'positionCoach' ? { tab: 'position', room: ch.room } : { tab: 'coord', side: ch.role };

const LEADERSHIP: Chair[] = [{ role: 'headCoach' }, { role: 'offCoord' }, { role: 'defCoord' }];
const POSITION_ROOMS: Chair[] = COACH_ROOMS.map((room) => ({ role: 'positionCoach' as const, room }));
const CONDITIONING: Chair[] = [{ role: 'strengthCoach' }];
const GROUPS: [string, Chair[]][] = [
  ['Leadership', LEADERSHIP],
  ['Position rooms', POSITION_ROOMS],
  ['Strength & conditioning', CONDITIONING],
];
const LIMIT = 6;

/** One polite live region for the screen: what the last coaching move did. Moves that remove a card also say where focus should land. */
const Announce = createContext<(text: string, jump?: Jump) => void>(() => {});

const sumDead = (league: League, teamId: number) => league.teams[teamId].coachDead.filter((d) => d.season === league.season).reduce((n, d) => n + d.amount, 0);
/** "Head coach · 2 yrs with you": tenure rides in the subtitle so the card stays short. */
const subtitle = (league: League, c: Coach) => {
  const t = c.since === undefined ? 0 : league.season - c.since;
  return `${coachTitle(c)}${c.since === undefined ? '' : t <= 0 ? ' · new hire' : ` · ${t} yr${t > 1 ? 's' : ''} with you`}`;
};
const years = (n: number) => `${n} year${n > 1 ? 's' : ''}`;

function Trend({ age }: { age: number }) {
  const t = coachTrendLabel(age);
  return <span className={t === 'Rising' ? 'tone-good' : t === 'Declining' ? 'tone-bad' : 'muted'}>{t}</span>;
}

function Skill({ label, value }: { label: string; value: number }) {
  return (
    <span className="fact">
      <span className="eyebrow">{label}</span>
      <b className={`num ${band(value)}`}>{value}</b>
    </span>
  );
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

/** How a head coach or offensive coordinator likes to call a game: only where it stands out. */
function StyleRow({ c }: { c: Coach }) {
  if (c.role !== 'headCoach' && c.role !== 'offCoord') return null;
  const notes = styleNotes(c.style);
  const why = c.role === 'headCoach' ? 'The head coach decides fourth downs, and calls the plays without an offensive coordinator.' : 'The offensive coordinator calls the plays.';
  if (!notes.length) return <span className="muted small">Balanced play-calling</span>;
  return (
    <span className="pill-row" title={why}>
      {notes.map((n) => (
        <span key={n} className="tag-pill">
          {n}
        </span>
      ))}
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
  const expiring = isCoachExpiring(league, c);
  const [term, setTerm] = useState(2);
  // Dismissing someone under contract costs real money: ask once more.
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
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
          <b className="staff-name">{name}</b>
          <span className="muted small">{subtitle(league, c)}</span>
        </div>
        {expiring && <span className="tag-pill tag-warn">Deal up</span>}
      </div>
      <div className="facts">
        <Skill label="Youth development" value={c.youth} />
        <Skill label="Veteran care" value={c.veterans} />
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
      <StyleRow c={c} />
      {expiring ? (
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
              aria-label={`Let ${name} go`}
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
              aria-label={`Extend ${name} for ${years(term)} at ${money(coachAsk(league, c, term))} a year`}
              disabled={!!extendProblem}
              title={extendProblem ?? undefined}
              onClick={() => {
                store.mutate((l) => extendCoach(l, l.userTeamId, c.id, term));
                announce(`Extended ${name} for ${years(term)}.`);
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
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                Keep him
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm"
              aria-label={`Dismiss ${name}${pay > 0 ? `, ${money(pay)} severance` : ''}`}
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
      {open && why && <p className="small muted staff-why">{why}</p>}
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

// ───────── who coaches your players ─────────

function RoomRow({ league, room, staying, count, expanded, onToggle }: { league: League; room: Room; staying: readonly Coach[]; count: RoomCount; expanded: boolean; onToggle: () => void }) {
  const id = useId();
  const coach = room ? chairHolder(staying, { role: 'positionCoach', room }) : null;
  // His deal is up and he doesn't stay: the room is empty come next year.
  const leaving = room ? teamCoaches(league, league.userTeamId).find((c) => c.role === 'positionCoach' && c.room === room && isCoachExpiring(league, c) && !staying.includes(c)) : undefined;
  const effect = roomEffect(staying, room);
  const parts = roomParts(staying, room);
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
          {room === null ? (
            <span className="muted">Head coach and S&C coach</span>
          ) : coach ? (
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
            <span className="muted small">Growth</span> <b className={`num ${growthTone(effect.growth)}`}>{signedPct(effect.growth)}</b>
          </span>
          <span className="fx">
            <span className="muted small">Decline</span> <b className={`num ${agingTone(effect.aging)}`}>{signedPct(effect.aging)}</b>
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
              ? 'Kickers and punters have no room of their own, so the head coach and the strength & conditioning coach share them.'
              : 'A position coach counts most for his room, a coordinator for his side of the ball, the head coach a little for everyone, and the S&C coach most for the body.'}{' '}
            {count.young} of these players {count.young === 1 ? 'is' : 'are'} under {YOUNG_UNDER} (growth) and {count.old} {count.old === 1 ? 'is' : 'are'} {VETERAN_FROM} or older (decline). Percentages are rounded.
          </p>
        </div>
      )}
    </li>
  );
}

// ───────── candidates ─────────

function Candidate({ league, c, open, counts }: { league: League; c: Coach; open: boolean; counts: Map<Room, RoomCount> }) {
  const teamId = league.userTeamId;
  const [term, setTerm] = useState(2);
  const holder = replaces(league, teamId, c);
  const problem = holder ? replaceProblem(league, teamId, c, term) : coachMoveProblem(league, teamId, c, 'hire', term);
  const changes = previewCoachHire(league, teamId, c, term);
  const lines = previewLines(changes);
  const net = gainScore(changes, counts);
  // Hiring now can cost an expiring man his re-signing: his chair or his money goes to the new hire.
  const pushed = problem ? [] : coachesPushedOutBy(league, teamId, c, term);
  const announce = useContext(Announce);
  const name = coachName(c);
  const ask = coachAsk(league, c, term);
  const sev = holder ? coachSeverance(league, holder) : 0;
  const notable = net <= -0.05 ? ' tone-bad' : lines[0].startsWith('No change') ? ' muted' : '';
  return (
    <li className="staff-card coach-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">{name}</b>
          <span className="muted small">{coachTitle(c)}</span>
        </div>
      </div>
      <div className="facts">
        <Skill label="Youth development" value={c.youth} />
        <Skill label="Veteran care" value={c.veterans} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{c.age}</b> <Trend age={c.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Asks</span>
          <span className="staff-age">
            <b className="num">{money(ask)}</b> <span className="muted small">/ yr for {term}</span>
          </span>
        </span>
      </div>
      <StyleRow c={c} />
      {c.lastJob && <p className="small muted staff-why">Last job: {c.lastJob}</p>}
      <p className={`small staff-preview${notable}`}>
        {lines.map((l) => (
          <span key={l} className="preview-line">
            {l}
          </span>
        ))}
        <span className="preview-line muted">Takes effect at next year’s development.</span>
      </p>
      {holder && (
        <p className="small staff-why muted">
          Replaces {coachName(holder)} (<Rates c={holder} />): {sev > 0 ? `${money(sev)} severance books against this year’s coaching budget.` : 'no severance.'}
        </p>
      )}
      {pushed.length > 0 && <p className="small tone-bad staff-preview">Hiring him means {pushed.map(coachName).join(' and ')} won’t be re-signed.</p>}
      <div className="staff-actions">
        <Term value={term} max={maxYears(c.role)} onChange={setTerm} label={`Contract length for ${name}`} />
        <button
          className="btn btn-sm btn-primary"
          aria-label={`${holder ? `Replace ${coachName(holder)} with` : 'Hire'} ${name} for ${years(term)} at ${money(ask)} a year`}
          disabled={!!problem}
          title={problem ?? undefined}
          onClick={() => {
            store.mutate((l) => (holder ? replaceCoach(l, l.userTeamId, c.id, term) : hireCoach(l, l.userTeamId, c.id, term)));
            announce(`${holder ? `Replaced ${coachName(holder)} with` : 'Hired'} ${name}.`, 'candidates');
          }}
        >
          {holder ? `Replace ${holder.lastName}` : 'Hire'} · {money(ask)}/yr
        </button>
      </div>
      {open && problem && <p className="small muted staff-why">{problem}</p>}
    </li>
  );
}

// ───────── around the league ─────────

function Rival({ c }: { c: Coach | null }) {
  if (!c) return <span className="tone-bad small">Vacant</span>;
  return (
    <span className="lc-cell">
      <span>{coachName(c)}</span>
      <span className="small muted num">
        <b className={band(c.youth)}>{c.youth}</b> / <b className={band(c.veterans)}>{c.veterans}</b>
      </span>
      <StyleRow c={c} />
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
  const dead = sumDead(league, teamId);
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
                  {best.holder ? `, instead of ${coachName(best.holder)}` : ''}. {previewLines(best.changes)[0]}
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
    .map((c) => ({ c, score: sort === 'roster' ? gainScore(previewCoachHire(league, teamId, c, 2), counts) : 0 }))
    .sort((a, b) => b.score - a.score || coachValue(b.c) - coachValue(a.c));
  const candidates = sort === 'roster' ? ranked : [...ranked].sort((a, b) => coachValue(b.c) - coachValue(a.c));
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
            the decline of players past their prime. A typical coach (10 or 11) changes nothing. Development runs once a year, so a new hire takes effect at next year&rsquo;s.
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
            Against a typical staff, once the re-sign window closes. <b>Growth</b>: how much faster (+) or slower (−) players under {YOUNG_UNDER} develop. <b>Decline</b>: how much faster (+) or slower (−) players past their prime
            fade, so lower is better. Tap a room to see who counts.
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
                Your coaches
              </h2>
            }
          >
            <div className="stack coach-groups">
              {GROUPS.map(([title, chairs]) => (
                <section key={title} aria-label={title}>
                  <h3 className="coach-group-title">{title}</h3>
                  <ul className="staff-grid">
                    {chairs.flatMap((ch) => {
                      const key = `${ch.role}-${ch.room ?? ''}`;
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
                ? `Ranked by what each hire would do for the players you have: faster growth for your ${totals.young} under ${YOUNG_UNDER}, slower decline for your ${totals.old} aged ${VETERAN_FROM} and over. It takes effect at next year’s development.`
                : 'Ranked by overall quality in the job: youth development and veteran care, weighted for what the job leans on.'}
            </p>
            {candidates.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nobody on the market fits that filter.
              </p>
            ) : (
              <>
                <ul className="staff-grid">
                  {shown.map(({ c }) => (
                    <Candidate key={c.id} league={league} c={c} open={open} counts={counts} />
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
    .filter((t) => t.kind === 'staff' && t.season === league.season && !t.teamIds.includes(teamId))
    .slice(-12)
    .reverse();
  return (
    <Panel>
      <details className="more">
        <summary>Around the league: how all {league.teams.length} coaching staffs grade</summary>
        <p className="muted small">Ratings are youth development / veteran care.</p>
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
                .map(([id, g]) => {
                  const t = league.teams[id];
                  const staff = teamCoaches(league, id);
                  return (
                    <tr key={id} className={id === teamId ? 'me' : undefined}>
                      <td className="num">{g.rank}</td>
                      <td className="sticky-col">
                        <span className="team-inline">
                          <TeamChip team={t} />
                          <span>
                            <span className="team-name">{t.name}</span>
                            {id === teamId && <span className="tag-pill">You</span>}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={`grade grade-${g.grade}`}>{g.grade}</span>
                      </td>
                      <td>
                        <Rival c={chairHolder(staff, { role: 'headCoach' })} />
                      </td>
                      <td>
                        <Rival c={chairHolder(staff, { role: 'offCoord' })} />
                      </td>
                      <td>
                        <Rival c={chairHolder(staff, { role: 'defCoord' })} />
                      </td>
                    </tr>
                  );
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
                <span>{m.text}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </Panel>
  );
}
