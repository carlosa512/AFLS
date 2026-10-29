import { canMentor, MAX_MENTEES, mentorStatus, setMentor, setMentoringByYou } from '../../engine/mentoring';
import { leadersOf } from '../../engine/personality';
import { activeRoster } from '../../engine/roster';
import type { League, Player, Position } from '../../engine/types';
import { POSITION_NAMES } from '../../engine/positions';
import { PlayerLink, Section } from '../components';
import { PersonalityPill } from '../scouting';
import { store } from '../store';
import { MORALE_WORDS, moraleStepOf, moraleView } from '../../engine/morale';
import { MoodCell, MoodFace } from '../morale';

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
  // Friendships and feuds inside our rooms, each pair once, by position.
  const byPos = new Map<Position, { a: Player; b: Player; kind: 'friend' | 'feud' }[]>();
  for (const a of roster)
    for (const t of a.ties ?? []) {
      const b = league.players[t.with];
      if (!b || b.teamId !== team.id || b.id < a.id) continue;
      byPos.set(a.position, [...(byPos.get(a.position) ?? []), { a, b, kind: t.kind }]);
    }
  const rooms = [...byPos.entries()];
  // The room's mood: every man's, averaged; then who's down, worst first, and who's flying.
  const moods = roster.flatMap((p) => {
    const view = moraleView(league, p);
    return view ? [{ p, view }] : [];
  });
  const roomStep = moods.length ? moraleStepOf(moods.reduce((t, m) => t + m.view.level, 0) / moods.length) : undefined;
  const unhappy = moods.filter((m) => m.view.step <= 3).sort((a, b) => a.view.level - b.view.level);
  const happiest = moods
    .filter((m) => m.view.step >= 6)
    .sort((a, b) => b.view.level - a.view.level)
    .slice(0, 3);

  return (
    <div className="screen">
      <h1>Locker Room</h1>
      <p className="muted">The way our coaches see it.</p>
      <Section id="locker-morale" title="Morale">
        {roomStep === undefined ? (
          <p className="muted">Nobody on the roster yet.</p>
        ) : (
          <p className="mood-room">
            <MoodFace step={roomStep} size={28} />
            <span>
              The room is <b>{MORALE_WORDS[roomStep].toLowerCase()}</b>.
            </span>
          </p>
        )}
        {unhappy.length > 0 && (
          <>
            <h3>Unhappy</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Mood</th>
                  <th>Player</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {unhappy.map(({ p, view }) => (
                  <tr key={p.id}>
                    <td>
                      <span className="mood-word">
                        <MoodFace step={view.step} /> {view.word}
                      </span>
                    </td>
                    <td>
                      <PlayerLink league={league} player={p} pos />
                    </td>
                    <td>{view.reasons.join('. ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {happiest.length > 0 && (
          <>
            <h3>Happiest</h3>
            <ul className="plain-list">
              {happiest.map(({ p, view }) => (
                <li key={p.id}>
                  <MoodFace step={view.step} /> <PlayerLink league={league} player={p} pos />
                  {view.reasons.length > 0 && <span className="muted"> · {view.reasons.join('. ')}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
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
                <PlayerLink league={league} player={league.players[id]} pos />{' '}
                <PersonalityPill league={league} player={league.players[id]} />
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
                  <PlayerLink league={league} player={p} pos /> <PersonalityPill league={league} player={p} />
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
                      <span className="mood-word">
                        <MoodCell league={league} player={y} /> <PlayerLink league={league} player={y} pos />
                      </span>
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
      <Section id="locker-room-ties" title="In the room">
        {rooms.length === 0 ? (
          <p className="muted">No friendships or feuds our coaches would mention.</p>
        ) : (
          rooms.map(([pos, ties]) => (
            <div key={pos}>
              <h3>{POSITION_NAMES[pos]}</h3>
              <ul className="plain-list">
                {ties.map(({ a, b, kind }) => (
                  <li key={`${a.id}:${b.id}`}>
                    <PlayerLink league={league} player={a} /> and <PlayerLink league={league} player={b} />
                    {kind === 'feud' ? ' don’t see eye to eye' : ' are close'}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
