/**
 * A deal handed to the trade table from elsewhere (a counter to an offer, "Ask their price" on a
 * player card), picked up the next time the table renders. Screen state only: it never touches the
 * league or the save.
 */
export interface Picked {
  players: number[];
  picks: number[];
  /** Salary this side keeps paying, $K by player (`TradeSide.retain`). */
  retain?: Record<number, number>;
}

export interface DeskDraft {
  partnerId: number;
  mine: Picked;
  theirs: Picked;
  /** The offer this answers: proposing it counters that offer. */
  counterTo?: number;
}

let draft: DeskDraft | null = null;
let version = 0;
const listeners = new Set<() => void>();

export const tradeDesk = {
  put(next: DeskDraft) {
    draft = next;
    version++;
    for (const f of listeners) f();
  },
  /** The waiting draft, once: the table takes it and the desk is empty again. */
  take(): DeskDraft | null {
    const d = draft;
    draft = null;
    return d;
  },
  /** A draft is waiting for the table. */
  pending: () => draft !== null,
  subscribe(f: () => void) {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  version: () => version,
};
