import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from './generate';
import { simToEndOfSeason } from './league';
import { migrateLeague } from './migrate';
import { advanceOffseason, beginOffseason } from './offseason';
import { overall, playerOvr } from './positions';
import { teamPlayers } from './roster';
import {
  generateCombine,
  isProspect,
  knowledge,
  perceive,
  SCOUT_POINTS_PER_YEAR,
  scoutPlayer,
  scoutReport,
  scoutReportParts,
  starRating,
} from './scouting';
import type { League, Player } from './types';
import { ATTRIBUTES } from './types';

const width = (league: League, p: Player) => {
  const v = perceive(league, league.userTeamId, p);
  return ATTRIBUTES.reduce((s, a) => s + v.ratings[a].hi - v.ratings[a].lo, 0) / ATTRIBUTES.length;
};

describe('perceived ratings', () => {
  const league = createLeague({ seed: 'scouting' });
  const mine = teamPlayers(league, league.userTeamId);
  const theirs = Object.values(league.players).filter((p) => p.teamId !== null && p.teamId !== league.userTeamId);

  it('shows your own players exactly and everyone else as a range', () => {
    const p = mine[0];
    const v = perceive(league, league.userTeamId, p);
    expect(v.exact).toBe(true);
    for (const a of ATTRIBUTES) expect(v.ratings[a]).toEqual({ value: p.ratings[a], lo: p.ratings[a], hi: p.ratings[a] });
    expect(v.ovr).toBeCloseTo(playerOvr(p), 6);
    const rookie = theirs.find((x) => x.experience === 0)!;
    expect(perceive(league, league.userTeamId, rookie).exact).toBe(false);
    expect(width(league, rookie)).toBeGreaterThan(1.5);
  });

  it('is stable across calls and never touches the league RNG', () => {
    const before = [...league.rngState];
    const p = theirs[10];
    expect(perceive(league, league.userTeamId, p)).toEqual(perceive(league, league.userTeamId, p));
    expect(league.rngState).toEqual(before);
    // Another front office sees him differently.
    const other = (league.userTeamId + 1) % 32 === p.teamId ? (league.userTeamId + 2) % 32 : (league.userTeamId + 1) % 32;
    expect(perceive(league, other, p).ratings).not.toEqual(perceive(league, league.userTeamId, p).ratings);
  });

  it('usually brackets the truth, and knows veterans better than rookies', () => {
    let inside = 0;
    let total = 0;
    for (const p of theirs) {
      const v = perceive(league, league.userTeamId, p);
      for (const a of ATTRIBUTES) {
        total++;
        if (p.ratings[a] >= v.ratings[a].lo && p.ratings[a] <= v.ratings[a].hi) inside++;
      }
    }
    expect(inside / total).toBeGreaterThan(0.85);
    const vet = theirs.find((p) => p.experience >= 6)!;
    const rookie = theirs.find((p) => p.experience === 0)!;
    expect(knowledge(league, league.userTeamId, vet)).toBeGreaterThan(knowledge(league, league.userTeamId, rookie));
  });

  it('gives stars on a 0–4 half-step scale spread across the league', () => {
    const counts = new Map<number, number>();
    for (const p of theirs) {
      const s = starRating(league, league.userTeamId, p, perceive(league, league.userTeamId, p));
      expect(s.ability * 2).toBe(Math.round(s.ability * 2));
      expect(s.ability).toBeGreaterThanOrEqual(0);
      expect(s.ability).toBeLessThanOrEqual(4);
      expect(s.potHi).toBeGreaterThanOrEqual(s.potLo);
      counts.set(s.ability, (counts.get(s.ability) ?? 0) + 1);
    }
    // Each full level is roughly an eighth of the league; the extremes about a sixteenth.
    expect((counts.get(4) ?? 0) / theirs.length).toBeLessThan(0.12);
    expect((counts.get(2) ?? 0) / theirs.length).toBeGreaterThan(0.06);
    const starter = mine.reduce((a, b) => (playerOvr(b) > playerOvr(a) && b.position === 'QB' ? b : a), mine.find((p) => p.position === 'QB')!);
    expect(starRating(league, league.userTeamId, starter, perceive(league, league.userTeamId, starter), 'roster').basis).toMatch(/your starting QB/);
  });

  it('writes a short plain-language report: a verdict, his game, then the rest', () => {
    for (const p of [mine[3], theirs[42], theirs[400], ...theirs.slice(0, 200)]) {
      const r = scoutReportParts(league, league.userTeamId, p);
      const lines = scoutReport(league, league.userTeamId, p);
      expect(lines).toEqual([r.verdict, ...r.game, ...r.notes]);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(9);
      for (const l of lines) expect(l).toMatch(/^[A-Z].*\.$/);
      expect(lines.join(' ')).not.toMatch(/undefined|NaN|offensive line\b/);
      // One judgment up front, with where he is headed; one sentence on his traits, one on his outlook.
      expect(r.verdict).toMatch(
        /^(On limited looks, an?|An?) \S.* (in his prime|in his best years|in the middle of his prime|on the downslope|past his best|in decline|nearing the end of his best years|with a year or two of his prime left|whose value now rests on|living on .* now|with the upside of|with room still to grow|close to his ceiling)/,
      );
      expect(r.game.length).toBeGreaterThanOrEqual(1);
      expect(r.game.length).toBeLessThanOrEqual(3);
      // The third sentence, when there is one, is last season's line against the league's starters.
      if (r.game[2]) expect(r.game[2]).toMatch(/^Last season he .*, (well above|above|about what|below|well below) a league-average (starter|kicker|punter)( does)?\.$/);
      expect(r.game[0]).toMatch(/^(His |[A-Z][a-z-]+( [a-z-]+)* (is|are) his strongest suit|Nothing in his game|Nothing jumps out|A balanced set)/);
      expect(r.game[0]).not.toMatch(/\b(hands|instincts) is\b/);
      // The scouts never list every habit: at most two sentences on them.
      expect(r.notes.filter((n) => /^(On film|Lately|Starting to show)/.test(n)).length).toBeLessThanOrEqual(2);
    }
  });

  it('tells a prospect from a veteran, and a rough read from a sure one', () => {
    const me = league.userTeamId;
    const own = scoutReportParts(league, me, mine.find((p) => p.age >= 27)!);
    // Our own veteran: nothing to hedge, so no word on how sure we are.
    expect(own.notes.some((n) => /film|provisional|scouts’ best guess/.test(n))).toBe(false);
    const prospect = theirs.find((p) => p.age <= 23 && scoutReportParts(league, me, p).verdict.includes('with the upside of'))!;
    const young = scoutReportParts(league, me, prospect);
    expect(young.game[1]).toMatch(/^(With reps he could grow into|Given snaps he could become|There is .* in him if he develops)/);
    const old = theirs.find((p) => p.age >= 34 && !['QB', 'K', 'P'].includes(p.position))!;
    const vet = scoutReportParts(league, me, old);
    expect(vet.verdict).toMatch(/on the downslope|past his best|in decline|nearing the end of his best years|a year or two of his prime left|whose value now rests on|living on|in his prime|in his best years/);
    // At 34 or more the clock is always worth a sentence: past his prime, or fading, or in its last year.
    expect(vet.game[1]).toMatch(/expect him to lose|decline is under way|takes something|should hold|last year of his prime/);
    // A player we have barely seen: the verdict itself is hedged, and the report says what would help.
    const unknown = theirs.find((p) => p.experience === 0 && scoutReportParts(league, me, p).verdict.startsWith('On limited looks'))!;
    expect(unknown).toBeDefined();
    const rough = scoutReportParts(league, me, unknown);
    expect(rough.verdict).toMatch(/^On limited looks, an? /);
    expect(rough.notes.find((n) => n.startsWith('Our read'))).toBe(`Our read is still provisional: more film${league.scoutPoints > 0 ? ' or a scouting visit' : ''} would narrow these grades.`);
    // A well-known veteran on another team: a plain verdict and a reliable read.
    const known = theirs.find((p) => p.experience >= 8 && (perceive(league, me, p).ovrHi - perceive(league, me, p).ovrLo) / 2 <= 0.5)!;
    const clear = scoutReportParts(league, me, known);
    expect(clear.verdict).not.toMatch(/^On limited looks/);
    expect(clear.notes).toContain('Plenty of film on him: this read is reliable.');
  });
});

describe('scouting visits', () => {
  it('narrow the range, cost a visit, and pull the read toward the truth', () => {
    const league = createLeague({ seed: 'visits' });
    simToEndOfSeason(league);
    beginOffseason(league);
    expect(league.scoutPoints).toBe(SCOUT_POINTS_PER_YEAR);
    const prospects = league.draftClass.map((id) => league.players[id]).filter(isProspect).slice(0, 25);
    const error = () => prospects.reduce((s, p) => s + Math.abs(perceive(league, league.userTeamId, p).ovr - playerOvr(p)), 0) / prospects.length;
    const before = error();
    const w0 = width(league, prospects[0]);
    for (const p of prospects.slice(0, 10)) for (let i = 0; i < 3; i++) scoutPlayer(league, p.id);
    expect(league.scoutPoints).toBe(SCOUT_POINTS_PER_YEAR - 30);
    expect(width(league, prospects[0])).toBeLessThan(w0 / 2);
    expect(knowledge(league, league.userTeamId, prospects[0])).toBeGreaterThan(0.7);
    expect(error()).toBeLessThan(before);
    expect(() => scoutPlayer(league, prospects[20].id)).toThrow(/No scouting visits/);
  }, 30_000);

  it('records a ratings snapshot each league year', () => {
    const league = createLeague({ seed: 'history' });
    const p = teamPlayers(league, 3)[0];
    expect(Object.keys(p.ratingHistory!)).toEqual([String(league.season)]);
    simToEndOfSeason(league);
    beginOffseason(league);
    if (!p.retired) expect(p.ratingHistory![league.season]).toEqual(ATTRIBUTES.map((a) => p.ratings[a]));
    const prospect = league.players[league.draftClass[0]];
    expect(prospect.ratingHistory![league.season]).toBeDefined();
    advanceOffseason(league, { autoUser: true });
  }, 30_000);
});

describe('combine', () => {
  it('produces plausible numbers that track the true physical ratings', () => {
    const league = createLeague({ seed: 'combine' });
    const wrs = Object.values(league.players).filter((p) => p.position === 'WR');
    for (const p of wrs) {
      const c = p.combine!;
      expect(c.arms).toBeGreaterThan(28);
      if (c.forty) {
        expect(c.forty).toBeGreaterThan(4.15);
        expect(c.forty).toBeLessThan(5.2);
      }
    }
    const timed = wrs.filter((p) => p.combine!.forty);
    const fast = timed.filter((p) => p.ratings.speed >= 15);
    const slow = timed.filter((p) => p.ratings.speed <= 9);
    const avg = (ps: Player[]) => ps.reduce((s, p) => s + p.combine!.forty!, 0) / ps.length;
    expect(avg(fast)).toBeLessThan(avg(slow) - 0.1);
    expect(generateCombine(wrs[0])).toEqual(wrs[0].combine);
    const ol = Object.values(league.players).find((p) => p.position === 'OL' && p.combine!.forty)!;
    expect(ol.combine!.forty).toBeGreaterThan(4.9);
  });
});

describe('save migration to v3', () => {
  it('adds scouting state, combine results and a first ratings snapshot', () => {
    const league = createLeague({ seed: 'migrate-v3' });
    const v2 = JSON.parse(JSON.stringify(league)) as League;
    v2.version = 2;
    delete (v2 as Partial<League>).knowledge;
    delete (v2 as Partial<League>).scoutPoints;
    for (const p of Object.values(v2.players)) {
      delete p.combine;
      delete p.ratingHistory;
    }
    const up = migrateLeague(v2)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.knowledge).toEqual({});
    expect(up.scoutPoints).toBe(SCOUT_POINTS_PER_YEAR);
    const p = Object.values(up.players)[0];
    expect(p.combine).toEqual(league.players[p.id].combine);
    expect(p.ratingHistory![up.season]).toEqual(ATTRIBUTES.map((a) => p.ratings[a]));
    expect(overall(p.ratings, p.position)).toBeCloseTo(playerOvr(league.players[p.id]), 6);
  });
});
