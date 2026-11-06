"""The NFL passer's choices under pressure and from a clean pocket: the targets behind match/pocketChoice.ts and the
passer check.

python3 -I scripts/research-passer.py [cache dir, default work/nflverse]

FTN charting (`is_throw_away`, `is_qb_out_of_pocket`) joined to NGS participation (`was_pressure`) and nflverse
play-by-play, regular seasons 2023-25 (2022's participation file reads no pressure on any sack or scramble, so it is left out;
missing files are downloaded into the cache), per play.
Dropbacks (`qb_dropback`) without spikes or two-point tries, with a pressure reading. A dropback is a sack, a scramble
(`qb_scramble`), a throwaway (FTN), or a throw. Spec: docs/superpowers/specs/2026-11-05-passer-under-pressure-design.md.
"""
import sys
import urllib.request
from pathlib import Path

import pandas as pd

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/nflverse')
root.mkdir(parents=True, exist_ok=True)
YEARS = (2023, 2024, 2025)
REL = 'https://github.com/nflverse/nflverse-data/releases/download'
for year in YEARS:
    for tag, name in (('pbp', f'play_by_play_{year}.csv.gz'), ('ftn_charting', f'ftn_charting_{year}.csv'),
                      ('pbp_participation', f'pbp_participation_{year}.csv')):
        f = root / name
        if not f.exists():
            with urllib.request.urlopen(f'{REL}/{tag}/{name}', timeout=300) as r:
                f.write_bytes(r.read())

COLS = ['game_id', 'play_id', 'season_type', 'qb_dropback', 'qb_spike', 'two_point_attempt', 'sack', 'qb_scramble',
        'down', 'ydstogo', 'yardline_100', 'score_differential', 'game_seconds_remaining', 'desc', 'safety',
        'passer_player_id', 'rusher_player_id']
pbp = pd.concat([pd.read_csv(root / f'play_by_play_{y}.csv.gz', usecols=COLS, low_memory=False) for y in YEARS])
pbp = pbp[pbp.season_type == 'REG']
games = pbp.game_id.nunique()
ftn = pd.concat([pd.read_csv(root / f'ftn_charting_{y}.csv', low_memory=False) for y in YEARS])
ftn = ftn.rename(columns={'nflverse_game_id': 'game_id', 'nflverse_play_id': 'play_id'})[
    ['game_id', 'play_id', 'is_throw_away', 'is_qb_out_of_pocket']]
part = pd.concat([pd.read_csv(root / f'pbp_participation_{y}.csv', usecols=['nflverse_game_id', 'play_id', 'was_pressure'],
                              low_memory=False) for y in YEARS]).rename(columns={'nflverse_game_id': 'game_id'})
pbp['play_id'] = pbp.play_id.astype(int)
for df in (ftn, part):
    df['play_id'] = df.play_id.astype(int)

truthy = lambda s: s.astype(str).str.lower().isin(['true', '1', '1.0'])
grounded = pbp.desc.str.lower().str.contains('intentional grounding', na=False)

d = pbp[(pbp.qb_dropback == 1) & (pbp.qb_spike != 1) & (pbp.two_point_attempt != 1)]
d = d.merge(ftn, on=['game_id', 'play_id']).merge(part, on=['game_id', 'play_id'])
d = d[d.was_pressure.notna() & (d.was_pressure.astype(str) != '')]
# A season whose pressure readings skip sacks or scrambles would bias every share: refuse it.
for season, s in d.groupby(d.game_id.str[:4]):
    assert (s.sack == 1).any() and (s.qb_scramble == 1).any(), f'{season}: no pressure reading on sacks or scrambles'
d['pressured'] = truthy(d.was_pressure)
d['away'] = truthy(d.is_throw_away)
d['outside'] = truthy(d.is_qb_out_of_pocket)
d['outcome'] = 'throw'
d.loc[d.away, 'outcome'] = 'away'
d.loc[d.qb_scramble == 1, 'outcome'] = 'run'
d.loc[d.sack == 1, 'outcome'] = 'sack'
# A man's scrambles carry his id as the rusher, his throws as the passer: one key either way.
d['qb'] = d.passer_player_id.fillna(d.rusher_player_id)
d['season'] = d.game_id.str[:4]

late = d.game_seconds_remaining <= 300
BUCKETS = {
    'all': d.down.notna() | d.down.isna(),
    'early': d.down.isin([1, 2]),
    'third short': (d.down == 3) & (d.ydstogo <= 3),
    'third mid': (d.down == 3) & d.ydstogo.between(4, 9),
    'third long': (d.down == 3) & (d.ydstogo >= 10),
    'fourth': d.down == 4,
    'red zone': d.yardline_100 <= 20,
    'backed up': d.yardline_100 >= 90,
    'trailing late': late & d.score_differential.between(-16, -1),
    'leading late': late & (d.score_differential > 0),
}
print(f'Dropbacks joined: {len(d):,} ({games} games). Shares: sack, scramble, throwaway (n).')
print('export const PASSER_NFL = {')
for side, mask in (('pressured', d.pressured), ('clean', ~d.pressured)):
    print(f'  {side}: {{')
    for name, b in BUCKETS.items():
        s = d[mask & b]
        share = lambda o: round(float((s.outcome == o).mean()), 4)
        print(f"    '{name}': [{share('sack')}, {share('run')}, {share('away')}, {len(s)}],")
    print('  },')
print('};')

aw = d[d.away]
print(f'\nThrowaways from outside the pocket: all {aw.outside.mean():.3f}, pressured {aw[aw.pressured].outside.mean():.3f}, '
      f'clean {aw[~aw.pressured].outside.mean():.3f} (n {len(aw)})')

g = pbp[grounded]
gd = d[d.desc.str.lower().str.contains('intentional grounding', na=False)]
print(f'Grounding: {len(g) / games:.3f} a game ({len(g)} in {games} games), safeties from it {int((g.safety == 1).sum())} '
      f'({(g.safety == 1).sum() / len(YEARS):.1f} a season)')
print(f'  of those joined ({len(gd)}): pressured {gd.pressured.mean():.3f}, inside the pocket {(~gd.outside).mean():.3f}')
for name, s in (('inside, pressured', aw[~aw.outside & aw.pressured]), ('outside', aw[aw.outside]),
                ('clean', aw[~aw.pressured])):
    flagged = s.desc.str.lower().str.contains('intentional grounding', na=False).mean()
    print(f'  flagged among throwaways {name}: {flagged:.3f} (n {len(s)})')

qb = d.groupby(['season', 'qb']).agg(n=('outcome', 'size'), run=('outcome', lambda o: (o == 'run').mean()),
                                     away=('outcome', lambda o: (o == 'away').mean()))
qb = qb[qb.n >= 250]
print(f'\nPassers with 250+ dropbacks: {len(qb)} seasons')
for col in ('run', 'away'):
    q = qb[col]
    print(f'  {col}: median {q.median():.3f}, p10 {q.quantile(0.1):.3f}, p90 {q.quantile(0.9):.3f}, sd {q.std(ddof=0):.4f}')
