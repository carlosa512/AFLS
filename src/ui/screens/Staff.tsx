/**
 * The scouting department: who reads which players for you, whose deal is up, and who you could hire.
 * Staff ratings are public, so they show exactly; what they do to a *player's* ratings stays behind
 * the fog of war (see ui/scouting.tsx).
 */
import { useRef, useState } from 'react';
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
import type { League, ScoutFocus, Staff, StaffRole } from '../../engine/types';
import { Panel, TeamChip } from '../components';
import { band, money, ordinal } from '../format';
import { store } from '../store';

type Group = ScoutFocus | null;

/** How a position group reads in a sentence. */
const GROUP_PHRASE: Record<ScoutFocus | 'kp', string> = { skill: 'QB, RB, WR and TE', line: 'the offensive line', front: 'DL and LB', back: 'CB and S', kp: 'kickers and punters' };
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

const roleLine = (s: Staff) => `${ROLE_LABEL[s.role]}${s.focus ? ` · ${FOCUS_LABEL[s.focus]}` : ''}`;
const sumDead = (league: League, teamId: number) => league.teams[teamId].staffDead.filter((d) => d.season === league.season).reduce((n, d) => n + d.amount, 0);

function Trend({ age }: { age: number }) {
  const t = staffTrendLabel(age);
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
  const expiring = isExpiring(league, s);
  const [years, setYears] = useState(2);
  // Dismissing someone under contract costs real money: ask once more.
  const [confirming, setConfirming] = useState(false);
  const releaseProblem = staffMoveProblem(league, teamId, s, 'release');
  const extendProblem = expiring ? staffMoveProblem(league, teamId, s, 'extend', years) : null;
  const pay = severance(league, s);
  const why = expiring ? extendProblem : releaseProblem;
  return (
    <li className={`staff-card${expiring ? ' expiring' : ''}`}>
      <div className="staff-head">
        <div>
          <b className="staff-name">{staffName(s)}</b>
          <span className="muted small">{roleLine(s)}</span>
        </div>
        {expiring && <span className="tag-pill tag-warn">Deal up</span>}
      </div>
      <div className="facts">
        <Skill label="Evaluation" value={s.evaluation} />
        <Skill label="Projection" value={s.projection} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{s.age}</b> <Trend age={s.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Salary</span>
          <span className="staff-age">
            <b className="num">{money(s.contract?.salary ?? 0)}</b> <span className="muted small">thru {s.contract?.through}</span>
          </span>
        </span>
      </div>
      {expiring ? (
        <>
          <p className="small staff-note">
            {outlook === 'budget'
              ? `Deal up: he leaves when free agency opens. Your staff budget can't cover his ask of ${money(staffAsk(league, s, 2))} a year for 2 years.`
              : outlook === 'chair'
                ? `Deal up: he leaves when free agency opens. All ${STAFF_SLOTS[s.role]} ${ROLE_LABEL[s.role].toLowerCase()} jobs are filled.`
                : `Deal up: re-signs for 2 years at ${money(staffAsk(league, s, 2))} when free agency opens unless you let him go.`}
          </p>
          <div className="staff-actions">
            <button className="btn btn-sm" disabled={!!releaseProblem} title={releaseProblem ?? undefined} onClick={() => store.mutate((l) => releaseStaff(l, l.userTeamId, s.id))}>
              Let go
            </button>
            <Term value={years} onChange={setYears} label={`Extension length for ${staffName(s)}`} />
            <button className="btn btn-sm btn-primary" disabled={!!extendProblem} title={extendProblem ?? undefined} onClick={() => store.mutate((l) => extendStaff(l, l.userTeamId, s.id, years))}>
              Extend · {money(staffAsk(league, s, years))}/yr
            </button>
          </div>
        </>
      ) : (
        <div className="staff-actions">
          {confirming ? (
            <>
              <button className="btn btn-sm btn-danger" onClick={() => store.mutate((l) => releaseStaff(l, l.userTeamId, s.id))}>
                Pay {money(pay)} and dismiss
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                Keep him
              </button>
            </>
          ) : (
            <button className="btn btn-sm" disabled={!!releaseProblem} title={releaseProblem ?? undefined} onClick={() => (pay > 0 ? setConfirming(true) : store.mutate((l) => releaseStaff(l, l.userTeamId, s.id)))}>
              Dismiss{pay > 0 ? ` · ${money(pay)} severance` : ''}
            </button>
          )}
        </div>
      )}
      {open && why && <p className="small muted staff-why">{why}</p>}
    </li>
  );
}

// ───────── candidates ─────────

/** The biggest gains a hire brings, evaluation first: "Sharpens prospects on the offensive line: 10 → 14". */
function previewText(changes: ReadChange[]): string {
  const gains = changes
    .filter((c) => c.to > c.from)
    .sort((a, b) => (a.trait === b.trait ? 0 : a.trait === 'evaluation' ? -1 : 1) || b.to - b.from - (a.to - a.from))
    .slice(0, 2);
  if (!gains.length) return 'No gain over your current staff';
  const part = (c: ReadChange) => `${c.trait === 'projection' ? 'ceilings of ' : ''}${c.domain === 'college' ? 'prospects' : 'pros'} on ${phrase(c.group)}: ${c.from} → ${c.to}`;
  return `Sharpens ${gains.map(part).join(', and ')}`;
}

function Candidate({ league, s, open }: { league: League; s: Staff; open: boolean }) {
  const teamId = league.userTeamId;
  const [years, setYears] = useState(2);
  const problem = staffMoveProblem(league, teamId, s, 'hire', years);
  const preview = previewText(previewHire(league, teamId, s));
  return (
    <li className="staff-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">{staffName(s)}</b>
          <span className="muted small">{roleLine(s)}</span>
        </div>
      </div>
      <div className="facts">
        <Skill label="Evaluation" value={s.evaluation} />
        <Skill label="Projection" value={s.projection} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{s.age}</b> <Trend age={s.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Asks</span>
          <span className="staff-age">
            <b className="num">{money(staffAsk(league, s, years))}</b> <span className="muted small">/ yr for {years}</span>
          </span>
        </span>
      </div>
      <p className={`small staff-preview${preview.startsWith('No gain') ? ' muted' : ''}`}>{preview}</p>
      <div className="staff-actions">
        <Term value={years} onChange={setYears} label={`Contract length for ${staffName(s)}`} />
        <button className="btn btn-sm btn-primary" disabled={!!problem} title={problem ?? undefined} onClick={() => store.mutate((l) => hireStaff(l, l.userTeamId, s.id, years))}>
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
        {r.by === null ? 'Vacant' : r.by.role === 'director' ? 'Director' : r.by.lastName}
        {r.by && isExpiring(league, r.by) && <span title="His deal is up"> *</span>}
      </span>
    </span>
  );
}

// ───────── the screen ─────────

export function StaffScreen({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const open = staffWindowOpen(league);
  // teamStaff hands back a shared, cached list: copy before sorting.
  const mine = [...teamStaff(league, teamId)].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || staffValue(b) - staffValue(a));
  const [role, setRole] = useState<StaffRole>('collegeScout');
  const [focus, setFocus] = useState<ScoutFocus | 'any'>('any');
  const candidatesRef = useRef<HTMLDivElement>(null);

  const payroll = staffPayroll(league, teamId);
  const budget = staffBudget(league, teamId);
  const room = budget - payroll;
  const dead = sumDead(league, teamId);
  const grades = departmentGrades(league);
  const mineGrade = grades.get(teamId)!;
  const spot = weakestSpot(league, teamId);
  const forecast = resignForecast(league, teamId);

  const showCandidates = (r: StaffRole, f: ScoutFocus | 'any') => {
    setRole(r);
    setFocus(f);
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    candidatesRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };

  const spotRole: StaffRole = spot.group === null ? 'director' : SCOUT_ROLE[spot.domain];
  const spotWho = spot.read.by === null ? 'Director’s chair empty' : spot.read.by.role === 'director' ? 'your Director' : staffName(spot.read.by);
  const vacancies = ROLE_ORDER.flatMap((r) => Array.from({ length: Math.max(0, STAFF_SLOTS[r] - mine.filter((s) => s.role === r).length) }, () => r));

  const candidates = staffMarket(league)
    .filter((s) => s.role === role && (role === 'director' || focus === 'any' || s.focus === focus))
    .sort((a, b) => staffValue(b) - staffValue(a));
  const expiringCount = mine.filter((s) => isExpiring(league, s)).length;
  const pct = budget > 0 ? Math.min(100, Math.max(0, (payroll / budget) * 100)) : 100;

  return (
    <>
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
            <span className="eyebrow">Room left</span>
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
        <div className={`staff-bar${payroll > budget ? ' over' : ''}`} role="img" aria-label={`Staff payroll is ${Math.round(pct)}% of the staff budget`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="muted small staff-lede">
          Staff are paid from their own budget, not the cap{dead > 0 ? ` (${money(dead)} of this year's is severance)` : ''}. Your scouts set how wide your ranges are: a sharper read is closer to the truth
          and surer of it.
        </p>
        <div className="callout staff-next">
          <span>
            <b>Weakest spot:</b> {spot.domain} reads on {phrase(spot.group)} ({spotWho}, read {spot.read.rating}).
            {expiringCount > 0 && open ? ` ${expiringCount === 1 ? 'One deal is' : `${expiringCount} deals are`} up below.` : ''}
          </span>
          <button className="btn btn-sm" onClick={() => showCandidates(spotRole, spot.group ?? 'any')}>
            {spot.group === null ? 'Show Directors' : `Show ${spot.domain} ${FOCUS_NOUN[spot.group]} scouts`}
          </button>
        </div>
      </Panel>

      <Panel title="How your staff reads players">
        <p className="muted small" style={{ marginTop: 0 }}>
          The number is who reads each group for you and how well. A scout reads his own group best; the Director covers any group nobody specialises in, a step below his rating.
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
            * His deal is up.
          </p>
        )}
      </Panel>

      <Panel title="Your staff">
        <ul className="staff-grid">
          {mine.map((s) => (
            <Member key={s.id} league={league} s={s} open={open} outlook={forecast.get(s.id)} />
          ))}
          {vacancies.map((r, i) => (
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
          title="Candidates"
          action={
            <span className="board-sort">
              <div className="seg seg-sm" role="group" aria-label="Candidate role">
                {ROLE_TABS.map(([key, label]) => (
                  <button key={key} aria-pressed={role === key} onClick={() => setRole(key)}>
                    {label}
                  </button>
                ))}
              </div>
              {role !== 'director' && (
                <select aria-label="Filter by focus" value={focus} onChange={(e) => setFocus(e.target.value as ScoutFocus | 'any')}>
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
            Best first. {role === 'director' ? 'You can only hold one Director, so dismiss yours before hiring another. ' : ''}Each hire shows how he would change your reads.
          </p>
          {candidates.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nobody on the market fits that filter.
            </p>
          ) : (
            <ul className="staff-grid">
              {candidates.map((s) => (
                <Candidate key={s.id} league={league} s={s} open={open} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <details className="more">
          <summary>Around the league: how all {league.teams.length} departments grade</summary>
          <div className="table-scroll">
            <table className="league-grades">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Team</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {[...grades]
                  .sort((a, b) => a[1].rank - b[1].rank)
                  .map(([id, g]) => {
                    const t = league.teams[id];
                    return (
                      <tr key={id} className={id === teamId ? 'me' : undefined}>
                        <td className="num">{g.rank}</td>
                        <td>
                          <span className="team-inline">
                            <TeamChip team={t} />
                            <span>
                              {t.city} {t.name}
                              {id === teamId && <span className="tag-pill">You</span>}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={`grade grade-${g.grade}`}>{g.grade}</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </details>
      </Panel>
    </>
  );
}
