import { useMemo, useState } from 'react';
import { coachingGrades } from '../../engine/coaching';
import { createLeague } from '../../engine/generate';
import { medicalGrades } from '../../engine/medical';
import { teamRatings } from '../../engine/roster';
import { departmentGrades, ownerBudgetNote } from '../../engine/staff';
import { Rating, TeamChip } from '../components';
import { live } from '../live';
import { LoadBackupButton } from '../saves';
import { store } from '../store';
import { VersionTag } from '../versionHistory';

type Grades = Map<number, { rank: number; grade: string }>;

export function NewGame() {
  // One preview league, so you can weigh the clubs before you commit. This is the one screen that shows a club's
  // true overall: you haven't taken a job yet, so there are no scouts of yours to read it through, and choosing
  // a project (a contender or a rebuild) is the decision this screen is for. Just the headline, no unit breakdown.
  // The staffs' grades are the ones every screen shows; you inherit the club's staff, so they're part of the choice.
  const [seed] = useState(() => Math.random().toString(36).slice(2, 10));
  const preview = useMemo(() => createLeague({ seed, inheritStaff: true }), [seed]);
  const [picked, setPicked] = useState<number | null>(null);
  const overall = useMemo(() => new Map(preview.teams.map((t) => [t.id, teamRatings(preview, t).overall])), [preview]);
  const staffs = useMemo(
    (): [string, string, Grades][] => [
      ['Coach', 'Coaching staff', coachingGrades(preview)],
      ['Scout', 'Scouting department', departmentGrades(preview)],
      ['Med', 'Medical staff', medicalGrades(preview)],
    ],
    [preview],
  );

  const start = () => {
    if (picked === null) return;
    // The same seed rebuilds the same league, staffs included, now with the picked club as the user's.
    live.clear();
    store.set(createLeague({ seed, userTeamId: picked, inheritStaff: true }));
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
          <div className="row">
            <LoadBackupButton className="btn" />
            <button className="btn btn-primary" disabled={picked === null} onClick={start}>
              Start career
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
