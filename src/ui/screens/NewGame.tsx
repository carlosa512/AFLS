import { useMemo, useState } from 'react';
import { createLeague } from '../../engine/generate';
import { ownerBudgetNote } from '../../engine/staff';
import { TeamChip } from '../components';
import { live } from '../live';
import { LoadBackupButton } from '../saves';
import { store } from '../store';
import { APP_VERSION } from '../version';

export function NewGame() {
  // One preview league for the names and colours. Before you take a job you have no scouts, and a new league
  // has no history yet, so a club shows no strength or record (docs/MVP.md, item 14).
  const [seed] = useState(() => Math.random().toString(36).slice(2, 10));
  const preview = useMemo(() => createLeague({ seed }), [seed]);
  const [picked, setPicked] = useState<number | null>(null);

  const start = () => {
    if (picked === null) return;
    // The same seed rebuilds the same league; building it for the picked team gives his club the
    // user's opening scouting and coaching staffs (deliberately typical) instead of team 0.
    live.clear();
    store.set(createLeague({ seed, userTeamId: picked }));
  };

  const pickedTeam = picked === null ? null : preview.teams[picked];

  return (
    <>
      <main className="wrap" style={{ paddingBlock: '8px 32px', display: 'grid', gap: 24 }}>
        <div className="title-block">
          <span className="eyebrow">
            {preview.name} · {preview.season} season · {APP_VERSION}
          </span>
          <h1>
            Take over a <em>franchise.</em>
          </h1>
          <p>
            Pick one of 32 teams. You set the depth chart and watch every snap play out from the ratings of real
            matchups: blockers against rushers, receivers against their corner. Ratings use a 1–20 scale, where 10 is a
            solid backup and 16+ is a star.
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
