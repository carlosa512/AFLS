/**
 * A preview, not a check: plays a season and the offseason after it as the app does (one step at a time, practice
 * squads on so cut-down day has its own step, the mail filed after each) and writes SNN's big-day editions to
 * `.check/day-editions.md` for reading the words: rule breaks at the top, then each edition's stories as printed and
 * its lists. `npm run editions -- --days [seed]`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLeague } from '../src/engine/generate';
import { deliverMail } from '../src/engine/inbox';
import { playWeek } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { turnOnPersonnel } from '../src/engine/personnel/activation';
import { ruleBreaks } from '../src/engine/storyRules';
import type { EditionStory, League } from '../src/engine/types';

export function runDayEditions(seed: string): void {
  const l: League = createLeague({ seed });
  const phase = () => l.phase as string;
  deliverMail(l);
  while (phase() === 'regular' || phase() === 'playoffs') {
    playWeek(l);
    deliverMail(l);
  }
  beginOffseason(l);
  if (!l.personnel?.enabled) turnOnPersonnel(l);
  deliverMail(l);
  for (let n = 0; n < 30 && phase() !== 'regular'; n++) {
    advanceOffseason(l, { autoUser: true });
    deliverMail(l);
  }

  const user = l.teams[l.userTeamId];
  const breaks: string[] = [];
  const out: string[] = [];
  const story = (tag: string, label: string, s: EditionStory): string => {
    for (const b of ruleBreaks(l, s)) breaks.push(`- ${label} · ${s.headline} · ${b}`);
    const numbers = s.numbers.map((n) => `**${n.value}** ${n.label}`).join(' · ');
    return [`### ${tag} · ${s.kicker}`, `**${s.headline}**`, s.summary, ...(numbers ? [numbers] : []), ...s.paragraphs]
      .filter(Boolean)
      .join('\n\n');
  };
  for (const m of l.inbox ?? []) {
    const e = m.edition;
    if (!e || !m.id.startsWith(`snn:${l.season}:d:`)) continue;
    out.push(
      `## ${e.label}`,
      story('LEAD', e.label, e.lead),
      ...(e.club ? [story('YOUR TEAM', e.label, e.club)] : []),
      ...e.tiles.map((t) => story('TILE', e.label, t)),
      ...(e.lists ?? []).map((x) =>
        [
          `### ${x.title}`,
          `| ${x.head.join(' | ')} |`,
          `| ${x.head.map(() => '---').join(' | ')} |`,
          ...x.rows.map((r) => `| ${r.cells.join(' | ')} |`),
        ].join('\n'),
      ),
    );
  }
  const head = [
    `# An offseason of SNN's big-day editions`,
    `League seed \`${seed}\`, the ${l.season} league year. Your team: the ${user.city} ${user.name}.`,
    breaks.length ? `## Rule breaks (${breaks.length})\n\n${breaks.join('\n')}` : `## Rule breaks\n\nNone.`,
  ];
  mkdirSync('.check', { recursive: true });
  writeFileSync('.check/day-editions.md', [...head, ...out].join('\n\n') + '\n');
  console.log(
    `Wrote .check/day-editions.md (${out.filter((x) => x.startsWith('## ')).length} editions, ${breaks.length} rule breaks).`,
  );
}
