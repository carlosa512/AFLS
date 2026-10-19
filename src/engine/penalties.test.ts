import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { downValue, takesPenalty } from './match/coach';
import { simulateGame } from './match/gameSim';
import { buildLineup } from './match/lineup';
import { enforce, FOUL_KINDS, FOULS } from './penalties';

const at = (yardLine: number, down = 1, toGo = 10) => ({ yardLine, down, lineToGain: Math.min(100, yardLine + toGo) });
const value = (s: { yardLine: number; down: number; lineToGain: number }) => downValue(s.yardLine, s.down, s.lineToGain - s.yardLine);

describe('penalty enforcement', () => {
  it('replays the down on an offensive foul, half the distance near its own goal line', () => {
    expect(enforce('holding', at(40, 2, 7))).toEqual({ yardLine: 30, down: 2, lineToGain: 47, yards: 10 });
    expect(enforce('holding', at(8)).yards).toBe(4);
    expect(enforce('falseStart', at(3, 3, 5))).toMatchObject({ yardLine: 2, down: 3, yards: 1 });
  });

  it('moves the chains on an automatic first down or when a defensive foul reaches the line', () => {
    expect(enforce('defHolding', at(40, 3, 12))).toEqual({ yardLine: 45, down: 1, lineToGain: 55, yards: 5 });
    expect(enforce('offside', at(40, 2, 4))).toMatchObject({ yardLine: 45, down: 1 });
    expect(enforce('offside', at(40, 2, 8))).toMatchObject({ yardLine: 45, down: 2, lineToGain: 48 });
    // Goal to go: a first down stays first and goal.
    expect(enforce('defHolding', at(96, 3, 4))).toEqual({ yardLine: 98, down: 1, lineToGain: 100, yards: 2 });
  });

  it('spots pass interference where it happened, never past the 1', () => {
    expect(enforce('passInterference', at(30, 2), 24)).toMatchObject({ yardLine: 54, down: 1, yards: 24 });
    expect(enforce('passInterference', at(85, 2), 30)).toMatchObject({ yardLine: 99, yards: 14 });
  });
});

describe('take the penalty or the play', () => {
  it('values field position, downs and yards to go the way coaches do', () => {
    expect(downValue(60, 1, 10)).toBeGreaterThan(downValue(40, 1, 10));
    expect(downValue(40, 1, 10)).toBeGreaterThan(downValue(40, 3, 10));
    expect(downValue(40, 3, 2)).toBeGreaterThan(downValue(40, 3, 12));
  });

  it('declines holding on a third-down incompletion, takes it on first down', () => {
    // 3rd and 5: an incompletion brings up fourth down, which beats 3rd and 15.
    const fourth = downValue(40, 4, 5);
    expect(takesPenalty('defense', fourth, value(enforce('holding', at(40, 3, 5))))).toBe(false);
    // 1st and 10: 2nd and 10 is worse for the defense than 1st and 20.
    const second = downValue(30, 2, 10);
    expect(takesPenalty('defense', second, value(enforce('holding', at(30))))).toBe(true);
  });

  it('declines holding on a sack, and the offense declines defensive holding on a big gain', () => {
    const sacked = downValue(32, 3, 18);
    expect(takesPenalty('defense', sacked, value(enforce('holding', at(40, 2))))).toBe(false);
    const bigGain = downValue(65, 1, 10);
    expect(takesPenalty('offense', bigGain, value(enforce('defHolding', at(40, 2))))).toBe(false);
    // A short completion on third down: the automatic first down is worth more.
    const short = downValue(43, 4, 4);
    expect(takesPenalty('offense', short, value(enforce('defHolding', at(40, 3, 7))))).toBe(true);
  });

  it('takes an offside over an interception (the free play), but a defense keeps its takeaway', () => {
    const picked = -downValue(55, 1, 10);
    expect(takesPenalty('offense', picked, value(enforce('offside', at(45, 2, 6))))).toBe(true);
    // A deep pick returned to midfield against 3rd and 21 at the 8: the ball beats the field position.
    const deepPick = -downValue(44, 1, 10);
    expect(takesPenalty('defense', deepPick, value(enforce('holding', at(16, 3, 13))), true)).toBe(false);
  });
});

describe('flags in a game', () => {
  it('charges every accepted penalty to a player and counts declined and offsetting flags apart', () => {
    const league = createLeague({ seed: 'penalty-games' });
    let declined = 0;
    let offset = 0;
    for (const g of league.games.filter((g) => g.week <= 4)) {
      const r = simulateGame(league, g);
      for (const [side, teamId] of [
        [r.home, g.homeId],
        [r.away, g.awayId],
      ] as const) {
        expect(FOUL_KINDS.reduce((s, f) => s + (side.flags?.[f] ?? 0), 0)).toBe(side.penalties);
        const charged = Object.entries(r.playerStats).filter(([id]) => r.playerTeams[Number(id)] === teamId);
        expect(charged.reduce((s, [, line]) => s + (line.penalties ?? 0), 0)).toBe(side.penalties);
        expect(charged.reduce((s, [, line]) => s + (line.penaltyYds ?? 0), 0)).toBe(side.penaltyYds);
        declined += Object.values(side.declined ?? {}).reduce((a, b) => a + b, 0);
        offset += Object.values(side.offset ?? {}).reduce((a, b) => a + b, 0);
      }
    }
    expect(declined).toBeGreaterThan(0);
    expect(offset).toBeGreaterThan(0);
  });
});

describe('personal fouls', () => {
  const league = createLeague({ seed: 'personal-fouls' });
  const games = league.games.filter((g) => g.week <= 6).map((g) => ({ g, r: simulateGame(league, g, { keepPlays: true }) }));

  it('credits the quarterback with every roughing call his defense drew', () => {
    let calls = 0;
    for (const { g, r } of games) {
      for (const [side, teamId] of [
        [r.home, g.awayId],
        [r.away, g.homeId],
      ] as const) {
        const drawn = Object.entries(r.playerStats)
          .filter(([id]) => r.playerTeams[Number(id)] === teamId)
          .reduce((s, [, line]) => s + (line.roughingDrawn ?? 0), 0);
        expect(drawn).toBe(side.flags?.roughingPasser ?? 0);
        calls += drawn;
      }
    }
    expect(calls).toBeGreaterThan(0);
  });

  it('goes on from where a run or a catch ended, with a first down, and the play stands', () => {
    const late = /for (-?\d+) yards?.*PENALTY on \w+ \([^)]*\): (Roughing the passer|Unnecessary roughness|Face mask|Horse collar), (\d+) yards\.$/;
    let seen = 0;
    for (const { r } of games) {
      const plays = r.plays!;
      plays.forEach((p, i) => {
        const m = p.text.match(late);
        if (!m || p.scoring) return;
        const next = plays.slice(i + 1).find((q) => q.down > 0);
        if (!next || next.quarter !== p.quarter || next.offense !== p.offense) return;
        expect(next.down).toBe(1);
        expect(next.yardLine).toBe(p.yardLine + Number(m[1]) + Number(m[3]));
        seen++;
      });
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('special teams', () => {
  it('covers kicks with backups, never a starter while a backup is free, and takes the returners the user picks', () => {
    const league = createLeague({ seed: 'special-teams' });
    const team = league.teams[0];
    const starters = new Set([...team.depthChart.LB.slice(0, 2), ...team.depthChart.S.slice(0, 2), ...team.depthChart.CB.slice(0, 2), ...team.depthChart.QB, ...team.depthChart.OL]);
    const lineup = buildLineup(league, team);
    expect(lineup.st).toHaveLength(10);
    expect(new Set(lineup.st.map((p) => p.id)).size).toBe(10);
    for (const p of lineup.st) expect(starters.has(p.id)).toBe(false);
    const wr1 = league.players[team.depthChart.WR[0]];
    team.returners = { kr: wr1.id };
    expect(buildLineup(league, team).kr).toBe(wr1);
    // A pick who's out sits like anyone else.
    expect(buildLineup(league, team, new Set([wr1.id])).kr).not.toBe(wr1);
  });

  it('flags returns, kickoffs and punts, and charges the kick units', () => {
    const league = createLeague({ seed: 'special-flags' });
    const seen = new Set<string>();
    for (const g of league.games.filter((g) => g.week <= 8)) {
      const r = simulateGame(league, g, { keepPlays: true });
      for (const side of [r.home, r.away]) for (const f of FOUL_KINDS) if (FOULS[f].special && side.flags?.[f]) seen.add(f);
      // A flagged return goes 10 yards back from the spot of the foul (half the distance near the goal): toward
      // the returning team's own goal, so down the yard lines on its side of the field and up them on the other.
      for (const p of r.plays!) {
        const m = p.text.match(/returns to the (\w+) (\d+)\. PENALTY on (\w+) \([^)]*\): (?:Holding on a return|Illegal block in the back), (\d+) yards\. Ball at the (\w+) (\d+)\./);
        if (m && m[1] === m[5]) expect(Number(m[2]) + (m[1] === m[3] ? -1 : 1) * Number(m[4])).toBe(Number(m[6]));
      }
    }
    for (const f of ['returnHolding', 'blockInBack', 'kickoffMiss', 'kickoffFormation']) expect(seen.has(f)).toBe(true);
  });

  it('flags field goals and extra points, and counts only the kicks that stand', () => {
    const league = createLeague({ seed: 'kick-flags' });
    const seen = new Set<string>();
    let held = 0;
    for (const g of league.games.filter((g) => g.week <= 12)) {
      const r = simulateGame(league, g, { keepPlays: true });
      const plays = r.plays!;
      let tries = 0;
      plays.forEach((p, i) => {
        if (/extra point is (GOOD|NO GOOD)\.$/.test(p.text)) tries++;
        const m = p.text.match(/(?:field goal is (?:good|no good)|Field goal try|extra point is (?:good|no good))\. PENALTY on \w+ \([^)]*\): ([^,]+),/);
        if (m) seen.add(m[1]);
        // A hold on a good kick: the defense takes the points off the board and the kick goes again, 10 yards back.
        if (/field goal is good\. PENALTY on \w+ \([^)]*\): Offensive holding, 10 yards/.test(p.text)) {
          const next = plays.slice(i + 1).find((q) => q.down > 0);
          if (next && next.offense === p.offense && next.quarter === p.quarter) {
            expect(next.yardLine).toBe(p.yardLine - 10);
            held++;
          }
        }
      });
      // One attempt in the box score per try that stood, however many flags came before it.
      const attempts = Object.values(r.playerStats).reduce((n, line) => n + (line.xpAtt ?? 0), 0);
      expect(attempts).toBe(tries);
    }
    for (const label of ['False start', 'Offensive holding']) expect(seen.has(label)).toBe(true);
    expect(held).toBeGreaterThan(0);
  });
});
