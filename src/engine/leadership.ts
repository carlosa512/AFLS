import { resetScouting } from './scouting';
/** Ownership accountability, GM searches and succession. Decisions use isolated seeded streams. */
import {
  canOwnerDismissHeadCoach,
  chairHolder,
  coachMandate,
  coachName,
  coachRoom,
  coachSeverance,
  installInterimHeadCoach,
  ownerDismissHeadCoach,
  ownerTrigger,
  protectCoach,
  resolveInterimHeadCoach,
  teamCoaches,
} from './coaching';
import { managesTeam } from './employment';
import { logTransaction } from './finance/cap';
import { appointDirectorAsGm, appointGm, careerDate, endGmAppointment, makeGmPermanent, teamGm } from './gm';
import { drawInSeason, drawOffseason, heatSoFar, ownerBag, seasonHeat, talentRanks } from './ownerBag';
import { gmRecord } from './records';
import { clamp, Rng } from './rng';
import { computeRecords } from './season/standings';
import { TRADE_DEADLINE_WEEK } from './trade/rules';
import { ensureStaffed, promoteScoutToDirector, staffValue, teamStaff } from './staff';
import type {
  Coach,
  GeneralManager,
  GmJobOffer,
  GmJobTerms,
  League,
  LeadershipEvent,
  LeadershipReview,
  Team,
} from './types';
const name = (gm: GeneralManager) => `${gm.firstName} ${gm.lastName}`;
const head = (l: League, id: number) => chairHolder(teamCoaches(l, id), { role: 'headCoach' });
const recordText = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
const pct = (r: { w: number; l: number; t: number }) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);

/** Club service and head-coach service differ after an internal promotion. */
export function leadershipCoachTenure(l: League, c: Coach): number {
  const since = c.since ?? l.season;
  const rows = (c.career ?? []).filter((r) => r.teamId === c.teamId && r.season >= since);
  if (rows.some((r) => r.role !== 'headCoach')) {
    const heads = rows.filter((r) => r.role === 'headCoach');
    return heads.length ? l.season - Math.min(...heads.map((r) => r.season)) : 0;
  }
  return l.season - since;
}

export function leadershipEvent(l: League, event: Omit<LeadershipEvent, 'id' | 'date'>): LeadershipEvent {
  const e = { ...event, id: l.leadership.nextEventId++, date: careerDate(l) };
  l.leadership.events.push(e);
  // Only confirmed moves enter the transactions feed. Unconfirmed reporting stays in news/mail.
  if (!['warning', 'coachChange'].includes(e.kind))
    logTransaction(l, e.kind.startsWith('gm') ? 'gm' : 'coach', [e.teamId], e.report);
  return e;
}

function dismissGm(l: League, t: Team, why: string) {
  const gm = teamGm(l, t.id)!;
  endGmAppointment(l, gm.id, 'dismissed');
  leadershipEvent(l, {
    teamId: t.id,
    kind: 'gmDismissed',
    gmId: gm.id,
    report: `${t.abbrev} dismissed GM ${name(gm)}.`,
    privateText: why,
  });
}
function coverDirector(l: League, teamId: number) {
  if (teamStaff(l, teamId).some((s) => s.role === 'director')) return;
  const pool = teamStaff(l, teamId)
    .filter((s) => s.role !== 'director')
    .sort((a, b) => staffValue(b) - staffValue(a));
  for (const s of pool) {
    try {
      promoteScoutToDirector(l, teamId, s.id, 1);
      return;
    } catch {
      /* The next internal candidate may fit the budget. */
    }
  }
  // Owners also maintain coverage when it is the player's director who took a GM job elsewhere.
  ensureStaffed(l, { autoUser: true });
}
function recordHire(l: League, t: Team, gm: GeneralManager) {
  const hc = head(l, t.id);
  leadershipEvent(l, {
    teamId: t.id,
    kind: 'gmHired',
    gmId: gm.id,
    report: `${t.abbrev} hired ${name(gm)} as ${gm.appointments.at(-1)?.interim ? 'interim ' : ''}GM.`,
    privateText: hc ? coachMandate(l, hc)?.reason : undefined,
  });
  if (hc && coachMandate(l, hc) && new Rng(`${l.seed}:staff-report:${l.season}:${gm.id}`).chance(0.65))
    leadershipEvent(l, {
      teamId: t.id,
      kind: 'warning',
      gmId: gm.id,
      coachId: hc.id,
      report: `Reports suggest new ${t.abbrev} GM ${name(gm)} is expected to work with the existing head coach.`,
      privateText: `The owner has committed to ${coachName(hc)} through ${coachMandate(l, hc)!.through}.`,
    });
}

/** Offseason decisions are made together before staffing or searches: one draw from each owner's bag (`ownerBag.ts`). */
export function leadershipNewYear(l: League): void {
  if (l.phase !== 'resign') throw new Error('Leadership reviews open in the re-sign window.');
  let ranks: Map<number, number> | undefined;
  for (const t of l.teams) {
    if (t.leadershipReview?.season === l.season) continue;
    const gm = teamGm(l, t.id);
    const rng = new Rng(`${l.seed}:leadership:${l.season}:${t.id}`);
    let hc = head(l, t.id);
    // An interim the owner has just offered the permanent job is not reviewed again in the same breath.
    let confirmed = false;
    if (hc?.interim) {
      const service = hc.career
        ?.filter((c) => c.season === l.season - 1 && c.role === 'headCoach' && c.teamId === t.id)
        .at(-1)?.record;
      const keep = rng.chance(service && pct(service.regular) >= 0.4 ? 0.75 : 0.3);
      const id = hc.id;
      resolveInterimHeadCoach(l, hc, keep);
      confirmed = keep;
      leadershipEvent(l, {
        teamId: t.id,
        coachId: id,
        kind: keep ? 'coachPermanent' : 'coachDismissed',
        report: `${t.abbrev} ${keep ? 'offered its interim head coach ' + coachName(hc) + ' a permanent contract.' : 'ended ' + coachName(hc) + '’s interim head-coaching appointment.'}`,
      });
      hc = head(l, t.id);
    }
    // The owner settles an interim even while the club has no GM; the rest of the review needs one.
    if (!gm) continue;
    const review: LeadershipReview = {
      season: l.season,
      week: 0,
      gmId: gm.id,
      coachId: hc?.id,
      outcome: 'back',
      reason: 'The owner is continuing with the current leadership.',
    };
    t.leadershipReview = review;
    const a = gm.appointments.at(-1)!;
    if (a.interim) continue; // The search presents a separate permanent offer.
    if (gm.id !== l.userGmId && gm.age >= 67 && rng.chance(clamp((gm.age - 66) * 0.06, 0, 1))) {
      endGmAppointment(l, gm.id, 'retired');
      review.outcome = 'gmChange';
      leadershipEvent(l, {
        teamId: t.id,
        kind: 'gmRetired',
        gmId: gm.id,
        report: `${t.abbrev} GM ${name(gm)} retired.`,
      });
      continue;
    }
    const bag = ownerBag(l, t, (ranks ??= talentRanks(l)));
    const last = l.history.find((h) => h.season === l.season - 1);
    const rec = last?.records[t.id];
    const tenure = l.season - a.start.season + (a.priorSeasons ?? 0);
    // New GMs get two complete seasons: until then the owner reviews only the head coach, and spends no patience on the GM.
    const gmProtected = tenure < 3;
    // A playoff trip buys a year. Otherwise a worse season gets a harder look, and a GM whose deal is up one more.
    const heat = rec && !last?.playoffs?.[t.id] ? seasonHeat(rec) : 0;
    const draws = heat ? heat + (a.through < l.season ? 1 : 0) : 0;
    const drawn = drawOffseason(gmProtected ? { ...bag, gm: 0 } : bag, draws, rng);
    const coachGoes =
      drawn.coach && !!hc && !confirmed && canOwnerDismissHeadCoach(l, t.id) && leadershipCoachTenure(l, hc) >= 1;
    if (drawn.gm && !gmProtected) {
      // The coach goes too when his own marble came out; otherwise a new GM usually inherits him.
      const keepCoach =
        hc &&
        (coachMandate(l, hc) || confirmed || (!coachGoes && (leadershipCoachTenure(l, hc) < 2 || rng.chance(0.6))));
      review.outcome = keepCoach ? 'gmChange' : 'bothChange';
      review.reason = keepCoach
        ? 'The owner is changing the front office and keeping the head coach for this season.'
        : 'The owner is changing the front office. The incoming GM can review the coaching staff within the budget.';
      if (keepCoach)
        protectCoach(
          l,
          hc!.id,
          l.season,
          'The owner wants the incoming GM to work with the existing head coach this season.',
        );
      else if (hc) ownerDismissHeadCoach(l, t.id);
      dismissGm(l, t, review.reason);
    } else {
      if (hc && coachGoes) {
        review.outcome = 'coachChange';
        review.reason = 'The owner is retaining you but requires a different head coach before free agency.';
        leadershipEvent(l, {
          teamId: t.id,
          kind: 'coachChange',
          gmId: gm.id,
          coachId: hc.id,
          report: `Reports suggest ${t.abbrev} GM ${name(gm)} is under pressure to change the coaching staff.`,
          privateText: review.reason,
        });
      } else if (rec && pct(rec) < 0.48 && tenure >= 2) {
        review.outcome = 'warning';
        review.reason =
          'The owner expects clear progress this season. Your job will be reviewed again if results do not improve.';
        if (rng.chance(0.65))
          leadershipEvent(l, {
            teamId: t.id,
            kind: 'warning',
            gmId: gm.id,
            report: `League sources suggest ${t.abbrev} GM ${name(gm)} could be entering a prove-it season.`,
            privateText: review.reason,
          });
      }
      if (a.through < l.season) {
        a.through = l.season + (review.outcome === 'warning' ? 0 : 2);
        leadershipEvent(l, {
          teamId: t.id,
          kind: 'gmExtended',
          gmId: gm.id,
          report: `${t.abbrev} extended GM ${name(gm)} through ${a.through}.`,
        });
      }
    }
  }
  beginGmSearch(l);
}

function vacancies(l: League) {
  return l.teams.filter((t) => t.gmId === null || teamGm(l, t.id)?.appointments.at(-1)?.interim);
}
/** Recent results carry more weight than an old winning spell, but titles and playoff work still matter. */
export function gmReputation(l: League, gm: GeneralManager): number {
  const career = gmRecord(l, gm);
  const recent = career.seasons
    .slice()
    .sort((a, b) => b.season - a.season)
    .slice(0, 3);
  const recentRecord = recent.reduce((r, s) => ({ w: r.w + s.regular.w, l: r.l + s.regular.l, t: r.t + s.regular.t }), {
    w: 0,
    l: 0,
    t: 0,
  });
  if (!career.seasons.length) return 0.4;
  return clamp(
    0.6 * pct(recentRecord) +
      0.4 * pct(career.regular) +
      Math.min(0.12, career.playoffTrips * 0.02 + career.titles * 0.04),
    0,
    1,
  );
}

/** The same owner's appetite for a second chance influences player interest and AI candidate rankings. */
export function gmCandidateScore(l: League, teamId: number, gm: GeneralManager): number {
  const secondChance = new Rng(`${l.seed}:owner-second-chance:${teamId}`).float(-0.08, 0.16);
  const priorDismissals = gm.appointments.filter((a) => a.reason === 'dismissed').length;
  return gmReputation(l, gm) + (priorDismissals ? secondChance : 0);
}

/** The least attractive available jobs are clubs with the weakest recent results. */
export function gmJobAppeal(l: League, teamId: number): number {
  const rows = l.history.filter((h) => h.season >= l.season - 3 && h.records[teamId]);
  return rows.length ? rows.reduce((n, h) => n + pct(h.records[teamId]), 0) / rows.length : 0.5;
}

export function gmOfferTerms(l: League, offer: GmJobOffer): GmJobTerms {
  if (offer.terms) return offer.terms;
  const appeal = gmJobAppeal(l, offer.teamId),
    trigger = ownerTrigger(l, offer.teamId);
  const expectation =
    appeal < 0.4
      ? trigger > 1.2
        ? 'Show clear progress this season. Ownership expects the rebuild to move quickly.'
        : 'Build a competitive roster and show progress over your first two seasons.'
      : appeal >= 0.55
        ? 'Compete for the playoffs immediately and sustain a winning roster.'
        : 'Improve the record and put this club in the playoff race.';
  const staffing = l.teams[offer.teamId].ownerMandates
    .filter((m) => m.through >= l.season && l.coaches[m.coachId]?.teamId === offer.teamId)
    .map(
      (m) =>
        `Keep ${coachName(l.coaches[m.coachId])} in the current role through ${m.through}; the contract is already signed.`,
    );
  const review = l.teams[offer.teamId].leadershipReview;
  if (review?.season === l.season && review.outcome === 'coachChange' && head(l, offer.teamId)?.id === review.coachId)
    staffing.push('Hire a different head coach before free agency opens.');
  if (!staffing.length) staffing.push('Review the coaching staff within the owner’s existing staffing budgets.');
  return { expectation, staffing };
}
function jobOffer(l: League, teamId: number, extra: Partial<GmJobOffer> = {}): GmJobOffer {
  const offer: GmJobOffer = { teamId, through: l.season + 2, expiresRound: 3, ...extra };
  offer.terms = gmOfferTerms(l, offer);
  return offer;
}

function additionalOffers(l: League): void {
  const search = l.leadership.search!,
    user = l.gms[l.userGmId];
  if (user.teamId !== null || search.playerDeclined || search.round >= 3) return;
  const rng = new Rng(`${l.seed}:gm-offers:${l.season}:${user.id}:${search.round}`);
  for (const t of rng.shuffle(vacancies(l))) {
    if (search.offers.length >= 3) break;
    if (search.offers.some((o) => o.teamId === t.id) || justLeft(l, user, t.id)) continue;
    // One job is already guaranteed (`beginGmSearch`); a second usually follows, more often for a better record.
    const interest = clamp(
      0.1 + 0.85 * (gmCandidateScore(l, t.id, user) - 0.25) - 0.15 * gmJobAppeal(l, t.id),
      0.3,
      0.8,
    );
    if (rng.chance(interest)) search.offers.push(jobOffer(l, t.id));
  }
}
function justLeft(l: League, user: GeneralManager, teamId: number): boolean {
  const last = user.appointments.at(-1);
  return last?.teamId === teamId && last.end?.season === l.season;
}
export function beginGmSearch(l: League): void {
  if (l.leadership.search?.season === l.season) return;
  const user = l.gms[l.userGmId],
    offers: GmJobOffer[] = [];
  const incumbent = user.teamId === null ? undefined : user.appointments.at(-1);
  if (incumbent?.interim) {
    const record = gmRecord(l, user)
      .seasons.filter((s) => s.teamId === user.teamId && s.season === l.season - 1)
      .at(-1)?.regular;
    if (new Rng(`${l.seed}:interim-offer:${l.season}:${user.id}`).chance(record && pct(record) >= 0.4 ? 0.8 : 0.35))
      offers.push(jobOffer(l, user.teamId!, { incumbent: true }));
    else endGmAppointment(l, user.id, 'expired');
  }
  if (user.teamId === null) {
    // Keep one way back into the game. A quiet market makes this a conditional replacement,
    // so rejecting the offer never manufactures a firing or another league vacancy.
    const open = vacancies(l).filter((t) => !justLeft(l, user, t.id));
    const pool = open.length ? open : l.teams.filter((t) => !justLeft(l, user, t.id));
    const worst = pool.sort((a, b) => gmJobAppeal(l, a.id) - gmJobAppeal(l, b.id) || a.id - b.id)[0];
    if (worst)
      offers.push(jobOffer(l, worst.id, open.length || worst.gmId === null ? {} : { replacesGmId: worst.gmId }));
  }
  l.leadership.search = { season: l.season, round: vacancies(l).length || offers.length ? 0 : 3, offers };
  additionalOffers(l);
  if (l.leadership.search.round === 3) for (const team of l.teams) coverDirector(l, team.id);
}

export function pendingGmOffers(l: League): boolean {
  const s = l.leadership.search;
  return l.phase === 'resign' && !!s && s.season === l.season && s.offers.some((o) => s.round < o.expiresRound);
}
export function declineGmOffers(l: League): void {
  const s = l.leadership.search;
  if (!s || l.phase !== 'resign') throw new Error('The staffing window is closed.');
  s.offers = [];
  s.playerDeclined = true;
  while (s.round < 3) advanceGmHiringRound(l);
}

export function acceptGmOffer(l: League, teamId: number): void {
  const search = l.leadership.search,
    offer = search?.offers.find((o) => o.teamId === teamId);
  if (!search || !offer || search.round >= offer.expiresRound || l.phase !== 'resign')
    throw new Error('This GM offer is no longer available.');
  const user = l.gms[l.userGmId],
    sitting = teamGm(l, teamId);
  const changingClub = user.teamId !== teamId;
  if (offer.incumbent && user.teamId === teamId) makeGmPermanent(l, user.id, offer.through);
  else {
    if (user.teamId !== null) throw new Error('You already have a permanent job.');
    if (offer.replacesGmId !== undefined) {
      if (sitting?.id !== offer.replacesGmId) throw new Error('This club has changed its hiring plans.');
      dismissGm(l, l.teams[teamId], 'The owner has chosen a different GM.');
    } else if (sitting?.appointments.at(-1)?.interim) endGmAppointment(l, sitting.id, 'expired');
    appointGm(l, teamId, user.id, { through: offer.through });
  }
  l.userTeamId = teamId;
  const terms = gmOfferTerms(l, offer);
  user.appointments.at(-1)!.terms = JSON.parse(JSON.stringify(terms));
  const review = l.teams[teamId].leadershipReview;
  l.teams[teamId].leadershipReview = {
    season: l.season,
    week: 0,
    gmId: user.id,
    coachId: head(l, teamId)?.id,
    outcome: review?.outcome === 'coachChange' ? 'coachChange' : 'back',
    reason: [terms.expectation, ...terms.staffing].join(' '),
  };
  if (changingClub) {
    // Scouting visits and trade negotiations belong to the old club, not the person changing jobs.
    l.knowledge = {};
    l.negotiations = {};
    resetScouting(l);
    if (l.market) {
      l.market.offers = [];
      l.market.status = {};
      l.market.talks = {};
      l.market.shopped = {};
      delete l.market.exam;
    }
  }
  search.offers = [];
  recordHire(l, l.teams[teamId], user);
}

function hireForTeam(l: League, t: Team, rng: Rng): void {
  const current = teamGm(l, t.id);
  if (current?.appointments.at(-1)?.interim) {
    const service = gmRecord(l, current)
      .seasons.filter((s) => s.teamId === t.id && s.season === l.season - 1)
      .at(-1)?.regular;
    if (current.id !== l.userGmId && rng.chance(service && pct(service) >= 0.4 ? 0.75 : 0.35)) {
      makeGmPermanent(l, current.id, l.season + 2);
      recordHire(l, t, current);
      return;
    }
    endGmAppointment(l, current.id, 'expired');
  }
  const former = Object.values(l.gms)
    .filter(
      (g) => g.teamId === null && !g.retired && g.id !== l.userGmId && g.appointments.at(-1)?.end?.season !== l.season,
    )
    .map((g) => ({ g, score: gmCandidateScore(l, t.id, g) + rng.normal(0, 0.12) }))
    .sort((a, b) => b.score - a.score)[0];
  const directors = Object.values(l.staff)
    .filter((s) => s.role === 'director')
    .map((s) => ({ s, score: 0.33 + 0.018 * staffValue(s) + (s.teamId === t.id ? 0.05 : 0) + rng.normal(0, 0.14) }))
    .sort((a, b) => b.score - a.score);
  // About one new GM in seven is a former GM getting another chance (NFL hires 2020–2025): owners mostly give new
  // blood a shot. The odds read his record, not the shortlist's luck: the pool of former GMs grows every year.
  const retread =
    former &&
    (!directors.length || rng.chance(clamp(0.04 + 0.45 * (gmCandidateScore(l, t.id, former.g) - 0.3), 0.03, 0.3)));
  if (retread) {
    appointGm(l, t.id, former.g.id, { through: l.season + 2 });
    recordHire(l, t, former.g);
  } else {
    const s = directors[0]?.s;
    if (!s) throw new Error('The GM search has no scouting directors or experienced candidates.');
    const from = s.teamId,
      gm = appointDirectorAsGm(l, t.id, s.id, { through: l.season + 2 });
    if (from !== null) coverDirector(l, from);
    recordHire(l, t, gm);
  }
}

export function advanceGmHiringRound(l: League, opts: { autoUser?: boolean } = {}): void {
  const search = l.leadership.search;
  if (!search || search.round >= 3) return;
  if (opts.autoUser && search.offers.length) {
    const offer = search.offers[0];
    acceptGmOffer(l, offer.teamId);
  }
  search.round++;
  additionalOffers(l);
  const rng = new Rng(`${l.seed}:gm-hiring:${l.season}:${search.round}`);
  for (const t of rng.shuffle(vacancies(l))) {
    if (search.offers.some((o) => o.teamId === t.id && search.round < o.expiresRound)) continue;
    if (search.round < 3 && !rng.chance(0.5)) continue;
    hireForTeam(l, t, rng);
  }
  search.offers = search.offers.filter((o) => search.round < o.expiresRound);
  if (search.round === 3) for (const team of l.teams) coverDirector(l, team.id);
}

export function enforceCoachChanges(l: League, autoUser: boolean): void {
  for (const t of l.teams) {
    const r = t.leadershipReview;
    if (
      r?.season === l.season &&
      r.outcome === 'coachChange' &&
      head(l, t.id)?.id === r.coachId &&
      (autoUser || !managesTeam(l, t.id))
    )
      ownerDismissHeadCoach(l, t.id);
  }
}

/** The club's latest finished game this season was a loss. */
function lostLast(l: League, teamId: number): boolean {
  const g = l.games
    .filter((g) => g.season === l.season && g.result && (g.homeId === teamId || g.awayId === teamId))
    .sort((a, b) => b.week - a.week)[0];
  if (!g?.result) return false;
  const { homeScore, awayScore } = g.result;
  return g.homeId === teamId ? homeScore < awayScore : awayScore < homeScore;
}

/** Losses in a row, back from the club's latest finished game this season. */
function losingStreak(l: League, teamId: number): number {
  const games = l.games
    .filter((g) => g.season === l.season && g.result && (g.homeId === teamId || g.awayId === teamId))
    .sort((a, b) => b.week - a.week);
  let n = 0;
  for (const g of games) {
    const { homeScore, awayScore } = g.result!;
    if (g.homeId === teamId ? homeScore < awayScore : awayScore < homeScore) n++;
    else break;
  }
  return n;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const inWords = (n: number) => WORDS[n] ?? String(n);
const money = (k: number) => (k >= 1000 ? `$${(k / 1000).toFixed(2)}M` : `$${Math.round(k)}K`);

/**
 * The owner's letter when he lets our head coach go in season: the record, whose fault (the roster's talent rank
 * against the results, as his marble bag reads it), who runs the team now, the audition and the bill. `rank` is
 * `talentRanks` (0 = the league's best roster). The letter always opens "I've let … go." (the mail's subject).
 */
export function interimLetter(
  l: League,
  teamId: number,
  fired: Coach,
  interim: Coach,
  severance: number,
  rank: number,
): string {
  const rec = computeRecords(l).get(teamId) ?? { w: 0, l: 0, t: 0 };
  const record = recordText(rec);
  const streak = losingStreak(l, teamId);
  const side = interim.actingAs === 'offCoord' ? 'offense' : 'defense';
  const left = Math.max(0, 17 - (rec.w + rec.l + rec.t));
  const room = coachRoom(l, teamId);
  return [
    `I've let ${coachName(fired)} go. We're ${record}${streak >= 3 ? `, and we've lost ${inWords(streak)} straight` : ''}.`,
    rank < 16 ? `This roster is better than ${record}.` : `I know the roster is thin, but we've gone backwards.`,
    interim.actingAs
      ? `${coachName(interim)}, our ${side === 'offense' ? 'offensive' : 'defensive'} coordinator, takes over for the rest of the season and keeps running the ${side} himself.`
      : `${coachName(interim)} takes over for the rest of the season.`,
    `Consider the last ${left === 1 ? 'game' : `${inWords(left)} games`} his audition; you and I decide in the offseason whether he stays.`,
    severance > 0
      ? `His severance is ${money(severance)}, out of the coaching budget.${room < 0 ? ` That puts us ${money(-room)} over this year.` : ''}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** How often an owner on a lost season reaches into the bag after a loss: tuned to the NFL's in-season firings. */
const OWNER_REACH = 0.4;

/**
 * In-season reviews, week by week once the trade deadline has passed: only after a loss, only on a pace of .300 or
 * worse, and only now and then, so a bad month is not a verdict. Most NFL clubs sell at the deadline and change
 * coaches after it; a change just before it also rewrote the deadline's buyers and sellers. At most one GM and one
 * head-coach change per club per season.
 */
export function leadershipWeek(l: League): void {
  if (l.phase !== 'regular' || l.week <= TRADE_DEADLINE_WEEK + 1 || l.week > 18) return;
  const records = computeRecords(l);
  let ranks: Map<number, number> | undefined;
  for (const t of l.teams) {
    if (t.leadershipWeek?.season === l.season && t.leadershipWeek.week === l.week) continue;
    t.leadershipWeek = { season: l.season, week: l.week };
    const gm = teamGm(l, t.id);
    if (!gm) continue;
    const a = gm.appointments.at(-1)!,
      rec = records.get(t.id)!;
    if (rec.w + rec.l + rec.t < 6 || pct(rec) > 0.3 || !lostLast(l, t.id)) continue;
    const rng = new Rng(`${l.seed}:leadership-week:${l.season}:${l.week}:${t.id}`);
    if (!rng.chance(OWNER_REACH)) continue;
    const tenure = l.season - a.start.season + (a.priorSeasons ?? 0);
    const gmAlready = l.leadership.events.some(
      (e) => e.teamId === t.id && e.date.season === l.season && e.kind === 'gmDismissed',
    );
    const coachAlready = l.leadership.events.some(
      (e) => e.teamId === t.id && e.date.season === l.season && e.kind === 'coachInterim',
    );
    const bag = ownerBag(l, t),
      extra = heatSoFar(l, t, rec, (ranks ??= talentRanks(l)).get(t.id)!);
    const drawn = drawInSeason(bag, extra, rng);
    // A GM fired in season is rarer than a head coach (NFL: one every year or two, against two coaches a year):
    // his marble has to come out twice.
    const fireGm = drawn.gm && drawInSeason(bag, extra, rng).gm && !a.interim && !gmAlready && tenure >= 2;
    if (fireGm) {
      const hc = head(l, t.id);
      if (hc && !hc.interim && rng.chance(0.6))
        protectCoach(
          l,
          hc.id,
          l.season,
          'The owner is keeping the head coach through the season while changing the front office.',
        );
      dismissGm(l, t, 'The owner has ended your appointment during the season.');
      const d = teamStaff(l, t.id).find((s) => s.role === 'director');
      let successor: GeneralManager;
      if (d) {
        successor = appointDirectorAsGm(l, t.id, d.id, { through: l.season, interim: true });
        coverDirector(l, t.id);
      } else {
        const free = Object.values(l.gms).find(
          (g) => g.id !== l.userGmId && g.id !== gm.id && g.teamId === null && !g.retired,
        );
        if (free) {
          appointGm(l, t.id, free.id, { through: l.season, interim: true });
          successor = free;
        } else {
          const freeDirector = Object.values(l.staff).find((s) => s.role === 'director' && s.teamId === null);
          if (!freeDirector) throw new Error('No eligible interim GM.');
          successor = appointDirectorAsGm(l, t.id, freeDirector.id, { through: l.season, interim: true });
        }
      }
      recordHire(l, t, successor);
    }
    const hc = head(l, t.id);
    if (
      !coachAlready &&
      hc &&
      !hc.interim &&
      !coachMandate(l, hc) &&
      leadershipCoachTenure(l, hc) >= 1 &&
      drawn.coach
    ) {
      const severance = coachSeverance(l, hc);
      const interim = installInterimHeadCoach(l, t.id);
      if (interim)
        leadershipEvent(l, {
          teamId: t.id,
          kind: 'coachInterim',
          coachId: interim.id,
          report: `${t.abbrev} dismissed ${coachName(hc)} and named ${coachName(interim)} interim head coach. Reports suggest the rest of the season will serve as an audition.`,
          privateText: managesTeam(l, t.id)
            ? interimLetter(l, t.id, hc, interim, severance, (ranks ??= talentRanks(l)).get(t.id)!)
            : undefined,
        });
    }
  }
}
