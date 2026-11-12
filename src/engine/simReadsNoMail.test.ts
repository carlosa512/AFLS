import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The sim never reads mail: letters are archived, deleted, evicted and rebuilt, and play must be reproducible from the
 * league alone. The sim modules the storylines added or changed may not touch the inbox, what it has told, or its keys.
 * Stories are record-keeping and follow the same rule.
 */
const SIM = [
  'benching.ts',
  'morale.ts',
  'playerTalks.ts',
  'disputes.ts',
  'talkBasics.ts',
  'stories.ts',
  'storiesStep.ts',
  'league.ts',
  'offseason/index.ts',
  'meetings/index.ts',
  'meetings/commitments.ts',
  'meetings/react.ts',
  'publicStanding.ts',
  'finance/cap.ts',
  'offseason/draft.ts',
];

/** Mail-side modules of SNN's big days: the editor and its words. Only mail, scripts and screens may import them. */
const DAYS = /from '\.\.?\/(?:engine\/)?(snnDays|snnDayVoice)'/;
const MAIL_SIDE = new Set(['inbox.ts', 'snnDays.ts', 'snnDayVoice.ts']);
const engineFiles = (dir: URL, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? engineFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`)
      : e.name.endsWith('.ts') && !e.name.includes('.test.')
        ? [`${prefix}${e.name}`]
        : [],
  );

/** The file's code, comments taken out (a comment may name the inbox to say why it is not read). */
const code = (file: string) =>
  readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the sim reads no mail', () => {
  it.each(SIM)('%s never reads the inbox or what it told', (file) => {
    const src = code(file);
    expect(src.match(/\binbox\b|mailTold|toldKeys|from '\.\/inbox'|from '\.\.\/inbox'/g) ?? []).toEqual([]);
  });

  it('nothing in the engine but the inbox imports the big-day editor or its words', () => {
    const importers = engineFiles(new URL('./', import.meta.url)).filter(
      (file) => !MAIL_SIDE.has(file) && DAYS.test(code(file)),
    );
    expect(importers).toEqual([]);
  });
});
