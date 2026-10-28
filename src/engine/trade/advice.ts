/**
 * Your staff's word on a deal (docs/TRADES.md, "Your staff's advice on every offer"): your view only,
 * never the other GM's numbers. The head coach says who'd start and where you'd be thin, the scouts
 * give their read on who's coming, the doctors his injury risk, and the cap sheet what it costs.
 */
import { injuryRisk } from '../injuries';
import { STARTERS } from '../positions';
import { starters, teamPlayers } from '../roster';
import { characterNotes, perceive } from '../scouting';
import type { League, Player, TradeSide } from '../types';
import { tradeCapImpact } from './rules';

/** How a line reads for the deal: good news, a worry, a reason against, or just a fact. */
export type AdviceTone = 'good' | 'warn' | 'bad' | 'note';

export interface Advice {
  who: 'coach' | 'scouts' | 'medical' | 'cap';
  line: string;
  tone: AdviceTone;
}

/** The staff's lines summed up: they like it, they're split, or they're against it. */
export type StaffTake = 'likes' | 'split' | 'against';

/** Against when a reason against outweighs the good news; for when nothing worries anyone and something is good. */
export function staffTake(advice: readonly Advice[]): StaffTake {
  const count = (t: AdviceTone) => advice.filter((a) => a.tone === t).length;
  const [good, warn, bad] = [count('good'), count('warn'), count('bad')];
  if (bad > 0 && good <= bad) return 'against';
  if (bad === 0 && warn === 0 && good > 0) return 'likes';
  return 'split';
}

const MEDICAL_TONE = { Low: 'good', Medium: 'warn', High: 'bad' } as const;

const name = (p: Player) => `${p.firstName} ${p.lastName}`;
const money = (k: number) => `${k < 0 ? '-' : ''}$${(Math.abs(k) / 1000).toFixed(1)}M`;

/** The staff's lines on a deal whose sides are [theirs, yours]. */
export function dealAdvice(league: League, [theirs, yours]: readonly [TradeSide, TradeSide]): Advice[] {
  const user = league.teams[league.userTeamId];
  const seen = (p: Player) => perceive(league, user.id, p).ovr;
  const out: Advice[] = [];
  const incoming = theirs.players.map((id) => league.players[id]);
  const outgoing = yours.players.map((id) => league.players[id]);
  for (const p of incoming) {
    const ours = starters(league, user, p.position).filter((s) => !yours.players.includes(s.id));
    const weakest = Math.min(...ours.map(seen));
    const starts = ours.length < STARTERS[p.position] || seen(p) > weakest;
    out.push({
      who: 'coach',
      line: starts
        ? `${name(p)} would start for us at ${p.position}.`
        : `${name(p)} would be depth for us at ${p.position}.`,
      tone: starts ? 'good' : 'note',
    });
  }
  for (const p of outgoing) {
    const room = teamPlayers(league, user.id).filter(
      (q) => q.position === p.position && !yours.players.includes(q.id) && q.id !== p.id && !q.ir,
    );
    const isStarter = starters(league, user, p.position).some((s) => s.id === p.id);
    if (!isStarter) continue;
    const next = room
      .filter((q) => !starters(league, user, p.position).some((s) => s.id === q.id))
      .sort((a, b) => seen(b) - seen(a))[0];
    if (!next) out.push({ who: 'coach', line: `We'd have nobody behind ${name(p)} at ${p.position}.`, tone: 'bad' });
    else if (seen(next) < seen(p) - 2)
      out.push({
        who: 'coach',
        line: `We'd be thin at ${p.position} without ${name(p)}: ${name(next)} is next up.`,
        tone: 'warn',
      });
  }
  for (const p of incoming) {
    const view = perceive(league, user.id, p);
    const lo = Math.round(view.ovrLo);
    const hi = Math.round(view.ovrHi);
    const read = lo === hi ? `about ${lo}` : `${lo} to ${hi}`;
    const makeup = characterNotes(league, user.id, p);
    const words =
      makeup.known && makeup.notes[0]
        ? ` ${makeup.notes[0].line}`
        : ' We haven’t seen enough of him to judge his makeup.';
    out.push({ who: 'scouts', line: `We have ${name(p)} at ${read} overall.${words}`, tone: 'note' });
    const risk = injuryRisk(league, user.id, p);
    if (risk.known) out.push({ who: 'medical', line: `${name(p)}: ${risk.line}`, tone: MEDICAL_TONE[risk.tier] });
  }
  const [mine] = tradeCapImpact(league, { sides: [yours, theirs] });
  out.push({
    who: 'cap',
    line: `Cap room after: ${money(Math.round(mine.space))}${mine.dead > 0 ? `, and ${money(Math.round(mine.dead))} of dead money on our books` : ''}.`,
    tone: mine.space < 0 ? 'bad' : mine.dead > 0 ? 'warn' : 'good',
  });
  return out;
}
