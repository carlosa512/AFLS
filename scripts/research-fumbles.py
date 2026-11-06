"""The NFL's contact fumbles by situation: the targets behind match/fumbleOdds.ts and the fumbles check.

python3 -I scripts/research-fumbles.py [cache dir, default work/nflverse]

nflverse play-by-play, regular seasons 2021-25 (missing seasons are downloaded into the cache). Touches: runs (no
scrambles or kneels), completions and scrambles that end in bounds without a touchdown; no two-point tries. A fumble is
the carrier's own (`fumbled_1_player_id`). Buckets read only what's known before the snap: a fumble ends the play where it
happens, so a short gain or a play short of the sticks would read fumble-heavy because of the fumble. Spec:
docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md.

Then the loose ball and the strip-sack (spec: docs/superpowers/specs/2026-11-06-fumble-recoveries-design.md): every
fumble on a run, a catch, a scramble or a sack, who got it (forced or his own), who on the defense was credited (his
season roster's position group), how far he ran it back; strip-sacks per sack by situation and by the sacker's group.
Rosters (`roster_YYYY.csv`) are downloaded into the cache too.
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

COLS = ['game_id', 'play_id', 'season_type', 'play_type', 'qb_scramble', 'qb_kneel', 'complete_pass',
        'rusher_player_id', 'receiver_player_id', 'fumbled_1_player_id', 'fumble', 'fumble_lost', 'fumble_forced',
        'down', 'ydstogo', 'game_seconds_remaining', 'score_differential', 'touchdown', 'out_of_bounds',
        'two_point_attempt']
d = pd.concat([pd.read_csv(f, usecols=COLS, low_memory=False) for f in sorted(root.glob('play_by_play_202[1-5].csv.gz'))])
d = d[(d.season_type == 'REG') & (d.two_point_attempt != 1) & (d.qb_kneel != 1)]
run = d[(d.play_type == 'run') & (d.qb_scramble != 1)].assign(who=lambda x: x.rusher_player_id, kind='run')
catch = d[(d.play_type == 'pass') & (d.complete_pass == 1)].assign(who=lambda x: x.receiver_player_id, kind='catch')
scramble = d[d.qb_scramble == 1].assign(who=lambda x: x.rusher_player_id, kind='scramble')
t = pd.concat([run, catch, scramble])
t = t[(t.touchdown != 1) & (t.out_of_bounds != 1)].copy()
t['fum'] = (t.fumble == 1) & (t.fumbled_1_player_id == t.who)
t['lost'] = t.fum & (t.fumble_lost == 1)

late = t.game_seconds_remaining <= 300
BUCKETS = {
    'all': t.down == t.down,
    'early': t.down <= 2,
    'third short': (t.down == 3) & (t.ydstogo <= 3),
    'third mid': (t.down == 3) & t.ydstogo.between(4, 9),
    'third long': (t.down == 3) & (t.ydstogo >= 10),
    'fourth': t.down == 4,
    'trailing late': late & (t.score_differential < 0),
    'leading late': late & (t.score_differential > 0),
}
print('Per 100 tackles in bounds: fumbles, lost (n).')
print('export const FUMBLES_NFL = {')
for kind in ('run', 'catch', 'scramble'):
    print(f'  {kind}: {{')
    for name, m in BUCKETS.items():
        s = t[(t.kind == kind) & m]
        print(f"    '{name}': [{100 * s.fum.mean():.2f}, {100 * s.lost.mean():.2f}, {len(s)}],")
    print('  },')
print('};')
print('Forced share of fumbles:', {k: round(float(t[(t.kind == k) & t.fum].fumble_forced.mean()), 3)
                                   for k in ('run', 'catch', 'scramble')})
for kind in ('run', 'catch'):
    p = t[t.kind == kind].groupby('who').agg(n=('fum', 'size'), f=('fum', 'sum'))
    p = p[p.n >= 150]
    r = p.f / p.n
    binom = ((r.mean() * (1 - r.mean())) / p.n).mean() ** 0.5
    print(f'{kind} carriers with 150+ touches: {len(p)}; median {r.median():.4f}, p90 {r.quantile(0.9):.4f}, '
          f'sd {r.std(ddof=0):.4f} (luck alone {binom:.4f})')

# ───────── the loose ball and the strip-sack ─────────

LCOLS = ['season', 'season_type', 'play_type', 'qb_scramble', 'complete_pass', 'sack', 'fumble', 'fumble_lost',
         'fumble_forced', 'forced_fumble_player_1_player_id', 'fumble_recovery_1_player_id', 'fumble_recovery_1_yards',
         'return_touchdown', 'sack_player_id', 'half_sack_1_player_id', 'down', 'ydstogo', 'game_seconds_remaining',
         'score_differential', 'two_point_attempt']
a = pd.concat([pd.read_csv(f, usecols=LCOLS, low_memory=False) for f in sorted(root.glob('play_by_play_202[1-5].csv.gz'))])
a = a[(a.season_type == 'REG') & (a.two_point_attempt != 1)]
a['kind'] = None
a.loc[(a.play_type == 'run') & (a.qb_scramble != 1), 'kind'] = 'run'
a.loc[(a.play_type == 'pass') & (a.complete_pass == 1), 'kind'] = 'catch'
a.loc[a.qb_scramble == 1, 'kind'] = 'scramble'
a.loc[a.sack == 1, 'kind'] = 'sack'
rosters = pd.concat([pd.read_csv(f, low_memory=False, usecols=['season', 'gsis_id', 'position', 'depth_chart_position'])
                     for f in sorted(root.glob('roster_202[1-5].csv'))]).drop_duplicates(['season', 'gsis_id'])
POS = rosters.set_index(['season', 'gsis_id'])


def group(season, pid, edge_dl=True):
    """A man's group from his season roster: DB, LB, DL (edge and interior told apart for the strip)."""
    try:
        pos, dc = POS.loc[(season, pid)]
    except KeyError:
        return None
    if pos in ('DT', 'NT') or dc in ('DT', 'NT', 'DL'):
        return 'interior'
    if pos in ('DE', 'OLB') or dc in ('DE', 'OLB', 'EDGE'):
        return 'edge'
    if pos in ('LB', 'ILB', 'MLB') or dc in ('LB', 'ILB', 'MLB'):
        return 'LB'
    if pos in ('CB', 'S', 'SS', 'FS', 'DB') or dc in ('CB', 'S', 'SS', 'FS', 'DB'):
        return 'DB'
    return None


fum = a[a.kind.notna() & (a.fumble == 1)].copy()
print('\nThe defense recovers (share of fumbles), all / forced / his own (n):')
print('export const RECOVERED_NFL = {')
for kind in ('run', 'catch', 'scramble', 'sack'):
    g = fum[fum.kind == kind]
    f, o = g[g.fumble_forced == 1], g[g.fumble_forced != 1]
    print(f'  {kind}: {{ all: [{g.fumble_lost.mean():.2f}, {len(g)}], forced: [{f.fumble_lost.mean():.2f}, {len(f)}], '
          f'own: [{o.fumble_lost.mean():.2f}, {len(o)}] }},')
print('};')
lost = fum[fum.fumble_lost == 1].copy()
lost['group'] = [group(s, p) for s, p in zip(lost.season, lost.fumble_recovery_1_player_id)]
lost['group'] = lost.group.replace({'edge': 'DL', 'interior': 'DL'})
lost = lost[lost.group.notna()]
forcer = (lost.fumble_forced == 1) & (lost.forced_fumble_player_1_player_id == lost.fumble_recovery_1_player_id)
print('The forcer recovers (share of the defense\'s recoveries):',
      {k: round(float(forcer[lost.kind == k].mean()), 2) for k in ('run', 'catch', 'scramble', 'sack')})
print('The rest by group (DB, LB, DL):')
for kind in ('run', 'catch', 'scramble', 'sack'):
    g = lost[(lost.kind == kind) & ~forcer]
    sh = g.group.value_counts(normalize=True)
    print(f'  {kind}: {{ DB: {sh.get("DB", 0):.2f}, LB: {sh.get("LB", 0):.2f}, DL: {sh.get("DL", 0):.2f} }}, // n {len(g)}')
print('Returns by group: zero or less, 1-9, 10-19, 20+, mean, touchdown (n):')
for grp in ('DB', 'LB', 'DL'):
    g = lost[lost.group == grp]
    y = g.fumble_recovery_1_yards.fillna(0)
    print(f'  {grp}: [{(y <= 0).mean():.2f}, {((y > 0) & (y < 10)).mean():.2f}, {((y >= 10) & (y < 20)).mean():.2f}, '
          f'{(y >= 20).mean():.2f}, {y.mean():.1f}, {g.return_touchdown.mean():.3f}, {len(g)}],')
print('Return touchdowns by play:', {k: round(float(lost[lost.kind == k].return_touchdown.mean()), 3)
                                    for k in ('run', 'catch', 'sack')})

sk = a[a.kind == 'sack'].copy()
sk['rusher'] = sk.sack_player_id.fillna(sk.half_sack_1_player_id)
sk['group'] = [group(s, p) for s, p in zip(sk.season, sk.rusher)]
late = sk.game_seconds_remaining <= 300
SB = {
    'all': sk.down == sk.down,
    'early': sk.down <= 2,
    'third short': (sk.down == 3) & (sk.ydstogo <= 3),
    'third mid': (sk.down == 3) & sk.ydstogo.between(4, 9),
    'third long': (sk.down == 3) & (sk.ydstogo >= 10),
    'fourth': sk.down == 4,
    'trailing late': late & (sk.score_differential < 0),
    'leading late': late & (sk.score_differential > 0),
}
print('\nStrip-sacks per 100 sacks, lost per 100 (n):')
print('export const STRIP_NFL = {')
for name, m in SB.items():
    g = sk[m]
    print(f"  '{name}': [{100 * g.fumble.mean():.2f}, {100 * g.fumble_lost.mean():.2f}, {len(g)}],")
for grp in ('edge', 'DB', 'LB', 'interior'):
    g = sk[sk.group == grp]
    print(f"  '{grp}': [{100 * g.fumble.mean():.2f}, {100 * g.fumble_lost.mean():.2f}, {len(g)}],")
print('};')
sf = sk[sk.fumble == 1]
print(f'Forced share of sack fumbles: {sf.fumble_forced.mean():.3f} ({len(sf)})')
