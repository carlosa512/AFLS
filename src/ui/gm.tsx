/** Shared GM identity and presentation. These views never change a person's employment. */
import { gmTraits } from '../engine/gm';
import type { CareerDate, GeneralManager, League } from '../engine/types';
import { FREE_AGENT } from './components';
import { PHASE_LABELS, weekLabel } from './format';
import { useNav } from './nav';
import { StaffFigure } from './staffAvatar';
import { staffLook } from './staffLook';

export const gmName = (gm: GeneralManager) => `${gm.firstName} ${gm.lastName}`;

export function gmStatus(gm: GeneralManager): string {
  if (gm.retired) return 'Retired';
  if (gm.teamId === null) return 'Between jobs';
  return gm.appointments.at(-1)?.interim ? 'Interim GM' : 'Permanent GM';
}

export const gmDate = (date: CareerDate) =>
  `${date.season} · ${date.phase === 'regular' || date.phase === 'playoffs' ? weekLabel(date.week) : PHASE_LABELS[date.phase]}`;

export function gmLook(gm: GeneralManager) {
  // Executives dress for the press box, with a stable outfit even when the club is playing in snow.
  const look = staffLook(gm.appearanceId, 'gm', gm.woman === true, 'game');
  // A promoted director keeps the same head and hair as their scouting portrait.
  if (gm.scouting) look.hair = staffLook(gm.appearanceId, 'director', gm.woman === true, 'game').hair;
  return look;
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
  if (gm.id === league.userGmId) return ['You set the roster strategy, spending and draft priorities.'];
  const t = gmTraits(league, gm);
  return [
    t.winNow >= 0.7
      ? 'Prioritizes winning now'
      : t.winNow <= 0.4
        ? 'Builds for the future'
        : 'Balances today and tomorrow',
    t.capAggression >= 0.7
      ? 'Pushes money into future years'
      : t.capAggression <= 0.35
        ? 'Protects future cap room'
        : 'Measured with the cap',
    t.pickChart === 'analytics' ? 'Values depth across the draft' : 'Pays a premium for top picks',
    ...(t.loyalty >= 0.65 ? ['Pays to keep the core together'] : []),
    ...(t.stubbornness >= 0.7 ? ['Drives a hard bargain'] : []),
  ];
}
