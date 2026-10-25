/** Shared GM identity and presentation. These views never change a person's employment. */
import type { CareerDate, GeneralManager, League } from '../engine/types';
import { FREE_AGENT } from './components';
import { PHASE_LABELS, weekLabel } from './format';
import { useNav } from './nav';
import { StaffFigure } from './staffAvatar';
import { staffLook } from './staffLook';
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
  if (gm.id === league.userGmId) return [gm.teamId === null ? 'Your career continues between appointments.' : 'You set the roster strategy, spending and draft priorities.'];
  const record = gmRecord(league, gm), games = record.regular.w + record.regular.l + record.regular.t;
  if (record.titles) return [`A championship-winning executive with ${record.titles === 1 ? 'a title' : `${record.titles} titles`} on the résumé.`];
  if (record.playoffTrips >= 2) return [`An established front-office leader with ${record.playoffTrips} playoff appearances.`];
  if (games >= 34 && record.regular.w / games < 0.4) return ['The record has raised questions about whether this GM can build a consistent winner.'];
  if (record.playoffTrips) return ['Has taken a team to the playoffs; the next test is building sustained success.'];
  if (gm.origin === 'director') return ['Known first as a scouting evaluator, now building a reputation running a front office.'];
  return ['Still building a public track record as the league watches this front office take shape.'];
}
