"""A play's time, the half's last possession, the two-point try and returns in the NFL: the targets behind
match/playTime.ts, match/twoPoint.ts and match/returns.ts.

python3 -I scripts/research-situations.py [cache dir, default work/nflverse]

nflverse play-by-play 2021-25 (regular seasons); missing files are downloaded into the cache.
Spec: docs/superpowers/specs/2026-11-07-a-plays-time-design.md.
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

COLS = ['game_id', 'play_id', 'season', 'season_type', 'drive', 'qtr', 'quarter_seconds_remaining',
        'half_seconds_remaining', 'yardline_100', 'posteam', 'posteam_timeouts_remaining', 'score_differential',
        'play_type', 'incomplete_pass', 'complete_pass', 'air_yards', 'yards_gained', 'out_of_bounds', 'touchdown',
        'interception', 'fumble', 'fumble_lost', 'penalty', 'timeout', 'rush_attempt', 'pass_attempt', 'qb_scramble',
        'sack', 'kickoff_attempt', 'punt_attempt', 'return_yards', 'return_touchdown', 'touchback', 'punt_fair_catch',
        'kickoff_fair_catch', 'kickoff_returner_player_id', 'punt_returner_player_id', 'two_point_attempt',
        'two_point_conv_result', 'extra_point_attempt', 'fixed_drive_result', 'desc']
d = pd.concat([pd.read_csv(f, usecols=COLS, low_memory=False) for f in sorted(root.glob('play_by_play_202[1-5].csv.gz'))])
d = d[(d.season_type == 'REG') & d.play_type.notna()].sort_values(['game_id', 'play_id'])

# ───────────── A play's time: plays after which the clock stopped, so the time to the next snap is the play's own.
t = d[(d.extra_point_attempt != 1) & (d.two_point_attempt != 1)].copy()
t['nq'] = t.groupby('game_id').qtr.shift(-1)
t['dur'] = t.quarter_seconds_remaining - t.groupby('game_id').quarter_seconds_remaining.shift(-1)
t = t[(t.nq == t.qtr) & (t.penalty != 1) & (t.timeout != 1) & (t.dur >= 0) & (t.dur <= 25)]
YB = [-99, 4, 9, 19, 39, 99]
YL = ['<5', '5-9', '10-19', '20-39', '40+']


def means(x, by, labels):
    g = x.groupby(by, observed=True).dur.agg(['count', 'mean'])
    return {str(k): [round(float(v['mean']), 2), int(v['count'])] for k, v in g.iterrows() if str(k) in labels}


inc = t[(t.incomplete_pass == 1) & (t.interception != 1)]
inc = inc.assign(b=pd.cut(inc.air_yards, [-99, 0, 9, 19, 99], labels=['behind', '0-9', '10-19', '20+']))
late = ((t.qtr == 2) & (t.quarter_seconds_remaining <= 120)) | ((t.qtr == 4) & (t.quarter_seconds_remaining <= 300))
ob = t[late & (t.out_of_bounds == 1) & (t.fumble != 1)]
ob = ob.assign(b=pd.cut(ob.yards_gained, YB, labels=YL))
td = t[(t.touchdown == 1) & t.play_type.isin(['run', 'pass']) & (t.interception != 1) & (t.fumble != 1)]
td = td.assign(b=pd.cut(td.yards_gained, [-1, 4, 9, 19, 39, 99], labels=YL))
ko = t[(t.kickoff_attempt == 1) & (t.return_yards > 0) & (t.touchdown != 1) & (t.fumble != 1)]
pu = t[(t.punt_attempt == 1) & (t.return_yards > 0) & (t.touchdown != 1) & (t.fumble != 1)]
pf = t[(t.punt_attempt == 1) & (t.punt_fair_catch == 1)]
print('export const TIME_NFL = {')
print(f'  incomplete: {means(inc, "b", ["behind", "0-9", "10-19", "20+"])},')
print(f'  incompleteAll: [{inc.dur.mean():.2f}, {len(inc)}], incompleteP10P90: [{inc.dur.quantile(.1):.0f}, {inc.dur.quantile(.9):.0f}],')
print(f'  catchTd: {means(td[td.complete_pass == 1], "b", YL)},')
print(f'  runTd: {means(td[(td.rush_attempt == 1) & (td.qb_scramble != 1)], "b", YL)},')
print(f'  catchOutLate: {means(ob[ob.complete_pass == 1], "b", YL)},')
print(f'  runOutLate: {means(ob[(ob.rush_attempt == 1) & (ob.qb_scramble != 1)], "b", YL)},')
print(f'  puntReturned: [{pu.dur.mean():.2f}, {len(pu)}], fairCatch: [{pf.dur.mean():.2f}, {len(pf)}],')
print(f'  kickoffReturned: [{ko.dur.mean():.2f}, {len(ko)}],')
print('};')

# ───────────── The half's last possession: the first scrimmage snap of drives with 75 s or less in the 2nd quarter.
h = d[(d.qtr == 2) & d.play_type.isin(['run', 'pass', 'qb_kneel', 'qb_spike', 'field_goal', 'punt'])]
f = h.groupby(['game_id', 'drive']).head(1)
f = f[f.half_seconds_remaining <= 75].copy()
f['kneel'] = (f.play_type == 'qb_kneel').astype(int)
f['own'] = 100 - f.yardline_100
f['to'] = f.posteam_timeouts_remaining.clip(upper=3)
f['tb'] = pd.cut(f.half_seconds_remaining, [-1, 20, 40, 60, 75], labels=['<=20', '21-40', '41-60', '61-75'])
f['ob'] = pd.cut(f.own, [0, 25, 35, 50, 100], labels=['own 1-25', 'own 26-35', 'own 36-50', 'plus'])


def shares(x, by):
    g = x.groupby(by, observed=True).kneel.agg(['count', 'mean'])
    return {str(k): [round(float(v['mean']), 3), int(v['count'])] for k, v in g.iterrows()}


tried = f[(f.kneel == 0) & (f.own <= 35)]
ends = tried.fixed_drive_result.value_counts(normalize=True)
print('export const HALF_NFL = {')
print(f'  all: [{f.kneel.mean():.3f}, {len(f)}],')
print(f'  byClock: {shares(f, "tb")},')
print(f'  bySpot: {shares(f, "ob")},')
print(f'  byScore: {shares(f, np.sign(f.score_differential))},')
for tb in ['<=20', '21-40']:
    print(f'  timeouts{tb.replace("<=", "Under").replace("-", "to")}: {shares(f[(f.tb == tb) & (f.own <= 35)], "to")},')
print(f'  triedFromDeep: {{ n: {len(tried)}, ' + ', '.join(f"'{k}': {v:.3f}" for k, v in ends.items()) + ' },')
# The kneel's logistic fit inside the own 50: kneel ~ clock + timeouts + [own 36-50] (Newton's method).
x = f[f.own < 50]
X = np.column_stack([np.ones(len(x)), x.half_seconds_remaining, x.to, (x.own > 35).astype(float)])
y = x.kneel.to_numpy(float)
b = np.zeros(4)
for _ in range(50):
    p = 1 / (1 + np.exp(-X @ b))
    b += np.linalg.solve(X.T @ (X * (p * (1 - p))[:, None]) + 1e-9 * np.eye(4), X.T @ (y - p))
print(f'  fit: {{ HALF_BASE: {b[0]:.3f}, HALF_CLOCK: {b[1]:.4f}, HALF_TIMEOUT: {b[2]:.3f}, HALF_SPOT: {b[3]:.3f} }},')
team = f[(f.own <= 35) & f.tb.isin(['21-40', '41-60']) & (f.to >= 2)].copy()
team['season'] = h.season.iloc[0] if 'season' not in team else team.season
gs = team.groupby(['posteam', 'season']).kneel.agg(['count', 'mean'])
gs = gs[gs['count'] >= 3]
pm = team.kneel.mean()
print(f'  coachSpread: [{gs["mean"].std():.3f}, {np.sqrt((pm * (1 - pm) / gs["count"]).mean()):.3f}],')
print('};')

# ───────────── The two-point try.
tr = d[(d.two_point_attempt == 1) | (d.extra_point_attempt == 1)].copy()
tr['two'] = (tr.two_point_attempt == 1).astype(int)
tr['late'] = tr.qtr >= 4


def table(x):
    g = x.groupby('score_differential').two.agg(['count', 'mean'])
    g = g[g['count'] >= 30]
    return '{ ' + ', '.join(f"'{int(k)}': [{v['mean']:.2f}, {int(v['count'])}]" for k, v in g.iterrows()) + ' }'


tp = d[d.two_point_attempt == 1].copy()
tp['ok'] = (tp.two_point_conv_result == 'success').astype(int)
runs = tp[(tp.rush_attempt == 1) & (tp.qb_scramble != 1)]
passes = tp[(tp.pass_attempt == 1) | (tp.qb_scramble == 1)]
dtwo = d.desc.str.contains('DEFENSIVE TWO-POINT', na=False).sum()
early = tr[~tr.late]
gs = early.groupby(['posteam', 'season']).two.agg(['count', 'mean'])
pe = early.two.mean()
print('export const TWO_NFL = {')
print(f'  all: [{tr.two.mean():.3f}, {len(tr)}], early: [{early.two.mean():.3f}, {len(early)}], '
      f'late: [{tr[tr.late].two.mean():.3f}, {int(tr.late.sum())}],')
print(f'  earlyByDiff: {table(early)},')
print(f'  lateByDiff: {table(tr[tr.late])},')
print(f'  success: [{tp.ok.mean():.3f}, {len(tp)}], run: [{runs.ok.mean():.3f}, {len(runs)}], '
      f'pass: [{passes.ok.mean():.3f}, {len(passes)}], runShare: {len(runs) / len(tp):.3f},')
print(f'  defensiveTwo: [{dtwo / len(tp):.3f}, {dtwo}],')
print(f'  coachSpread: [{gs["mean"].std():.3f}, {np.sqrt((pe * (1 - pe) / gs["count"]).mean()):.3f}],')
print('};')

# ───────────── Returns: kickoffs on the 2025 rules (touchback to the 35), punts 2021-25.
k = d[(d.kickoff_attempt == 1) & (d.season == 2025)]
kr = k[(k.touchback != 1) & k.kickoff_returner_player_id.notna() & (k.kickoff_fair_catch != 1)]
p = d[d.punt_attempt == 1]
pr = p[p.punt_returner_player_id.notna() & (p.punt_fair_catch != 1) & (p.touchback != 1)]
print('export const RETURN_NFL = {')
for name, r, pid in [('kickoff', kr, 'kickoff_returner_player_id'), ('punt', pr, 'punt_returner_player_id')]:
    y = r.return_yards.fillna(0)
    q = [round(float(y.quantile(i / 100)), 1) for i in range(101)]
    g = r.groupby(pid).return_yards.agg(['count', 'mean'])
    g = g[g['count'] >= 30]
    print(f'  {name}: {{ n: {len(r)}, mean: {y.mean():.2f}, sd: {y.std():.2f}, '
          f'over20: {(y >= 20).mean():.4f}, over40: {(y >= 40).mean():.4f}, over60: {(y >= 60).mean():.4f}, '
          f'td: {r.return_touchdown.mean():.4f}, tds: {int(r.return_touchdown.sum())},')
    print(f'    spread: [{g["mean"].std():.2f}, {np.sqrt((y.std() ** 2 / g["count"]).mean()):.2f}, {len(g)}],')
    print(f'    quantiles: {q} }},')
print('};')
