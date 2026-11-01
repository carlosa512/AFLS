import { canMentor, MAX_MENTEES, mentorStatus, setMentor, setMentoringByYou } from '../../engine/mentoring';
import { leadersOf } from '../../engine/standing';
import { activeRoster } from '../../engine/roster';
import type { League, Player, Position } from '../../engine/types';
import { POSITION_NAMES } from '../../engine/positions';
import { PlayerLink, Section } from '../components';
import { PersonalityPill } from '../scouting';
import { store } from '../store';
import { DOWN_REASONS, MORALE_WORDS, moraleStepOf, moraleView, TEMPERAMENT_REASONS } from '../../engine/morale';
import { MoodCell, MoodFace, ReasonChip } from '../morale';

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
    .filter((m) => m.view.step >= 5)
    .sort((a, b) => b.view.level - a.view.level)
    .slice(0, 5);
  // Promises (G3): the open ones, then the ones he still feels kept or broken.
  const promised = moods.filter((m) => m.view.promise);
  const keptLately = moods.filter((m) => m.view.reasons.includes('You kept your word'));
  const brokenLately = moods.filter((m) => m.view.reasons.includes('You broke your word'));
  const spread = ([1, 2, 3, 4, 5, 6, 7] as const).map(
    (step) => [step, moods.filter((m) => m.view.step === step).length] as const,
  );
  // What the room is talking about: each reason with the men who feel it, the most-felt first.
  const byReason = new Map<string, Player[]>();
  for (const { p, view } of [...moods].sort((a, b) => a.view.level - b.view.level))
    // His makeup is his own, not something the room is talking about.
    for (const r of view.reasons) if (!TEMPERAMENT_REASONS.has(r)) byReason.set(r, [...(byReason.get(r) ?? []), p]);
  const minds = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);

  return (
    <div className="screen">
      <h1>Locker Room</h1>
      <p className="muted">The way our coaches see it.</p>
      <Section id="locker-morale" title="Morale">
        <p className="muted small">
          A player's mood moves how he practices, grows and plays, and what he asks for in a new deal.
        </p>
        {roomStep === undefined ? (
          <p className="muted">Nobody on the roster yet.</p>
        ) : (
          <div className="morale-board">
            <div className="morale-card">
              <div className="mood-room">
                <MoodFace step={roomStep} size={48} />
                <div>
                  <span className="eyebrow">The room</span>
                  <div className="mood-room-word">{MORALE_WORDS[roomStep]}</div>
                </div>
              </div>
              {/* The room by step, worst to best: each band as wide as the men in it. */}
              <div
                className="mood-strip"
                role="img"
                aria-label={`The room's moods, ${MORALE_WORDS[1]} to ${MORALE_WORDS[7]}`}
              >
                {spread.map(([step, n]) =>
                  n ? (
                    <span
                      key={step}
                      title={MORALE_WORDS[step]}
                      style={{ flexGrow: n, background: `var(--mood-${step})` }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mood-strip-ends muted small">
                <span>Unhappy</span>
                <span>Happy</span>
              </div>
              {minds.length > 0 && (
                <>
                  <h4>On their minds</h4>
                  <ul className="plain-list mood-minds">
                    {minds.map(([reason, men]) => (
                      <li key={reason}>
                        <ReasonChip text={reason} />
                        <span>
                          {men.slice(0, 3).map((p, i) => (
                            <span key={p.id}>
                              {i > 0 && ', '}
                              <PlayerLink league={league} player={p} />
                            </span>
                          ))}
                          {men.length > 3 && <span className="muted"> and others</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="morale-card">
              <h4>Needs a word</h4>
              {unhappy.length === 0 ? (
                <p className="muted">Nobody is down right now.</p>
              ) : (
                <ul className="plain-list mood-list">
                  {unhappy.map(({ p, view }) => (
                    <li key={p.id} className="mood-row">
                      <MoodFace step={view.step} size={22} />
                      <span className="mood-who">
                        <PlayerLink league={league} player={p} pos />
                        <span className="muted small">{view.word}</span>
                      </span>
                      <span className="mood-why">
                        {view.reasons
                          .filter((r) => DOWN_REASONS.has(r))
                          .map((r) => (
                            <ReasonChip key={r} text={r} />
                          ))}
                      </span>
                      {view.effect === 'costing' && (
                        <span className="muted small mood-effect">It's costing him in practice and on game day.</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <h4>Flying</h4>
              {happiest.length === 0 ? (
                <p className="muted">Nobody is flying right now.</p>
              ) : (
                <ul className="plain-list mood-list">
                  {happiest.map(({ p, view }) => (
                    <li key={p.id} className="mood-row">
                      <MoodFace step={view.step} size={22} />
                      <span className="mood-who">
                        <PlayerLink league={league} player={p} pos />
                        <span className="muted small">{view.word}</span>
                      </span>
                      <span className="mood-why">
                        {view.reasons
                          .filter((r) => !DOWN_REASONS.has(r))
                          .map((r) => (
                            <ReasonChip key={r} text={r} />
                          ))}
                      </span>
                      {view.effect === 'lifting' && (
                        <span className="muted small mood-effect">It's lifting his practice and his play.</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {(promised.length > 0 || keptLately.length > 0 || brokenLately.length > 0) && (
                <>
                  <h4>Promises</h4>
                  <ul className="plain-list mood-list">
                    {promised.map(({ p, view }) => (
                      <li key={p.id} className="mood-row">
                        <MoodFace step={view.step} size={22} />
                        <span className="mood-who">
                          <PlayerLink league={league} player={p} pos />
                        </span>
                        <span className="mood-why">
                          <span className="tag-pill">{view.promise!.text}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {keptLately.length > 0 && (
                    <p className="small" style={{ margin: 0 }}>
                      <span className="muted">Kept lately: </span>
                      {keptLately.map(({ p }, i) => (
                        <span key={p.id}>
                          {i > 0 && ', '}
                          <PlayerLink league={league} player={p} />
                        </span>
                      ))}
                    </p>
                  )}
                  {brokenLately.length > 0 && (
                    <p className="small" style={{ margin: 0 }}>
                      <span className="muted">Broken lately: </span>
                      {brokenLately.map(({ p }, i) => (
                        <span key={p.id}>
                          {i > 0 && ', '}
                          <PlayerLink league={league} player={p} />
                        </span>
                      ))}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
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
