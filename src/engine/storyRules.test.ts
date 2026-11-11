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
