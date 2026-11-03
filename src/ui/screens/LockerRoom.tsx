import { canMentor, MAX_MENTEES, mentorStatus, setMentor, setMentoringByYou } from '../../engine/mentoring';
import { whyFact } from '../../engine/roomFacts';
import { STANDING_WHY, standsOut } from '../../engine/roomVoice';
import {
  captainsNow,
  roomReasons,
  roomView,
  standingView,
  unitOf,
  UNITS,
  WANTS_DEAL,
  type UnitWord,
} from '../../engine/standing';
import { TalkContractButton } from '../negotiation';
import { ROOM_LABEL } from '../../engine/coaching';
import { say } from '../../engine/voice';
import { activeRoster, teamPlayers } from '../../engine/roster';
import { disputeView } from '../../engine/disputes';
import { DisputeTag } from '../disputeTag';
import type { League, Player } from '../../engine/types';
import { PlayerLink, Section } from '../components';
import { PersonalityPill } from '../scouting';
import { store } from '../store';
import {
  DOWN_REASONS,
  MORALE_WORDS,
  moraleStepOf,
  moraleView,
  TEMPERAMENT_REASONS,
  viewContext,
} from '../../engine/morale';
import { MoodCell, MoodFace, ReasonChip } from '../morale';
import { requestAddress, requestMeeting } from '../../engine/meetings';
import { SCOPE_NOUN } from '../../engine/meetings/facts';
import { meetingsView, type RoomMeetingView } from '../../engine/meetings/mail';
import { ROOMS } from '../../engine/meetings/suggest';
import type { CoachRoom, MeetingScope } from '../../engine/types';
import { MeetingChoices } from '../meetings';
import { chemistryOf, type ChemRoom } from '../../engine/chemistry';
import { chemFact } from '../../engine/roomFacts';
import { CHEM_REASON } from '../../engine/roomVoice';
import { soundOf, voiceName } from '../../engine/standing';
import type { MoraleContext } from '../../engine/morale';

/**
 * Your locker room, the way your coaches see it: who leads it and who is mentoring whom. Your club only; you can't see
 * inside anyone else's room.
 */
export function LockerRoom({ league }: { league: League }) {
  const team = league.teams[league.userTeamId];
  const roster = activeRoster(league, team.id);
  const captains = team.captains?.season === league.season ? team.captains : undefined;
  const ctx = viewContext(league);
  const room = roomView(league, ctx);
  // Your men holding in or out (G4), the holdouts off the 53 among them.
  const disputes = teamPlayers(league, team.id).flatMap((p) => {
    const v = disputeView(league, p);
    return v ? [{ p, v }] : [];
  });
  const young = roster.filter((p) => p.age >= 21 && p.age <= 24).sort((a, b) => a.age - b.age || a.id - b.id);
  const load = (id: number) => roster.filter((p) => p.mentor === id).length;
  const byCoaches = !team.mentoringByYou;
  // One card per room: its read, who it follows, its young players and its friendships and feuds. Rooms in trouble
  // first (divided, down, restless), then the unhappiest, then the coaches' order; a room with no read (too small, the
  // specialists) only when it has someone to show.
  const now = captainsNow(league, team);
  const captainIds = now ? [now.offense, now.defense, now.specialTeams] : [];
  const followers = [...captainIds, ...room.leaders, ...room.voices]
    .filter((id, i, all) => all.indexOf(id) === i)
    .map((id) => league.players[id])
    .filter((p): p is Player => !!p && p.teamId === team.id);
  const cards = UNITS.map((unit) => {
    const view = room.units.find((u) => u.unit === unit);
    const inRoom = (p: Player) => unitOf(p.position) === unit;
    const ties: { a: Player; b: Player; kind: 'friend' | 'feud' }[] = [];
    for (const a of roster.filter(inRoom))
      for (const t of a.ties ?? []) {
        const b = league.players[t.with];
        if (b && b.teamId === team.id && b.id > a.id) ties.push({ a, b, kind: t.kind });
      }
    return {
      unit,
      label: unit === 'ST' ? 'Specialists' : ROOM_LABEL[unit],
      view,
      trouble: !!view && (view.word === 'Split' || view.word === 'Down' || view.word === 'Restless'),
      follows: followers.filter(inRoom),
      // Men in this room who want a new deal and can be talked to now: the button opens talks right here.
      deal: roster.filter((p) => inRoom(p) && roomReasons(league, p, ctx).includes(WANTS_DEAL)),
      young: young.filter(inRoom),
      struggling: young.filter(
        (p) => inRoom(p) && p.mentor !== undefined && /not taking|bad habits/.test(mentorStatus(league, p)),
      ).length,
      ties,
    };
  })
    .filter((c) => c.view || c.follows.length || c.deal.length || c.young.length || c.ties.length)
    .sort(
      (a, b) =>
        (a.view ? READ_ORDER[a.view.word] : 9) - (b.view ? READ_ORDER[b.view.word] : 9) ||
        (a.view?.mood ?? 9) - (b.view?.mood ?? 9) ||
        UNITS.indexOf(a.unit) - UNITS.indexOf(b.unit),
    );
  // The room's mood: every man's, averaged; then who's down, worst first, and who's flying.
  const moods = roster.flatMap((p) => {
    const view = moraleView(league, p);
    return view ? [{ p, view }] : [];
  });
  // The room's mood: the 53's, the voices counting more (`roomView`).
  const roomStep = moods.length
    ? (([1, 2, 3, 4, 5, 6, 7] as const).find((step) => MORALE_WORDS[step] === room.word) ?? moraleStepOf(0))
    : undefined;
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
  // Team meetings (L2): what waits on your call, your address when a crisis opens it, each room's ask.
  const meetings = meetingsView(league);
  const roomMeeting = (scope: MeetingScope) => meetings?.rooms.find((r) => r.scope === scope);

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
      {disputes.length > 0 && (
        <Section id="locker-disputes" title="Disputes">
          <ul className="plain-list">
            {disputes.map(({ p, v }) => (
              <li key={p.id}>
                <PlayerLink league={league} player={p} pos /> <DisputeTag league={league} p={p} />{' '}
                <span className="muted small">{v.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section id="locker-leaders" title="Captains">
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
      </Section>
      <Section id="locker-rooms" title="The rooms">
        <label className="check">
          <input
            type="checkbox"
            checked={byCoaches}
            onChange={(e) => store.mutate((l) => setMentoringByYou(l, !e.target.checked))}
          />{' '}
          Let the coaches handle the mentoring
        </label>
        {meetings?.pending && (
          <div className="meeting-banner">
            <b>
              {league.teams[team.id].meetings?.pending?.kind === 'gm'
                ? 'Your word to the team'
                : `The coach wants your call on a word with ${SCOPE_NOUN[meetings.pending.scope]}`}
            </b>
            <MeetingChoices
              key={`${meetings.pending.clock}:${meetings.pending.scope}`}
              league={league}
              s={meetings.pending}
            />
          </div>
        )}
        {meetings?.address && (
          <div className="meeting-banner">
            <span>Things have gone far enough that you can talk to the team yourself, once this season.</span>
            <div>
              <button className="btn btn-sm btn-primary" onClick={() => store.mutate((l) => void requestAddress(l))}>
                Address the team
              </button>
            </div>
          </div>
        )}
        {meetings && (
          <RoomAsk view={roomMeeting('team')} label="Ask the coach to talk to the team" note={meetings.blocked} />
        )}
        <div className="room-cards">
          {cards.map((c) => (
            <div key={c.unit} className={`room-card${c.trouble ? ' is-trouble' : ''}`}>
              <div className="room-card-head">
                {c.view && <MoodFace step={c.view.mood} size={32} />}
                <div>
                  <div className="room-card-name">{c.label}</div>
                  {c.view && (
                    <div className="room-card-mood">
                      {MORALE_WORDS[c.view.mood]}
                      {c.view.word === 'Split' && <span className="tag-pill room-divided">Divided</span>}
                    </div>
                  )}
                </div>
              </div>
              {c.view && <p className="room-card-line">{standsOut(c.view, room.team)}</p>}
              {c.unit !== 'ST' && <ChemLine league={league} unit={c.unit} ctx={ctx} />}
              {meetings && ROOMS.includes(c.unit as CoachRoom) && (
                <RoomAsk view={roomMeeting(c.unit as CoachRoom)} label="Ask the coach to meet with them" />
              )}
              {c.follows.length > 0 && (
                <div>
                  <h4>Who they follow</h4>
                  <ul className="plain-list">
                    {c.follows.map((p) => (
                      <li key={p.id}>
                        <PlayerLink league={league} player={p} pos /> <PersonalityPill league={league} player={p} />
                        <VoiceTag p={p} />
                        <div className="muted small">{whyLine(league, p)}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.deal.length > 0 && (
                <div>
                  <h4>Wants a new deal</h4>
                  <ul className="plain-list">
                    {c.deal.map((p) => (
                      <li key={p.id} className="room-deal">
                        <span className="mood-word">
                          <MoodCell league={league} player={p} /> <PlayerLink league={league} player={p} pos />
                        </span>
                        <TalkContractButton league={league} player={p} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.young.length > 0 && (
                <details className="room-fold">
                  <summary>
                    Mentoring · {c.young.length} young {c.young.length === 1 ? 'player' : 'players'}
                    {c.struggling > 0 && <span className="muted"> · {c.struggling} not going well</span>}
                  </summary>
                  <ul className="plain-list room-mentoring">
                    {c.young.map((y) => {
                      const options = roster.filter(
                        (m) => m.id !== y.id && canMentor(m) && (m.id === y.mentor || load(m.id) < MAX_MENTEES),
                      );
                      return (
                        <li key={y.id}>
                          <span className="mood-word">
                            <MoodCell league={league} player={y} /> <PlayerLink league={league} player={y} pos />
                          </span>{' '}
                          <select
                            aria-label={`Mentor for ${y.lastName}`}
                            value={y.mentor ?? ''}
                            onChange={(e) =>
                              store.mutate((l) =>
                                setMentor(l, y.id, e.target.value === '' ? null : Number(e.target.value)),
                              )
                            }
                          >
                            <option value="">No mentor</option>
                            {options.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.position} {m.lastName}
                              </option>
                            ))}
                          </select>{' '}
                          {y.mentor !== undefined && <span className="muted small">{mentorStatus(league, y)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {c.ties.length > 0 && (
                <div>
                  <h4>In the room</h4>
                  <ul className="plain-list">
                    {c.ties.map(({ a, b, kind }) => (
                      <li key={`${a.id}:${b.id}`}>
                        <PlayerLink league={league} player={a} /> and <PlayerLink league={league} player={b} />
                        {kind === 'feud' ? ' don’t see eye to eye' : ' are close'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

/** A room's meeting: what we told them and still owe, and your ask (or why not now). */
function RoomAsk({ view, label, note }: { view?: RoomMeetingView; label: string; note?: string }) {
  if (!view) return null;
  return (
    <div className="room-ask">
      {view.owed.map((line) => (
        <p key={line} className="room-owed small">
          {line}
        </p>
      ))}
      <button
        className="btn btn-sm"
        disabled={!view.canAsk}
        title={view.why ?? note}
        onClick={() => store.mutate((l) => void requestMeeting(l, view.scope))}
      >
        {label}
      </button>
      {(view.why ?? note) && <span className="muted small">{view.why ?? note}</span>}
    </div>
  );
}

/** A room's chemistry (L3), in words: the word, and the biggest reason behind it when one stands out. */
function ChemLine({ league, unit, ctx }: { league: League; unit: ChemRoom; ctx: MoraleContext }) {
  const c = chemistryOf(league, league.userTeamId, unit);
  if (!c) return null;
  const reason = say(CHEM_REASON, chemFact(league, c, ctx), { key: `chem:${unit}`, slot: 'reason' });
  return <p className="room-chem">{reason ? `${c.word} · ${reason}` : c.word}</p>;
}

/** A Spark or an Anchor, by name (L3); a plain voice has no tag. */
function VoiceTag({ p }: { p: Player }) {
  const name = voiceName(soundOf(p));
  return name ? <span className="tag-pill voice-tag">{name}</span> : null;
}

/** Worst first: the rooms that need you on top. */
const READ_ORDER: Record<UnitWord, number> = { Split: 0, Down: 1, Restless: 2, Settled: 3, Tight: 4 };

/** Why the room goes to him, in one line: the biggest parts of where he stands. */
function whyLine(league: League, p: Player): string {
  const view = standingView(league, p);
  return view ? say(STANDING_WHY, whyFact(league, p, view), { key: `why:${p.id}`, slot: 'why' }) : '';
}
