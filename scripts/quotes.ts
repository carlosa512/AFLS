/**
 * Players in their own words (`src/engine/playerQuote.ts`): a preview, and with `--check` a check.
 *
 *   npm run quotes                      every line each personality can say at each moment, to `.check/quotes.md`
 *   npm run quotes -- --check [seed]    also plays a ten-season league, collects every player quote SNN printed (week
 *                                       by week and on the big days) and fails (exit 1) when one is printed more than
 *                                       `MAX_SAME` times or fewer than `MIN_DISTINCT` of all printed quotes are distinct
 *   npm run quotes -- --check --seasons 4   a shorter league, for steering
 *
 * The preview is for reading straight through: a line that reads stiff, odd, unlike a person or like another is a bug.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLeague } from '../src/engine/generate';
import { deliverMail } from '../src/engine/inbox';
import { playWeek } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { turnOnPersonnel } from '../src/engine/personnel/activation';
import { personalityOf, trueCharacter } from '../src/engine/personality';
import { linesOf, MOMENTS, PERSONALITIES } from '../src/engine/playerQuote';
import { PLAIN, VOICES } from '../src/engine/playerQuoteLines';
import type { EditionStory, League } from '../src/engine/types';

const MAX_SAME = 3;
const MIN_DISTINCT = 0.8;

const args = process.argv.slice(2);
const check = args.includes('--check');
const seasonsAt = args.indexOf('--seasons');
const seasons = seasonsAt >= 0 ? Number(args[seasonsAt + 1]) || 10 : 10;
const seed = args.find((a, i) => !a.startsWith('--') && (seasonsAt < 0 || i !== seasonsAt + 1)) ?? 'quotes';

const out: string[] = ['# Players in their own words', ''];
out.push(
  'Every line each personality can say at each moment, as written: a slot in braces is a fact the story fills in. A tag',
  'in brackets is a narrower case that is chosen first while it has not been said. Nothing here names a trait or label.',
  '',
  '## Lines a personality a moment',
  '',
  `| Personality | ${MOMENTS.join(' | ')} |`,
  `| --- | ${MOMENTS.map(() => '---:').join(' | ')} |`,
  ...PERSONALITIES.map((n) => `| ${n} | ${MOMENTS.map((m) => linesOf(n, m).length).join(' | ')} |`),
  `| plain voice | ${MOMENTS.map((m) => PLAIN[m].length).join(' | ')} |`,
  '',
);
for (const m of MOMENTS) {
  out.push(`## ${m}`, '');
  for (const n of PERSONALITIES) {
    out.push(`### ${n}`, '');
    for (const e of VOICES[n][m]) out.push(typeof e === 'string' ? `- ${e}` : `- [${e[0]}] ${e[1]}`);
    out.push('');
  }
  out.push('### plain voice', '', ...PLAIN[m].map((t) => `- ${t}`), '');
}

if (!check) {
  mkdirSync('.check', { recursive: true });
  writeFileSync('.check/quotes.md', out.join('\n') + '\n');
  const total = PERSONALITIES.reduce((n, p) => n + MOMENTS.reduce((k, m) => k + linesOf(p, m).length, 0), 0);
  console.log(
    `Wrote .check/quotes.md (${PERSONALITIES.length} personalities, ${MOMENTS.length} moments, ${total} lines).`,
  );
  process.exit(0);
}

// ── the ten-season check ──
const l: League = createLeague({ seed });
const phase = () => l.phase as string;
const seen = new Set<string>();
interface Printed {
  text: string;
  who: string;
  season: number;
  headline: string;
}
const printed: Printed[] = [];
let coachQuotes = 0;
let spokeOut = 0;
const collect = () => {
  for (const m of l.inbox ?? []) {
    if (!m.edition || seen.has(m.id)) continue;
    seen.add(m.id);
    const e = m.edition;
    for (const s of [e.lead, ...(e.club ? [e.club] : []), ...e.tiles] as EditionStory[]) {
      if (!s.quote) continue;
      if (s.quote.playerId === undefined) {
        coachQuotes++;
        continue;
      }
      // A man speaking out about a benching, a trade or a release has four fixed lines (`speakStory`), not a personality's.
      if (s.kind === 'speak') {
        spokeOut++;
        continue;
      }
      const p = l.players[s.quote.playerId];
      printed.push({
        text: s.quote.text,
        who: p ? personalityOf(trueCharacter(p)) : 'unknown',
        season: l.season,
        headline: s.headline,
      });
    }
  }
};
deliverMail(l);
collect();
for (let n = 0; n < seasons; n++) {
  while (phase() === 'regular' || phase() === 'playoffs') {
    playWeek(l);
    deliverMail(l);
    collect();
  }
  beginOffseason(l);
  if (!l.personnel?.enabled) turnOnPersonnel(l);
  deliverMail(l);
  collect();
  for (let k = 0; k < 40 && phase() !== 'regular'; k++) {
    advanceOffseason(l, { autoUser: true });
    deliverMail(l);
    collect();
  }
  console.log(`season ${n + 1} of ${seasons} (${l.season - 1}): ${printed.length} player quotes so far`);
}

// A line is what the preview lists: the same line with another team's name in it is still that line.
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = [
  ...PERSONALITIES.flatMap((n) => MOMENTS.flatMap((m) => linesOf(n, m))),
  ...MOMENTS.flatMap((m) => PLAIN[m]),
].map((t) => ({ t, re: new RegExp(`^${escape(t).replace(/\\\{\w+\\\}/g, '.+?')}$`, 'i') }));
const lineOf = (text: string) => templates.find((x) => x.re.test(text))?.t ?? text;

const count = new Map<string, number>();
const printedLines = new Map<string, number>();
for (const q of printed) {
  count.set(q.text, (count.get(q.text) ?? 0) + 1);
  const line = lineOf(q.text);
  printedLines.set(line, (printedLines.get(line) ?? 0) + 1);
}
const distinct = printed.length ? count.size / printed.length : 1;
const worst = [...printedLines].sort((a, b) => b[1] - a[1]);
const over = worst.filter(([, n]) => n > MAX_SAME);
const byWho = new Map<string, number>();
for (const q of printed) byWho.set(q.who, (byWho.get(q.who) ?? 0) + 1);

const ok = over.length === 0 && distinct >= MIN_DISTINCT && printed.length > 0;
out.push(
  `## A ${seasons}-season league (seed \`${seed}\`)`,
  '',
  `- Player quotes printed: **${printed.length}** (not counted: head coaches quoted ${coachQuotes}, players speaking out ${spokeOut}).`,
  `- Distinct share: **${distinct.toFixed(3)}** (${count.size} different quotes as printed, must be at least ${MIN_DISTINCT}; ${printedLines.size} different lines).`,
  `- Most often printed: one line **${worst[0]?.[1] ?? 0}** times, whatever team or city was in it (must be at most ${MAX_SAME}).`,
  `- By personality: ${[...byWho]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}.`,
  '',
  ...(over.length ? ['### Lines printed too often', '', ...over.map(([t, n]) => `- ${n} times: ${t}`), ''] : []),
  '### Every printed quote, in order',
  '',
  ...printed.map((q) => `- (${q.season}, ${q.who}) “${q.text}” · ${q.headline}`),
  '',
);
mkdirSync('.check', { recursive: true });
writeFileSync('.check/quotes.md', out.join('\n') + '\n');
console.log(
  `${ok ? '✓' : '✗'} ${printed.length} player quotes, distinct share ${distinct.toFixed(3)} (floor ${MIN_DISTINCT}), most printed line ${worst[0]?.[1] ?? 0} times (max ${MAX_SAME}). Wrote .check/quotes.md.`,
);
if (printed.length === 0) console.log('✗ no player quote was printed at all');
process.exit(ok ? 0 : 1);
