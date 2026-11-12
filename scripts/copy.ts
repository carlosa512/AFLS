/**
 * Every sentence a screen can show, in one file, for reading the words on their own (`docs/UI.md`, "Words on a
 * screen"). A preview, not a check: nothing fails.
 *
 *   npm run copy [-- min]
 *
 * Reads the screens' source (`src/ui`, tests left out) and lists the text between tags and the strings inside them
 * (button titles, labels, hints) of `min` characters or more (45 unless given), by file and line, in
 * `.check/copy.txt`, what the app fills in shown as `{…}`. Letters and reports are written in `src/engine` and have
 * their own previews (`npm run letters`, `npm run mail-preview`, `npm run gm-letters`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { screenFiles, screenLines } from './screen-source';

const min = Number(process.argv[2]) || 45;
const files = screenFiles();
const out: string[] = [];
let count = 0;
for (const file of files) {
  const lines = screenLines(file, min);
  if (lines.length === 0) continue;
  out.push(`\n## ${file}`, ...lines.map((l) => `${l.line}  ${l.text}`));
  count += lines.length;
}

mkdirSync('.check', { recursive: true });
writeFileSync('.check/copy.txt', `${out.join('\n')}\n`);
console.log(`${count} lines from ${files.length} files in .check/copy.txt`);
