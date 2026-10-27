/**
 * Where a player came from (`engine/origin.ts`). Public, like an injury: every club sees the same school. A college
 * reads as plain text; the Pathway and the CFL get their own pills, so a player from outside the college game stands out.
 */
import { originOf } from '../engine/origin';
import type { Player } from '../engine/types';

export function OriginTag({ player }: { player: Player }) {
  const o = originOf(player);
  if (!o) return null;
  if (o.kind === 'pathway') return <span className="tag-pill tag-pathway">Pathway · {o.name}</span>;
  if (o.kind === 'cfl') return <span className="tag-pill tag-cfl">CFL</span>;
  return <>{o.name}</>;
}

/** What a School column sorts by: Pathway and CFL players after the colleges, by name within each. */
export function originName(player: Player): string {
  const o = originOf(player);
  return !o ? '~' : o.kind === 'college' ? o.name : `~${o.kind} ${o.name}`;
}
