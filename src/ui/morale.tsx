import { DOWN_REASONS, MORALE_WORDS, moraleView, type MoraleStep } from '../engine/morale';
import type { League, Player } from '../engine/types';
import { TipPill } from './components';

/** The mouth's bend at each step: a deep frown (1) through flat (4) to a big grin (7). */
// Whole numbers on a 40-unit box: no decimals on a screen, even in a drawing.
const BEND: Record<MoraleStep, number> = { 1: -12, 2: -8, 3: -4, 4: 0, 5: 5, 6: 9, 7: 13 };

/** A small smiley in the step's colour: the mood at a glance, its word (and why, when given) for a screen reader. */
export function MoodFace({ step, size = 18, title }: { step: MoraleStep; size?: number; title?: string }) {
  const label = title ? `${MORALE_WORDS[step]}: ${title}` : MORALE_WORDS[step];
  const bend = BEND[step];
  // A frown sits a little lower, so the face doesn't look surprised.
  const y = bend < 0 ? 31 : 24;
  return (
    <svg className="mood-face" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={label}>
      <title>{label}</title>
      <circle cx="20" cy="20" r="18" fill={`var(--mood-${step})`} />
      <circle cx="14" cy="15" r="3" className="mood-ink" />
      <circle cx="26" cy="15" r="3" className="mood-ink" />
      <path
        d={`M11 ${y} Q20 ${y + bend} 29 ${y}`}
        className="mood-ink"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Your player's mood as a pill in its colour, why in its note. Nothing for anyone else's. */
export function MoodPill({ league, player }: { league: League; player: Player }) {
  const view = moraleView(league, player);
  if (!view) return null;
  return (
    <TipPill className={`mood-pill mood-${view.step}`} tip={view.reasons.join('. ') || 'Nothing on his mind.'}>
      <MoodFace step={view.step} size={14} /> {view.word}
    </TipPill>
  );
}

/** A table cell's smiley, the reasons in its label. */
export function MoodCell({ league, player }: { league: League; player: Player }) {
  const view = moraleView(league, player);
  return view ? <MoodFace step={view.step} title={view.reasons.join('. ') || undefined} /> : null;
}

/** For a sortable Mood column: happiest highest; a man whose mood you can't see sorts last. */
export const moodSortValue = (league: League, p: Player) => moraleView(league, p)?.level ?? -Infinity;

/** A reason as a small chip: amber when it weighs on him, green when it lifts him. */
export function ReasonChip({ text }: { text: string }) {
  return <span className={`tag-pill ${DOWN_REASONS.has(text) ? 'tag-warn' : 'tag-good'}`}>{text}</span>;
}
