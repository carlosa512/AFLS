/**
 * The medical staff: who treats your players, what the department does for layoffs and fresh legs,
 * your injury report, and who you could hire. Staff ratings are public, so they show exactly; a
 * player's injury proneness stays a word (see ui/injuries.tsx).
 */
import { useState } from 'react';
import { injuryLabel, estimateText, weeksLeft } from '../../engine/injuries';
import {
  conditionBonus,
  departmentFor,
  extendMedic,
  hireMedic,
  isMedicExpiring,
  MEDIC_ROLE_LABEL,
  MEDIC_ROLES,
  MEDIC_SLOTS,
  medicalBudget,
  medicalGrades,
  medicalPayroll,
  medicalRoom,
  medicAsk,
  medicMarket,
  medicMoveProblem,
  medicName,
  medicResignForecast,
  medicSeverance,
  medicTrendLabel,
  medicValue,
  preventionMultiplier,
  previewMedicHire,
  recoveryMultiplier,
  releaseMedic,
  teamMedics,
  type Department,
} from '../../engine/medical';
import { teamPlayers } from '../../engine/roster';
import { staffWindowOpen } from '../../engine/staff';
import type { League, Medic, MedicRole } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar, TeamChip } from '../components';
import { band, money, ordinal } from '../format';
import { conditionTone, InjuryTag } from '../injuries';
import { store } from '../store';

const TERMS = [1, 2, 3];
const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
/** Worth a mention: at least 1% once rounded. */
const shows = (x: number) => Math.round(Math.abs(x) * 100) >= 1;

/** What a department does, in plain numbers against a baseline (9-or-below) department. */
function effects(d: Department) {
  const rehab = 1 - recoveryMultiplier(d.physio);
  const prevention = 1 - preventionMultiplier(d.science);
  const recovery = conditionBonus(d.science);
  return { rehab, prevention, recovery };
}

function Trend({ age }: { age: number }) {
  const t = medicTrendLabel(age);
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

function Member({ league, m, open }: { league: League; m: Medic; open: boolean }) {
  const teamId = league.userTeamId;
  const expiring = isMedicExpiring(league, m);
  const [years, setYears] = useState(2);
  const outlook = expiring ? medicResignForecast(league, teamId).get(m.id) : undefined;
  const releaseProblem = medicMoveProblem(league, teamId, m, 'release');
  const extendProblem = expiring ? medicMoveProblem(league, teamId, m, 'extend', years) : null;
  const pay = medicSeverance(league, m);
  return (
    <li className={`staff-card${expiring ? ' expiring' : ''}`}>
      <div className="staff-head">
        <div>
          <b className="staff-name">{medicName(m)}</b>
          <span className="muted small">{MEDIC_ROLE_LABEL[m.role]}</span>
        </div>
        {expiring && <span className="tag-pill tag-warn">Deal up</span>}
      </div>
      <div className="facts">
        <Skill label="Physiotherapy" value={m.physio} />
        <Skill label="Sports science" value={m.science} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{m.age}</b> <Trend age={m.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Salary</span>
          <span className="staff-age">
            <b className="num">{money(m.contract?.salary ?? 0)}</b> <span className="muted small">thru {m.contract?.through}</span>
          </span>
        </span>
      </div>
      {expiring && (
        <p className="small staff-note">
          {outlook === 'stays'
            ? `Deal up: re-signs for 2 years at ${money(medicAsk(league, m, 2))} when free agency opens unless you let him go.`
            : outlook === 'budget'
              ? `Deal up: he leaves when free agency opens. Your medical budget can't cover his ask of ${money(medicAsk(league, m, 2))}.`
              : 'Deal up: he leaves when free agency opens. His chair is taken.'}
        </p>
      )}
      <div className="staff-actions">
        <button className="btn btn-sm" disabled={!!releaseProblem} title={releaseProblem ?? undefined} onClick={() => store.mutate((l) => releaseMedic(l, l.userTeamId, m.id))}>
          {expiring ? 'Let go' : `Dismiss${pay > 0 ? ` · ${money(pay)} severance` : ''}`}
        </button>
        {expiring && (
          <>
            <Term value={years} onChange={setYears} label={`Extension length for ${medicName(m)}`} />
            <button className="btn btn-sm btn-primary" disabled={!!extendProblem} title={extendProblem ?? undefined} onClick={() => store.mutate((l) => extendMedic(l, l.userTeamId, m.id, years))}>
              Extend · {money(medicAsk(league, m, years))}/yr
            </button>
          </>
        )}
      </div>
      {open && (expiring ? extendProblem : releaseProblem) && <p className="small muted staff-why">{expiring ? extendProblem : releaseProblem}</p>}
    </li>
  );
}

function Candidate({ league, m, open }: { league: League; m: Medic; open: boolean }) {
  const teamId = league.userTeamId;
  const [years, setYears] = useState(2);
  const problem = medicMoveProblem(league, teamId, m, 'hire', years);
  const { from, to } = previewMedicHire(league, teamId, m);
  const change = (label: string, a: number, b: number) => (Math.abs(b - a) >= 0.05 ? `${label} ${a.toFixed(1)} → ${b.toFixed(1)}` : null);
  const preview = [change('physiotherapy', from.physio, to.physio), change('sports science', from.science, to.science)].filter(Boolean).join(', ');
  return (
    <li className="staff-card">
      <div className="staff-head">
        <div>
          <b className="staff-name">{medicName(m)}</b>
          <span className="muted small">
            {MEDIC_ROLE_LABEL[m.role]}
            {m.lastJob ? ` · last: ${m.lastJob}` : ''}
          </span>
        </div>
      </div>
      <div className="facts">
        <Skill label="Physiotherapy" value={m.physio} />
        <Skill label="Sports science" value={m.science} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{m.age}</b> <Trend age={m.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">Asks</span>
          <span className="staff-age">
            <b className="num">{money(medicAsk(league, m, years))}</b> <span className="muted small">/ yr for {years}</span>
          </span>
        </span>
      </div>
      <p className={`small staff-preview${preview ? '' : ' muted'}`}>{preview ? `Department ${preview}` : 'No gain over your current staff'}</p>
      <div className="staff-actions">
        <Term value={years} onChange={setYears} label={`Contract length for ${medicName(m)}`} />
        <button className="btn btn-sm btn-primary" disabled={!!problem} title={problem ?? undefined} onClick={() => store.mutate((l) => hireMedic(l, l.userTeamId, m.id, years))}>
          Hire · {money(medicAsk(league, m, years))}/yr
        </button>
      </div>
      {open && problem && <p className="small muted staff-why">{problem}</p>}
    </li>
  );
}

/** Your injured players, worst first: what they have, how long, and where they stand. */
function InjuryReport({ league }: { league: League }) {
  const nav = useNav();
  const teamId = league.userTeamId;
  const team = league.teams[teamId];
  const hurt = teamPlayers(league, teamId)
    .filter((p) => p.injury || p.ir)
    .sort((a, b) => (b.injury?.weeksRemaining ?? 0) - (a.injury?.weeksRemaining ?? 0));
  const tired = teamPlayers(league, teamId)
    .filter((p) => !p.injury && !p.ir && (p.condition ?? 100) < 80)
    .sort((a, b) => (a.condition ?? 100) - (b.condition ?? 100));
  return (
    <Panel title="Injury report">
      <p className="muted small" style={{ marginTop: 0 }}>
        {team.autoInjuries === false
          ? 'You manage injuries yourself: place long injuries on reserve and sign replacements from the player card and free agency.'
          : 'Your staff moves long injuries to reserve, brings players back when they heal, and signs a replacement when a position runs short. Turn that off on the roster screen.'}
      </p>
      {hurt.length === 0 ? (
        <p className="muted">Nobody is hurt.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="sticky-col">Player</th>
                <th>Injury</th>
                <th>Outlook</th>
              </tr>
            </thead>
            <tbody>
              {hurt.map((p) => (
                <tr key={p.id}>
                  <td className="sticky-col">
                    <button className="linklike player-link" onClick={() => nav.openPlayer(p.id)}>
                      <PlayerAvatar player={p} team={team} size={26} />
                      <span>
                        {p.position} {p.firstName} {p.lastName}
                      </span>
                    </button>
                  </td>
                  <td>
                    {p.injury ? injuryLabel(p.injury.type) : 'Healed'}
                    <InjuryTag league={league} p={p} />
                  </td>
                  <td className="muted small">{p.injury ? (p.injury.injected ? 'Playing through it' : estimateText(p.injury, weeksLeft(league))) : 'Ready to come off reserve'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tired.length > 0 && (
        <p className="small" style={{ marginBottom: 0 }}>
          <b>Worn down:</b>{' '}
          {tired.slice(0, 6).map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <button className="linklike" onClick={() => nav.openPlayer(p.id)}>
                {p.position} {p.lastName}
              </button>{' '}
              <span className={conditionTone(p.condition ?? 100)}>{Math.round(p.condition ?? 100)}%</span>
            </span>
          ))}
          . Below 65 in a game the injury risk climbs fast; a week off brings most of it back.
        </p>
      )}
    </Panel>
  );
}

export function MedicalScreen({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const open = staffWindowOpen(league);
  const mine = [...teamMedics(league, teamId)].sort((a, b) => MEDIC_ROLES.indexOf(a.role) - MEDIC_ROLES.indexOf(b.role) || medicValue(b) - medicValue(a));
  const [role, setRole] = useState<MedicRole>('physio');
  const [showAll, setShowAll] = useState(false);
  const dept = departmentFor(league, teamId);
  const e = effects(dept);
  const grades = medicalGrades(league);
  const mineGrade = grades.get(teamId)!;
  const payroll = medicalPayroll(league, teamId);
  const budget = medicalBudget(league, teamId);
  const room = medicalRoom(league, teamId);
  const fill = budget > 0 ? Math.min(100, Math.max(0, (payroll / budget) * 100)) : 100;
  const vacancies = MEDIC_ROLES.flatMap((r) => Array.from({ length: Math.max(0, MEDIC_SLOTS[r] - mine.filter((m) => m.role === r).length) }, () => r));
  const candidates = medicMarket(league)
    .filter((m) => m.role === role)
    .sort((a, b) => medicValue(b) - medicValue(a));
  const LIMIT = 6;
  const shown = showAll ? candidates : candidates.slice(0, LIMIT);

  return (
    <>
      {!open && <div className="notice">Medical staff moves open in the re-sign window and free agency.</div>}

      <Panel title="Medical staff">
        <div className="facts">
          <span className="fact">
            <span className="eyebrow">Medical budget</span>
            <b className="num">
              {money(payroll)} / {money(budget)}
            </b>
          </span>
          <span className="fact">
            <span className="eyebrow">Room left</span>
            <b className={`num${room < 0 ? ' tone-bad' : ''}`}>{money(room)}</b>
          </span>
          <Skill label="Physiotherapy" value={Math.round(dept.physio * 10) / 10} />
          <Skill label="Sports science" value={Math.round(dept.science * 10) / 10} />
          <span className="fact">
            <span className="eyebrow">Department</span>
            <b className="num">
              {mineGrade.grade} · {ordinal(mineGrade.rank)} of {league.teams.length}
            </b>
          </span>
        </div>
        <div className={`staff-bar${payroll > budget ? ' over' : ''}`} role="img" aria-label={`Medical payroll is ${Math.round(fill)}% of the medical budget`}>
          <i style={{ width: `${fill}%` }} />
        </div>
        <ul className="medical-effects small">
          <li>
            <b>Rehab:</b> {shows(e.rehab) ? `layoffs ${pct(e.rehab)} shorter than the standard timeline` : 'the standard clinical timeline (a physiotherapy above 9 starts to shorten it)'}.
          </li>
          <li>
            <b>Prevention:</b> {shows(e.prevention) ? `${pct(e.prevention)} fewer soft-tissue injuries` : 'no edge on soft-tissue injuries (a sports science above 10 starts to cut them)'}
            {shows(e.recovery) ? `, and ${pct(e.recovery)} more of a player's lost condition back each week` : ''}.
          </li>
          <li>
            <b>Diagnosis:</b> the head doctor's estimates {dept.diagnosis >= 14 ? 'land close to the real layoff' : dept.diagnosis >= 10 ? 'are usually within a week or two' : 'can miss by weeks'}.
          </li>
        </ul>
        <p className="muted small staff-lede">
          Staff are paid from their own budget, not the cap. Elite rehab (18–20) takes up to a quarter off every layoff; anything at 9 or below follows the standard timeline, never a slower one.
        </p>
      </Panel>

      <InjuryReport league={league} />

      <Panel title="Your staff">
        <ul className="staff-grid">
          {mine.map((m) => (
            <Member key={m.id} league={league} m={m} open={open} />
          ))}
          {vacancies.map((r, i) => (
            <li key={`${r}-${i}`} className="staff-card vacant">
              <b className="staff-name">Open chair</b>
              <span className="muted small">An empty {MEDIC_ROLE_LABEL[r].toLowerCase()} chair works like a replacement-level clinician (6).</span>
              <div className="staff-actions">
                <button className="btn btn-sm" onClick={() => setRole(r)}>
                  Find a {MEDIC_ROLE_LABEL[r].toLowerCase()}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Candidates"
        action={
          <div className="seg seg-sm" role="group" aria-label="Candidate role">
            {MEDIC_ROLES.map((r) => (
              <button
                key={r}
                aria-pressed={role === r}
                onClick={() => {
                  setRole(r);
                  setShowAll(false);
                }}
              >
                {MEDIC_ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        }
      >
        <p className="muted small" style={{ marginTop: 0 }}>
          Best first. Physios carry most of the rehab, the sports scientist most of the prevention, the head doctor both and the diagnosis. Each hire shows how he would change your department.
        </p>
        {candidates.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nobody on the market for that role.
          </p>
        ) : (
          <>
            <ul className="staff-grid">
              {shown.map((m) => (
                <Candidate key={m.id} league={league} m={m} open={open} />
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

      <Panel>
        <details className="more">
          <summary>Around the league: how all {league.teams.length} medical staffs grade</summary>
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
