import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { aiGm } from '../gmHabits';
import { capHit } from '../finance/contract';
import { starters, teamPlayers } from '../roster';
import type { TradeSide } from '../types';
import { dealAdvice, staffTake, type Advice, type AdviceTone } from './advice';

const line = (tone: AdviceTone): Advice => ({ who: 'coach', line: '', tone });

describe("your staff's word on a deal", () => {
  it('takes a side from the tones', () => {
    expect(staffTake([line('good'), line('note')])).toBe('likes');
    expect(staffTake([line('good'), line('warn')])).toBe('split');
    expect(staffTake([line('good'), line('good'), line('bad')])).toBe('split');
    expect(staffTake([line('good'), line('bad')])).toBe('against');
    expect(staffTake([line('note')])).toBe('split');
    expect(staffTake([])).toBe('split');
  });

  it('tones each line by what it says', () => {
    const l = createLeague({ seed: 'advice-tone' });
    const user = l.teams[l.userTeamId];
    const rival = l.teams.find((t) => t.id !== user.id)!;
    // Send our only kicker away and take their best receiver.
    const [kicker] = starters(l, user, 'K');
    const [wr] = starters(l, rival, 'WR');
    const theirs: TradeSide = { teamId: rival.id, players: [wr.id], picks: [] };
    const yours: TradeSide = { teamId: user.id, players: [kicker.id], picks: [] };
    const advice = dealAdvice(l, [theirs, yours]);
    expect(advice.find((a) => a.who === 'scouts')!.tone).toBe('note');
    expect(['good', 'note']).toContain(advice.find((a) => a.who === 'coach' && / would /.test(a.line))!.tone);
    expect(advice.find((a) => /nobody behind/.test(a.line))!.tone).toBe('bad');
    expect(['good', 'warn', 'bad']).toContain(advice.find((a) => a.who === 'cap')!.tone);
    for (const a of advice.filter((x) => x.who === 'medical')) expect(['good', 'warn', 'bad']).toContain(a.tone);
  });

  it('calls a deal that leaves us over the cap bad', () => {
    const l = createLeague({ seed: 'advice-cap' });
    const user = l.teams[l.userTeamId];
    const rival = l.teams.find((t) => t.id !== user.id)!;
    // Take on their 25 biggest contracts for nothing.
    const big = teamPlayers(l, rival.id)
      .filter((p) => p.contract)
      .sort((a, b) => capHit(b.contract!, l.season) - capHit(a.contract!, l.season))
      .slice(0, 25);
    const advice = dealAdvice(l, [
      { teamId: rival.id, players: big.map((p) => p.id), picks: [] },
      { teamId: user.id, players: [], picks: [] },
    ]);
    expect(advice.find((a) => a.who === 'cap')!.tone).toBe('bad');
  });

  it('adds the director’s tip from the partner GM’s log, only when the deal bears on it', () => {
    const l = createLeague({ seed: 'advice-tip' });
    const user = l.teams[l.userTeamId];
    const rival = l.teams.find((t) => t.id !== user.id)!;
    const gm = aiGm(l, rival)!;
    const mine = teamPlayers(l, user.id)[0];
    const theirs = teamPlayers(l, rival.id)[0];
    const a = gm.appointments[0];
    mine.draft = {
      ...(mine.draft ?? ({} as NonNullable<typeof mine.draft>)),
      teamId: a.teamId,
      season: a.start.season,
    };
    const sides: [TradeSide, TradeSide] = [
      { teamId: rival.id, players: [theirs.id], picks: [] },
      { teamId: user.id, players: [mine.id], picks: [] },
    ];
    const tip = (adv: Advice[]) => adv.filter((x) => x.who === 'scouts' && /drafted/.test(x.line));
    gm.habitLog = [];
    expect(tip(dealAdvice(l, sides))).toHaveLength(0);
    gm.habitLog = [{ habit: 'hisGuys', season: l.season, teamId: rival.id, playerId: mine.id }];
    const found = tip(dealAdvice(l, sides));
    expect(found).toHaveLength(1);
    expect(found[0].tone).toBe('note');
    expect(found[0].line).not.toMatch(/hisGuys|habit/i);
  });
});
