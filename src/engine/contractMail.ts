/**
 * The director's contracts letter, once a re-sign window: a row per expiring player with his ask, the market, and our
 * staff's call on him (keep, tag or let walk, from `resignCall`, the rule the AI clubs use for their own), the reason
 * in the director's words. The letter's buttons (`ui/mail.tsx`) act on each row; what each player's row shows is
 * worked out from the league as it is (`contractDecision`), so a signing made on the Re-sign screen shows here too.
 */
import { isExpired } from './finance/contract';
import { lettingWalk } from './offseason';
import { expiringPlayers, resignCall, type ResignReason } from './offseason/ai';
import { demand } from './offseason/negotiation';
import { teamPlayers } from './roster';
import { perceive } from './scouting';
import { director, type Draft } from './senders';
import type { League, MailSection, Player } from './types';
import { recentBodies, say, toldKeys, type Line } from './voice';

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
const millions = (k: number) => `$${(k / 1000).toFixed(1)}M`;
const NUMBER = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const CALL = { keep: 'Keep', tag: 'Tag', walk: 'Let walk' } as const;
const ORDER = { keep: 0, tag: 1, walk: 2 } as const;

/** Where a player's deal stands now, wherever it was decided: the letter's row reads this, never a stored flag. */
export function contractDecision(league: League, playerId: number): 'signed' | 'tagged' | 'walking' | 'broken' | null {
  const p = league.players[playerId];
  if (!p) return null;
  const user = league.userTeamId;
  if (p.teamId === user && p.contract && !isExpired(p.contract, league.season))
    return p.contract.kind === 'tag' ? 'tagged' : 'signed';
  if (lettingWalk(league, playerId)) return 'walking';
  const n = league.negotiations[playerId];
  if (n?.teamId === user && n.status === 'broken' && n.brokenPhase === league.phase) return 'broken';
  return null;
}

interface NoteFact {
  reason: ResignReason;
  call: 'keep' | 'tag' | 'walk';
  /** A teammate at his position who reads better, for "X is already ahead of him". */
  better: string | null;
  age: number;
}

/** The director on each call: analytical, hedged, and about what our staff can see. */
const NOTE: readonly Line<NoteFact>[] = [
  {
    when: (f) => f.call === 'tag',
    reads: 2,
    text: () => 'Top-of-market money for a top-of-market player. Tag him if talks stall.',
  },
  {
    when: (f) => f.call === 'tag',
    reads: 2,
    text: () => "Worth the tag if his agent won't move. A year at the tag beats losing him for nothing.",
  },
  {
    when: (f) => f.reason === 'starter',
    reads: 1,
    text: () => "He starts for us, and I don't see anyone in the room ready to take the job.",
  },
  { when: (f) => f.reason === 'starter', reads: 1, text: () => 'A starter at a fair ask. Easy call.' },
  {
    when: (f) => f.reason === 'young',
    reads: 1,
    text: () => 'Young enough that the ceiling is the point. I would pay for where he is going.',
  },
  {
    when: (f) => f.reason === 'young',
    reads: 1,
    text: () => 'Not there yet, but our scouts like where he is headed. Keep him.',
  },
  {
    when: (f) => f.reason === 'depth',
    reads: 1,
    text: () => 'We are thin at his spot. Bringing him back is cheaper than finding his replacement.',
  },
  {
    when: (f) => f.reason === 'fading' && !!f.better,
    reads: 2,
    text: (f) => `He's fading, and ${f.better} is already ahead of him.`,
  },
  {
    when: (f) => f.reason === 'fading',
    reads: 1,
    text: () => "His best football is behind him. I wouldn't pay for what he was.",
  },
  {
    when: (f) => f.reason === 'age',
    reads: 1,
    text: (f) => `At ${f.age}, the decline is the safer bet than the bounce-back.`,
  },
  {
    when: (f) => f.reason === 'backup' && !!f.better,
    reads: 2,
    text: (f) => `${f.better} has the job. We can find a backup for less in free agency.`,
  },
  {
    when: (f) => f.reason === 'backup',
    reads: 1,
    text: () => "The room is covered without him. I'd let the market have him.",
  },
];

const OPENER: readonly Line<{ n: number }>[] = [
  {
    text: (f) =>
      `${NUMBER[f.n] ?? f.n} deal${f.n === 1 ? ' is' : 's are'} up. My calls below; the money is each agent's opening ask.`,
  },
  {
    text: (f) =>
      `${NUMBER[f.n] ?? f.n} of our deal${f.n === 1 ? '' : 's'} ran out. Here is where I land on each, with what his agent is asking.`,
  },
];

/** A teammate under contract at his position who reads better than him on our staff's view, if any. */
function betterTeammate(league: League, p: Player): string | null {
  const user = league.userTeamId;
  const mine = perceive(league, user, p).ovr;
  const q = teamPlayers(league, user)
    .filter((x) => x.id !== p.id && x.position === p.position && x.contract && !isExpired(x.contract, league.season))
    .map((x) => ({ x, ovr: perceive(league, user, x).ovr }))
    .filter((y) => y.ovr > mine)
    .sort((a, b) => b.ovr - a.ovr)[0];
  return q ? q.x.lastName : null;
}

/** The re-sign window's contracts letter: one, as the window opens. */
export function contractMail(league: League, have: Set<string>): Draft[] {
  if (league.phase !== 'resign') return [];
  const { season } = league;
  const user = league.userTeamId;
  const id = `expiring:${season}`;
  if (have.has(id)) return [];
  const expiring = expiringPlayers(league, user);
  if (!expiring.length) return [];
  const told = toldKeys(league);
  for (const k of have) told.add(k);
  // A save upgraded mid-window already has its agents' letters: leave it to them.
  if (expiring.every((p) => told.has(`contracts:${season}:${p.id}`))) return [];
  const sender = director(league);
  const recent = recentBodies(league, sender.from);
  const rows = expiring
    .map((p) => ({ p, call: resignCall(league, user, p), read: perceive(league, user, p).ovr }))
    .sort((a, b) => ORDER[a.call.call] - ORDER[b.call.call] || b.read - a.read || a.p.id - b.p.id)
    .map(({ p, call, read }): MailSection['rows'][number] => {
      const d = demand(league, p, user);
      return {
        playerId: p.id,
        cells: [
          fullName(p),
          String(p.age),
          String(Math.round(read)),
          `${millions(d.askApy)} × ${d.askYears}, ${Math.round(d.askGtdPct * 100)}% gtd`,
          millions(d.market),
          CALL[call.call],
        ],
        note: say(
          NOTE,
          { reason: call.reason, call: call.call, better: betterTeammate(league, p), age: p.age },
          { key: id, slot: `note:${p.id}`, recent },
        ),
        contract: { playerId: p.id },
      };
    });
  return [
    {
      id,
      season,
      phase: 'resign',
      week: 0,
      ...sender,
      category: 'contracts',
      subject: `Contracts up: ${expiring.length} player${expiring.length === 1 ? '' : 's'}, our calls`,
      body: say(OPENER, { n: expiring.length }, { key: id, slot: 'opener', recent }),
      sections: [
        {
          title: 'Expiring contracts',
          columns: ['Player', 'Age', 'Our read', 'Ask', 'Market', 'Call'],
          rows,
        },
      ],
      covered: expiring.map((p) => `contracts:${season}:${p.id}`),
      actions: [{ kind: 'resign' }],
    },
  ];
}

/** The letter asks while the window is open and a player it lists has no decision yet. */
export function contractLetterNeedsYou(league: League, sections: MailSection[] | undefined): boolean {
  if (league.phase !== 'resign' || !sections) return false;
  return sections.some((s) =>
    s.rows.some(
      (r) =>
        r.contract && league.players[r.contract.playerId] && contractDecision(league, r.contract.playerId) === null,
    ),
  );
}
