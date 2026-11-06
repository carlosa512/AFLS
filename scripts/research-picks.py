"""The NFL's picks and breakups: the targets behind match/defendedPass.ts and the picks check.

python3 -I scripts/research-picks.py [cache dir, default work/nflverse]

nflverse play-by-play and season rosters, regular seasons 2021-25 (missing files are downloaded into the cache). Passes
with air yards, no sacks, spikes or two-point tries; bands by the throw's air yards (behind the line, 0-9, 10-19, 20+);
groups by the season roster's position and depth-chart spot (an OLB on the edge counts with the line, as the game's
EDGE). Spec: docs/superpowers/specs/2026-11-06-picks-and-breakups-design.md.
"""
import sys
import urllib.request
from pathlib import Path

import pandas as pd

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/nflverse')
root.mkdir(parents=True, exist_ok=True)
for year in range(2021, 2026):
    for f, tag in ((root / f'play_by_play_{year}.csv.gz', 'pbp'), (root / f'roster_{year}.csv', 'rosters')):
        if not f.exists():
            with urllib.request.urlopen(f'https://github.com/nflverse/nflverse-data/releases/download/{tag}/{f.name}',
                                        timeout=300) as r:
                f.write_bytes(r.read())

COLS = ['season', 'season_type', 'pass_attempt', 'sack', 'qb_spike', 'two_point_attempt', 'complete_pass',
        'incomplete_pass', 'interception', 'interception_player_id', 'pass_defense_1_player_id', 'air_yards',
        'return_yards', 'return_touchdown']
d = pd.concat([pd.read_csv(f, usecols=COLS, low_memory=False) for f in sorted(root.glob('play_by_play_202[1-5].csv.gz'))])
d = d[(d.season_type == 'REG') & (d.pass_attempt == 1) & (d.sack != 1) & (d.qb_spike != 1) & (d.two_point_attempt != 1)
      & d.air_yards.notna()].copy()
d['band'] = pd.cut(d.air_yards, [-100, -0.5, 9.5, 19.5, 100], labels=['behind', 'short', 'mid', 'deep'])
rosters = pd.concat([pd.read_csv(f, low_memory=False, usecols=['season', 'gsis_id', 'position', 'depth_chart_position'])
                     for f in sorted(root.glob('roster_202[1-5].csv'))]).drop_duplicates(['season', 'gsis_id'])
POS = rosters.set_index(['season', 'gsis_id'])


def group(season, pid):
    try:
        pos, dc = POS.loc[(season, pid)]
    except KeyError:
        return None
    if pos == 'CB' or dc in ('CB', 'LCB', 'RCB', 'NB'):
        return 'CB'
    if pos in ('S', 'SS', 'FS', 'DB') or dc in ('S', 'SS', 'FS'):
        return 'S'
    if pos in ('LB', 'ILB', 'MLB') or dc in ('LB', 'ILB', 'MLB'):
        return 'LB'
    if pos in ('DE', 'DT', 'NT', 'OLB') or dc in ('DE', 'DT', 'NT', 'OLB', 'EDGE', 'DL'):
        return 'DL'
    return None


BANDS = ('behind', 'short', 'mid', 'deep')
picks = d[d.interception == 1].copy()
picks['g'] = [group(s, p) for s, p in zip(picks.season, picks.interception_player_id)]
print(f'Picks: {len(picks)} ({len(picks) / len(d):.4f} of attempts)')
print('Who intercepts it, by band: CB, S, LB, DL (n):')
print('const PICK_GROUPS_NFL = {')
for b in BANDS:
    g = picks[(picks.band == b) & picks.g.notna()]
    sh = g.g.value_counts(normalize=True)
    print(f"  {b}: [{sh.get('CB', 0):.3f}, {sh.get('S', 0):.3f}, {sh.get('LB', 0):.3f}, {sh.get('DL', 0):.3f}, {len(g)}],")
print('};')
print('The return, by band: none, 1-9, 10-19, 20+, mean, pick-six (n):')
print('const PICK_RETURN_NFL = {')
for b in BANDS:
    g = picks[picks.band == b]
    y = g.return_yards.fillna(0)
    print(f'  {b}: [{(y <= 0).mean():.2f}, {((y > 0) & (y < 10)).mean():.2f}, {((y >= 10) & (y < 20)).mean():.2f}, '
          f'{(y >= 20).mean():.2f}, {y.mean():.1f}, {g.return_touchdown.mean():.3f}, {len(g)}],')
print('};')
print(f'Picks crediting their catcher a pass defensed: '
      f'{(picks.pass_defense_1_player_id == picks.interception_player_id).mean():.2f}')

inc = d[(d.incomplete_pass == 1) & (d.interception != 1)].copy()
inc['pd'] = inc.pass_defense_1_player_id.notna()
print(f'\nIncompletions: {len(inc)}; a breakup credited {inc.pd.mean():.3f}')
print('const BREAKUP_NFL = {')
for b in BANDS:
    g = inc[inc.band == b]
    print(f'  {b}: [{g.pd.mean():.3f}, {len(g)}],')
print('};')
br = inc[inc.pd].copy()
br['g'] = [group(s, p) for s, p in zip(br.season, br.pass_defense_1_player_id)]
sh = br.g.value_counts(normalize=True)
print(f"Who breaks it up: CB {sh.get('CB', 0):.3f}, S {sh.get('S', 0):.3f}, LB {sh.get('LB', 0):.3f}, "
      f"DL {sh.get('DL', 0):.3f} (n {br.g.notna().sum()})")

# The engine's incompletion branch never sees a throwaway (that's the passer's own choice, `pocketChoice.ts`), so the
# breakup rate it reads leaves them out: FTN charting marks them, 2022-25.
ftn = [root / f'ftn_charting_{y}.csv' for y in range(2022, 2026)]
if all(f.exists() for f in ftn):
    f = pd.concat([pd.read_csv(x, low_memory=False, usecols=['nflverse_game_id', 'nflverse_play_id', 'is_throw_away'])
                   for x in ftn]).rename(columns={'nflverse_game_id': 'game_id', 'nflverse_play_id': 'play_id'})
    g = pd.concat([pd.read_csv(x, low_memory=False, usecols=['game_id', 'play_id', 'season', 'season_type', 'pass_attempt',
                                                             'sack', 'qb_spike', 'two_point_attempt', 'incomplete_pass',
                                                             'interception', 'pass_defense_1_player_id', 'air_yards'])
                   for x in sorted(root.glob('play_by_play_202[2-5].csv.gz'))])
    g = g[(g.season_type == 'REG') & (g.pass_attempt == 1) & (g.sack != 1) & (g.qb_spike != 1)
          & (g.two_point_attempt != 1) & g.air_yards.notna() & (g.incomplete_pass == 1) & (g.interception != 1)]
    g = g.merge(f, on=['game_id', 'play_id'], how='inner')
    g = g[~g.is_throw_away.astype(bool)].copy()
    g['band'] = pd.cut(g.air_yards, [-100, -0.5, 9.5, 19.5, 100], labels=['behind', 'short', 'mid', 'deep'])
    g['pd'] = g.pass_defense_1_player_id.notna()
    print(f'\nWithout throwaways (FTN 2022-25): {len(g)} incompletions, a breakup credited {g.pd.mean():.3f}')
    print('const BREAKUP_NFL = {')
    for b in BANDS:
        x = g[g.band == b]
        print(f'  {b}: [{x.pd.mean():.3f}, {len(x)}],')
    print('};')
