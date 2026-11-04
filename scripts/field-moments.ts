/**
 * Real moments of possession from today's engine (runs past the line, catches, returns), for `npm run parity`, its fit
 * and the attribute audit: each one's start, what today's rolls gave, and the features parity bins by. Games are played
 * with the field's tap on and the switch off, so every game is today's own.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame, type FieldTap } from '../src/engine/match/gameSim';
import type { FieldStart } from '../src/engine/field/types';
import type { League, Position } from '../src/engine/types';

export type Group = 'DL' | 'LB' | 'DB';
export const groupOf = (pos: Position | undefined): Group | null =>
  pos === 'DT' || pos === 'EDGE' ? 'DL' : pos === 'LB' ? 'LB' : pos === 'CB' || pos === 'S' ? 'DB' : null;

export interface MomentRow {
  kind: FieldStart['kind'];
  kick?: 'kickoff' | 'punt';
  /** A back's carry. */
  rb: boolean;
  /** The play stood (no flag wiped it): it counts toward the rebuilt league numbers. */
  stood: boolean;
  start: FieldStart;
  /** A catch's air yards (from the line to the catch). */
  air: number;
  today: { yards: number; td: boolean; oob: boolean; duration: number; group: Group | null; broke: boolean };
  /** What parity bins by: the carrier's skill, the defense's tackling and pursuit, the line state, the coaching edge. */
  f: { carrier: number; defense: number; z: number; edge: number };
}

export interface Totals {
  games: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  /** A back's carries, stuffed ones too. */
  rbCarries: number;
  passAtt: number;
  passYds: number;
  passTd: number;
}

/** The carrier's open-field skill as today's engine reads it after the line or the catch. */
function carrierSkill(start: FieldStart): number {
  const c = start.players.find((p) => p.id === start.carrier)!.s;
  return start.kind === 'run' ? (c.power + c.speed) / 2 : start.kind === 'catch' ? c.move : c.ret;
}

/** The defense's tackling and pursuit: its eleven's mean. */
function defenseSkill(start: FieldStart): number {
  const d = start.players.filter((p) => p.side === 1);
  return d.reduce((n, p) => n + (p.s.tackle + p.s.pursuit) / 2, 0) / d.length;
}

export function harvest(
  seed: string,
  games: number,
  league: League = createLeague({ seed }),
): {
  rows: MomentRow[];
  totals: Totals;
  league: League;
} {
  const rows: MomentRow[] = [];
  const totals: Totals = {
    games: 0,
    rushAtt: 0,
    rushYds: 0,
    rushTd: 0,
    rbCarries: 0,
    passAtt: 0,
    passYds: 0,
    passTd: 0,
  };
  for (const g of league.games.slice(0, games)) {
    const taps: FieldTap[] = [];
    const r = simulateGame(league, g, { fieldTap: (t) => taps.push(t) });
    totals.games++;
    for (const t of [r.home, r.away]) {
      totals.rushAtt += t.rushAtt;
      totals.rushYds += t.rushYds;
      totals.passAtt += t.passAtt;
    }
    for (const [id, line] of Object.entries(r.playerStats)) {
      totals.rushTd += line.rushTd ?? 0;
      totals.passYds += line.passYds ?? 0;
      totals.passTd += line.passTd ?? 0;
      if (league.players[Number(id)]?.position === 'RB') totals.rbCarries += line.rushAtt ?? 0;
    }
    for (const t of taps) {
      const e = r.plays![t.moment.index];
      const c = t.start.players.find((p) => p.id === t.start.carrier)!;
      const tackler = t.today.tackler === null ? undefined : league.players[t.today.tackler];
      rows.push({
        kind: t.moment.kind,
        ...(t.moment.kick ? { kick: t.moment.kick } : {}),
        rb: c.s.pos === 'RB',
        stood: e?.kind !== 'penalty',
        start: t.start,
        air: t.moment.kind === 'catch' ? (c.x - t.start.yardLine) * t.start.dir : 0,
        today: {
          yards: t.today.yards,
          td: t.today.touchdown,
          oob: t.today.outOfBounds,
          duration: t.today.duration,
          group: groupOf(tackler?.position),
          broke: !!e?.open?.broke || !!e?.ran?.open?.broke,
        },
        f: {
          carrier: carrierSkill(t.start),
          defense: defenseSkill(t.start),
          z: t.moment.facts.z ?? 0,
          edge: t.start.edge,
        },
      });
    }
  }
  return { rows, totals, league };
}
