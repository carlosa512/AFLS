import { describe, expect, it } from 'vitest';
import { CFL_ORIGIN, COLLEGES_BY_TIER, PATHWAY_ORIGINS } from './data/origins';
import { pathwayClass } from './offseason/arrivals';
import { generateDraftClass } from './offseason/draft';
import { Rng } from './rng';
import { createLeague, SAVE_VERSION } from './generate';
import { simToEndOfSeason } from './league';
import { migrateLeague } from './migrate';
import { advanceOffseason, beginOffseason } from './offseason';
import { overall, playerOvr } from './positions';
import { starters, teamPlayers, teamRatings } from './roster';
import {
  characterRead,
  perceivedTeamRatings,
  generateCombine,
  isProspect,
  knowledge,
  perceive,
  SCOUT_POINTS_PER_YEAR,
  scoutPlayer,
  scoutReport,
  scoutReportParts,
  seasonNote,
  seasonRole,
  settleNote,
  starRating,
} from './scouting';
import type { League, Player } from './types';
import { ATTRIBUTES } from './types';
import { personalityRead } from './personality';

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
    for (const a of ATTRIBUTES)
      expect(v.ratings[a]).toEqual({ value: p.ratings[a], lo: p.ratings[a], hi: p.ratings[a] });
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
    const other =
      (league.userTeamId + 1) % 32 === p.teamId ? (league.userTeamId + 2) % 32 : (league.userTeamId + 1) % 32;
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
    const starter = mine.reduce(
      (a, b) => (playerOvr(b) > playerOvr(a) && b.position === 'QB' ? b : a),
      mine.find((p) => p.position === 'QB')!,
    );
    expect(
      starRating(league, league.userTeamId, starter, perceive(league, league.userTeamId, starter), 'roster').basis,
    ).toMatch(/your starting QB/);
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
      if (r.game[2])
        expect(r.game[2]).toMatch(
          /^(Last season he .*, (well above|above|below|well below) a league-average (starter|kicker|punter)|A rotation player last season \(|He barely saw the field last season, but he has|Nothing unusual in his line last season, but he has|He has (taken a real step|come on a little|slipped noticeably|slipped a little) since last season)/,
        );
      expect(r.game[0]).toMatch(
        /^(His |[A-Z][a-z-]+( [a-z-]+)* (is|are) his strongest suit|Nothing in his game|Nothing jumps out|A balanced set)/,
      );
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
    const prospect = theirs.find(
      (p) => p.age <= 23 && scoutReportParts(league, me, p).verdict.includes('with the upside of'),
    )!;
    const young = scoutReportParts(league, me, prospect);
    expect(young.game[1]).toMatch(
      /^(With reps he could grow into|Given snaps he could become|There is .* in him if he develops)/,
    );
    const old = theirs.find((p) => p.age >= 34 && !['QB', 'K', 'P'].includes(p.position))!;
    const vet = scoutReportParts(league, me, old);
    expect(vet.verdict).toMatch(
      /on the downslope|past his best|in decline|nearing the end of his best years|a year or two of his prime left|whose value now rests on|living on|in his prime|in his best years/,
    );
    // At 34 or more the clock is always worth a sentence: past his prime, or fading, or in its last year.
    expect(vet.game[1]).toMatch(
      /expect him to lose|decline is under way|takes something|should hold|last year of his prime/,
    );
    // A player we have barely seen: the verdict itself is hedged, and the report says what would help.
    const unknown = theirs.find(
      (p) => p.experience === 0 && scoutReportParts(league, me, p).verdict.startsWith('On limited looks'),
    )!;
    expect(unknown).toBeDefined();
    const rough = scoutReportParts(league, me, unknown);
    expect(rough.verdict).toMatch(/^On limited looks, an? /);
    expect(rough.notes.find((n) => n.startsWith('Our read'))).toBe(
      `Our read is still provisional: more film${league.scoutPoints > 0 ? ' or a scouting visit' : ''} would narrow these grades.`,
    );
    // A well-known veteran on another team: a plain verdict and a reliable read.
    const known = theirs.find(
      (p) => p.experience >= 8 && (perceive(league, me, p).ovrHi - perceive(league, me, p).ovrLo) / 2 <= 0.5,
    )!;
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
    const prospects = league.draftClass
      .map((id) => league.players[id])
      .filter(isProspect)
      .slice(0, 25);
    const error = () =>
      prospects.reduce((s, p) => s + Math.abs(perceive(league, league.userTeamId, p).ovr - playerOvr(p)), 0) /
      prospects.length;
    const before = error();
    const w0 = width(league, prospects[0]);
    for (const p of prospects.slice(0, 10)) for (let i = 0; i < 3; i++) scoutPlayer(league, p.id);
    expect(league.scoutPoints).toBe(SCOUT_POINTS_PER_YEAR - 30);
    expect(width(league, prospects[0])).toBeLessThan(w0 / 2);
    expect(knowledge(league, league.userTeamId, prospects[0])).toBeGreaterThan(0.7);
    expect(error()).toBeLessThan(before);
    expect(() => scoutPlayer(league, prospects[20].id)).toThrow(/No scouting visits/);
  });

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
  });
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

describe('last season in the report', () => {
  const league = createLeague({ seed: 'last-season' });
  simToEndOfSeason(league);
  beginOffseason(league);
  const last = league.season - 1;
  const me = league.userTeamId;
  const played = Object.values(league.players).filter((p) => p.stats[last]?.gp);

  it('counts scrimmage snaps for who really played, kickers and punters aside', () => {
    expect(played.length).toBeGreaterThan(1000);
    // Nobody is on the field for more snaps than the busiest offense ran in a game: a long day's 80-odd plays, never
    // double counted.
    const most = Math.max(
      ...league.games
        .filter((g) => g.season === last && g.result)
        .flatMap((g) => [g.result!.home.plays, g.result!.away.plays]),
    );
    expect(most).toBeGreaterThan(60);
    for (const p of played) {
      const s = p.stats[last];
      if (p.position === 'K' || p.position === 'P') continue;
      expect(s.snaps ?? 0).toBeLessThanOrEqual(most * s.gp!);
    }
    // A team's quarterback takes nearly every offensive snap; its third quarterback next to none.
    const qbs = played
      .filter((p) => p.teamId === me && p.position === 'QB')
      .sort((a, b) => (b.stats[last].snaps ?? 0) - (a.stats[last].snaps ?? 0));
    expect(qbs[0].stats[last].snaps!).toBeGreaterThan(40 * qbs[0].stats[last].gp!);
    expect(seasonRole(league, qbs[0])!.role).toBe('starter');
    const third = Object.values(league.players).find(
      (p) => p.teamId === me && p.position === 'QB' && (p.stats[last]?.snaps ?? 0) < 0.2 * qbs[0].stats[last].snaps!,
    );
    if (third?.stats[last]?.gp) expect(seasonRole(league, third)!.role).toBe('backup');
  });

  it('says only what a contract decision needs: a line that stood out, a rotation role, growth off the bench', () => {
    const qb = played
      .filter((p) => p.position === 'QB' && seasonRole(league, p)?.role === 'starter')
      .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    const s = qb.stats[last];
    // A line nobody could call ordinary.
    Object.assign(s, { passAtt: 17 * 35, passCmp: 17 * 25, passYds: 5200, passTd: 45, passInt: 4 });
    expect(seasonNote(league, qb)).toBe(
      `Last season he threw for 5,200 yards, 45 touchdowns and 4 picks in ${s.gp} games, well above a league-average starter.`,
    );
    // An ordinary one says nothing, unless he has grown since.
    const lb = played.filter((p) => p.position === 'LB' && seasonRole(league, p)?.role === 'starter')[0];
    const note = seasonNote(league, lb);
    if (note) expect(note).toMatch(/^(Last season he made|Nothing unusual in his line last season, but he has)/);
    lb.ratingHistory![last] = ATTRIBUTES.map((a) => lb.ratings[a] - 1.5);
    expect(seasonNote(league, lb)).toMatch(/he has taken a real step since/);
    // A rotation player: his role and his line, and a starter's rate when he produced like one.
    const starter = seasonRole(league, lb)!;
    const refSnaps = lb.stats[last].snaps! / starter.share;
    lb.stats[last].snaps = Math.round(0.4 * refSnaps);
    delete lb.ratingHistory![last];
    expect(seasonRole(league, lb)!.role).toBe('rotation');
    expect(seasonNote(league, lb)).toMatch(
      /^A rotation player last season \(made \d+ tackles, \d+ of them for loss\)(, at a starter's rate)?\.$/,
    );
    // A backup who barely played: nothing to say, unless he has come on.
    lb.stats[last].snaps = Math.round(0.1 * refSnaps);
    expect(seasonRole(league, lb)!.role).toBe('backup');
    expect(seasonNote(league, lb)).toBeNull();
    lb.ratingHistory![last] = ATTRIBUTES.map((a) => lb.ratings[a] - 0.8);
    expect(seasonNote(league, lb)).toBe('He barely saw the field last season, but he has come on a little since.');
    // Without the snap count (a save from before it was kept), the volume stat stands in.
    for (const p of played) delete p.stats[last].snaps;
    expect(seasonRole(league, qb)!.role).toBe('starter');
  });
});

describe('perceived team strength', () => {
  const UNITS = ['overall', 'qb', 'offense', 'defense', 'special'] as const;
  const POS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S', 'K', 'P'] as const;

  it('reads your own club exactly', () => {
    const league = createLeague({ seed: 'units' });
    const own = league.teams[league.userTeamId];
    const seen = perceivedTeamRatings(league, own.id, own);
    const truth = teamRatings(league, own);
    for (const u of UNITS) {
      expect(seen[u].exact).toBe(true);
      expect(seen[u].value).toBe(truth[u]);
      expect(seen[u].lo).toBe(seen[u].hi);
    }
  });

  it('reads a fully scouted rival at his true strength', () => {
    const league = createLeague({ seed: 'units' });
    const rival = league.teams.find((t) => t.id !== league.userTeamId)!;
    for (const pos of POS) for (const p of starters(league, rival, pos)) league.knowledge[p.id] = 1;
    const seen = perceivedTeamRatings(league, league.userTeamId, rival);
    const truth = teamRatings(league, rival);
    for (const u of UNITS) {
      expect(seen[u].value).toBeCloseTo(truth[u], 1);
      expect(seen[u].known).toBe(true);
    }
  });

  it('gives every rival a range around its best guess', () => {
    const league = createLeague({ seed: 'units' });
    for (const t of league.teams.filter((x) => x.id !== league.userTeamId)) {
      const seen = perceivedTeamRatings(league, league.userTeamId, t);
      for (const u of UNITS) {
        expect(seen[u].exact).toBe(false);
        expect(seen[u].lo).toBeLessThanOrEqual(seen[u].value);
        expect(seen[u].value).toBeLessThanOrEqual(seen[u].hi);
      }
    }
  });

  it('counts a starter out of position at what he is worth there', () => {
    const league = createLeague({ seed: 'units' });
    const rival = league.teams.find((t) => t.id !== league.userTeamId)!;
    for (const pos of POS) for (const p of starters(league, rival, pos)) league.knowledge[p.id] = 1;
    const corner = rival.depthChart.CB[rival.depthChart.CB.length - 1];
    league.knowledge[corner] = 1;
    const before = perceivedTeamRatings(league, league.userTeamId, rival).defense.value;
    const truthBefore = teamRatings(league, rival).defense;
    rival.depthChart.S = [corner, ...rival.depthChart.S.filter((id) => id !== corner)];
    const after = perceivedTeamRatings(league, league.userTeamId, rival).defense.value;
    const truthAfter = teamRatings(league, rival).defense;
    expect(after).toBeCloseTo(before + (truthAfter - truthBefore), 1);
  });
});

describe('film by origin', () => {
  const l = createLeague({ seed: 'film-origin' });
  generateDraftClassForTest(l);
  const prospect = l.players[l.draftClass[40]];
  const ai = (l.userTeamId + 1) % 32;
  const at = (origin: number) => {
    prospect.origin = origin;
    return knowledge(l, ai, prospect);
  };

  it('prospects on less film start less known: power > group5 > fcs > small > pathway', () => {
    const ks = [
      COLLEGES_BY_TIER.power[0],
      COLLEGES_BY_TIER.group5[0],
      COLLEGES_BY_TIER.fcs[0],
      COLLEGES_BY_TIER.small[0],
      PATHWAY_ORIGINS[0],
    ].map(at);
    for (let i = 1; i < ks.length; i++) expect(ks[i]).toBeLessThan(ks[i - 1]);
  });

  it('own players stay exact and a visit still narrows a Pathway prospect', () => {
    prospect.origin = PATHWAY_ORIGINS[0];
    const before = knowledge(l, l.userTeamId, prospect);
    scoutPlayer(l, prospect.id);
    expect(knowledge(l, l.userTeamId, prospect)).toBeGreaterThan(before);
    const own = Object.values(l.players).find((p) => p.teamId === l.userTeamId)!;
    own.origin = PATHWAY_ORIGINS[0];
    expect(knowledge(l, l.userTeamId, own)).toBe(1);
  });

  it('a CFL veteran sits between a rookie and an NFL veteran with the same years', () => {
    const vet = Object.values(l.players).find((p) => p.teamId === ai && p.experience === 4)!;
    const nfl = knowledge(l, l.userTeamId, vet);
    const cfl = { ...vet, experience: 0, cflSeasons: 4, origin: CFL_ORIGIN } as Player;
    const rookie = { ...vet, experience: 0, origin: COLLEGES_BY_TIER.power[0] } as Player;
    expect(knowledge(l, l.userTeamId, cfl)).toBeCloseTo(0.45 + 0.08 * 2, 5);
    expect(knowledge(l, l.userTeamId, cfl)).toBeLessThan(nfl);
    expect(knowledge(l, l.userTeamId, cfl)).toBeGreaterThan(knowledge(l, l.userTeamId, rookie));
  });
});

function generateDraftClassForTest(l: League): void {
  generateDraftClass(l, new Rng('film-class'));
}

describe('film for arrivals', () => {
  it('a real Pathway arrival is read less clearly than a power-school rookie', () => {
    const l = createLeague({ seed: 'pathway-film' });
    const ai = (l.userTeamId + 1) % 32;
    const arrival = pathwayClass(l)[0];
    const rookie = { ...arrival, origin: COLLEGES_BY_TIER.power[0] } as Player;
    expect(knowledge(l, ai, arrival)).toBeLessThan(knowledge(l, ai, rookie));
    expect(knowledge(l, ai, arrival)).toBeCloseTo(0.45 * 0.4, 5);
  });
});

describe('a ceiling still settling', () => {
  const league = createLeague({ seed: 'scouting-settle' });
  const theirs = Object.values(league.players).filter(
    (p) => p.teamId !== null && p.teamId !== league.userTeamId && p.age <= 23,
  );
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  /** The same player in his third year, before and after its settle (the last he has): all else equal. */
  const pair = (p: Player) => [
    { ...copy(p), experience: 2, ceilingShifts: undefined },
    { ...copy(p), experience: 2, ceilingShifts: { [league.season]: 0 } },
  ];

  it("a rookie's ceiling range is wider than a settled player's, centred the same", () => {
    for (const p of theirs.slice(0, 20)) {
      const [fresh, settled] = pair(p).map((x) => perceive(league, league.userTeamId, x));
      expect(fresh.potMid).toBeCloseTo(settled.potMid, 9);
      expect(fresh.potHi - fresh.potLo).toBeGreaterThan(settled.potHi - settled.potLo);
      expect(fresh.potHiRead).toBeCloseTo(settled.potHi, 9);
      expect(settled.potHiRead).toBe(settled.potHi);
    }
  });

  it('the verdict reads the range without the unsettled part', () => {
    for (const p of theirs.slice(0, 20)) {
      const [fresh, settled] = pair(p).map((x) => scoutReportParts(league, league.userTeamId, x).verdict);
      expect(fresh).toBe(settled);
    }
  });

  it("a rookie's verdict, room to grow included, ignores what is still to settle", () => {
    // Two rookies alike in all but his first season's settle (same experience, so the same knowledge).
    const verdicts = (p: Player) =>
      [undefined, { [league.season]: 0 }].map(
        (ceilingShifts) =>
          scoutReportParts(league, league.userTeamId, { ...copy(p), experience: 0, ceilingShifts }).verdict,
      );
    // Rookies already at their ceiling: only what is still to settle could make "room still to grow" of them.
    for (const p of theirs.slice(0, 60).map((x) => ({ ...copy(x), potential: playerOvr(x) - 0.5 }))) {
      const [fresh, settled] = verdicts(p);
      expect(fresh).toBe(settled);
    }
  });

  it('says where a young player stands in settling', () => {
    const p = theirs[0];
    const note = (over: Partial<Player>) => {
      const q = { ...copy(p), ...over };
      return settleNote(league, league.userTeamId, q, perceive(league, league.userTeamId, q));
    };
    expect(note({ experience: 0, ceilingShifts: undefined })).toBe(
      'Still a projection: his first season will tell us a lot about his ceiling.',
    );
    expect(note({ experience: 2, ceilingShifts: { [league.season - 1]: 0.1 } })).toBe(
      'His ceiling looks about settled.',
    );
    expect(note({ experience: 1, ceilingShifts: { [league.season - 1]: -2.5 } })).toBe(
      'His ceiling read has come down since he came into the league.',
    );
    expect(note({ experience: 1, ceilingShifts: { [league.season - 1]: 2.5 } })).toBe(
      'His ceiling read has gone up since he came into the league.',
    );
    expect(note({ experience: 1, ceilingShifts: { [league.season - 1]: 0.2 } })).toBeNull();
    expect(note({ age: 27, experience: 5 })).toBeNull();
  });
});

describe('character reads', () => {
  const league = createLeague({ seed: 'char-read-stable' });
  const known = Object.values(league.players)
    .filter((p) => p.teamId !== null && p.teamId !== 0)
    .filter((p) => {
      const k = knowledge(league, 0, p);
      return k >= 0.5 && k < 1;
    })
    .slice(0, 8);

  it('keeps every older guess where it was', () => {
    const r = (x: number) => Math.round(x * 1000) / 1000;
    const six = known.map((p) => {
      const c = characterRead(league, 0, p)!;
      return [c.workEthic, c.durability, c.temperament, c.injuryResistance, c.naturalFitness, c.versatility].map(r);
    });
    expect(six).toMatchInlineSnapshot(`
      [
        [
          12.556,
          9.131,
          12.238,
          10.742,
          4.306,
          8.267,
        ],
        [
          9.713,
          10.728,
          1.429,
          9.312,
          9.752,
          14.298,
        ],
        [
          17.33,
          8.73,
          11.544,
          8.72,
          12.136,
          15.706,
        ],
        [
          10.01,
          5.206,
          13.755,
          6.266,
          12.974,
          14.06,
        ],
        [
          8.306,
          15.352,
          17.319,
          13.356,
          10.768,
          11.638,
        ],
        [
          9.925,
          8.149,
          11.809,
          13.514,
          8.243,
          9.782,
        ],
        [
          12.762,
          4.224,
          9.791,
          10.429,
          13.038,
          5.679,
        ],
        [
          12.553,
          10.15,
          9.268,
          4.067,
          11.965,
          10.389,
        ],
      ]
    `);
  });

  it('reads the new character on the same streams, after the old ones', () => {
    const read = characterRead(league, 0, known[0])!;
    for (const k of ['leads', 'poise', 'controversy', 'sportsmanship'] as const)
      expect(read[k]).toBeGreaterThanOrEqual(1);
    for (const k of ['loyalty', 'winning', 'greed', 'patience'] as const) {
      expect(read[k]).toBeGreaterThanOrEqual(0);
      expect(read[k]).toBeLessThanOrEqual(1);
    }
    expect(characterRead(league, 0, known[0])).toEqual(read);
    const named = personalityRead(league, 0, known[0])!;
    expect(named.name).toBeTruthy();
    expect(named.line).toMatch(/\.$/);
    const stranger = Object.values(league.players).find((p) => !characterRead(league, 0, p))!;
    expect(stranger).toBeDefined();
    expect(personalityRead(league, 0, stranger)).toBeNull();
  });
});
