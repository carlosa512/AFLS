/**
 * The picks check (spec: docs/superpowers/specs/2026-11-06-picks-and-breakups-design.md, §6): who picks it off by the
 * throw's depth, how often and by whom an incompletion is broken up (throwaways left out), the pick's 20+ returns and
 * pick-sixes by depth, and the share of picks crediting a pass defensed, against nflverse 2021–25
 * (`scripts/research-picks.py`). Used by `npm run picks` (fast, AI games) and `npm run sim`.
 */
import type { DefendedTap } from '../src/engine/match/gameSim';
import type { Band, PassGroup } from '../src/engine/match/defendedPass';
import { share } from './fumbles-core';
import type { Line } from './sideline-core';

const BANDS: readonly Band[] = ['behind', 'short', 'mid', 'deep'];
const GROUPS: readonly PassGroup[] = ['CB', 'S', 'LB', 'DL'];
const BAND_NAMES: Record<Band, string> = { behind: 'behind', short: 'short', mid: 'mid', deep: 'deep' };
const GROUP_NAMES: Record<PassGroup, string> = {
  CB: 'the corners',
  S: 'the safeties',
  LB: 'the linebackers',
  DL: 'the line',
};

/** Who intercepts it by depth (CB, S, LB, DL shares; n). */
const PICK_GROUPS_NFL: Record<Band, [number, number, number, number, number]> = {
  behind: [0.121, 0.081, 0.379, 0.419, 124],
  short: [0.4, 0.262, 0.309, 0.028, 637],
  mid: [0.438, 0.392, 0.164, 0.006, 651],
  deep: [0.431, 0.535, 0.034, 0, 643],
};
/** The pick's return by depth: 20+ share, mean, pick-sixes (n). */
const PICK_RETURN_NFL: Record<Band, [long: number, mean: number, six: number, n: number]> = {
  behind: [0.25, 12.8, 0.266, 124],
  short: [0.31, 16.4, 0.184, 637],
  mid: [0.26, 11.7, 0.043, 651],
  deep: [0.2, 9.1, 0.005, 643],
};
/** Incompletions with a breakup credited by depth, throwaways left out (FTN 2022–25; n). */
const BREAKUP_NFL: Record<Band, [number, number]> = {
  behind: [0.456, 2149],
  short: [0.369, 8410],
  mid: [0.349, 5505],
  deep: [0.288, 4569],
};
/** Who's credited with breakups (CB, S, LB, DL; n). */
const BREAKUP_GROUPS_NFL: [number, number, number, number, number] = [0.467, 0.194, 0.193, 0.146, 9103];
const PICK_PD_NFL = 0.84;

interface BandTally {
  picks: number;
  groups: Record<PassGroup, number>;
  returns: number;
  yards: number;
  long: number;
  six: number;
  incompletions: number;
  breakups: number;
}
export interface PickTally {
  bands: Record<Band, BandTally>;
  breakGroups: Record<PassGroup, number>;
  pd: number;
}

const groups = () => ({ CB: 0, S: 0, LB: 0, DL: 0 });
export function newPickTally(): PickTally {
  const band = (): BandTally => ({
    picks: 0,
    groups: groups(),
    returns: 0,
    yards: 0,
    long: 0,
    six: 0,
    incompletions: 0,
    breakups: 0,
  });
  return { bands: { behind: band(), short: band(), mid: band(), deep: band() }, breakGroups: groups(), pd: 0 };
}

/** One pick or incompletion, as the engine tapped it. */
export function tapDefended(t: PickTally, tap: DefendedTap): void {
  const b = t.bands[tap.band];
  if (tap.outcome === 'pick') {
    b.picks++;
    if (tap.group) b.groups[tap.group]++;
    if (tap.pd) t.pd++;
    if (tap.endZone) return;
    b.returns++;
    b.yards += tap.returnYds ?? 0;
    if ((tap.returnYds ?? 0) >= 20) b.long++;
    if (tap.pickSix) b.six++;
    return;
  }
  b.incompletions++;
  if (tap.outcome === 'breakup') {
    b.breakups++;
    if (tap.group) t.breakGroups[tap.group]++;
  }
}

/** Every line: shares judged once their tolerance clears 3.5 standard errors (`share`), mean returns reported only. */
export function judgePicks(t: PickTally): Line[] {
  const lines: Line[] = [];
  for (const band of BANDS) {
    const b = t.bands[band];
    const nfl = PICK_GROUPS_NFL[band];
    GROUPS.forEach((g, i) =>
      lines.push(share(`picks, ${BAND_NAMES[band]}: by ${GROUP_NAMES[g]}`, b.groups[g], b.picks, nfl[i], nfl[4], 0.08)),
    );
    const [long, mean, six, n] = PICK_RETURN_NFL[band];
    lines.push(share(`picks, ${BAND_NAMES[band]}: 20+ returns`, b.long, b.returns, long, n, 0.08));
    lines.push(share(`picks, ${BAND_NAMES[band]}: pick-sixes`, b.six, b.returns, six, n, Math.max(0.04, 0.25 * six)));
    lines.push({
      label: `picks, ${BAND_NAMES[band]}: mean return`,
      value: b.returns ? b.yards / b.returns : NaN,
      range: [0, 0],
      note: `NFL ${mean} (${b.returns}), reported`,
      info: true,
    });
    const [rate, bn] = BREAKUP_NFL[band];
    lines.push(share(`breakups, ${BAND_NAMES[band]}: per incompletion`, b.breakups, b.incompletions, rate, bn, 0.05));
  }
  const broken = GROUPS.reduce((a, g) => a + t.breakGroups[g], 0);
  GROUPS.forEach((g, i) =>
    lines.push(
      share(
        `breakups: by ${GROUP_NAMES[g]}`,
        t.breakGroups[g],
        broken,
        BREAKUP_GROUPS_NFL[i],
        BREAKUP_GROUPS_NFL[4],
        0.06,
      ),
    ),
  );
  const picks = BANDS.reduce((a, band) => a + t.bands[band].picks, 0);
  lines.push(share('picks: crediting a pass defensed', t.pd, picks, PICK_PD_NFL, 2055, 0.06));
  return lines;
}
