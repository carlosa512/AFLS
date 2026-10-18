/**
 * The medical staff: who treats your players, what the department does for layoffs and fresh legs,
 * your injury report, and who you could hire. Staff ratings are public, so they show exactly; a
 * player's injury proneness stays a word (see ui/injuries.tsx).
 */
import { useState } from 'react';
import { injuryLabel, estimateText, SEVERITY_LABEL, weeksLeft } from '../../engine/injuries';
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
import type { InjuryRecord, League, Medic, MedicRole, Player } from '../../engine/types';
import { useNav } from '../App';
import { Exact, GradesTable, Panel, PlayerAvatar, Section, Sheet, TeamChip } from '../components';
import { money, ordinal, resultsSeason, verdict, type Verdict } from '../format';
import { conditionTone, InjuryTag } from '../injuries';
import { ReadNum, StaffSkill } from '../scouting';
import { medicReads, seenMedic } from '../../engine/scouting';
import { store } from '../store';

const TERMS = [1, 2, 3];
const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
/** Worth a mention: at least 1% once rounded. */
const shows = (x: number) => Math.round(Math.abs(x) * 100) >= 1;

/** How big each effect can get at 20 (a quarter off layoffs and soft-tissue injuries, a tenth more condition back). */
const MAX = { rehab: 0.25, prevention: 0.25, recovery: 0.1 };
/** A department on the shared scale: never below Average, since a weak one only follows the standard timeline. */
const rehabVerdict = (d: Department) => verdict(effects(d).rehab, MAX.rehab);
const preventionVerdict = (d: Department) => verdict(effects(d).prevention, MAX.prevention);

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
          <MedicLink m={m} />
          <span className="muted small">{MEDIC_ROLE_LABEL[m.role]}</span>
        </div>
        {expiring && <span className="tag-pill tag-warn">Deal up</span>}
      </div>
      <div className="facts">
        <StaffSkill label="Physiotherapy" value={m.physio} />
        <StaffSkill label="Sports science" value={m.science} />
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

/** A medic's name: opens his card. */
function MedicLink({ m }: { m: Medic }) {
  const nav = useNav();
  return (
    <button className="linklike staff-name" onClick={() => nav.openStaff('medic', m.id)}>
      {medicName(m)}
    </button>
  );
}

/** What each chair does, true to how the department is worked out (`departmentOf`). */
const MEDIC_ROLE_LINE: Record<MedicRole, string> = {
  doctor: 'Makes the call on every injury (how good the layoff estimates are) and has a hand in rehab and prevention.',
  physio: 'Runs rehab with the other physiotherapist: the biggest say in how soon injured players get back.',
  scientist: 'Runs load management: the biggest say in soft-tissue injuries and how fast players get their legs back.',
};

/** What hiring `m` would do to your department, from your read of him, in words with the ratings for the tap. */
function hirePreview(league: League, teamId: number, m: Medic): { words: string; numbers: string } | null {
  // His true ratings stay his old club's secret.
  const { from, to } = previewMedicHire(league, teamId, seenMedic(league, teamId, m));
  const change = (label: string, a: number, b: number) => (Math.abs(b - a) >= 0.05 ? `${label} ${a.toFixed(1)} → ${b.toFixed(1)}` : null);
  const numbers = [change('physiotherapy', from.physio, to.physio), change('sports science', from.science, to.science)].filter(Boolean).join(', ');
  if (!numbers) return null;
  // Same word both sides: say which way it went rather than "Average → Average".
  const step = (what: string, a: Verdict, b: Verdict, up: boolean) => (a.word === b.word ? `${what} a touch ${up ? 'better' : 'worse'}` : `${what} ${a.word} → ${b.word}`);
  const words = [
    Math.abs(to.physio - from.physio) >= 0.05 ? step('rehab', rehabVerdict(from), rehabVerdict(to), to.physio > from.physio) : '',
    Math.abs(to.science - from.science) >= 0.05 ? step('prevention', preventionVerdict(from), preventionVerdict(to), to.science > from.science) : '',
  ].filter(Boolean);
  return { words: `Your department: ${words.join(', ')}.`, numbers: `Department ${numbers}` };
}

/** A medic's full card: your read of him, what his chair does, his last job, and for one on the market, what hiring him would change. */
export function MedicCard({ league, medic: m, onClose }: { league: League; medic: Medic; onClose: () => void }) {
  const teamId = league.userTeamId;
  const team = m.teamId !== null ? league.teams[m.teamId] : null;
  const reads = medicReads(league, teamId, m);
  const preview = m.teamId === null ? hirePreview(league, teamId, m) : undefined;
  return (
    <Sheet
      label={medicName(m)}
      team={team}
      onClose={onClose}
      head={
        <>
          {team && <TeamChip team={team} large />}
          <div style={{ minWidth: 0 }}>
            <span style={{ opacity: 0.85, fontSize: 'var(--step--1)' }}>
              {MEDIC_ROLE_LABEL[m.role]}
              {team ? ` · ${team.city} ${team.name}` : ' · On the market'}
            </span>
            <h2 style={{ fontSize: 'var(--step-3)' }}>{medicName(m)}</h2>
          </div>
        </>
      }
    >
      <div className="facts">
        <StaffSkill label="Physiotherapy" value={reads.physio} />
        <StaffSkill label="Sports science" value={reads.science} />
        <span className="fact">
          <span className="eyebrow">Age</span>
          <span className="staff-age">
            <b className="num">{m.age}</b> <Trend age={m.age} />
          </span>
        </span>
        <span className="fact">
          <span className="eyebrow">{m.contract ? 'Salary' : 'Asks'}</span>
          <span className="staff-age">
            <b className="num">{money(m.contract?.salary ?? medicAsk(league, m, 2))}</b> <span className="muted small">{m.contract ? `thru ${m.contract.through}` : '/ yr for 2'}</span>
          </span>
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {MEDIC_ROLE_LINE[m.role]}
      </p>
      {m.lastJob && (
        <p className="muted small" style={{ margin: 0 }}>
          Last job: {m.lastJob}
        </p>
      )}
      {preview !== undefined && (
        <Section id="staff-hire" title="If you hire him">
          <div className={`small${preview ? '' : ' muted'}`}>{preview ? <Exact numbers={preview.numbers}>{preview.words}</Exact> : 'No gain over your current staff.'}</div>
        </Section>
      )}
    </Sheet>
  );
}

function Candidate({ league, m, open }: { league: League; m: Medic; open: boolean }) {
  const teamId = league.userTeamId;
  const [years, setYears] = useState(2);
  const problem = medicMoveProblem(league, teamId, m, 'hire', years);
  const reads = medicReads(league, teamId, m);
  return (
    <li className="staff-card">
      <div className="staff-head">
        <div>
          <MedicLink m={m} />
          <span className="muted small">{MEDIC_ROLE_LABEL[m.role]}</span>
        </div>
      </div>
      <div className="facts">
        <StaffSkill label="Physiotherapy" value={reads.physio} />
        <StaffSkill label="Sports science" value={reads.science} />
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

/**
 * Injuries around the league. An injury, its estimate and a player's history are public, so every club's
 * hurt players show, with the doctor's estimate and never the real layoff (the longest are ranked by the
 * estimate too). Who's banged up, then everyone out now, then the season's log.
 */
function LeagueInjuries({ league }: { league: League }) {
  const nav = useNav();
  const [only, setOnly] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const season = resultsSeason(league);
  const players = Object.values(league.players).filter((p) => !p.retired);
  const out = players.filter((p) => p.teamId !== null && (p.injury || p.ir));
  const log = players
    .flatMap((p) => (p.injuries ?? []).filter((r) => r.season === season).map((r) => ({ p, r })))
    .sort((a, b) => b.r.week - a.r.week);
  const byTeam = league.teams
    .map((t) => ({
      t,
      out: out.filter((p) => p.teamId === t.id && !(p.injury?.injected ?? false)).length,
      ir: out.filter((p) => p.teamId === t.id && p.ir).length,
      season: log.filter((x) => x.p.teamId === t.id).length,
    }))
    .sort((a, b) => b.out - a.out || b.season - a.season);
  const shown = out
    .filter((p) => only === null || p.teamId === only)
    .sort((a, b) => (b.injury?.estimate[1] ?? 0) - (a.injury?.estimate[1] ?? 0));
  const LIMIT = 15;
  const name = (p: Player) => (
    <button className="linklike player-link" onClick={() => nav.openPlayer(p.id)}>
      <PlayerAvatar player={p} team={p.teamId !== null ? league.teams[p.teamId] : null} size={26} />
      <span>
        {p.position} {p.firstName} {p.lastName}
      </span>
    </button>
  );
  const when = (r: InjuryRecord) => (r.week ? `Week ${r.week}` : 'Offseason');
  return (
    <>
      <Panel title="Who's banged up">
        <p className="muted small" style={{ marginTop: 0 }}>
          Players out now (playing through it on injections doesn't count), on injured reserve, and hurt this {season} season. Tap a team to see its injuries.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="sticky-col">Team</th>
                <th className="num">Out now</th>
                <th className="num">On IR</th>
                <th className="num">Season</th>
              </tr>
            </thead>
            <tbody>
              {byTeam.map(({ t, out: n, ir, season: total }) => (
                <tr key={t.id} className={`clickable${t.id === league.userTeamId ? ' is-user' : ''}`} onClick={() => setOnly(only === t.id ? null : t.id)}>
                  <td className="sticky-col">
                    <span className="team-inline">
                      <TeamChip team={t} />
                      <span>{t.name}</span>
                    </span>
                  </td>
                  <td className={`num${n >= 6 ? ' tone-bad' : ''}`}>{n}</td>
                  <td className="num">{ir}</td>
                  <td className="num">{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={only === null ? 'Out around the league' : `Out: ${league.teams[only].city} ${league.teams[only].name}`}
        action={
          only !== null ? (
            <button className="btn btn-sm btn-ghost" onClick={() => setOnly(null)}>
              Every team
            </button>
          ) : undefined
        }
      >
        {shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nobody is hurt.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="sticky-col">Player</th>
                  {only === null && <th>Team</th>}
                  <th>Injury</th>
                  <th>Outlook</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? shown : shown.slice(0, LIMIT)).map((p) => (
                  <tr key={p.id}>
                    <td className="sticky-col">{name(p)}</td>
                    {only === null && <td>{league.teams[p.teamId!].abbrev}</td>}
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
        {shown.length > LIMIT && (
          <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAll(!showAll)}>
            {showAll ? `Show the longest ${LIMIT}` : `Show all ${shown.length}`}
          </button>
        )}
      </Panel>

      <Panel title={`${season} injury log`}>
        <details className="more">
          <summary>
            {log.length} injur{log.length === 1 ? 'y' : 'ies'} this season, newest first
          </summary>
          <div className="table-scroll">
            <table className="injury-history">
              <thead>
                <tr>
                  <th className="sticky-col">Player</th>
                  <th>When</th>
                  <th>Injury</th>
                  <th className="num">Out</th>
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 200).map(({ p, r }, i) => (
                  <tr key={`${p.id}-${i}`}>
                    <td className="sticky-col">{name(p)}</td>
                    <td className="num">{when(r)}</td>
                    <td>
                      {injuryLabel(r.type)} <span className="muted small">· {SEVERITY_LABEL[r.severity]}</span>
                    </td>
                    <td className="num">{r.weeks >= 30 ? 'season+' : `${r.weeks} wk`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {log.length > 200 && <p className="muted small">The 200 most recent are shown.</p>}
        </details>
      </Panel>
    </>
  );
}

export function MedicalScreen({ league }: { league: League }) {
  const [view, setView] = useState<'team' | 'league'>('team');
  return (
    <>
      <div>
        <div className="seg" role="group" aria-label="Medical view">
          <button aria-pressed={view === 'team'} onClick={() => setView('team')}>
            Your department
          </button>
          <button aria-pressed={view === 'league'} onClick={() => setView('league')}>
            League injuries
          </button>
        </div>
      </div>
      {view === 'team' ? <Department league={league} /> : <LeagueInjuries league={league} />}
    </>
  );
}

function Department({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const open = staffWindowOpen(league);
  const mine = [...teamMedics(league, teamId)].sort((a, b) => MEDIC_ROLES.indexOf(a.role) - MEDIC_ROLES.indexOf(b.role) || medicValue(b) - medicValue(a));
  const [role, setRole] = useState<MedicRole>('physio');
  const [showAll, setShowAll] = useState(false);
  const dept = departmentFor(league, teamId);
  const e = effects(dept);
  const grades = medicalGrades(league, (m) => seenMedic(league, teamId, m));
  // Another club's department, as your read of each man.
  const staffOf = (id: number) => (
    <ul className="team-staff">
      {[...teamMedics(league, id)]
        .sort((a, b) => MEDIC_ROLES.indexOf(a.role) - MEDIC_ROLES.indexOf(b.role))
        .map((m) => {
          const r = medicReads(league, teamId, m);
          return (
            <li key={m.id}>
              <MedicLink m={m} />
              <span className="muted small">{MEDIC_ROLE_LABEL[m.role]}</span>
              <span className="small">
                Physiotherapy <ReadNum r={r.physio} /> · Sports science <ReadNum r={r.science} />
              </span>
            </li>
          );
        })}
    </ul>
  );
  const mineGrade = grades.get(teamId)!;
  const payroll = medicalPayroll(league, teamId);
  const budget = medicalBudget(league, teamId);
  const room = medicalRoom(league, teamId);
  const fill = budget > 0 ? Math.min(100, Math.max(0, (payroll / budget) * 100)) : 100;
  const vacancies = MEDIC_ROLES.flatMap((r) => Array.from({ length: Math.max(0, MEDIC_SLOTS[r] - mine.filter((m) => m.role === r).length) }, () => r));
  const candidates = medicMarket(league)
    .filter((m) => m.role === role)
    .map((m) => ({ m, value: medicValue(seenMedic(league, teamId, m)) }))
    .sort((a, b) => b.value - a.value)
    .map((x) => x.m);
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
          <StaffSkill label="Physiotherapy" value={Math.round(dept.physio * 10) / 10} />
          <StaffSkill label="Sports science" value={Math.round(dept.science * 10) / 10} />
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
            <Exact numbers={shows(e.rehab) ? `Layoffs ${pct(e.rehab)} shorter than the standard timeline.` : 'The standard clinical timeline: a physiotherapy above 9 starts to shorten it.'}>
              <b>Rehab:</b> <b className={rehabVerdict(dept).tone}>{rehabVerdict(dept).word}</b>
              {' · '}
              {rehabVerdict(dept).much ? `players get back from injuries ${rehabVerdict(dept).much} sooner` : 'players come back on the standard timeline'}.
            </Exact>
          </li>
          <li>
            <Exact
              numbers={`${shows(e.prevention) ? `${pct(e.prevention)} fewer soft-tissue injuries` : 'No edge on soft-tissue injuries (a sports science above 10 starts to cut them)'}${shows(e.recovery) ? `, and ${pct(e.recovery)} more of a player's lost condition back each week` : ''}.`}
            >
              <b>Prevention:</b> <b className={preventionVerdict(dept).tone}>{preventionVerdict(dept).word}</b>
              {' · '}
              {preventionVerdict(dept).much ? `${preventionVerdict(dept).much.replace('much', 'far')} fewer soft-tissue injuries` : 'soft-tissue injuries at the usual rate'}
              {verdict(e.recovery, MAX.recovery).much ? `, and players get their legs back ${verdict(e.recovery, MAX.recovery).much} faster` : ''}.
            </Exact>
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
          Best first, by your read of each. Physios carry most of the rehab, the sports scientist most of the prevention, the head doctor both and the diagnosis. Tap a name to see what he would change in your department.
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
          <GradesTable league={league} grades={grades} staffOf={staffOf} />
        </details>
      </Panel>
    </>
  );
}
