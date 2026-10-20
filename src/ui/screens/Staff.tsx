/**
 * The scouting department: who reads which players for you, whose deal is up, and who you could hire.
 * Staff ratings are public, so they show exactly; what they do to a *player's* ratings stays behind
 * the fog of war (see ui/scouting.tsx).
 */
import { createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  departmentGrades,
  extendStaff,
  FOCUS_LABEL,
  FOCUSES,
  GROUPS,
  groupLabel,
  hireStaff,
  isExpiring,
  previewHire,
  pushedOutBy,
  readFor,
  releaseStaff,
  resignForecast,
  ROLE_LABEL,
  SCOUT_ROLE,
  severance,
  staffAsk,
  staffBudget,
  staffMarket,
  staffMoveProblem,
  staffName,
  staffPayroll,
  staffRoomAfterResigns,
  STAFF_SLOTS,
  staffTrendLabel,
  staffValue,
  staffWindowOpen,
  teamStaff,
  weakestSpot,
  type Domain,
  type ReadChange,
  type ResignOutlook,
} from '../../engine/staff';
import { pron } from '../../engine/pronouns';
import type { League, ScoutFocus, Staff, StaffRole } from '../../engine/types';
import { useNav } from '../App';
import { Exact, GradesTable, Panel, Section, Sheet, TeamPicker } from '../components';
import { StaffAvatar } from '../staffAvatar';
import { band, money, ordinal } from '../format';
import { StaffNum, StaffSkill } from '../scouting';
import { store } from '../store';

type Group = ScoutFocus | null;

/** How a position group reads in a sentence. */
const GROUP_PHRASE: Record<ScoutFocus | 'kp', string> = {
  skill: 'QB, RB, WR and TE',
  line: 'the offensive line',
  front: 'DL and LB',
  back: 'CB and S',
  kp: 'kickers and punters',
};
const phrase = (g: Group) => GROUP_PHRASE[g ?? 'kp'];
/** A focus as a button word: "Show college line scouts". */
const FOCUS_NOUN: Record<ScoutFocus, string> = { skill: 'skill', line: 'line', front: 'front', back: 'secondary' };
const ROLE_ORDER: StaffRole[] = ['director', 'collegeScout', 'proScout'];
const ROLE_TABS: [StaffRole, string][] = [
  ['director', 'Directors'],
  ['collegeScout', 'College'],
  ['proScout', 'Pro'],
];
const TERMS = [1, 2, 3];

/** One polite live region for the screen: what the last staff move did. */
const Announce = createContext<(text: string) => void>(() => {});

const roleLine = (s: Staff) => `${ROLE_LABEL[s.role]}${s.focus ? ` · ${FOCUS_LABEL[s.focus]}` : ''}`;
const sumDead = (league: League, teamId: number) =>
  league.teams[teamId].staffDead.filter((d) => d.season === league.season).reduce((n, d) => n + d.amount, 0);

function Trend({ age }: { age: number }) {
  const t = staffTrendLabel(age);
  return <span className={t === 'Rising' ? 'tone-good' : t === 'Declining' ? 'tone-bad' : 'muted'}>{t}</span>;
}

function Term({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="seg seg-sm" role="group" aria-label={label}>
      {TERMS.map((n) => (
        <button key={n} aria-pressed={value === n} onClick={() => onChange(n)}>
          {n} yr
        </button>
      ))}
    </div>
  );
}

// ───────── your staff ─────────

function Member({ league, s, open, outlook }: { league: League; s: Staff; open: boolean; outlook?: ResignOutlook }) {
  const teamId = league.userTeamId;
  const { he, his, him } = pron(s);
  // Another club's scout: the same card to read, without the deal notes and buttons (those are his club's).
  const theirs = s.teamId !== league.userTeamId;
  const expiring = !theirs && isExpiring(league, s);
  const [years, setYears] = useState(2);
  // Dismissing someone under contract costs real money: ask once more.
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const announce = useContext(Announce);
  const name = staffName(s);
  const releaseProblem = staffMoveProblem(league, teamId, s, 'release');
  const extendProblem = expiring ? staffMoveProblem(league, teamId, s, 'extend', years) : null;
  const pay = severance(league, s);
  const why = expiring ? extendProblem : releaseProblem;
  return (
    <li className={`staff-card${expiring ? ' expiring' : ''}`}>
      <div className="staff-head">
        <div className="staff-who">
          <StaffAvatar person={s} size={56} />
          <div>
            <ScoutLink s={s} />
            <span className="muted small">{roleLine(s)}</span>
          </div>
        </div>
        {expiring && <span className="tag-pill tag-warn">Deal up</span>}
      </div>
      <div className="facts">
        <StaffSkill label="Evaluation" value={s.evaluation} />
        <StaffSkill label="Projection" value={s.projection} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{s.age}</b> <Trend age={s.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Salary</span>
          <span className="staff-age">
            <b className="num">{money(s.contract?.salary ?? 0)}</b>{' '}
            <span className="muted small">thru {s.contract?.through}</span>
          </span>
        </span>
      </div>
      {theirs ? null : expiring ? (
        <>
          <p className="small staff-note">
            {outlook === 'budget'
              ? `Deal up: ${he} leaves when free agency opens. Your staff budget can't cover ${his} ask of ${money(staffAsk(league, s, 2))} a year for 2 years.`
              : outlook === 'chair'
                ? `Deal up: ${he} leaves when free agency opens. All ${STAFF_SLOTS[s.role]} ${ROLE_LABEL[s.role].toLowerCase()} jobs are filled.`
                : `Deal up: re-signs for 2 years at ${money(staffAsk(league, s, 2))} when free agency opens unless you let ${him} go.`}
          </p>
          <div className="staff-actions">
            <button
              className="btn btn-sm"
              aria-label={`Let ${name} go`}
              disabled={!!releaseProblem}
              title={releaseProblem ?? undefined}
              onClick={() => {
                store.mutate((l) => releaseStaff(l, l.userTeamId, s.id));
                announce(`Let ${name} go.`);
              }}
            >
              Let go
            </button>
            <Term value={years} onChange={setYears} label={`Extension length for ${name}`} />
            <button
              className="btn btn-sm btn-primary"
              aria-label={`Extend ${name} for ${years} year${years > 1 ? 's' : ''} at ${money(staffAsk(league, s, years))} a year`}
              disabled={!!extendProblem}
              title={extendProblem ?? undefined}
              onClick={() => {
                store.mutate((l) => extendStaff(l, l.userTeamId, s.id, years));
                announce(`Extended ${name} for ${years} year${years > 1 ? 's' : ''}.`);
              }}
            >
              Extend · {money(staffAsk(league, s, years))}/yr
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
                  store.mutate((l) => releaseStaff(l, l.userTeamId, s.id));
                  announce(`Dismissed ${name}; ${money(pay)} severance booked.`);
                }}
              >
                Pay {money(pay)} and dismiss {s.firstName}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                Keep {him}
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm"
              aria-label={`Dismiss ${name}${pay > 0 ? `, ${money(pay)} severance` : ''}`}
              disabled={!!releaseProblem}
              title={releaseProblem ?? undefined}
              onClick={() => (pay > 0 ? setConfirming(true) : store.mutate((l) => releaseStaff(l, l.userTeamId, s.id)))}
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

// ───────── candidates ─────────

/** How clear a read is, in scouting talk: what a 1–20 read rating means for what you'll see. */
const readWord = (r: number) => (r >= 16 ? 'sharp' : r >= 13 ? 'solid' : r >= 10 ? 'fair' : r >= 6 ? 'hazy' : 'blind');

/**
 * The biggest gains a hire brings, evaluation first ("Sharpens prospects on the offensive line: hazy →
 * solid"), and the biggest loss if he pushes someone out or replaces a better Director. Words to read, the
 * read ratings for the tap.
 */
function previewText(changes: ReadChange[]): { words: string; numbers: string } {
  const byImpact = (a: ReadChange, b: ReadChange) =>
    (a.trait === b.trait ? 0 : a.trait === 'evaluation' ? -1 : 1) || Math.abs(b.to - b.from) - Math.abs(a.to - a.from);
  const what = (c: ReadChange) =>
    `${c.trait === 'projection' ? 'ceilings of ' : ''}${c.domain === 'college' ? 'prospects' : 'pros'} on ${phrase(c.group)}`;
  // Same word both sides: say which way it went rather than "fair → fair".
  const words = (c: ReadChange) =>
    `${what(c)} (${readWord(c.from) === readWord(c.to) ? (c.to > c.from ? 'a touch clearer' : 'a touch hazier') : `${readWord(c.from)} → ${readWord(c.to)}`})`;
  const numbers = (c: ReadChange) => `${what(c)}: ${Math.round(c.from)} → ${Math.round(c.to)}`;
  const gains = changes
    .filter((c) => c.to > c.from)
    .sort(byImpact)
    .slice(0, 2);
  const loss = changes.filter((c) => c.to < c.from).sort(byImpact)[0];
  const say = (part: (c: ReadChange) => string) => {
    const text = gains.length ? `Sharpens ${gains.map(part).join(', and ')}` : 'No gain over your current staff';
    return loss ? `${text}. Weakens ${part(loss)}` : text;
  };
  return { words: say(words), numbers: gains.length || loss ? `Read ratings, 1–20: ${say(numbers)}` : '' };
}

/** A scout's name: opens his card. `className` swaps the card-heading look for a plain inline link; `avatar` puts his picture beside it, as in a list. */
function ScoutLink({
  s,
  className = 'staff-name',
  last = false,
  avatar = false,
}: {
  s: Staff;
  className?: string;
  last?: boolean;
  avatar?: boolean;
}) {
  const nav = useNav();
  const name = last ? s.lastName : staffName(s);
  return (
    <button
      className={`linklike ${avatar ? 'staff-link ' : ''}${className}`.trim()}
      onClick={() => nav.openStaff('scout', s.id)}
    >
      {avatar ? (
        <>
          <StaffAvatar person={s} size={28} />
          <span>{name}</span>
        </>
      ) : (
        name
      )}
    </button>
  );
}

/** What each chair does, true to how reads are worked out (`readFor`). */
const SCOUT_ROLE_LINE: Record<StaffRole, string> = {
  director:
    'Runs the department: the Director’s read backs up every group, a step behind a specialist’s, and covers any group no scout does.',
  collegeScout:
    'Reads draft prospects in a position group: what they are now (evaluation) and what they could become (projection).',
  proScout: 'Reads players already in the league in a position group: free agents and trade targets.',
};

/** A scout's full card: his ratings, what his chair does, and for one on the market, what hiring him would sharpen. */
export function ScoutCard({ league, scout: s, onClose }: { league: League; scout: Staff; onClose: () => void }) {
  const teamId = league.userTeamId;
  const { him } = pron(s);
  const team = s.teamId !== null ? league.teams[s.teamId] : null;
  const preview = s.teamId === null ? previewText(previewHire(league, teamId, s, 2)) : null;
  return (
    <Sheet
      label={staffName(s)}
      team={team}
      onClose={onClose}
      head={
        <>
          <StaffAvatar person={s} size={128} />
          <div style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.85, fontSize: 'var(--step--1)' }}>
              {roleLine(s)}
              {team ? ` · ${team.city} ${team.name}` : ' · On the market'}
            </span>
            <h2 style={{ fontSize: 'var(--step-3)' }}>{staffName(s)}</h2>
          </div>
        </>
      }
    >
      <div className="facts">
        <StaffSkill label="Evaluation" value={s.evaluation} />
        <StaffSkill label="Projection" value={s.projection} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{s.age}</b> <Trend age={s.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">{s.contract ? 'Salary' : 'Asks'}</span>
          <span className="staff-age">
            <b className="num">{money(s.contract?.salary ?? staffAsk(league, s, 2))}</b>{' '}
            <span className="muted small">{s.contract ? `thru ${s.contract.through}` : '/ yr for 2'}</span>
          </span>
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {SCOUT_ROLE_LINE[s.role]}
      </p>
      {preview && (
        <Section id="staff-hire" title={`If you hire ${him}`}>
          <div className={`small${preview.words.startsWith('No gain') ? ' muted' : ''}`}>
            {preview.numbers ? <Exact numbers={preview.numbers}>{preview.words}</Exact> : preview.words}
          </div>
        </Section>
      )}
    </Sheet>
  );
}

function Candidate({ league, s, open }: { league: League; s: Staff; open: boolean }) {
  const teamId = league.userTeamId;
  const { him } = pron(s);
  const [years, setYears] = useState(2);
  const problem = staffMoveProblem(league, teamId, s, 'hire', years);
  // Hiring now can cost an expiring man his re-signing: his chair or his money goes to the new hire.
  const pushed = problem ? [] : pushedOutBy(league, teamId, s, years);
  const announce = useContext(Announce);
  const name = staffName(s);
  return (
    <li className="staff-card">
      <div className="staff-head">
        <div className="staff-who">
          <StaffAvatar person={s} size={56} />
          <div>
            <ScoutLink s={s} />
            <span className="muted small">{roleLine(s)}</span>
          </div>
        </div>
      </div>
      <div className="facts">
        <StaffSkill label="Evaluation" value={s.evaluation} />
        <StaffSkill label="Projection" value={s.projection} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{s.age}</b> <Trend age={s.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Asks</span>
          <span className="staff-age">
            <b className="num">{money(staffAsk(league, s, years))}</b>{' '}
            <span className="muted small">/ yr for {years}</span>
          </span>
        </span>
      </div>
      {pushed.length > 0 && (
        <p className="small tone-bad staff-preview">
          Hiring {him} means{' '}
          {pushed.map((p, i) => (
            <Fragment key={p.id}>
              {i > 0 && ' and '}
              <ScoutLink s={p} className="" />
            </Fragment>
          ))}{' '}
          won’t be re-signed.
        </p>
      )}
      <div className="staff-actions">
        <Term value={years} onChange={setYears} label={`Contract length for ${name}`} />
        <button
          className="btn btn-sm btn-primary"
          aria-label={`Hire ${name} for ${years} year${years > 1 ? 's' : ''} at ${money(staffAsk(league, s, years))} a year`}
          disabled={!!problem}
          title={problem ?? undefined}
          onClick={() => {
            store.mutate((l) => hireStaff(l, l.userTeamId, s.id, years));
            announce(`Hired ${name}.`);
          }}
        >
          Hire · {money(staffAsk(league, s, years))}/yr
        </button>
      </div>
      {open && problem && <p className="small muted staff-why">{problem}</p>}
    </li>
  );
}

// ───────── how your staff reads players ─────────

function ReadCell({ league, staff, domain, group }: { league: League; staff: Staff[]; domain: Domain; group: Group }) {
  const r = readFor(staff, domain, group, 'evaluation');
  return (
    <span className="read-cell">
      <span className={`rating ${band(r.rating)}`}>{r.rating}</span>
      <span className={r.by ? 'small' : 'small tone-bad'}>
        {r.by === null ? 'Vacant' : r.by.role === 'director' ? 'Director' : <ScoutLink s={r.by} className="" last />}
        {r.by && isExpiring(league, r.by) && <span title="Deal up"> *</span>}
      </span>
    </span>
  );
}

// ───────── the screen ─────────

export function StaffScreen({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const open = staffWindowOpen(league);
  // teamStaff hands back a shared, cached list: copy before sorting.
  const mine = [...teamStaff(league, teamId)].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || staffValue(b) - staffValue(a),
  );
  const [role, setRole] = useState<StaffRole>('collegeScout');
  const [focus, setFocus] = useState<ScoutFocus | 'any'>('any');
  const [showAll, setShowAll] = useState(false);
  const [status, setStatus] = useState('');
  // Whose department the staff panel shows: yours, or any club's to look at.
  const [viewTeam, setViewTeam] = useState(league.userTeamId);
  const candidatesRef = useRef<HTMLDivElement>(null);
  const candidatesHeading = useRef<HTMLHeadingElement>(null);

  const payroll = staffPayroll(league, teamId);
  const budget = staffBudget(league, teamId);
  // What's really left once the deals that are up re-sign, as they will unless let go.
  const room = staffRoomAfterResigns(league, teamId);
  const dead = sumDead(league, teamId);
  const grades = departmentGrades(league);
  // Another club's department.
  const staffOf = (id: number) => (
    <ul className="team-staff">
      {[...teamStaff(league, id)]
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
        .map((s) => (
          <li key={s.id}>
            <ScoutLink s={s} avatar />
            <span className="muted small">{roleLine(s)}</span>
            <span className="small">
              Evaluation <StaffNum value={s.evaluation} /> · Projection <StaffNum value={s.projection} />
            </span>
          </li>
        ))}
    </ul>
  );
  const mineGrade = grades.get(teamId)!;
  const spot = weakestSpot(league, teamId);
  const forecast = resignForecast(league, teamId);

  const showCandidates = (r: StaffRole, f: ScoutFocus | 'any') => {
    setRole(r);
    setFocus(f);
    setShowAll(false);
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    candidatesRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    // Keyboard and screen-reader users land where the list starts, not back on the button.
    candidatesHeading.current?.focus({ preventScroll: true });
  };

  const spotRole: StaffRole = spot.group === null ? 'director' : SCOUT_ROLE[spot.domain];
  const spotWho: ReactNode =
    spot.read.by === null ? (
      'Director’s chair empty'
    ) : spot.read.by.role === 'director' ? (
      'your Director'
    ) : (
      <ScoutLink s={spot.read.by} className="" />
    );
  const vacancies = ROLE_ORDER.flatMap((r) =>
    Array.from({ length: Math.max(0, STAFF_SLOTS[r] - mine.filter((s) => s.role === r).length) }, () => r),
  );

  const candidates = staffMarket(league)
    .filter((s) => s.role === role && (role === 'director' || focus === 'any' || s.focus === focus))
    .sort((a, b) => staffValue(b) - staffValue(a));
  const expiringCount = mine.filter((s) => isExpiring(league, s)).length;
  const pct = budget > 0 ? Math.min(100, Math.max(0, (payroll / budget) * 100)) : 100;

  const director = mine.find((s) => s.role === 'director');
  const LIMIT = 6;
  const shown = showAll ? candidates : candidates.slice(0, LIMIT);

  return (
    <Announce.Provider value={setStatus}>
      <p className="visually-hidden" role="status" aria-live="polite">
        {status}
      </p>
      {!open && <div className="notice">Staff moves open in the re-sign window and free agency.</div>}

      <Panel title="Scouting staff">
        <div className="facts">
          <span className="fact">
            <span className="eyebrow">Staff budget</span>
            <b className="num">
              {money(payroll)} / {money(budget)}
            </b>
          </span>
          <span className="fact">
            <span className="eyebrow">{expiringCount > 0 ? 'Room after re-signs' : 'Room left'}</span>
            <b className={`num${room < 0 ? ' tone-bad' : ''}`}>{money(room)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Scouting visits left</span>
            <b className="num">{league.scoutPoints}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Department</span>
            <b className="num">
              {mineGrade.grade} · {ordinal(mineGrade.rank)} of {league.teams.length}
            </b>
          </span>
        </div>
        <div
          className={`staff-bar${payroll > budget ? ' over' : ''}`}
          role="img"
          aria-label={`Staff payroll is ${Math.round(pct)}% of the staff budget`}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="muted small staff-lede">
          Staff are paid from their own budget, not the cap
          {dead > 0 ? ` (${money(dead)} of this year's is severance)` : ''}. Your scouts set how wide your ranges are: a
          sharper read is closer to the truth and surer of it.
        </p>
        <div className="callout staff-next">
          <span>
            <b>Weakest spot:</b> {spot.domain} reads on {phrase(spot.group)} ({spotWho}, read {spot.read.rating}).
            {expiringCount > 0 && open
              ? ` ${expiringCount === 1 ? 'One deal is' : `${expiringCount} deals are`} up below.`
              : ''}
          </span>
          <button className="btn btn-sm" onClick={() => showCandidates(spotRole, spot.group ?? 'any')}>
            {spot.group === null ? 'Show Directors' : `Show ${spot.domain} ${FOCUS_NOUN[spot.group]} scouts`}
          </button>
        </div>
      </Panel>

      <Panel title="How your staff reads players">
        <p className="muted small" style={{ marginTop: 0 }}>
          The number is how well each group is read for you, and by whom: whoever scores highest. A scout gets +3 on
          their own group and −3 on others; the Director reads every group at their rating −1.
        </p>
        <div className="table-scroll">
          <table className="read-table">
            <thead>
              <tr>
                <th>Position group</th>
                <th>Prospects</th>
                <th>Pros</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => (
                <tr key={g ?? 'kp'}>
                  <th scope="row">{groupLabel(g)}</th>
                  <td>
                    <ReadCell league={league} staff={mine} domain="college" group={g} />
                  </td>
                  <td>
                    <ReadCell league={league} staff={mine} domain="pro" group={g} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mine.some((s) => isExpiring(league, s)) && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            * Deal up.
          </p>
        )}
      </Panel>

      <Panel
        title={
          viewTeam === teamId ? 'Your staff' : `${league.teams[viewTeam].city} ${league.teams[viewTeam].name} staff`
        }
        action={<TeamPicker league={league} value={viewTeam} onChange={setViewTeam} />}
      >
        <ul className="staff-grid">
          {(viewTeam === teamId
            ? mine
            : [...teamStaff(league, viewTeam)].sort(
                (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || staffValue(b) - staffValue(a),
              )
          ).map((s) => (
            <Member key={s.id} league={league} s={s} open={open} outlook={forecast.get(s.id)} />
          ))}
          {viewTeam === teamId &&
            vacancies.map((r, i) => (
              <li key={`${r}-${i}`} className="staff-card vacant">
                <b className="staff-name">Open chair</b>
                <span className="muted small">
                  {r === 'director'
                    ? 'No Director: every group without a specialist is read badly until you hire one.'
                    : `Room for one more ${ROLE_LABEL[r].toLowerCase()}: a specialist in a group nobody covers sharpens it.`}
                </span>
                <div className="staff-actions">
                  <button className="btn btn-sm" onClick={() => showCandidates(r, 'any')}>
                    Find {r === 'director' ? 'a Director' : r === 'collegeScout' ? 'a college scout' : 'a pro scout'}
                  </button>
                </div>
              </li>
            ))}
        </ul>
      </Panel>

      <div ref={candidatesRef} className="staff-anchor">
        <Panel
          title={
            <h2 ref={candidatesHeading} tabIndex={-1}>
              Candidates
            </h2>
          }
          action={
            <span className="board-sort">
              <div className="seg seg-sm" role="group" aria-label="Candidate role">
                {ROLE_TABS.map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={role === key}
                    onClick={() => {
                      setRole(key);
                      setShowAll(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {role !== 'director' && (
                <select
                  aria-label="Filter by focus"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value as ScoutFocus | 'any')}
                >
                  <option value="any">Any focus</option>
                  {FOCUSES.map((f) => (
                    <option key={f} value={f}>
                      {FOCUS_LABEL[f]}
                    </option>
                  ))}
                </select>
              )}
            </span>
          }
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            Best first.{' '}
            {role === 'director'
              ? director && isExpiring(league, director)
                ? 'Hiring one replaces your Director, whose deal is up. '
                : 'You can only hold one Director, so dismiss yours before hiring another. '
              : ''}
            Tap a name to see how hiring them would change your reads.
          </p>
          {candidates.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nobody on the market fits that filter.
            </p>
          ) : (
            <>
              <ul className="staff-grid">
                {shown.map((s) => (
                  <Candidate key={s.id} league={league} s={s} open={open} />
                ))}
              </ul>
              {candidates.length > LIMIT && (
                <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAll(!showAll)}>
                  {showAll ? `Show the best ${LIMIT}` : `Show all ${candidates.length}`}
                </button>
              )}
            </>
          )}
        </Panel>
      </div>

      <Panel>
        <details className="more">
          <summary>Around the league: how all {league.teams.length} departments grade</summary>
          <GradesTable league={league} grades={grades} staffOf={staffOf} />
        </details>
      </Panel>
    </Announce.Provider>
  );
}
