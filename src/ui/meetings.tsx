import { useState } from 'react';
import { answerMeeting, setMeetingsByCoach } from '../engine/meetings';
import { meetingCard } from '../engine/meetings/mail';
import type { Approach, Backing, League, MeetingScope, Timing } from '../engine/types';
import { store } from './store';

/**
 * The head coach's question to you, as buttons (L2): how to put it, what to tell them, when. One pick each, labels
 * only; Go ahead once each is picked. The suggestion letter and the Locker Room both show it.
 */
export function MeetingChoices({ league, s }: { league: League; s: { clock: number; scope: MeetingScope } }) {
  const card = meetingCard(league, s);
  const only = <T,>(xs?: { value: T }[]) => (xs?.length === 1 ? xs[0].value : undefined);
  const [approach, setApproach] = useState<Approach | undefined>(only(card.approaches));
  const [backing, setBacking] = useState<Backing | undefined>(only(card.backings));
  const [timing, setTiming] = useState<Timing | undefined>(only(card.timings));
  if (card.state === 'held')
    return (
      <div className="meeting-held">
        {card.setFor && <p className="meeting-said">{card.setFor}</p>}
        <p className="meeting-said">{card.said}</p>
      </div>
    );
  if (card.state === 'passed') return <p className="muted small">This one has passed.</p>;
  const timings = card.timings ?? [];
  const when = timings.length ? timing : card.timing;
  // A pick still on offer (the choices can change under a letter left open).
  const offered = <T,>(v: T | undefined, xs?: { value: T }[]) => v !== undefined && !!xs?.some((x) => x.value === v);
  const ready =
    offered(approach, card.approaches) &&
    offered(backing, card.backings) &&
    (timings.length ? offered(timing, timings) : !!when);
  return (
    <div className="meeting-choices">
      <Pick label={card.questions!.approach} options={card.approaches!} value={approach} onPick={setApproach} />
      {/* One thing on offer is no choice: it goes ahead as it is. */}
      {card.backings!.length > 1 && (
        <Pick label={card.questions!.backing} options={card.backings!} value={backing} onPick={setBacking} />
      )}
      {timings.length > 0 && (
        <Pick label={card.questions!.timing} options={timings} value={timing} onPick={setTiming} />
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={!ready}
          onClick={() =>
            store.mutate((l) => {
              answerMeeting(l, { approach: approach!, backing: backing!, timing: when! });
            })
          }
        >
          Go ahead
        </button>
        <button className="btn btn-sm" onClick={() => store.mutate((l) => void answerMeeting(l, 'skip'))}>
          Not now
        </button>
      </div>
      {!card.gm && (
        <label className="check small">
          <input
            type="checkbox"
            checked={!!card.byCoach}
            onChange={(e) => store.mutate((l) => setMeetingsByCoach(l, e.target.checked))}
          />{' '}
          Let the coach handle these himself
        </label>
      )}
    </div>
  );
}

function Pick<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | undefined;
  onPick: (v: T) => void;
}) {
  return (
    <div className="meeting-q" role="group" aria-label={label}>
      <div className="meeting-q-label">{label}</div>
      <div className="meeting-q-options">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
