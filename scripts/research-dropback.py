"""How a play ends in the NFL: a sack's yards and a scramble's ending. The targets behind match/dropbackEnd.ts.

python3 -I scripts/research-dropback.py [cache dir, default work/nflverse]

nflverse play-by-play 2021-25 (regular seasons), participation (rushers) and FTN charting (out of the pocket) 2022-25;
missing play-by-play files are downloaded into the cache. Spec: docs/superpowers/specs/2026-11-07-dropback-endings-design.md.
"""
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/nflverse')
root.mkdir(parents=True, exist_ok=True)
for year in range(2021, 2026):
    f = root / f'play_by_play_{year}.csv.gz'
    if not f.exists():
        with urllib.request.urlopen(f'https://github.com/nflverse/nflverse-data/releases/download/pbp/{f.name}',
                                    timeout=300) as r:
            f.write_bytes(r.read())

COLS = ['game_id', 'play_id', 'season_type', 'sack', 'qb_scramble', 'yards_gained', 'down', 'ydstogo', 'yardline_100',
        'passer_player_id', 'safety', 'out_of_bounds', 'touchdown', 'solo_tackle', 'assist_tackle', 'tackle_with_assist']
d = pd.concat([pd.read_csv(f, usecols=COLS, low_memory=False) for f in sorted(root.glob('play_by_play_202[1-5].csv.gz'))])
d = d[d.season_type == 'REG']
s = d[d.sack == 1].copy()
s['loss'] = (-s.yards_gained).clip(lower=0)

print(f'Sacks: {len(s)}, loss mean {s.loss.mean():.2f} sd {s.loss.std():.2f}; no loss {(s.loss <= 0).mean():.3f}, '
      f'10+ {(s.loss >= 10).mean():.3f}, 15+ {(s.loss >= 15).mean():.3f}; safeties per 1,000 {1000 * s.safety.mean():.1f}')


def hist(x):
    return [round(float(((x.round() == k) if k < 15 else (x.round() >= 15)).mean()), 4) for k in range(16)]


ftn = [root / f'ftn_charting_{y}.csv' for y in range(2022, 2026)]
f = pd.concat([pd.read_csv(x, low_memory=False, usecols=['nflverse_game_id', 'nflverse_play_id', 'is_qb_out_of_pocket'])
               for x in ftn if x.exists()]).rename(columns={'nflverse_game_id': 'game_id', 'nflverse_play_id': 'play_id'})
m = s.merge(f, on=['game_id', 'play_id'], how='inner')
out = m.is_qb_out_of_pocket.astype(bool)
print(f'Out of the pocket (FTN 2022-25): {out.mean():.3f} of {len(m)} sacks; mean in {m[~out].loss.mean():.2f}, '
      f'out {m[out].loss.mean():.2f}')
print('const SACK_LOSS_NFL = {  // shares of 0..14 and 15+ yards')
print(f'  pocket: {hist(m[~out].loss)}, // n {(~out).sum()}')
print(f'  out: {hist(m[out].loss)}, // n {out.sum()}')
print('};')

print('Mean loss by down:', {int(k): (round(v.mean(), 2), len(v)) for k, v in s.groupby(s.down.clip(1, 4)).loss})
t = s[s.down == 3]
print(f'3rd and 8+: {t[t.ydstogo >= 8].loss.mean():.2f} ({(t.ydstogo >= 8).sum()}); under 8: '
      f'{t[t.ydstogo < 8].loss.mean():.2f} ({(t.ydstogo < 8).sum()})')
spot = pd.cut(s.yardline_100, [0, 80, 90, 95, 100], labels=['own 21+', 'own 11-20', 'own 6-10', 'own 1-5'])
print('Mean loss by spot:', {k: (round(v.mean(), 2), len(v)) for k, v in s.groupby(spot, observed=True).loss})
p = pd.concat([pd.read_csv(x, low_memory=False, usecols=['nflverse_game_id', 'play_id', 'number_of_pass_rushers'])
               for x in sorted(root.glob('pbp_participation_202[2-5].csv'))]).rename(columns={'nflverse_game_id': 'game_id'})
r = s.merge(p, on=['game_id', 'play_id'], how='inner')
print('Mean loss by rushers:', {int(k): (round(v.mean(), 2), len(v)) for k, v in r.groupby(r.number_of_pass_rushers.clip(3, 6)).loss})
q = s.groupby('passer_player_id').loss.agg(['mean', 'count'])
q = q[q['count'] >= 40]
print(f'QBs with 40+ sacks: {len(q)}; sd of means {q["mean"].std():.2f}, luck {(s.loss.std() / np.sqrt(q["count"])).mean():.2f}')

c = d[(d.qb_scramble == 1) & (d.out_of_bounds != 1) & (d.touchdown != 1)]
tackled = (c.solo_tackle == 1) | (c.assist_tackle == 1) | (c.tackle_with_assist == 1)
print(f'\nScrambles in bounds without a touchdown: {len(c)}; a tackler credited {tackled.mean():.3f}')
