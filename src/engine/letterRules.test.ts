import { describe, expect, it } from 'vitest';
import { sourceLines } from '../../scripts/letters-source';
import { LETTER_FILES, letterBreaks, wordBreaks } from './letterRules';

describe('the house rules for letters', () => {
  it('catches what a rule can check', () => {
    expect(letterBreaks('Three men are still waiting on you.')).toContain('says "men" for players');
    expect(letterBreaks('He is the better man right now.')).toContain('says "man" for a player');
    expect(letterBreaks('Here is the state of the locker room as I see it.')).toEqual([
      'announces what follows ("here is")',
      'announces a view ("as I see it")',
    ]);
    expect(letterBreaks('You can feel it in the building.')).toContain('says "the building" for the club');
    expect(letterBreaks('The guys heard you.')).toContain('says "guys" for players');
    expect(letterBreaks('He is fading; I would let him go.')).toContain('has a semicolon');
    expect(letterBreaks('My read: words will not do it.')).toContain('has a colon inside a sentence');
    expect(letterBreaks('The room is restless. Not yet.')).toContain('is clipped ("Not yet.")');
  });

  it('lets plain letters through, and a person speaking answer in two words', () => {
    expect(letterBreaks('Two players are still waiting on you about their contracts.')).toEqual([]);
    expect(letterBreaks('Nobody here is judged by it.')).toEqual([]);
    expect(letterBreaks('Our game kicks off Sunday at 1:00.')).toEqual([]);
    expect(letterBreaks('Man coverage suits him.')).toEqual([]);
    expect(letterBreaks("Fair enough. I'll earn it.", { quotes: true })).toEqual([]);
    expect(letterBreaks('Losing wears on a man.', { quotes: true })).toContain('says "man" for a player');
    expect(wordBreaks('a third-year man')).toEqual(['says "man" for a player']);
  });

  // Every line the letters can say, read from the source: a new line that breaks a rule fails here by file and line.
  it('holds every line in the files that word letters', () => {
    const breaks: string[] = [];
    let lines = 0;
    for (const { file, quotes } of LETTER_FILES) {
      for (const l of sourceLines(file)) {
        lines++;
        for (const why of letterBreaks(l.text, { quotes })) breaks.push(`${file}:${l.line} ${why}: ${l.text}`);
      }
      for (const l of sourceLines(file, true))
        for (const why of wordBreaks(l.text)) breaks.push(`${file}:${l.line} ${why}: ${l.text}`);
    }
    expect(lines).toBeGreaterThan(1500);
    expect(breaks).toEqual([]);
  });
});
