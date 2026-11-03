import { disputeView } from '../engine/disputes';
import type { League, Player } from '../engine/types';
import { TipPill } from './components';

/**
 * A pill for a player in a dispute a screen may show (G4, `disputeView`): holding in or out for anyone's player; a
 * trade request only to his own club until it's public. Nothing otherwise.
 */
export function DisputeTag({ league, p, sub = false }: { league: League; p: Player; sub?: boolean }) {
  const v = disputeView(league, p);
  if (!v) return null;
  return (
    <TipPill className={`tag-warn${sub ? ' name-sub' : ''}`} tip={v.text}>
      {v.label}
    </TipPill>
  );
}
