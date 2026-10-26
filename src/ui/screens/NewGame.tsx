import { useMemo, useState } from 'react';
import { coachingGrades } from '../../engine/coaching';
import { createLeague } from '../../engine/generate';
import { GM_START_AGES, gmStartProblem, startingGm, type StartingGm } from '../../engine/gm';
import { medicalGrades } from '../../engine/medical';
import { teamRatings } from '../../engine/roster';
import { departmentGrades, ownerBudgetNote } from '../../engine/staff';
import { Rating, TeamChip } from '../components';
import { live } from '../live';
import { LoadBackupButton } from '../saves';
import { store } from '../store';
import { VersionTag } from '../versionHistory';

type Grades = Map<number, { rank: number; grade: string }>;

/** You start as the club's GM: a fold-out shows who that is and lets you change the name and starting age. */
export function StartingGmFields({ value, onChange }: { value: StartingGm; onChange: (gm: StartingGm) => void }) {
  const problem = gmStartProblem(value.firstName, value.lastName, value.age);
  const [min, max] = GM_START_AGES;
  return (
    <details className="starting-gm">
      <summary>
        Your GM: <b>{`${value.firstName} ${value.lastName}, ${value.age}`}</b>
      </summary>
      <div className="identity-edit">
        <label>
          <span className="eyebrow">First name</span>
          <input
            className="text-input"
            value={value.firstName}
            maxLength={24}
            onChange={(e) => onChange({ ...value, firstName: e.target.value })}
          />
        </label>
        <label>
          <span className="eyebrow">Last name</span>
          <input
            className="text-input"
            value={value.lastName}
            maxLength={24}
            onChange={(e) => onChange({ ...value, lastName: e.target.value })}
          />
        </label>
        <label>
          <span className="eyebrow">Age</span>
          <input
            className="text-input"
            type="number"
            min={min}
            max={max}
            step={1}
            value={Number.isNaN(value.age) ? '' : value.age}
            onChange={(e) => onChange({ ...value, age: e.target.value === '' ? NaN : Number(e.target.value) })}
          />
        </label>
        {problem && <p className="small muted">{problem}</p>}
      </div>
    </details>
  );
}

export function NewGame() {
  // One preview league, so you can weigh the clubs before you commit. This is the one screen that shows a club's
  // true overall: you haven't taken a job yet, so there are no scouts of yours to read it through, and choosing
  // a project (a contender or a rebuild) is the decision this screen is for. Just the headline, no unit breakdown.
  // The staffs' grades are the ones every screen shows; you inherit the club's staff, so they're part of the choice.
  const [seed] = useState(() => Math.random().toString(36).slice(2, 10));
  // Practice squads are on for every new career; the preview skips them (they change no club's overall or staff
  // grades, checked when they were switched on) and opens about three times faster.
  const preview = useMemo(() => createLeague({ seed, inheritStaff: true }), [seed]);
  const [picked, setPicked] = useState<number | null>(null);
  // Per club: switching clubs offers that club's GM, keeping any edits you made to another's.
  const [gms, setGms] = useState<Record<number, StartingGm>>({});
  const overall = useMemo(() => new Map(preview.teams.map((t) => [t.id, teamRatings(preview, t).overall])), [preview]);
  const staffs = useMemo(
    (): [string, string, Grades][] => [
      ['Coach', 'Coaching staff', coachingGrades(preview)],
      ['Scout', 'Scouting department', departmentGrades(preview)],
      ['Med', 'Medical staff', medicalGrades(preview)],
    ],
    [preview],
  );

  const gm = picked === null ? null : (gms[picked] ?? startingGm(preview.gms[preview.teams[picked].gmId!]));
  const gmProblem = gm && gmStartProblem(gm.firstName, gm.lastName, gm.age);

  const start = () => {
    if (picked === null || !gm || gmProblem) return;
    // The same seed rebuilds the same league, staffs included, now with the picked club as the user's.
    live.clear();
    store.set(createLeague({ seed, userTeamId: picked, inheritStaff: true, gm, personnel: true }));
  };

  const pickedTeam = picked === null ? null : preview.teams[picked];

  return (
    <>
      <main className="wrap" style={{ paddingBlock: '8px 32px', display: 'grid', gap: 24 }}>
        <div className="title-block">
          <span className="eyebrow">
            {preview.name} · {preview.season} season · <VersionTag className="eyebrow-version" />
          </span>
          <h1>
            Take over a <em>franchise.</em>
          </h1>
          <p>
            Run a football club the way a GM does. Your scouts only see so much, your coaches' habits shape every call,
            and 31 rival front offices are working their own plans.
          </p>
          <p>
            Every snap plays out from real matchups, in wind, rain and snow, and your inbox tells the story. Ratings run
            1–20: 10 is a solid backup, 16+ a star.
          </p>
        </div>

        <div className="team-pick">
          {preview.divisions.map((division, d) => (
            <div className="div-col" key={division.name}>
              <span className="eyebrow">{division.name}</span>
              {preview.teams
                .filter((t) => t.division === d)
                .map((team) => {
                  const note = ownerBudgetNote(team.staffBudgetMult);
                  return (
                    <button
                      key={team.id}
                      className="team-option"
                      aria-pressed={picked === team.id}
                      onClick={() => setPicked(team.id)}
                    >
                      <TeamChip team={team} />
                      <span className="nm">
                        {team.city} {team.name}
                        {note && <small>{note}</small>}
                      </span>
                      <Rating value={overall.get(team.id)!} decimals={1} />
                      <span className="staff-grades">
                        {staffs.map(([short, long, grades]) => {
                          const g = grades.get(team.id)!;
                          return (
                            <span key={short} title={`${long}: ${g.grade}, ${g.rank} of ${preview.teams.length}`}>
                              {short} <span className={`grade grade-${g.grade}`}>{g.grade}</span>
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </main>
      <div className="start-bar">
        <div className="wrap">
          <span className={pickedTeam ? '' : 'muted'}>
            {pickedTeam ? (
              <>
                You'll run the{' '}
                <strong>
                  {pickedTeam.city} {pickedTeam.name}
                </strong>
                .
              </>
            ) : (
              'Choose a team to start your career.'
            )}
          </span>
          {gm && picked !== null && (
            <StartingGmFields value={gm} onChange={(v) => setGms((all) => ({ ...all, [picked]: v }))} />
          )}
          <div className="row">
            <LoadBackupButton className="btn" />
            <button className="btn btn-primary" disabled={picked === null || !!gmProblem} onClick={start}>
              Start career
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
