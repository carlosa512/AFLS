// The staff screens (coaches, scouts, medical) and the mail say the same few things; one wording each.

/** Why a staff move is greyed out: the gate is the same for every kind of staff. */
export const movesClosed = (kind: 'Coaching' | 'Staff' | 'Medical staff') =>
  `${kind} moves open in the re-sign window and free agency.`;

/** A man whose deal is up and who will stay: what re-signing him costs. */
export const reSigns = (ask: string | null, who: 'him' | 'her' | 'them') =>
  `Re-signs for 2 years${ask ? ` at ${ask} a year` : ''} when free agency opens unless you let ${who} go.`;

/** A man whose deal is up and whose club's budget can't cover his ask. */
export const leavesOverBudget = (kind: 'coaching' | 'staff' | 'medical', he: string, his: string, ask: string) =>
  `${he} leaves when free agency opens. Your ${kind} budget can't cover ${his} ask of ${ask} a year.`;
