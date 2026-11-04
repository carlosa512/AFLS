"""The NFL's out-of-bounds plays by situation: the targets behind match/sideline.ts and the sideline check.

python3 -I scripts/research-sideline.py [cache dir, default work/nflverse]

nflverse play-by-play, regular seasons 2021-25 (missing seasons are downloaded into the cache). Catches are completions;
runs leave out scrambles and kneels; all three leave out touchdowns, lost fumbles, two-point tries, plays a flag wiped out
and laterals. "Stepped" is the play text's `ran ob`, "pushed" its `pushed ob`. Tempo buckets use the engine's own rule
(`coach.tempo`); the engine's outside runs (left/right end) map to the NFL's runs at the end or the tackle. Spec:
docs/superpowers/specs/2026-11-04-out-of-bounds-choice-design.md, section 1.
"""
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/nflverse')
root.mkdir(parents=True, exist_ok=True)
BASE = 'https://github.com/nflverse/nflverse-data/releases/download/pbp'
for year in range(2021, 2026):
    f = root / f'play_by_play_{year}.csv.gz'
    if not f.exists():
        with urllib.request.urlopen(f'{BASE}/play_by_play_{year}.csv.gz', timeout=120) as r:
            f.write_bytes(r.read())

COLS = ['game_id', 'play_id', 'drive', 'season', 'season_type', 'play_type', 'qb_scramble', 'qb_kneel', 'qb_spike',
        'complete_pass', 'touchdown', 'fumble_lost', 'penalty', 'timeout', 'two_point_attempt', 'aborted_play',
        'lateral_reception', 'lateral_rush', 'qtr', 'quarter_seconds_remaining', 'score_differential', 'yardline_100',
        'desc', 'pass_location', 'run_gap', 'air_yards', 'yards_after_catch', 'yards_gained', 'ydstogo', 'down',
        'receiver_player_id', 'receiver_player_name', 'rusher_player_id', 'rusher_player_name',
        'solo_tackle_1_player_id', 'assist_tackle_1_player_id']
raw = pd.concat([pd.read_csv(f, usecols=COLS, low_memory=False) for f in sorted(root.glob('play_by_play_*.csv.gz'))])
raw = raw[raw.season_type == 'REG'].sort_values(['game_id', 'play_id'])

# The clock needs every play in order (timeouts included) before anything is filtered out.
nxt = raw.groupby('game_id').shift(-1)
raw['gap'] = raw.quarter_seconds_remaining - nxt.quarter_seconds_remaining
raw['gap_ok'] = ((nxt.qtr == raw.qtr) & (nxt.drive == raw.drive) & (nxt.timeout != 1) & (nxt.penalty != 1)
                 & nxt.play_type.isin(['pass', 'run']) & (raw.penalty != 1) & (nxt.quarter_seconds_remaining > 0))

p = raw[raw.play_type.isin(['pass', 'run']) & (raw.two_point_attempt != 1) & (raw.aborted_play != 1)
        & (raw.lateral_reception != 1) & (raw.lateral_rush != 1) & ~raw.desc.str.contains('No Play', na=False)
        & (raw.touchdown != 1) & (raw.fumble_lost != 1)].copy()
p['ran'] = p.desc.str.contains('ran ob', na=False)
p['pushed'] = p.desc.str.contains('pushed ob', na=False)
p['oob'] = p.ran | p.pushed
p['how'] = np.where(p.ran, 'stepped out', np.where(p.pushed, 'pushed out', 'in bounds'))
p['tackler'] = p.solo_tackle_1_player_id.notna() | p.assist_tackle_1_player_id.notna()
q, clk, sd, own = p.qtr, p.quarter_seconds_remaining, p.score_differential, 100 - p.yardline_100
hurry = ((q >= 4) & (sd < 0) & (clk <= 300)) | ((q == 4) & (sd == 0) & (clk <= 120) & (own >= 35)) \
    | ((q == 5) & (sd == 0) & (clk <= 360)) | ((q == 2) & (clk <= 120) & (own >= 25))
milk = ~hurry & (((q >= 4) & (sd > 0) & (clk <= 420)) | ((q >= 3) & (sd >= 17)))
p['tempo'] = np.where(hurry, 'hurry', np.where(milk, 'milk', 'normal'))
p['window'] = ((q == 2) & (clk <= 120)) | ((q >= 4) & (clk <= 300))
p['two_min'] = ((q >= 4) & (sd < 0) & (clk <= 300)) | ((q == 2) & (clk <= 120))

catch = p[(p.play_type == 'pass') & (p.complete_pass == 1)]
run = p[(p.play_type == 'run') & (p.qb_scramble != 1) & (p.qb_kneel != 1)]
scr = p[(p.play_type == 'run') & (p.qb_scramble == 1)]
side = catch.pass_location.isin(['left', 'right'])
outside = run.run_gap.isin(['end', 'tackle'])


def line(name, d):
    if len(d):
        print(f'  {name:<36} n={len(d):>6}  out {100*d.oob.mean():5.1f}%  pushed {100*d.pushed.mean():5.1f}%'
              f'  stepped {100*d.ran.mean():5.1f}%')


def table(title, d, rows):
    print(f'\n== {title}')
    for name, m in rows:
        line(name, d[m])


T = lambda d: d.index == d.index  # noqa: E731
table('Catches', catch, [
    ('all', T(catch)), ('normal tempo', catch.tempo == 'normal'), ('hurrying', catch.tempo == 'hurry'),
    ('protecting a lead', catch.tempo == 'milk'),
    ('Q4 last 5:00, leading', (catch.qtr >= 4) & (catch.quarter_seconds_remaining <= 300) & (catch.score_differential > 0)),
    ('to the sideline (left/right)', side), ('to the middle', ~side),
    ('yards after the catch 0-2', catch.yards_after_catch <= 2),
    ('yards after the catch 3-9', (catch.yards_after_catch >= 3) & (catch.yards_after_catch < 10)),
    ('yards after the catch 10+', catch.yards_after_catch >= 10),
    ('3rd/4th, short of the sticks', catch.down.isin([3, 4]) & (catch.yards_gained < catch.ydstogo)),
    ('3rd/4th, past the sticks', catch.down.isin([3, 4]) & (catch.yards_gained >= catch.ydstogo)),
])
g = run.yards_gained
table('Runs (outside = end or tackle)', run, [
    ('all', T(run)), ('outside', outside), ('inside', ~outside),
    ('outside, normal tempo', outside & (run.tempo == 'normal')), ('outside, hurrying', outside & (run.tempo == 'hurry')),
    ('outside, protecting a lead', outside & (run.tempo == 'milk')),
    ('outside, no gain or a loss', outside & (g <= 0)), ('outside, 1-9 yards', outside & (g >= 1) & (g < 10)),
    ('outside, 10+ yards', outside & (g >= 10)), ('outside, 20+ yards', outside & (g >= 20)),
    ('inside, 10+ yards', ~outside & (g >= 10)),
])
table('Scrambles', scr, [
    ('all', T(scr)), ('normal tempo', scr.tempo == 'normal'), ('hurrying', scr.tempo == 'hurry'),
    ('protecting a lead', scr.tempo == 'milk'),
    ('1-9 yards', (scr.yards_gained >= 1) & (scr.yards_gained < 10)), ('10+ yards', scr.yards_gained >= 10),
])
tg = 2 * raw.game_id.nunique()
print(f'\nPer team-game: catches out {catch.oob.sum()/tg:.2f}, runs {run.oob.sum()/tg:.2f}, scrambles {scr.oob.sum()/tg:.2f}')

print('\n== Between players (normal play; stepped-out share, its spread net of luck)')
normal = p[~p.two_min]
for title, d, who, name, minn in [
    ('sideline catches (150+)', normal[(normal.play_type == 'pass') & (normal.complete_pass == 1)
                                      & normal.pass_location.isin(['left', 'right'])], 'receiver_player_id', 'receiver_player_name', 150),
    ('runs to the end (100+)', normal[(normal.play_type == 'run') & (normal.qb_scramble != 1) & (normal.qb_kneel != 1)
                                     & (normal.run_gap == 'end')], 'rusher_player_id', 'rusher_player_name', 100),
    ('scrambles (60+)', normal[(normal.play_type == 'run') & (normal.qb_scramble == 1)], 'rusher_player_id', 'rusher_player_name', 60),
]:
    gr = d.groupby(who).agg(n=('ran', 'size'), ran=('ran', 'mean'), nm=(name, 'first'))
    gr = gr[gr.n >= minn]
    m = (gr.ran * gr.n).sum() / gr.n.sum()
    real = np.sqrt(max(0.0, gr.ran.var() - (m * (1 - m) / gr.n).mean()))
    top = gr.sort_values('ran', ascending=False)
    print(f'  {title:<26} men {len(gr):>3}  average {100*m:4.1f}%  real sd {100*real:4.1f} (x{real/m:.2f} of the average)')
    print('    most:', ', '.join(f'{r.nm} {100*r.ran:.0f}%' for r in top.head(3).itertuples()),
          '| least:', ', '.join(f'{r.nm} {100*r.ran:.0f}%' for r in top.tail(3).itertuples()))

print('\n== How each ending is scored (normal play)')
nc = normal[(normal.play_type == 'pass') & (normal.complete_pass == 1) & normal.pass_location.isin(['left', 'right'])]
for how in ['in bounds', 'pushed out', 'stepped out']:
    x = nc[nc.how == how]
    kinds = []
    for d in [nc, normal[(normal.play_type == 'run') & (normal.qb_scramble != 1) & (normal.run_gap == 'end')],
              normal[(normal.play_type == 'run') & (normal.qb_scramble == 1)]]:
        kinds.append(f'{100*d[d.how == how].tackler.mean():.0f}%')
    print(f'  {how:<12} sideline catches: yards after the catch median {x.yards_after_catch.median():.0f}'
          f'   tackle credited (catches / end runs / scrambles): {" / ".join(kinds)}')

print('\n== The clock: game clock from one snap to the next (no timeout or flag between)')
c = p[p.gap_ok]
for title, d in [('sideline catches', c[(c.play_type == 'pass') & (c.complete_pass == 1) & c.pass_location.isin(['left', 'right'])]),
                 ('runs at the end or tackle', c[(c.play_type == 'run') & (c.qb_scramble != 1) & c.run_gap.isin(['end', 'tackle'])])]:
    for name, m in [('Q1-Q3, normal', (d.qtr <= 3) & ~d.two_min), ('inside the late windows', d.window),
                    ('overtime, last 5:00', (d.qtr == 5) & (d.quarter_seconds_remaining <= 300))]:
        x = d[m]
        print(f'  {title:<26} {name:<24}' + ' | '.join(
            f'{h} {x[x.how == h].gap.mean():4.1f} s (n={len(x[x.how == h])})' for h in ['in bounds', 'pushed out', 'stepped out']))
f = c[(c.play_type == 'pass') & (c.complete_pass == 1) & (c.qtr <= 3) & ~c.two_min & (c.how == 'in bounds')]
print(f'  first downs, Q1-Q3 catches in bounds: {f[f.desc.notna() & (f.yards_gained >= f.ydstogo)].gap.median():.0f} s with one,'
      f' {f[f.yards_gained < f.ydstogo].gap.median():.0f} s without')
