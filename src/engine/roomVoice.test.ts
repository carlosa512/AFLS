import { describe, expect, it } from 'vitest';
import { RESERVED_NICKNAMES } from './data/teams';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { VERDICT, type VerdictFact } from './lockerVoice';
import { lastTold, unitFact } from './roomFacts';
import {
  causeOf,
  coachCount,
  inWords,
  STANDING_NOTE,
  STANDING_WHY,
  UNIT_NOTE,
  UNIT_TURN,
  type StandingFact,
  type UnitFact,
} from './roomVoice';
import { roomView, type UnitWord } from './standing';
import { say } from './voice';

const BANNED =
  /standing|weight|influence|\btiers?\b|hierarch|faction|clique|cohesion|contagion|\bspread|atmosphere|gauge|chemistry|\bmorale\b|\blevel\b|marble|\btraits?\b|z-score/i;
const unit = (o: Partial<UnitFact> = {}): UnitFact => ({
  unit: 'the receivers',
  word: 'Split',
  still: false,
  turned: true,
  setter: null,
  setterCaptain: false,
  setterSound: null,
  pulling: null,
  cause: null,
  causeCount: null,
  upYoung: false,
  rival: null,
  losingRun: 0,
  noVoice: false,
  goneLeader: null,
  nearVoice: null,
  was: null,
  ...o,
});
const WORDS: UnitWord[] = ['Tight', 'Settled', 'Restless', 'Down', 'Split'];
const clean = (s: string) => {
  expect(s.length).toBeGreaterThan(10);
  expect(s).not.toMatch(/\d/);
  expect(s).not.toMatch(BANNED);
  for (const nick of RESERVED_NICKNAMES) expect(s).not.toMatch(new RegExp(`\\b${nick}\\b`, 'i'));
};

describe('the room in words', () => {
  it('counts like a coach', () => {
    expect(coachCount(2, 9)).toBe('two');
    expect(coachCount(4, 9)).toBe('four');
    expect(coachCount(5, 10, 'the line')).toBe('half the line');
    expect(coachCount(7, 10, 'the line')).toBe('most of the line');
    expect(coachCount(10, 10, 'the line')).toBe('the whole line');
    expect(inWords(8)).toBe('eight');
  });

  it('maps reasons to causes', () => {
    expect(causeOf('Waiting on his snaps')).toBe('snaps');
    expect(causeOf('Noticed who got paid')).toBe('deal');
    expect(causeOf('The losing is wearing on him')).toBe('losing');
    expect(causeOf('Loving the winning')).toBeNull();
  });

  it('every bank has a line for every case, in plain football words', () => {
    const lines: string[] = [];
    for (const word of WORDS)
      for (const still of [false, true])
        for (const setter of [null, 'Mack'])
          for (const sound of [null, 'stirs', 'steadies'] as const)
            for (const cause of [null, 'snaps', 'deal', 'losing', 'feud'] as const)
              for (const noVoice of [false, true]) {
                const f = unit({
                  word,
                  still,
                  turned: !still,
                  setter,
                  setterSound: setter ? sound : null,
                  pulling: setter ? 'down' : null,
                  cause,
                  causeCount: cause && 'two',
                  noVoice: noVoice && !setter,
                  nearVoice: noVoice && !setter ? 'Pope' : null,
                  losingRun: cause === 'losing' ? 3 : 0,
                });
                const at = { key: `k:${word}:${still}:${setter}:${sound}:${cause}:${noVoice}`, slot: 'u' };
                lines.push(say(UNIT_NOTE, f, at), say(UNIT_TURN, f, at));
              }
    for (const now of [null, 'leader', 'voice'] as const)
      for (const was of [null, 'leader', 'voice'] as const)
        for (const experience of [1, 8])
          for (const newcomer of [false, true])
            if (now !== was)
              lines.push(
                say(
                  STANDING_NOTE,
                  {
                    name: 'Hill',
                    now,
                    was,
                    experience,
                    newcomer,
                    starts: true,
                    captain: false,
                    benched: now === null,
                    stirs: now === 'voice',
                    warn: now === 'voice',
                    unit: 'the receivers',
                  },
                  { key: `s:${now}:${was}:${experience}:${newcomer}`, slot: 's' },
                ),
              );
    for (const parts of [['veteran', 'starts'], ['captain'], ['newcomer'], ['leads'], ['quarterback'], []] as const)
      lines.push(say(STANDING_WHY, { parts: [...parts], experience: 8, unit: 'the line' }, { key: 'w', slot: 'w' }));
    for (const s of lines) clean(s);
  });

  it('the most specific line names the man and the reason', () => {
    const s = say(
      UNIT_NOTE,
      unit({ setter: 'Mack', setterSound: 'stirs', pulling: 'down', cause: 'snaps', rival: 'Hill', upYoung: true }),
      { key: 'k', slot: 'u' },
    );
    expect(s).toMatch(/Mack/);
    expect(s).toMatch(/Hill|job|snaps/);
  });

  it('"still" reads as still', () => {
    for (const word of ['Split', 'Down'] as const)
      expect(say(UNIT_NOTE, unit({ word, still: true, turned: false }), { key: 'k', slot: 'u' })).toMatch(/still/i);
  });

  it('a split unit never claims it costs us on the field', () => {
    for (const sound of [null, 'stirs'] as const)
      for (const k of ['a', 'b', 'c', 'd'])
        expect(
          say(UNIT_NOTE, unit({ setter: 'Mack', setterSound: sound, pulling: 'down' }), { key: k, slot: 'u' }),
        ).not.toMatch(/costing|Sunday|on the field/i);
  });

  it('the position coach speaks in the first person', () => {
    expect(say(UNIT_TURN, unit({ setter: 'Mack' }), { key: 'k', slot: 'u' })).toMatch(/\b(my|I|I'm|I've)\b/);
  });

  it('the verdict speaks about the room when a unit is split', () => {
    const quiet: VerdictFact = {
      checkin: 'cutdown',
      newFeuds: 0,
      standing: null,
      lost: 0,
      lostName: null,
      struggling: 0,
      friends: 0,
      grew: 0,
      unhappy: 0,
    };
    const s = say(VERDICT, { ...quiet, split: ['the receivers'] }, { key: 'k', slot: 'v' });
    expect(s).toMatch(/receivers/i);
    clean(s);
    clean(say(VERDICT, { ...quiet, tight: 'the line' }, { key: 'k', slot: 'v' }));
    clean(say(VERDICT, { ...quiet, apart: 'young down' }, { key: 'k', slot: 'v' }));
  });

  it('lastTold keeps the latest clock', () => {
    const t = lastTold(
      new Set(['unit:400:WR:Split', 'unit:405:WR:Restless', 'standing:400:7:voice', 'standing:405:8:leader']),
    );
    expect(t.units.get('WR')).toEqual({ word: 'Restless', clock: 405 });
    expect([...t.standing!.tiers]).toEqual([[8, 'leader']]);
    expect(lastTold(new Set()).standing).toBeNull();
  });

  it("writes a clean line for every unit of a played league's room", () => {
    const l = createLeague({ seed: 'room-voice' });
    simToEndOfSeason(l);
    for (const v of roomView(l).units) clean(say(UNIT_NOTE, unitFact(l, v, null, null), { key: 'k', slot: v.unit }));
  }, 60_000);
});

describe('the room in words: read by eye', () => {
  const standing = (o: Partial<StandingFact> = {}): StandingFact => ({
    name: 'Owens',
    now: 'voice',
    was: null,
    experience: 5,
    newcomer: false,
    starts: true,
    captain: false,
    benched: false,
    stirs: false,
    warn: false,
    unit: 'the line',
    ...o,
  });

  it('never writes "Owens\'s" for "Owens is" or "Owens has"', () => {
    for (const k of ['a', 'b', 'c', 'd', 'e'])
      for (const o of [{}, { stirs: true, warn: true }, { now: 'leader' as const }, { now: null, benched: true }])
        expect(say(STANDING_NOTE, standing(o), { key: k, slot: 's' })).not.toMatch(/Owens's/);
    for (const sound of [null, 'stirs', 'steadies'] as const)
      for (const word of WORDS)
        expect(
          say(UNIT_NOTE, unit({ word, setter: 'James', setterSound: sound, pulling: 'down', cause: 'deal' }), {
            key: 'k',
            slot: word,
          }),
        ).not.toMatch(/James's/);
    expect(say(UNIT_NOTE, unit({ setter: 'Chavez', pulling: 'down' }), { key: 'k', slot: 'u' })).not.toMatch(
      /Chavez's/,
    );
  });

  it("says a following isn't all good only when our read shows a man who stirs", () => {
    for (const k of ['a', 'b', 'c'])
      expect(say(STANDING_NOTE, standing({ stirs: true, warn: false }), { key: k, slot: 's' })).not.toMatch(
        /Not all of it/,
      );
    expect(say(STANDING_NOTE, standing({ stirs: true, warn: true }), { key: 'k', slot: 's' })).toMatch(/Not all of it/);
  });

  it('a unit that cooled from Tight is not "back on an even keel"', () => {
    for (const k of ['a', 'b', 'c'])
      expect(say(UNIT_NOTE, unit({ word: 'Settled', turned: true, was: 'Tight' }), { key: k, slot: 'u' })).not.toMatch(
        /even keel|back/i,
      );
    expect(say(UNIT_NOTE, unit({ word: 'Settled', turned: true, was: 'Split' }), { key: 'k', slot: 'u' })).toMatch(
      /back|even keel/i,
    );
  });

  it('the verdict never calls the rest of the room fine while a unit is split or down', () => {
    const fact: VerdictFact = {
      checkin: 'deadline',
      newFeuds: 0,
      standing: 'Hilliard and Smith',
      lost: 0,
      lostName: null,
      struggling: 0,
      friends: 0,
      grew: 0,
      unhappy: 0,
    };
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'])
      for (const room of [{ split: ['the quarterbacks'] }, { down: ['the line'] }])
        expect(say(VERDICT, { ...fact, ...room }, { key: k, slot: 'v' })).not.toMatch(/rest of the room is fine/i);
  });
});
