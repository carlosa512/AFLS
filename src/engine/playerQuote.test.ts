import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { LETTER_FILES, letterBreaks, wordBreaks } from './letterRules';
import { personalityOf, trueCharacter } from './personality';
import {
  bankFor,
  linesOf,
  MOMENTS,
  PERSONALITIES,
  playerQuote,
  speaks,
  type QuoteFacts,
  type QuoteMoment,
} from './playerQuote';
import { PLAIN } from './playerQuoteLines';
import type { League, Player } from './types';
import { sentencesOf } from './voice';

let l: League;
beforeAll(() => {
  l = createLeague({ seed: 'player-quotes' });
}, 60_000);

/** The least a personality's lines at a moment must number: four where the moment is common, two where it is rare. */
const FLOOR: Record<QuoteMoment, number> = {
  drafted: 4,
  signed: 4,
  trouble: 4,
  suspended: 2,
  back: 2,
  bigWin: 2,
  badLoss: 2,
  goodSide: 2,
};
const FACTS: Omit<QuoteFacts, 'key'> = {
  team: 'Tarpons',
  city: 'Tampa',
  pick: 14,
  round: 1,
  games: 2,
  opp: 'Hammers',
  kind: 'community',
};
/** A word list: no quote names a trait, a label or a hidden scale. */
const LABELS =
  /\b(hothead|diva|lawyer|volatile|mercenary|ring chaser|company man|quiet pro|coaster|easygoing|even-keeled|born leader|consummate|jittery|driven|fiery|dirty player|work ethic|temperament|poise|loyalty|sportsmanship|greed|patience|trait|personality|attribute|rating)\b/i;

describe('every personality has words for every moment', () => {
  it('has the depth: four lines a personality where the moment is common, two where it is rare', () => {
    for (const name of PERSONALITIES)
      for (const m of MOMENTS) expect(linesOf(name, m).length, `${name} ${m}`).toBeGreaterThanOrEqual(FLOOR[m]);
  });

  it('names all eighteen personalities and falls back to a plain voice, never to nothing', () => {
    expect(PERSONALITIES).toHaveLength(18);
    for (const m of MOMENTS) {
      expect(PLAIN[m].length).toBeGreaterThanOrEqual(3);
      for (const name of PERSONALITIES) {
        // With no fact at all, a personality (or, failing that, the plain voice) still has something to say.
        expect(bankFor(name, m).filter((x) => !x.when || x.when({ key: 'k' })).length, `${name} ${m}`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('has lines that fit each case, not just a plain one: every kind of good deed, trouble on or off the field, a first-round pick, a late one', () => {
    const own = (name: Parameters<typeof bankFor>[0], m: QuoteMoment, f: Partial<QuoteFacts>) =>
      bankFor(name, m).filter(
        (x) =>
          (x.reads ?? 0) > 0 &&
          (!x.when || x.when({ key: 'k', team: 'T', city: 'C', pick: 9, games: 2, pos: 'OL', ...f })),
      ).length;
    const cases: [string, QuoteMoment, Partial<QuoteFacts>, number][] = [
      ['good community', 'goodSide', { kind: 'community' }, 2],
      ['good family', 'goodSide', { kind: 'family' }, 2],
      ['good teammate', 'goodSide', { kind: 'teammate' }, 2],
      ['trouble on the field', 'trouble', { onField: true, heated: true, league: true }, 3],
      ['trouble off it, a fight', 'trouble', { onField: false, heated: true, league: true }, 3],
      ['trouble, a missed event', 'trouble', { onField: false, minor: true }, 3],
      ['trouble, an argument', 'trouble', { onField: false, heated: true, minor: true }, 3],
      ['first round', 'drafted', { round: 1 }, 4],
      ['late', 'drafted', { round: 6, slid: true }, 4],
      ['returning', 'signed', { returning: true }, 4],
      ['win, a game follows', 'bigWin', { next: true }, 2],
      ['win, season over', 'bigWin', { next: false }, 2],
      ['loss, a game follows', 'badLoss', { next: true }, 2],
      ['loss, season over', 'badLoss', { next: false }, 2],
      ['one game out', 'suspended', { games: 1 }, 2],
      ['games out', 'suspended', { games: 2 }, 2],
      ['back after one', 'back', { games: 1 }, 2],
      ['back after several', 'back', { games: 2 }, 2],
    ];
    for (const name of PERSONALITIES)
      for (const [label, m, f, least] of cases)
        expect(own(name, m, f), `${name} ${label}`).toBeGreaterThanOrEqual(least);
  });

  it('keeps lines about a missed event off a public argument, and still lets a missed curfew have them', () => {
    const said = (name: Parameters<typeof bankFor>[0], f: Partial<QuoteFacts>) =>
      bankFor(name, 'trouble')
        .filter((x) => (x.reads ?? 0) > 0 && (!x.when || x.when({ key: 'k', ...f })))
        .map((x) => (x.text ? x.text({ key: 'k', ...f }) : ''));
    const spat = { onField: false, heated: true, minor: true };
    const curfew = { onField: false, heated: false, minor: true };
    // Coaster's missed-event lines are tagged offField.
    for (const line of ["My bad. I'll set an alarm or something.", "I overslept. It's a bad look and I know it."]) {
      expect(said('Coaster', spat), line).not.toContain(line);
      expect(said('Coaster', curfew), line).toContain(line);
    }
  });

  it("is one voice a personality: a Hothead's line is not a Company Man's", () => {
    for (const m of MOMENTS) {
      const [a, b] = [new Set(linesOf('Hothead', m)), linesOf('Company Man', m)];
      expect(
        b.filter((x) => a.has(x)),
        m,
      ).toEqual([]);
    }
  });

  it('shares no line between two personalities at a moment', () => {
    for (const m of MOMENTS) {
      const seen = new Map<string, string>();
      for (const name of PERSONALITIES)
        for (const t of linesOf(name, m)) {
          expect(seen.get(t), `${m}: "${t}" is ${seen.get(t)}'s and ${name}'s`).toBeUndefined();
          seen.set(t, name);
        }
    }
  });

  it('gives each line its own sentences, so one said does not rule out another', () => {
    for (const m of MOMENTS) {
      const seen = new Map<string, string>();
      for (const name of PERSONALITIES)
        for (const t of linesOf(name, m).concat(name === 'Even-Keeled' ? [...PLAIN[m]] : []))
          for (const s of sentencesOf(t)) {
            const before = seen.get(s);
            expect(before === undefined || before === t, `${m}: "${s}" is in two lines`).toBe(true);
            seen.set(s, t);
          }
    }
  });
});

describe('the words themselves', () => {
  const every = () =>
    PERSONALITIES.flatMap((n) => MOMENTS.flatMap((m) => [...linesOf(n, m), ...(n === 'Even-Keeled' ? PLAIN[m] : [])]));

  it('name no trait, label or hidden number, and pass the letter and word rules', () => {
    for (const t of every()) {
      expect(t, t).not.toMatch(LABELS);
      expect(t, t).not.toMatch(/\d/);
      expect(letterBreaks(t, { quotes: true }), t).toEqual([]);
      expect(wordBreaks(t), t).toEqual([]);
      expect(t, t).not.toMatch(/\b(the guys|guys|the building|vets|kids)\b/i);
    }
  });

  it('are held to the house rules at the source, too', () => {
    expect(LETTER_FILES.some((f) => f.file === 'src/engine/playerQuoteLines.ts' && f.quotes)).toBe(true);
  });
});

/** A player of each personality the league has, to speak. */
function byPersonality(): Map<string, Player> {
  const out = new Map<string, Player>();
  for (const p of Object.values(l.players)) {
    const n = personalityOf(trueCharacter(p));
    if (!p.retired && !out.has(n)) out.set(n, p);
  }
  return out;
}

describe('a quote after a team’s last game says nothing of next week', () => {
  it('has no line that promises a game when none follows', () => {
    for (const name of PERSONALITIES)
      for (const m of ['bigWin', 'badLoss'] as const)
        for (const x of bankFor(name, m)) {
          const text = x.text({ key: 'k', team: 'T', city: 'C', opp: 'O', next: false });
          if (!x.when!({ key: 'k', team: 'T', city: 'C', opp: 'O', next: false, pos: 'OL' })) continue;
          expect(text, `${name} ${m}`).not.toMatch(
            /next week|next one|another game|another one|next big|keep going|next time/i,
          );
        }
  });
});

describe('a player speaks', () => {
  it('says something at every moment, whatever his personality, in a shape the story rules hold', () => {
    const men = byPersonality();
    expect(men.size).toBeGreaterThanOrEqual(12);
    for (const [name, p] of men)
      for (const m of MOMENTS) {
        const text = playerQuote(l, p, m, { key: `${name}:${m}`, ...FACTS });
        expect(text, `${name} ${m}`).toBeTruthy();
        expect(text).not.toMatch(/\{|\}/);
      }
  });

  it('leaves a line out when a fact it names is missing', () => {
    const p = [...byPersonality().values()][0];
    for (const m of MOMENTS) {
      const text = playerQuote(l, p, m, { key: 'bare' });
      expect(text, m).toBeTruthy();
      expect(text).not.toMatch(/\{|\}/);
    }
    // A slotted line is not even a candidate without its fact, and is one with it.
    const name = personalityOf(trueCharacter(p));
    const slotted = bankFor(name, 'drafted').filter(
      (x) => x.text({ key: 'k', team: 'T' }).includes('T') && !x.when!({ key: 'k' }),
    );
    expect(slotted.length).toBeGreaterThan(0);
    for (const x of slotted) expect(x.when!({ key: 'k', team: 'T', city: 'C', pick: 9, round: 1 })).toBeDefined();
  });

  it('is the same quote for the same story, and never the same sentence twice in a league year', () => {
    const p = [...byPersonality().values()].find((x) => personalityOf(trueCharacter(x)) === 'Even-Keeled')!;
    const a = playerQuote(l, p, 'drafted', { key: 'same', ...FACTS });
    expect(playerQuote(l, p, 'drafted', { key: 'same', ...FACTS })).toBe(a);
    const at = { editionId: 'snn:test', said: [] as string[] };
    const heard: string[] = [];
    // Everything he can say at the moment, then the plain voice's, then nothing: no repeat on the way.
    for (let i = 0; i < 60; i++) {
      const t = playerQuote(l, p, 'drafted', { key: `story:${i}`, at, ...FACTS });
      if (t === null) break;
      expect(heard).not.toContain(t);
      heard.push(t);
    }
    expect(heard.length).toBeGreaterThanOrEqual(linesOf('Even-Keeled', 'drafted').length - 2);
    expect(playerQuote(l, p, 'drafted', { key: 'last', at, ...FACTS })).toBeNull();
  });

  it('keeps a line from printing again in a later edition of the league year, whoever the team', () => {
    const p = [...byPersonality().values()].find((x) => personalityOf(trueCharacter(x)) === 'Even-Keeled')!;
    const used = new Set<string>();
    // Edition after edition, each filed with the line it printed in its `covered`, as the mail does.
    for (let i = 0; i < 60; i++) {
      const team = l.teams[i % l.teams.length];
      const q = speaks(
        l,
        p,
        'bigWin',
        { key: `g${i}`, at: { editionId: `snn:t:w${i}`, said: [] }, next: true },
        team.id,
      );
      if (!q) break;
      expect(used.has(q.line!), `${q.text} printed twice`).toBe(false);
      used.add(q.line!);
      l.inbox = [
        ...(l.inbox ?? []),
        {
          id: `snn:${l.season}:w${i}`,
          season: l.season,
          phase: 'regular',
          week: i,
          from: 'SNN',
          category: 'league',
          subject: '',
          body: q.text,
          covered: [q.line!],
          read: false,
          actions: [],
        },
      ];
    }
    expect(used.size).toBeGreaterThanOrEqual(linesOf('Even-Keeled', 'bigWin').length);
    l.inbox = [];
  });

  it('prefers the narrower case: a first-round pick has his own words while they are unsaid', () => {
    const p = [...byPersonality().values()][0];
    const first = linesOf(personalityOf(trueCharacter(p)), 'drafted').length;
    expect(first).toBeGreaterThan(0);
    const text = playerQuote(l, p, 'drafted', { key: 'top', ...FACTS, round: 1 })!;
    const own = bankFor(personalityOf(trueCharacter(p)), 'drafted').filter((x) => x.reads === 2);
    expect(own.map((x) => x.text({ key: 'top', ...FACTS, round: 1 }))).toContain(text);
  });
});
