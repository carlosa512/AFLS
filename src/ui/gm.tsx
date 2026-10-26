/** Shared GM identity and presentation. These views never change a person's employment. */
import type { CareerDate, GeneralManager, League } from '../engine/types';
import { FREE_AGENT } from './components';
import { PHASE_LABELS, weekLabel } from './format';
import { useNav } from './nav';
import { StaffFigure } from './staffAvatar';
import { staffLook } from './staffLook';
import { pron } from '../engine/pronouns';
import { gmRecord } from '../engine/records';

export const gmName = (gm: GeneralManager) => `${gm.firstName} ${gm.lastName}`;

export function gmStatus(gm: GeneralManager): string {
  if (gm.retired) return 'Retired';
  if (gm.teamId === null) return 'Between jobs';
  return gm.appointments.at(-1)?.interim ? 'Interim GM' : 'Permanent GM';
}

export const gmDate = (date: CareerDate) =>
  `${date.season} · ${date.phase === 'regular' || date.phase === 'playoffs' ? weekLabel(date.week) : PHASE_LABELS[date.phase]}`;

export function gmLook(gm: GeneralManager) {
  // Derive the established silhouette first: changing the dress code must not change the person.
  const look = staffLook(gm.appearanceId, 'gm', gm.woman === true, 'game');
  // A promoted director keeps the same head and hair as their scouting portrait.
  if (gm.scouting) look.hair = staffLook(gm.appearanceId, 'director', gm.woman === true, 'game').hair;
  return { ...look, garment: 'blazer' as const, headwear: 'none' as const, gear: 'none' as const };
}

export function GmAvatar({ league, gm, size = 32 }: { league: League; gm: GeneralManager; size?: number }) {
  const team = gm.teamId === null ? undefined : league.teams[gm.teamId];
  const colors = team ? { primary: team.colors[0], secondary: team.colors[1] } : FREE_AGENT;
  return <StaffFigure colors={colors} look={gmLook(gm)} size={size} />;
}

export function GmLink({ league, gm, avatar = false }: { league: League; gm: GeneralManager; avatar?: boolean }) {
  const nav = useNav();
  return (
    <button className={`linklike${avatar ? ' staff-link' : ''}`} onClick={() => nav.openStaff('gm', gm.id)}>
      {avatar && <GmAvatar league={league} gm={gm} size={28} />}
      <span>{gmName(gm)}</span>
    </button>
  );
}

/** Tendencies are described in words; the user's choices are never attributed to their unused AI profile. */
export function gmStyleNotes(league: League, gm: GeneralManager): string[] {
  if (gm.id === league.userGmId)
    return [
      gm.teamId === null
        ? 'Your career continues between appointments.'
        : 'You set the roster strategy, spending and draft priorities.',
    ];
  const record = gmRecord(league, gm),
    games = record.regular.w + record.regular.l + record.regular.t;
  const lead = perceptionLead(league, gm, record) ?? fallbackLead(gm, record, games);
  const second = perceptionDetail(league, gm, record, lead);
  return second ? [lead, second] : [lead];
}

const COUNT = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const rec = (r: { w: number; l: number; t: number }) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;
const pct = (r: { w: number; l: number; t: number }) => (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t);
type Career = ReturnType<typeof gmRecord>;

/** The one public fact that most defines this GM now, first that applies; undefined falls back to the older lines. */
function perceptionLead(league: League, gm: GeneralManager, record: Career): string | undefined {
  const { him, his } = pron(gm);
  const seasons = [...record.seasons].sort((a, b) => a.season - b.season);
  const last = gm.appointments.at(-1);
  if (gm.retired || last?.reason === 'retired') {
    const n = seasons.length;
    return n
      ? `Retired after ${(COUNT[n] ?? String(n)).toLowerCase()} season${n === 1 ? '' : 's'} running a front office.`
      : 'Retired from front-office work.';
  }
  if (gm.teamId === null && last?.end) {
    const club = league.teams[last.teamId].abbrev;
    const worked = seasons.filter((s) => s.teamId === last.teamId).at(-1);
    const lastYear = worked?.season ?? last.end.season - 1;
    if (league.season - last.end.season >= 2) return `Hasn’t run a front office since ${lastYear}.`;
    if (last.reason === 'dismissed')
      return worked
        ? `Out of work since ${club} let ${him} go after a ${rec(worked.regular)} season.`
        : `Out of work since ${club} let ${him} go.`;
    if (last.reason === 'expired') return `Left ${club} when ${his} deal ran out after ${lastYear}; available.`;
  }
  const titles = seasons.filter((s) => s.champion).map((s) => s.season);
  const inThree = Math.max(0, ...titles.map((t) => titles.filter((x) => x >= t && x <= t + 2).length));
  if (inThree >= 2) return `${COUNT[inThree]} titles in three years.`;
  if (titles.length) {
    const t = titles.at(-1)!;
    const since = seasons.filter((s) => s.season > t);
    if (since.length && since.every((s) => pct(s.regular) < 0.5)) {
      const sum = since.reduce((a, s) => ({ w: a.w + s.regular.w, l: a.l + s.regular.l, t: a.t + s.regular.t }), {
        w: 0,
        l: 0,
        t: 0,
      });
      return `Won it all in ${t}; ${rec(sum)} since.`;
    }
    return titles.length === 1 ? `A title in ${t} on the résumé.` : `Titles in ${titles.join(' and ')}.`;
  }
  const finalLoss = seasons.filter((s) => s.finish === 'Lost the title game').at(-1);
  if (finalLoss) return `One win from a title in ${finalLoss.season}.`;
  const trips = (s: Career['seasons'][number]) => !!s.playoffs || s.finish === 'Lost the title game';
  let streak = 0;
  while (streak < seasons.length && trips(seasons[seasons.length - 1 - streak])) streak++;
  if (streak >= 3) return `${COUNT[streak] ?? streak} straight playoff trips.`;
  const pressure = league.leadership.events.find(
    (e) =>
      e.gmId === gm.id &&
      e.date.season === league.season &&
      ((e.kind === 'warning' && e.coachId === undefined) || e.kind === 'coachChange'),
  );
  if (pressure && gm.teamId !== null)
    return pressure.date.phase === 'regular' || pressure.date.phase === 'playoffs'
      ? 'Under pressure from ownership.'
      : `Starts ${league.season} under pressure from ownership.`;
  return undefined;
}

function fallbackLead(gm: GeneralManager, record: Career, games: number): string {
  if (record.playoffTrips >= 2)
    return `An established front-office leader with ${record.playoffTrips} playoff appearances.`;
  if (games >= 34 && record.regular.w / games < 0.4)
    return 'The record has raised questions about whether this GM can build a consistent winner.';
  if (record.playoffTrips) return 'Has taken a team to the playoffs; the next test is building sustained success.';
  if (gm.origin === 'director')
    return 'Known first as a scouting evaluator, now building a reputation running a front office.';
  return 'Still building a public track record as the league watches this front office take shape.';
}

/** A second line only when it adds something: years in the chair, else a best season the lead doesn't already name. */
function perceptionDetail(league: League, gm: GeneralManager, record: Career, lead: string): string | undefined {
  const a = gm.appointments.at(-1);
  if (gm.teamId !== null && a && !a.end) {
    const year = league.season - a.start.season + 1 + (a.priorSeasons ?? 0);
    if (year >= 3) return `In ${pron(gm).his} ${ORDINAL[year] ?? `${year}th`} year in ${league.teams[gm.teamId].city}.`;
  }
  const best = record.seasons
    .filter((s) => s.regular.w > s.regular.l && s.regular.w + s.regular.l + s.regular.t >= 10)
    .sort((x, y) => pct(y.regular) - pct(x.regular) || y.season - x.season)[0];
  if (best && !lead.includes(String(best.season))) return `Best year: ${rec(best.regular)} in ${best.season}.`;
  return undefined;
}
