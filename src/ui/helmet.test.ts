import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ORIGINS, PATHWAY_ORIGINS } from '../engine/data/origins';
import { TEAM_SEEDS } from '../engine/data/teams';
import { createLeague } from '../engine/generate';
import { starters, teamPlayers } from '../engine/roster';
import type { HelmetModel, Player, Team } from '../engine/types';
import { contrast } from './color';
import {
  flagsOf,
  greenDotOf,
  HELMET_LABEL,
  HELMET_WEIGHTS,
  helmetDesignOf,
  helmetModelOf,
  isDarkShell,
  maskOf,
  PATHWAY_FLAGS,
  wearsHelmet,
} from './helmet';

describe('helmet', () => {
  it('puts a helmet on a player with a club, never on a free agent, prospect or retiree', () => {
    const team = { id: 0, colors: ['#1D4ED8', '#FFFFFF'] } as Team;
    expect(wearsHelmet({ teamId: 0 } as Player, team)).toBe(true);
    expect(wearsHelmet({ teamId: null } as Player, null)).toBe(false);
    expect(wearsHelmet({ teamId: 0, retired: true } as Player, team)).toBe(false);
    expect(wearsHelmet({ teamId: null, scouting: {} } as unknown as Player, team)).toBe(false); // a prospect
  });

  it('picks each position group its shells by their weights, and your pick wins', () => {
    const groups = { qb: 'QB', skill: 'WR', middle: 'LB', line: 'OL', kick: 'K' } as const;
    for (const [group, position] of Object.entries(groups)) {
      const w = HELMET_WEIGHTS[group as keyof typeof HELMET_WEIGHTS];
      const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
      const picks = Array.from({ length: 4000 }, (_, i) => helmetModelOf({ id: i + 1, position }));
      for (const m of Object.keys(HELMET_LABEL) as HelmetModel[])
        expect(picks.filter((x) => x === m).length / 4000, `${group} ${m}`).toBeCloseTo((w[m] ?? 0) / total, 1);
    }
    expect(helmetModelOf({ id: 9, position: 'QB', gear: { helmet: 'retro' } })).toBe('retro');
    // gear chosen before helmets existed: his own shell
    expect(helmetModelOf({ id: 9, position: 'QB', gear: {} })).toBe(helmetModelOf({ id: 9, position: 'QB' }));
  });

  it('fits the mask to the position', () => {
    expect(maskOf('QB')).toBe('qb');
    for (const p of ['RB', 'WR', 'CB', 'S'] as const) expect(maskOf(p)).toBe('skill');
    for (const p of ['LB', 'EDGE', 'TE'] as const) expect(maskOf(p)).toBe('hybrid');
    for (const p of ['OL', 'DT'] as const) expect(maskOf(p)).toBe('line');
    for (const p of ['K', 'P'] as const) expect(maskOf(p)).toBe('kicker');
  });

  it("reads every club's design so its stripe and number stand off the shell", () => {
    for (const s of TEAM_SEEDS) {
      const d = s.helmet!;
      const stripe = Math.max(
        contrast(d.shell, d.stripeA ?? d.shell),
        contrast(d.shell, d.stripeB ?? d.stripeA ?? d.shell),
      );
      if (d.stripe !== 'none') expect(stripe, s.abbrev).toBeGreaterThanOrEqual(2);
      if (d.number)
        expect(
          Math.max(contrast(d.shell, d.number.ink), contrast(d.shell, d.number.trim)),
          s.abbrev,
        ).toBeGreaterThanOrEqual(2.4);
    }
  });

  it("falls back to the club's colours when it has no design", () => {
    const d = helmetDesignOf({ colors: ['#123456', '#EEEEEE'] });
    expect(d).toMatchObject({
      shell: '#123456',
      finish: 'gloss',
      stripe: 'single',
      bumper: '#EEEEEE',
      mask: '#9AA3AD',
    });
    expect(d.number).toBeUndefined();
    expect(contrast(d.shell, d.stripeA!)).toBeGreaterThanOrEqual(1.8);
    // a secondary that doesn't stand off the primary is swapped for light or dark
    expect(helmetDesignOf({ colors: ['#101820', '#203731'] }).stripeA).not.toBe('#203731');
    // a club with a design wears it
    expect(helmetDesignOf({ colors: ['#e31837', '#ffb81c'], helmet: TEAM_SEEDS[13].helmet })).toBe(
      TEAM_SEEDS[13].helmet,
    );
  });

  it("flies the US flag on every helmet and a Pathway player's country under it, never a CFL arrival's", () => {
    for (const i of PATHWAY_ORIGINS) expect(flagsOf({ origin: i })).toEqual(['US', PATHWAY_FLAGS[ORIGINS[i].name]]);
    for (const name of PATHWAY_ORIGINS.map((i) => ORIGINS[i].name)) expect(PATHWAY_FLAGS[name], name).toBeDefined();
    expect(flagsOf({ origin: ORIGINS.findIndex((o) => o.kind === 'cfl') })).toEqual(['US']);
    expect(flagsOf({ origin: 0 })).toEqual(['US']); // a college
    expect(flagsOf({})).toEqual(['US']);
  });

  it('puts one green dot on each side: the starting QB and the first LB, or a safety', () => {
    const league = createLeague({ seed: 'dots' });
    for (const team of league.teams) {
      const dotted = teamPlayers(league, team.id).filter((p) => greenDotOf(league, team, p));
      expect(dotted.map((p) => p.id).sort()).toEqual(
        [starters(league, team, 'QB')[0].id, starters(league, team, 'LB')[0].id].sort(),
      );
    }
    const team = league.teams[0];
    team.depthChart.LB = [];
    expect(greenDotOf(league, team, starters(league, team, 'S')[0])).toBe(true);
    team.depthChart.QB = [];
    team.depthChart.S = [];
    expect(() => teamPlayers(league, team.id).forEach((p) => greenDotOf(league, team, p))).not.toThrow();
  });

  it('names the shells in our own words', () => {
    const banned = /Riddell|Schutt|Vicis|Xenith|Axiom|SpeedFlex|\bF7\b|Vengeance|Zero2|Trench|Shadow/i;
    for (const f of ['helmet.ts', 'helmetArt.tsx', 'flags.tsx'])
      if (existsSync(`src/ui/${f}`)) expect(readFileSync(`src/ui/${f}`, 'utf8'), f).not.toMatch(banned);
    for (const n of Object.values(HELMET_LABEL)) expect(n).not.toMatch(banned);
  });

  it('calls a shell dark when it would melt into a dark jersey', () => {
    expect(isDarkShell('#101820')).toBe(true);
    expect(isDarkShell('#ffb612')).toBe(false);
  });
});
