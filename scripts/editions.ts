/**
 * A read-through of a season of SNN's weekly editions, for the owner to judge the words (a preview, not a check).
 *
 *   npm run editions [-- seed] [--weeks n]
 *
 * Builds a league, plays the regular season and writes each week's edition to `.check/editions.md`: every story as its
 * kicker, headline, numbers, paragraphs and quote, marked LEAD, YOUR CLUB or TILE. At the top: every writing rule a
 * story breaks (`storyRules.ts`), and how often each angle led and ran. Read it after changing `snnVoice.ts`,
 * `snnStory.ts` or `snnWeek.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLeague } from '../src/engine/generate';
import { deliverMail } from '../src/engine/inbox';
import { playWeek } from '../src/engine/league';
import { buildEdition, SNN } from '../src/engine/snnWeek';
import { ruleBreaks } from '../src/engine/storyRules';
import type { Edition, EditionStory } from '../src/engine/types';

const args = process.argv.slice(2);
const weeksAt = args.indexOf('--weeks');
const weeks = weeksAt >= 0 ? Number(args[weeksAt + 1]) : 18;
const seed = args.find((a, i) => !a.startsWith('--') && i !== weeksAt + 1) ?? 'editions';

const league = createLeague({ seed });
const user = league.teams[league.userTeamId];
const breaks: string[] = [];
const led = new Map<string, number>();
const ran = new Map<string, number>();
const out: string[] = [];

const story = (tag: string, s: EditionStory, week: number): string => {
  for (const b of ruleBreaks(league, s)) breaks.push(`- Week ${week} · ${s.headline} · ${b}`);
  ran.set(s.angle, (ran.get(s.angle) ?? 0) + 1);
  const numbers = s.numbers.map((n) => `**${n.value}** ${n.label}`).join(' · ');
  return [
    `### ${tag} · ${s.kicker}`,
    `**${s.headline}**`,
    ...(numbers ? [numbers] : []),
    ...s.paragraphs,
    ...(s.quote ? [`> “${s.quote.text}” — ${s.quote.name}, ${s.quote.role}`] : []),
  ].join('\n\n');
};

for (let week = 1; week <= weeks; week++) {
  playWeek(league);
  deliverMail(league);
  // Once the edition is filed as mail it is read from the inbox; until then it is built here and filed by hand, so the
  // next week's words step around this week's.
  const filed = (league.inbox ?? []).find((m) => m.id === `snn:${league.season}:w${week}`)?.edition;
  const e: Edition | null = filed ?? buildEdition(league, week);
  if (!e) continue;
  const all = [e.lead, ...(e.club ? [e.club] : []), ...e.tiles];
  if (!filed)
    league.inbox = [
      ...(league.inbox ?? []),
      {
        id: `snn:${league.season}:w${week}`,
        season: league.season,
        phase: 'regular',
        week,
        from: SNN,
        category: 'league',
        subject: e.lead.headline,
        body: all.flatMap((s) => [...s.paragraphs, ...(s.quote ? [s.quote.text] : [])]).join(' '),
        read: true,
        actions: [],
      },
    ];
  led.set(e.lead.angle, (led.get(e.lead.angle) ?? 0) + 1);
  out.push(
    `## ${e.label}`,
    story(e.lead.yours ? 'LEAD (YOUR CLUB)' : 'LEAD', e.lead, week),
    ...(e.club ? [story('YOUR CLUB', e.club, week)] : []),
    ...e.tiles.map((t) => story('TILE', t, week)),
  );
}

const tally = (m: Map<string, number>) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ');
const head = [
  `# A season of SNN's weekly editions`,
  `League seed \`${seed}\`, ${league.season}. Your club: the ${user.city} ${user.name}. ${weeks} weeks.`,
  `**Led:** ${tally(led)}`,
  `**Ran (lead, your club and tiles):** ${tally(ran)}`,
  breaks.length ? `## Rule breaks (${breaks.length})\n\n${breaks.join('\n')}` : `## Rule breaks\n\nNone.`,
];
mkdirSync('.check', { recursive: true });
writeFileSync('.check/editions.md', [...head, ...out].join('\n\n') + '\n');
console.log(
  `${out.filter((x) => x.startsWith('## ')).length} editions in .check/editions.md · ${breaks.length} rule breaks`,
);
console.log(`led: ${tally(led)}`);
