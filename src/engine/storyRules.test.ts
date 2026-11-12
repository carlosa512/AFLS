import { describe, expect, it } from 'vitest';
import { ruleBreaks } from './storyRules';
import type { EditionStory, League } from './types';

const league = {
  players: {
    1: { id: 1, firstName: 'Jamison', lastName: 'Reed' },
    2: { id: 2, firstName: 'Jordan', lastName: 'Patterson' },
  },
  teams: [
    { id: 0, city: 'Minnesota', name: 'Voyageurs' },
    { id: 1, city: 'Seattle', name: 'Squall' },
  ],
} as unknown as League;

const good: EditionStory = {
  key: 'game:1',
  kind: 'game',
  angle: 'day',
  tier: 4,
  clubId: 0,
  kicker: 'Frontier',
  headline: 'Reed, 32, scores three as the Voyageurs run over Seattle',
  summary: 'Jamison Reed scored three times and the Voyageurs beat the Squall 35–14.',
  picture: { playerId: 1 },
  score: { gameId: 1, homeId: 0, awayId: 1, home: 35, away: 14 },
  cast: [1, 2],
  numbers: [
    { value: '149', label: 'Scrimmage yards' },
    { value: '3', label: 'Touchdowns' },
    { value: '17:34', label: "Seattle's possession" },
  ],
  paragraphs: [
    'Jamison Reed, 32 and in his eleventh season, ran for two touchdowns and caught a third as the Voyageurs beat the 7–1 Squall 35–14.',
    'Seattle lost quarterback Jordan Patterson to a concussion in the second quarter. The Squall held the ball for 17:34.',
    'Minnesota go to San Francisco next. Seattle host Green Bay.',
  ],
  quote: {
    coachId: 9,
    name: 'Tony Barrett',
    role: 'Voyageurs head coach',
    text: 'He’s 32 and he was our best player in the fourth quarter.',
  },
  links: [],
};
const change = (over: Partial<EditionStory>) => ruleBreaks(league, { ...good, ...over });
const withLast = (last: string) => change({ paragraphs: [...good.paragraphs.slice(0, 2), last] });

describe('the writing rules a test can hold', () => {
  it('passes a story that keeps them all', () => {
    expect(ruleBreaks(league, good)).toEqual([]);
  });

  it('catches a semicolon, in a paragraph or a quote', () => {
    expect(withLast('Minnesota go to San Francisco next; Seattle host Green Bay.')).toEqual([
      expect.stringMatching(/semicolon/),
    ]);
    expect(change({ quote: { ...good.quote!, text: 'We ran it; they could not stop it.' } })).toEqual([
      expect.stringMatching(/semicolon/),
    ]);
  });

  it('catches a colon inside a sentence, and lets a clock time pass', () => {
    expect(withLast('The margin: ten points. Seattle host Green Bay.')).toEqual([expect.stringMatching(/colon/)]);
    expect(withLast('Seattle held the ball for 17:34 and host Green Bay next.')).toEqual([]);
  });

  it('counts the numbers in a sentence, and not the story’s own score', () => {
    expect(withLast('Reed had 149 yards on 25 touches and 3 touchdowns for Minnesota.')).toEqual([
      expect.stringMatching(/numbers/),
    ]);
    // The final score is the result, not a stat: 32, 7–1 and the score is two numbers.
    expect(ruleBreaks(league, good)).toEqual([]);
  });

  it('wants the last sentence to carry a name, a number or a fixture', () => {
    expect(withLast('Minnesota go to San Francisco next. That was the game.')).toEqual([expect.stringMatching(/ends/)]);
    expect(withLast('The road gets no easier. Reed will carry the load.')).toEqual([]); // a man of the story
    expect(withLast('It was their third win in a row.')).toEqual([expect.stringMatching(/ends/)]);
    expect(withLast('It was their 3rd win in a row.')).toEqual([]);
  });

  it('wants two to four paragraphs and at most three numbers', () => {
    expect(change({ paragraphs: [good.paragraphs[0]] })).toEqual([expect.stringMatching(/paragraph/)]);
    expect(change({ paragraphs: [...good.paragraphs, 'Seattle are 7–2.', 'Minnesota are 5–4.'] })).toEqual([
      expect.stringMatching(/paragraph/),
    ]);
    expect(change({ numbers: [...good.numbers, { value: '1', label: 'X' }] })).toEqual([
      expect.stringMatching(/chips/),
    ]);
  });

  it('wants a man’s full name the first time', () => {
    const p = ['Reed ran for two touchdowns as the Voyageurs beat the Squall 35–14.', ...good.paragraphs.slice(1)];
    expect(change({ paragraphs: p })).toEqual([expect.stringMatching(/full name.*Reed/)]);
  });

  it('keeps a headline short, and the tile’s summary to the same rules', () => {
    expect(change({ headline: 'x'.repeat(71) })).toEqual([expect.stringMatching(/headline/)]);
    expect(change({ summary: 'Reed scored; Minnesota won.' })).toEqual([expect.stringMatching(/semicolon/)]);
  });
});

describe('two men with one surname', () => {
  const two = {
    ...league,
    players: {
      1: { id: 1, firstName: 'Jerome', lastName: 'Jackson' },
      2: { id: 2, firstName: 'Daniel', lastName: 'Jackson' },
    },
  } as unknown as League;
  const story = (first: string): EditionStory => ({
    ...good,
    headline: 'Jackson has three sacks in the Voyageurs’ win',
    summary: first,
    cast: [1, 2],
    paragraphs: [first, 'Minnesota go to San Francisco next. Seattle host Green Bay.'],
    quote: undefined,
  });
  it('holds each to his own first mention', () => {
    const fine = story(
      'Jerome Jackson had three sacks as the Voyageurs beat the Squall 35–14. Minnesota got 126 rushing yards from Daniel Jackson.',
    );
    expect(ruleBreaks(two, fine)).toEqual([]);
  });
  it('still catches a bare surname before either is named', () => {
    const bare = story(
      'Jackson had three sacks as the Voyageurs beat the Squall 35–14. Daniel Jackson ran for 126 yards.',
    );
    expect(ruleBreaks(two, bare).join(' ')).toContain('first mention is not the full name: Jackson');
  });
});

describe('a brief', () => {
  it('may be one paragraph, when the story says it is one', () => {
    const one = { ...good, paragraphs: [good.paragraphs[0]], quote: undefined };
    expect(ruleBreaks(league, one).join(' ')).toContain('1 paragraphs');
    expect(ruleBreaks(league, { ...one, brief: true })).toEqual([]);
  });
});

describe('a Column', () => {
  const column = (second: string, table?: EditionStory['table']): EditionStory => ({
    ...good,
    kind: 'column',
    kicker: 'Column',
    headline: 'Minnesota’s problem is its pass protection',
    cast: [],
    score: undefined,
    quote: undefined,
    summary: 'The Voyageurs have lost four in a row, and the pass protection is why.',
    paragraphs: ['The Voyageurs have lost four in a row, and the pass protection is why.', second],
    ...(table ? { table } : {}),
  });
  const table = {
    head: ['', 'Weeks 1–8', 'Since'],
    rows: [
      ['Dropbacks ending in a sack', '4.1%', '12.5%'],
      ['Record', '3–5', '0–4'],
      ['League average since', '—', '6.4%'],
    ],
  };
  const argued =
    'Before this run Minnesota allowed a sack on 4.1% of their dropbacks, so the trouble is new and it arrived with the losing. Minnesota have five games left, the next of them at home to Seattle, and the pass protection has to be better in them.';

  it('keeps the rules when its argument is one thought and its numbers are in a table', () => {
    expect(ruleBreaks(league, column(argued, table))).toEqual([]);
  });
  it('must carry its evidence in a table of two to four rows', () => {
    expect(ruleBreaks(league, column(argued)).join(' ')).toContain('evidence table');
    expect(ruleBreaks(league, column(argued, { ...table, rows: table.rows.slice(0, 1) })).join(' ')).toContain(
      'evidence table',
    );
  });
  it('may not be a row of short sentences', () => {
    const choppy =
      'The quarterback is not the cause. His numbers fell when the hits started. Minnesota changed two starters. The Voyageurs play at home next.';
    const breaks = ruleBreaks(league, column(choppy, table)).join(' | ');
    expect(breaks).toContain('under eight words');
    expect(breaks).toContain('two or three sentences');
  });
  it('keeps one number to a sentence', () => {
    const crowded =
      'Before Week 8 Minnesota allowed a sack on 4.1% of their dropbacks, so the trouble is new and it arrived with the losing. Minnesota have five games left, the next of them at home to Seattle, and the pass protection has to be better.';
    expect(ruleBreaks(league, column(crowded, table)).join(' ')).toContain('more than one number');
  });
});
