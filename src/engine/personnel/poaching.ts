import { practiceSquad } from '../roster';
import { perceive } from '../scouting';
import type { League, Player } from '../types';
import type { PersonnelState } from './types';

const PROTECTIONS = 2;

export function ensurePoaching(league: League): NonNullable<PersonnelState['poaching']> {
  if (!league.personnel?.enabled) throw new Error('Personnel transactions are not active.');
  const state = (league.personnel.poaching ??= {
    season: league.season,
    offers: [],
    results: [],
    locked: { week: -1, ids: {} },
    pins: {},
  });
  if (state.season !== league.season) {
    state.season = league.season;
    state.offers = [];
    state.results = [];
    state.locked = { week: -1, ids: {} };
  }
  return state;
}

const onSquad = (league: League, teamId: number, id: number) => {
  const p = league.players[id];
  return !!p && p.teamId === teamId && p.squad?.kind === 'practiceSquad';
};

/** Pins still on the squad first, then the club's own best estimated ceilings. Never the hidden potential. */
export function protectionPicks(league: League, teamId: number): number[] {
  const pins = (league.personnel?.poaching?.pins[teamId] ?? []).filter((id) => onSquad(league, teamId, id));
  const rest = practiceSquad(league, teamId)
    .filter((p: Player) => p.squad?.kind === 'practiceSquad' && !pins.includes(p.id))
    .map((p) => ({ id: p.id, pot: perceive(league, teamId, p).potMid }))
    .sort((a, b) => b.pot - a.pot || a.id - b.id)
    .map((x) => x.id);
  return [...pins, ...rest].slice(0, PROTECTIONS);
}

/** Once a week, at the settle: later pin changes wait a week, so protection can't cycle through a squad. */
export function lockProtections(league: League): void {
  const state = ensurePoaching(league);
  if (state.locked.week === league.week) return;
  state.locked = {
    week: league.week,
    ids: Object.fromEntries(league.teams.map((t) => [t.id, protectionPicks(league, t.id)])),
  };
}

/** This week's locked list, less anyone who has since left: a spent slot stays empty until next week. */
export function protectedIds(league: League, teamId: number): number[] {
  const locked = league.personnel?.poaching?.locked;
  if (!locked || locked.week !== league.week) return [];
  return (locked.ids[teamId] ?? []).filter((id) => onSquad(league, teamId, id));
}

export function setPin(league: League, teamId: number, playerId: number, on: boolean): void {
  if (!onSquad(league, teamId, playerId)) throw new Error('Only players on your practice squad can be protected.');
  const state = ensurePoaching(league);
  const pins = (state.pins[teamId] ?? []).filter((id) => id !== playerId && onSquad(league, teamId, id));
  if (on && pins.length >= PROTECTIONS) throw new Error('At most two players can always be protected.');
  state.pins[teamId] = on ? [...pins, playerId] : pins;
}
