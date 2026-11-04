/**
 * Where a name stands in a sentence as a whole word ("Hill", not the start of "Hillman"), or −1: the screens that turn
 * a name in a line of text into a link find it here, and leave the text plain when it isn't there.
 */
export function nameAt(text: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`, 'u').exec(text);
  return m ? m.index : -1;
}
