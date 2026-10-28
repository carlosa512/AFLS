import { canMentor, MAX_MENTEES, mentorShift, setMentor, setMentoringByYou } from '../../engine/mentoring';
import { leadersOf, personalityRead } from '../../engine/personality';
import { activeRoster } from '../../engine/roster';
import type { League, Player } from '../../engine/types';
import { PlayerLink, Section } from '../components';
import { store } from '../store';

/** How a pair is going, in your coaches' words. */
export function mentorStatus(league: League, young: Player): string {
  const m = young.mentor === undefined ? undefined : league.players[young.mentor];
  const weeks = young.mentorWeeks ?? 0;
  if (!m || weeks < 4) return 'early days';
  const s = mentorShift(league, m, young, weeks).workEthic;
  return s >= 0.05 ? 'learning well' : s <= -0.05 ? 'picking up his bad habits' : 'not taking';
}

/**
 * Your locker room, the way your coaches see it: who leads it and who is mentoring whom. Your club only; you can't see
 * inside anyone else's room.
 */
export function LockerRoom({ league }: { league: League }) {
  const team = league.teams[league.userTeamId];
  const roster = activeRoster(league, team.id);
  const captains = team.captains?.season === league.season ? team.captains : undefined;
  const leaders = leadersOf(league, team.id);
  const young = roster.filter((p) => p.age >= 21 && p.age <= 24).sort((a, b) => a.age - b.age || a.id - b.id);
  const load = (id: number) => roster.filter((p) => p.mentor === id).length;
  const byCoaches = !team.mentoringByYou;
  const name = (p: Player) => personalityRead(league, team.id, p)?.name;

  return (
    <div className="screen">
      <h1>Locker Room</h1>
      <p className="muted">The way our coaches see it.</p>
      <Section id="locker-leaders" title="Leaders">
        {captains ? (
          <ul className="plain-list">
            {(
              [
                ['Offense', captains.offense],
                ['Defense', captains.defense],
                ['Special teams', captains.specialTeams],
              ] as const
            ).map(([role, id]) => (
              <li key={role}>
                <span className="eyebrow">{role} captain</span>{' '}
                <PlayerLink league={league} player={league.players[id]} pos />
                {name(league.players[id]) && <span className="muted"> · {name(league.players[id])}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Captains are named when camp opens.</p>
        )}
        {leaders.length > 0 && (
          <>
            <h3>The room also follows</h3>
            <ul className="plain-list">
              {leaders.map((p) => (
                <li key={p.id}>
                  <PlayerLink league={league} player={p} pos />
                  {name(p) && <span className="muted"> · {name(p)}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
      <Section id="locker-mentoring" title="Mentoring">
        <label className="check">
          <input
            type="checkbox"
            checked={byCoaches}
            onChange={(e) => store.mutate((l) => setMentoringByYou(l, !e.target.checked))}
          />{' '}
          Let the coaches handle it
        </label>
        {young.length === 0 ? (
          <p className="muted">No one on the roster is young enough to need a mentor.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Mentor</th>
                <th>How it's going</th>
              </tr>
            </thead>
            <tbody>
              {young.map((y) => {
                const options = roster.filter(
                  (m) => m.id !== y.id && canMentor(m) && (m.id === y.mentor || load(m.id) < MAX_MENTEES),
                );
                const mentor = y.mentor === undefined ? undefined : league.players[y.mentor];
                return (
                  <tr key={y.id}>
                    <td>
                      <PlayerLink league={league} player={y} pos />
                    </td>
                    <td>
                      <select
                        aria-label={`Mentor for ${y.lastName}`}
                        value={y.mentor ?? ''}
                        onChange={(e) =>
                          store.mutate((l) => setMentor(l, y.id, e.target.value === '' ? null : Number(e.target.value)))
                        }
                      >
                        <option value="">No mentor</option>
                        {options.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.position} {m.lastName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{mentor ? mentorStatus(league, y) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
