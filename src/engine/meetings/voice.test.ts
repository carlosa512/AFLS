import { describe, expect, it } from 'vitest';
import { say } from '../voice';
import type { Backing, Moment, Outcome } from '../types';
import type { ManFact, Reason, SuggestFact } from './facts';
import {
  approachLabel,
  ASK,
  backingLabel,
  CANDID,
  CAPTAIN_OPEN,
  DUE,
  MOMENT_LEAD,
  NEXT,
  READ_LEAD,
  READ_ROOM,
  READ_WHY,
  TOLD,
  WENT,
  yearParagraph,
} from './voice';
import { leadAndWhy } from './mail';

const man = (last: string, o: Partial<ManFact> = {}): ManFact => ({
  id: 1,
  first: 'Preston',
  last,
  years: 'a third-year man',
  starting: true,
  rookieDeal: true,
  finalYear: true,
  ...o,
});
const fact = (o: Partial<SuggestFact> = {}): SuggestFact => ({
  style: 'plain',
  scope: 'DL',
  noun: 'the D-line',
  kind: 'trouble',
  topic: 'deal',
  word: 'Split',
  driver: man('Mitchell'),
  dealMen: [man('Mitchell')],
  record: 'winning',
  losingRun: false,
  credibility: 'steady',
  advice: 'talks',
  ...o,
});
const at = { key: 'k', slot: 's' };
/** Engine words a letter never uses (L1 §6.2), and digits. */
const BANNED =
  /\b(standing|weight|influence|tier|hierarchy|cohesion|chemistry|morale|credibility|score|faction|clique)\b|\d/i;
const clean = (s: string) => expect(s).not.toMatch(BANNED);

describe('meetings: the coach’s words', () => {
  it('reads a split room over money the way the mockup does', () => {
    const f = fact();
    expect(say(READ_LEAD, f, at)).toBe(
      'Preston Mitchell is unhappy about his deal, and the D-line is hearing about it.',
    );
    expect(say(READ_WHY, f, at)).toMatch(/third-year man starting for us on a rookie wage/);
    expect(say(READ_ROOM, f, at)).toMatch(/with his deal running out it won't sort itself out/);
    expect(say(ASK, f, at)).toMatch(/the only thing that reaches him on the money/);
  });

  it('has a line for every case, and none uses an engine word or a digit', () => {
    const topics = ['deal', 'snaps', 'losing', 'feud', 'none'] as const;
    for (const topic of topics)
      for (const word of ['Split', 'Down', undefined] as const)
        for (const style of ['terse', 'plain', 'warm'] as const)
          for (const kind of ['moment', 'trouble'] as const) {
            const f = fact({
              topic,
              word,
              style,
              kind,
              advice: undefined,
              ...(topic === 'feud' ? { feud: [man('A'), man('B')] } : {}),
            });
            const lead = say(READ_LEAD, f, at);
            expect(lead.length).toBeGreaterThan(0);
            for (const s of [lead, say(READ_WHY, f, at), say(READ_ROOM, f, at), say(ASK, f, at)]) clean(s);
          }
    for (const m of Object.keys(MOMENT_LEAD) as Moment[]) clean(MOMENT_LEAD[m]);
  });

  it('the specific line beats the general one', () => {
    expect(say(READ_LEAD, fact({ driver: undefined, dealMen: [], topic: 'deal' }), at)).not.toMatch(/hearing about it/);
    expect(say(READ_WHY, fact({ driver: man('Mitchell', { starting: false }) }), at)).not.toMatch(/rookie wage/);
  });

  it('labels every choice briefly, naming the man when there is one', () => {
    expect(approachLabel('callout', fact())).toBe('Call Mitchell out');
    expect(backingLabel('talks', fact())).toBe("We're talking to his agent");
    expect(backingLabel('words', fact())).toBe('Nothing, just words');
    for (const b of ['talks', 'snaps', 'feud', 'move', 'jobs', 'words'] as Backing[])
      expect(backingLabel(b, fact()).split(' ').length).toBeLessThanOrEqual(6);
  });

  it('every reaction names its reason', () => {
    const pairs: [Reason, Exclude<Outcome, 'shrug'>][] = [
      ...(['answered', 'heard', 'leader', 'content'] as Reason[]).map((r): [Reason, 'lands'] => [r, 'lands']),
      ...(['calledOut', 'friendCalledOut', 'money', 'dugIn', 'tone', 'again', 'notHis'] as Reason[]).map(
        (r): [Reason, 'bristles'] => [r, 'bristles'],
      ),
    ];
    for (const [reason, outcome] of pairs) {
      {
        const line = say(WENT, { man: man('Eze'), outcome, reason, topic: 'deal' }, at);
        expect(line).toMatch(/^Eze /);
        // A reason follows the verdict: "took it well. He heard…", "didn't like being…", ";…".
        expect(
          line.split(/[.;:]/).filter((x) => x.trim()).length +
            (/(didn't like|wanted|took the tone)/.test(line) ? 1 : 0),
        ).toBeGreaterThanOrEqual(2);
        clean(line);
      }
    }
  });

  it('never claims a meeting fixed anything, and says the window in words', () => {
    for (const backing of ['talks', 'snaps', 'feud', 'move', 'jobs', 'words'] as Backing[]) {
      const line = say(
        NEXT,
        {
          backing,
          noun: 'the D-line',
          named: [man('Mitchell'), man('Eze')].slice(0, backing === 'feud' ? 2 : 1),
          window: 'within four weeks',
        },
        at,
      );
      expect(line).not.toMatch(/\b(fixed|sorted|solved|settled|done deal)\b/i);
      clean(line);
    }
    for (const approach of ['straight', 'callout', 'leader', 'losing', 'standard'] as const)
      clean(
        say(
          TOLD,
          {
            style: 'plain',
            approach,
            backing: 'words',
            topic: 'deal',
            noun: 'the D-line',
            named: [],
            speaker: man('Mitchell'),
          },
          at,
        ),
      );
  });

  it('the staff notes, the year and the captain read plainly', () => {
    clean(say(DUE, { backing: 'talks', noun: 'the D-line', named: [man('Mitchell')] }, at));
    for (const read of ['believes', 'steady', 'heardBefore', 'wornThin'] as const)
      clean(say(CANDID, { read, better: true }, at));
    const year = yearParagraph({
      held: 4,
      kept: { noun: 'the line', month: 'October', promise: "we'd open Mitchell's talks", named: 'he' },
      broken: { when: 'the deadline', promise: 'we were buying' },
    });
    expect(year).toMatch(/^We got the guys together four times this year\./);
    expect(year.match(/\bthe one\b/gi)).toBeNull();
    clean(year);
    // A promise from your own address is yours, not the coach's.
    const yours = yearParagraph({
      held: 2,
      kept: { noun: 'the team', month: 'October', promise: "nobody's job was safe", you: true },
      broken: { when: 'the deadline', promise: 'we were buying', you: true },
    });
    expect(yours).toMatch(/you told them nobody's job was safe/i);
    expect(yours).toMatch(/You told them we were buying/);
    expect(yours).not.toMatch(/\bI (told|said)\b/);
    clean(yours);
    for (const went of ['landed', 'mixed', 'flopped'] as const)
      expect(
        say(CAPTAIN_OPEN, { approach: 'ownIt', backing: 'jobs', went, record: 'losing' }, at).length,
      ).toBeGreaterThan(0);
  });
});

describe('meetings: the review’s fixes', () => {
  it('a plural room takes a plural verb, in every line and the subject', () => {
    const f = fact({ scope: 'WR', noun: 'the receivers' });
    expect(say(READ_LEAD, f, at)).toMatch(/the receivers are hearing about it/);
    expect(say(READ_ROOM, f, at)).not.toMatch(/receivers is/);
    expect(
      say(
        READ_LEAD,
        fact({ scope: 'LB', noun: 'the linebackers', driver: undefined, dealMen: [], topic: 'none', word: 'Down' }),
        at,
      ),
    ).toBe('The linebackers are down.');
    expect(
      say(NEXT, { backing: 'talks', noun: 'the receivers', named: [man('Mitchell')], window: 'within four weeks' }, at),
    ).toMatch(/The receivers expect us/);
  });

  it('"He\'s…" follows only a lead that named him', () => {
    const losing = fact({ scope: 'team', noun: 'the team', topic: 'losing', losingRun: true });
    const [lead, why] = leadAndWhy(losing, at);
    expect(lead).not.toMatch(/Mitchell/);
    expect(why).toBe('');
    const [, named] = leadAndWhy(fact(), at);
    expect(named).toMatch(/^He's /);
  });
});
