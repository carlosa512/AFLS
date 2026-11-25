import { describe, expect, it } from 'vitest';
import { conductOpen, MAX_ROWS, weekItems } from './coachWeek';
import { answerConduct, reviewWeek, setConductByCoach, settleConduct } from './conduct';
import { conductFact, conductLetters, conductSettled, disciplineLines, leagueFact } from './conductMail';
import {
  CONDUCT_BEFORE,
  CONDUCT_DONE,
  CONDUCT_HEAD,
  CONDUCT_LEAD,
  CONDUCT_READ,
  LEAGUE_MISSES,
  LEAGUE_RECORD,
  LEAGUE_RULING,
  TEAM_RULES,
  type LeagueFact,
} from './conductVoice';
import { createLeague } from './generate';
import { deliverMail, needsYou } from './inbox';
import { moraleClock } from './morale';
import { waitFor } from './playerTalks';
import { activeRoster } from './roster';
import { toldKeys, say } from './voice';
import type { ConductKind, GameResult, League } from './types';

const template = createLeague({ seed: 'conduct-mail' });
const scene = () => {
  const l = structuredClone(template);
  l.phase = 'regular';
  l.week = 6;
  l.moraleAt = moraleClock(l);
  return l;
};
const rowsOf = (l: League) =>
  (l.inbox ?? []).filter((m) => m.id.startsWith('coach:')).flatMap((m) => (m.sections ?? []).flatMap((s) => s.rows));
const pend = (l: League, n: number, kind: ConductKind = 'curfew') => {
  const team = l.teams[l.userTeamId];
  const men = activeRoster(l, l.userTeamId).slice(0, n);
  team.conduct = { pending: men.map((p) => ({ playerId: p.id, kind, clock: l.moraleAt! })) };
  return men;
};

describe('the head coach’s row about trouble', () => {
  it('files with three answers, needs you while it waits, and is gone once answered', () => {
    const l = scene();
    const [p] = pend(l, 1);
    deliverMail(l);
    deliverMail(l);
    const row = rowsOf(l).find((r) => r.conduct)!;
    expect(row.conduct).toEqual({ playerId: p.id, clock: l.moraleAt });
    expect(row.lead).toMatch(/curfew/);
    expect(row.note).toBeTruthy();
    const m = l.inbox!.find((x) => x.id.startsWith('coach:'))!;
    expect(m.sections![0].title).toBe('Who came to see me');
    expect(needsYou(l, m)).toBe(true);
    expect(conductOpen(l, row.conduct!)).toBe(true);
    answerConduct(l, p.id, 'sat');
    expect(conductOpen(l, row.conduct!)).toBe(false);
    expect(needsYou(l, m)).toBe(false);
    deliverMail(l);
    expect(l.inbox!.filter((x) => x.id.startsWith('coach:'))).toHaveLength(1);
  });

  it('is always kept, past the rows a letter holds', () => {
    const l = scene();
    const men = pend(l, MAX_ROWS + 2);
    const rows = weekItems(l, toldKeys(l), []).filter((i) => i.row.conduct);
    expect(rows).toHaveLength(men.length);
    expect(rows.every((i) => i.tier === 1 && i.section === 'asks')).toBe(true);
  });

  it('is settled as Let it go after the usual wait, and its row goes', () => {
    const l = scene();
    const [p] = pend(l, 1);
    const row = l.teams[l.userTeamId].conduct!.pending![0];
    l.moraleAt = l.moraleAt! + waitFor(l, p);
    settleConduct(l);
    expect(conductOpen(l, { playerId: p.id, clock: row.clock })).toBe(false);
    expect(p.discipline!.entries.at(-1)!.outcome).toBe('letGo');
  });

  it('never words the same sentence twice in a league year', () => {
    const l = scene();
    const men = pend(l, 3);
    men.forEach(
      (_, i) => (l.teams[l.userTeamId].conduct!.pending![i].kind = (['meeting', 'late', 'spat'] as const)[i]),
    );
    const said: string[] = [];
    const items = weekItems(l, toldKeys(l), said).filter((i) => i.row.conduct);
    const lines = items.flatMap((i) => [i.row.lead, i.row.before, i.row.note]).filter(Boolean) as string[];
    expect(new Set(lines).size).toBe(lines.length);
    for (const t of lines) expect(t).not.toMatch(/\b(guys|men|club|building)\b|;/i);
  });

  it('has lines for every kind, and a headline with his name', () => {
    const l = scene();
    const p = activeRoster(l, l.userTeamId)[0];
    for (const kind of TEAM_RULES) {
      const f = conductFact(l, p, kind);
      expect(say(CONDUCT_LEAD, f, { key: kind, slot: 'lead' })).toMatch(/\S/);
      expect(say(CONDUCT_READ, f, { key: kind, slot: 'read' })).toMatch(/\S/);
      expect(say(CONDUCT_HEAD, f, { key: kind, slot: 'head' })).toContain(p.lastName);
      const again = { ...f, times: 1, lastOutcome: 'fine' as const, clean: false };
      expect(say(CONDUCT_LEAD, again, { key: kind, slot: 'lead' })).toMatch(/again|another|once more/);
      expect(say(CONDUCT_BEFORE, again, { key: kind, slot: 'b' })).toMatch(/second time/);
    }
    // Several lines a kind, so a league year does not run dry.
    expect(
      CONDUCT_LEAD.filter((x) => x.when!({ ...conductFact(l, p, 'curfew'), inSeason: true })).length,
    ).toBeGreaterThan(4);
  });

  it('with the head coach handling it, tells you what he did as a note with no question', () => {
    const l = scene();
    const [p] = pend(l, 1, 'late');
    setConductByCoach(l, true);
    expect(l.teams[l.userTeamId].conduct).toEqual({ byCoach: true });
    const e = p.discipline!.entries.at(-1)!;
    expect(e.byCoach).toBe(true);
    const note = weekItems(l, toldKeys(l), []).find((i) => i.row.cells[1] === 'Team rules')!;
    expect(note.tier).toBe(4);
    expect(note.row.conduct).toBeUndefined();
    expect(note.row.note).toContain(p.lastName);
    expect(CONDUCT_DONE.some((x) => x.when!({ kind: 'late', last: 'X', answer: e.outcome as 'fine', times: 0 }))).toBe(
      true,
    );
    // Your own answer is not told back to you.
    const l2 = scene();
    const [q] = pend(l2, 1);
    answerConduct(l2, q.id, 'fine');
    expect(weekItems(l2, toldKeys(l2), []).some((i) => i.row.cells[1] === 'Team rules')).toBe(false);
  });
});

const ejected = (l: League, playerId: number, why: 'fight' | 'flagrant' = 'fight') =>
  reviewWeek(l, [
    { ejections: [{ playerId, teamId: l.userTeamId, quarter: 3, clock: 400, why }] } as unknown as GameResult,
  ]);

describe('the league office’s letter', () => {
  it('files once for each ruling on your player, fine or suspension, from the league office', () => {
    const l = scene();
    const [p] = activeRoster(l, l.userTeamId);
    ejected(l, p.id, 'flagrant');
    deliverMail(l);
    deliverMail(l);
    const mine = () => l.inbox!.filter((m) => m.id.startsWith('conduct:'));
    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({ from: 'League office', category: 'league' });
    expect(mine()[0].subject).toBe(`${p.firstName} ${p.lastName} fined`);
    expect(mine()[0].body).toMatch(/^The league has fined .* after his ejection\./);
    expect(mine()[0].body).toMatch(/There is no suspension/);
    // A second ejection in the league year is a suspension, a letter of its own.
    l.week = 7;
    l.moraleAt = moraleClock(l);
    ejected(l, p.id, 'fight');
    deliverMail(l);
    expect(mine()).toHaveLength(2);
    expect(mine()[1].subject).toBe(`${p.firstName} ${p.lastName} suspended one game`);
    expect(mine()[1].body).toMatch(/second ejection this season and his first suspension/);
    expect(mine()[1].body).toMatch(/He will miss the game at .* and is eligible to return in week \d+\.$/);
    expect(mine()[1].week).toBe(7);
  });

  it('is not written for another team’s player, and an AI club’s ruling is no letter', () => {
    const l = scene();
    const other = activeRoster(l, (l.userTeamId + 1) % l.teams.length)[0];
    reviewWeek(l, [
      {
        ejections: [{ playerId: other.id, teamId: other.teamId!, quarter: 2, clock: 1, why: 'fight' }],
      } as unknown as GameResult,
    ]);
    expect(conductLetters(l, new Set())).toEqual([]);
  });

  it('tells the game, the quarter and where, and stops on a fact', () => {
    const f: LeagueFact = {
      full: 'Tre Rowe',
      last: 'Rowe',
      kind: 'ejected',
      ruling: 'suspended',
      games: 1,
      why: 'fight',
      quarter: 'third',
      where: 'at Miami',
      ejections: 2,
      bans: 1,
      next: 'at home against New England',
      back: 10,
    };
    const text = [LEAGUE_RULING, LEAGUE_RECORD, LEAGUE_MISSES]
      .map((b, i) => say(b, f, { key: 'k', slot: `s${i}` }))
      .join(' ');
    expect(text).toMatch(
      /^(The league has suspended Tre Rowe for one game for fighting in the third quarter at Miami\.|Tre Rowe is suspended)/,
    );
    expect(text).toContain('He was ejected for it.');
    expect(text).toContain('It is his second ejection this season and his first suspension.');
    expect(
      text.endsWith('He will miss the game at home against New England and is eligible to return in week 10.'),
    ).toBe(true);
    const two = say(LEAGUE_MISSES, { ...f, games: 2 }, { key: 'k', slot: 'm' });
    expect(two).toBe(
      'He will miss the next two games, starting with the game at home against New England, and is eligible to return in week 10.',
    );
  });

  it('reads the schedule for the next game and the week he is back', () => {
    const l = scene();
    const [p] = activeRoster(l, l.userTeamId);
    p.discipline = {
      entries: [
        {
          season: l.season,
          week: 14,
          kind: 'fight',
          outcome: 'suspended',
          games: 2,
          teamId: l.userTeamId,
          public: true,
        },
      ],
    };
    const f = leagueFact(l, p, p.discipline.entries[0], 0);
    expect(f.next).toMatch(/^at /);
    expect(f.back).toBeGreaterThan(1);
    expect(f.bans).toBe(1);
  });
});

describe('a card’s Discipline list', () => {
  it('tells your player’s record in words, and another team’s only what is public', () => {
    const l = scene();
    const [p] = activeRoster(l, l.userTeamId);
    p.discipline = {
      entries: [
        { season: l.season - 1, week: 20, kind: 'practiceScuffle', outcome: 'fine', byYou: true, teamId: l.userTeamId },
        { season: l.season, week: 15, kind: 'ejected', outcome: 'leagueFine', public: true, teamId: l.userTeamId },
        {
          season: l.season,
          week: 16,
          kind: 'curfew',
          outcome: 'sat',
          public: true,
          byCoach: true,
          teamId: l.userTeamId,
        },
      ],
    };
    const mine = disciplineLines(l, p);
    expect(mine.map((r) => `${r.when}: ${r.text}`)).toEqual([
      'Week 8: a missed curfew. The head coach sat him for a game.',
      'Week 7: ejected, fined by the league.',
      'Last season, week 12: a scuffle at practice. You fined him.',
    ]);
    l.userTeamId = (l.userTeamId + 1) % l.teams.length;
    expect(disciplineLines(l, p).map((r) => r.text)).toEqual([
      'a missed curfew. The team sat him for a game.',
      'ejected, fined by the league.',
    ]);
  });
});

describe('what a card and a row show of a man who changed teams', () => {
  it('hides his old team’s private entries and words its public ones as theirs', () => {
    const l = scene();
    const [p] = activeRoster(l, l.userTeamId);
    const old = (l.userTeamId + 1) % l.teams.length;
    p.discipline = {
      entries: [
        { season: l.season, week: 14, kind: 'curfew', outcome: 'fine', teamId: old },
        { season: l.season, week: 15, kind: 'spat', outcome: 'sat', public: true, teamId: old },
        { season: l.season, week: 16, kind: 'late', outcome: 'letGo', byYou: true, teamId: l.userTeamId },
      ],
    };
    expect(disciplineLines(l, p).map((r) => r.text)).toEqual([
      'a late arrival at practice. You let it go.',
      'a public spat. The team sat him for a game.',
    ]);
  });

  it('shows no buttons for a row whose man has left, and no other incident’s outcome', () => {
    const l = scene();
    const [p] = pend(l, 1);
    const s = { playerId: p.id, clock: l.moraleAt! };
    p.discipline = { entries: [{ season: l.season - 1, week: 3, kind: 'late', outcome: 'sat', teamId: l.userTeamId }] };
    expect(conductOpen(l, s)).toBe(true);
    p.teamId = (l.userTeamId + 1) % l.teams.length;
    expect(conductOpen(l, s)).toBe(false);
    expect(conductSettled(l, p.id, s.clock)).toBe('This one is settled.');
  });
});

describe('old trouble and who answered it', () => {
  it('shows and counts only the last two league years, and "last season" only for the season before', () => {
    const l = scene();
    const [p] = activeRoster(l, l.userTeamId);
    p.discipline = {
      entries: [
        { season: l.season - 3, week: 14, kind: 'curfew', outcome: 'fine', byYou: true, teamId: l.userTeamId },
        { season: l.season - 2, week: 15, kind: 'late', outcome: 'sat', byYou: true, teamId: l.userTeamId },
      ],
    };
    expect(disciplineLines(l, p)).toEqual([]);
    expect(conductFact(l, p, 'curfew')).toMatchObject({ clean: true });
    expect(conductFact(l, p, 'curfew').lastOutcome).toBeUndefined();
    p.discipline.entries.push({ season: l.season - 1, week: 12, kind: 'late', outcome: 'fine', teamId: l.userTeamId });
    expect(disciplineLines(l, p).map((r) => r.when)).toEqual(['Last season, week 4']);
    expect(conductFact(l, p, 'curfew')).toMatchObject({ clean: false, lastOutcome: 'fine' });
  });

  it('calls the last offseason step camp, never week 0', () => {
    const l = scene();
    const [p] = activeRoster(l, l.userTeamId);
    p.discipline = {
      entries: [{ season: l.season, week: 8, kind: 'curfew', outcome: 'fine', teamId: l.userTeamId }],
    };
    expect(disciplineLines(l, p)[0].when).toBe('This offseason, at camp');
  });

  it('says "You" only for an answer made on your desk, and words every other one from the team’s side', () => {
    const l = scene();
    const [a, b, c] = pend(l, 3);
    answerConduct(l, a.id, 'fine');
    expect(disciplineLines(l, a)[0].text).toMatch(/You fined him\.$/);
    // An answer left to time, a predecessor's (nobody's flag) and the head coach's own.
    l.moraleAt! += waitFor(l, b);
    settleConduct(l);
    expect(disciplineLines(l, b)[0].text).toMatch(/The team let it go\.$/);
    c.discipline = {
      entries: [{ season: l.season, week: 9, kind: 'late', outcome: 'sat', teamId: l.userTeamId }],
    };
    expect(disciplineLines(l, c)[0].text).toMatch(/The team sat him for a game\.$/);
    expect(conductSettled(l, c.id, l.season * 32)).toBe('The team sat him for a game.');
  });
});
