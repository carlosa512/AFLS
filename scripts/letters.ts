/**
 * Every line the letters in the inbox can say, in one file, for reading the words against the house rules
 * (`docs/NEWS.md`, "Words in a letter"). A preview, not a check: nothing fails here (`letterRules.test.ts` is the
 * check).
 *
 *   npm run letters [-- name]
 *
 * Reads the source of the files that word letters (`LETTER_FILES`) and lists each piece of prose by file and line in
 * `.check/letters.txt`, what the sim fills in shown as `{…}`, with the lines that break a rule at the top. `name`
 * keeps the files whose path holds it (`npm run letters -- locker`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { LETTER_FILES, letterBreaks } from '../src/engine/letterRules';
import { sourceLines } from './letters-source';

const only = process.argv[2];
const breaks: string[] = [];
const out: string[] = [];
let count = 0;
for (const { file, quotes } of LETTER_FILES) {
  if (only && !file.includes(only)) continue;
  const lines = sourceLines(file);
  if (!lines.length) continue;
  count += lines.length;
  out.push(`\n## ${file}${quotes ? ' (a person speaking)' : ''}`);
  for (const l of lines) {
    out.push(`${l.line}  ${l.text}`);
    const why = letterBreaks(l.text, { quotes });
    if (why.length) breaks.push(`${file}:${l.line}  ${l.text}\n    ${why.join(', ')}`);
  }
}
mkdirSync('.check', { recursive: true });
const head = breaks.length ? [`# Rule breaks (${breaks.length})`, ...breaks] : ['# No rule breaks'];
writeFileSync('.check/letters.txt', `${[...head, ...out].join('\n')}\n`);
console.log(`${count} lines, ${breaks.length} rule breaks, in .check/letters.txt`);
