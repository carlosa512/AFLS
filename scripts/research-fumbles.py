"""The NFL's contact fumbles by situation: the targets behind match/fumbleOdds.ts and the fumbles check.

python3 -I scripts/research-fumbles.py [cache dir, default work/nflverse]

nflverse play-by-play, regular seasons 2021-25 (missing seasons are downloaded into the cache). Touches: runs (no
scrambles or kneels), completions and scrambles that end in bounds without a touchdown; no two-point tries. A fumble is
the carrier's own (`fumbled_1_player_id`). Buckets read only what's known before the snap: a fumble ends the play where it
happens, so a short gain or a play short of the sticks would read fumble-heavy because of the fumble. Spec:
docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md.
"""
import sys
import urllib.request
from pathlib import Path

import pandas as pd

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/nflverse')
root.mkdir(parents=True, exist_ok=True)
for year in range(2021, 2026):
    f = root / f'play_by_play_{year}.csv.gz'
    if not f.exists():
        with urllib.request.urlopen(f'https://github.com/nflverse/nflverse-data/releases/download/pbp/{f.name}',
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
