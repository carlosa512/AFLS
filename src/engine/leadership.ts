import { resetScouting } from './scouting';
/** Ownership accountability, GM searches and succession. Decisions use isolated seeded streams. */
import {
  canOwnerDismissHeadCoach,
  chairHolder,
  coachMandate,
  coachName,
  hotSeat,
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
import { gmRecord } from './records';
import { clamp, Rng } from './rng';
import { computeRecords } from './season/standings';
import { ensureStaffed, promoteScoutToDirector, staffValue, teamStaff } from './staff';
import type { Coach, GeneralManager, League, LeadershipEvent, LeadershipReview, Team } from './types';
const name = (gm: GeneralManager) => `${gm.firstName} ${gm.lastName}`;
const head = (l: League, id: number) => chairHolder(teamCoaches(l, id), { role: 'headCoach' });
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

/** Losing rebuilds receive two complete seasons. Improvement, playoff trips and fresh hires buy time. */
export function gmDismissalChance(l: League, teamId: number): number {
  const gm = teamGm(l, teamId);
  if (!gm) return 0;
  const a = gm.appointments.at(-1)!;
  const tenure = l.season - a.start.season + (a.priorSeasons ?? 0);
  if (tenure < 3 || a.interim) return 0;
  const rows = l.history
    .filter((h) => h.season >= Math.max(a.start.season, l.season - 3) && h.season < l.season)
    .sort((a, b) => a.season - b.season);
  const last = rows.at(-1);
  if (!last) return 0;
  const rec = last.records[teamId];
  if (!rec || pct(rec) >= 0.56 || last.playoffs?.[teamId]) return 0;
  const avg = rows.reduce((s, h) => s + pct(h.records[teamId]), 0) / rows.length;
  const prior = rows.at(-2)?.records[teamId];
  const improving = prior && rec.w >= prior.w + 3;
  let chance = avg < 0.3 ? 0.7 : avg < 0.4 ? 0.48 : avg < 0.48 ? 0.28 : tenure >= 5 ? 0.14 : 0.04;
  if (improving) chance *= 0.3;
  if (rec.w <= 3) chance += 0.12;
  if (rows.some((h) => h.playoffs?.[teamId])) chance *= 0.45;
  return clamp(chance * ownerTrigger(l, teamId), 0, 0.88);
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

/** Offseason decisions are made together before staffing or searches. No GM receives a second hot-seat roll. */
export function leadershipNewYear(l: League): void {
  if (l.phase !== 'resign') throw new Error('Leadership reviews open in the re-sign window.');
  for (const t of l.teams) {
    if (t.leadershipReview?.season === l.season) continue;
    const gm = teamGm(l, t.id);
    if (!gm) continue;
    const rng = new Rng(`${l.seed}:leadership:${l.season}:${t.id}`);
    let hc = head(l, t.id);
    if (hc?.interim) {
      const service = hc.career
        ?.filter((c) => c.season === l.season - 1 && c.role === 'headCoach' && c.teamId === t.id)
        .at(-1)?.record;
      const keep = rng.chance(service && pct(service.regular) >= 0.4 ? 0.75 : 0.3);
      const id = hc.id;
      resolveInterimHeadCoach(l, hc, keep);
      leadershipEvent(l, {
        teamId: t.id,
        coachId: id,
        kind: keep ? 'coachPermanent' : 'coachDismissed',
        report: `${t.abbrev} ${keep ? 'offered its interim head coach ' + coachName(hc) + ' a permanent contract.' : 'ended ' + coachName(hc) + '’s interim head-coaching appointment.'}`,
      });
      hc = head(l, t.id);
    }
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
    const chance = gmDismissalChance(l, t.id);
    const rec = l.history.find((h) => h.season === l.season - 1)?.records[t.id];
    if (rng.chance(chance)) {
      const keepCoach = hc && (coachMandate(l, hc) || leadershipCoachTenure(l, hc) < 2 || rng.chance(0.35));
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
      const tenure = l.season - a.start.season + (a.priorSeasons ?? 0);
      const hcChance =
        hc && rec && canOwnerDismissHeadCoach(l, t.id)
          ? ownerTrigger(l, t.id) * hotSeat(rec, leadershipCoachTenure(l, hc))
          : 0;
      if (hc && rng.chance(hcChance)) {
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
export function beginGmSearch(l: League): void {
  if (l.leadership.search?.season === l.season) return;
  const available = vacancies(l),
    user = l.gms[l.userGmId];
  const offers: NonNullable<League['leadership']['search']>['offers'] = [];
  const incumbent = user.teamId === null ? undefined : user.appointments.at(-1);
  if (incumbent?.interim) {
    const record = gmRecord(l, user)
      .seasons.filter((s) => s.teamId === user.teamId && s.season === l.season - 1)
      .at(-1)?.regular;
    if (new Rng(`${l.seed}:interim-offer:${l.season}:${user.id}`).chance(record && pct(record) >= 0.4 ? 0.8 : 0.35))
      offers.push({ teamId: user.teamId!, through: l.season + 2, expiresRound: 2, incumbent: true });
  }
  if (user.teamId === null) {
    const record = gmRecord(l, user).regular;
    const reputation = record.w + record.l + record.t ? pct(record) : 0.4;
    const rng = new Rng(`${l.seed}:gm-offers:${l.season}:${user.id}`);
    for (const t of rng.shuffle([...available])) {
      if (offers.length >= 3) break;
      // Offers depend on the candidate and actual vacancies; a fired GM may sit out.
      if (rng.chance(clamp(0.15 + 0.7 * (reputation - 0.25), 0.12, 0.65)))
        offers.push({ teamId: t.id, through: l.season + 2, expiresRound: 2 });
    }
  }
  l.leadership.search = { season: l.season, round: available.length ? 0 : 3, offers };
  if (!available.length) for (const team of l.teams) coverDirector(l, team.id);
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
    if (sitting?.appointments.at(-1)?.interim) endGmAppointment(l, sitting.id, 'expired');
    appointGm(l, teamId, user.id, { through: offer.through });
  }
  l.userTeamId = teamId;
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
    .map((g) => ({ g, score: pct(gmRecord(l, g).regular) + rng.normal(0, 0.12) }))
    .sort((a, b) => b.score - a.score)[0];
  const directors = Object.values(l.staff)
    .filter((s) => s.role === 'director')
    .map((s) => ({ s, score: 0.33 + 0.018 * staffValue(s) + (s.teamId === t.id ? 0.05 : 0) + rng.normal(0, 0.14) }))
    .sort((a, b) => b.score - a.score);
  if (former && (!directors.length || former.score > directors[0].score)) {
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

/** Reviews occur between completed weeks. At most one GM and one HC decision per club per season. */
export function leadershipWeek(l: League): void {
  if (l.phase !== 'regular' || ![9, 13, 17].includes(l.week)) return;
  const records = computeRecords(l);
  for (const t of l.teams) {
    if (t.leadershipWeek?.season === l.season && t.leadershipWeek.week === l.week) continue;
    t.leadershipWeek = { season: l.season, week: l.week };
    const gm = teamGm(l, t.id);
    if (!gm) continue;
    const a = gm.appointments.at(-1)!,
      rec = records.get(t.id)!;
    if (rec.w + rec.l + rec.t < 8 || pct(rec) > 0.22) continue;
    const rng = new Rng(`${l.seed}:leadership-week:${l.season}:${l.week}:${t.id}`);
    const tenure = l.season - a.start.season + (a.priorSeasons ?? 0);
    const gmAlready = l.leadership.events.some(
      (e) => e.teamId === t.id && e.date.season === l.season && e.kind === 'gmDismissed',
    );
    const coachAlready = l.leadership.events.some(
      (e) => e.teamId === t.id && e.date.season === l.season && e.kind === 'coachInterim',
    );
    const prior = l.history
      .filter((h) => h.season >= l.season - 2)
      .map((h) => h.records[t.id])
      .filter(Boolean);
    const badHistory = prior.length > 0 && prior.reduce((s, r) => s + pct(r), 0) / prior.length < 0.4;
    const fireGm = !a.interim && !gmAlready && tenure >= 2 && badHistory && rng.chance(0.14 * ownerTrigger(l, t.id));
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
      rng.chance(0.14 * ownerTrigger(l, t.id))
    ) {
      const interim = installInterimHeadCoach(l, t.id);
      if (interim)
        leadershipEvent(l, {
          teamId: t.id,
          kind: 'coachInterim',
          coachId: interim.id,
          report: `${t.abbrev} dismissed ${coachName(hc)} and named ${coachName(interim)} interim head coach. Reports suggest the rest of the season will serve as an audition.`,
        });
    }
  }
}
