"""NFL aging curves by the delta method (each player against himself, season to next season), 2013-2025.
Snap share by position (scrimmage snaps over the team's snaps in its games) and, where nflverse has it, EPA per play.
The curve is the running sum of the mean year-to-year change at each age (weighted by the pair's harmonic-mean volume);
its peak is where it tops out. Research input for the careers check's peak ages (docs/research/league-age.md).

python3 -I scripts/research-peaks.py [--data work/nfl-aging]   (download with scripts/research-aging.py --download, plus
stats_player_reg_{2013..2025}.csv from nflverse's stats_player release)"""
import collections, csv, datetime, sys
from pathlib import Path
root = Path(sys.argv[sys.argv.index('--data') + 1] if '--data' in sys.argv else 'work/nfl-aging')
def load(n):
    with (root / n).open() as s:
        return list(csv.DictReader(s))
MAP = {'QB':'QB','RB':'RB','HB':'RB','WR':'WR','TE':'TE','T':'OL','G':'OL','C':'OL','OT':'OL','OG':'OL','OL':'OL','DT':'DT','NT':'DT','DE':'EDGE','OLB':'EDGE','LB':'LB','ILB':'LB','MLB':'LB','CB':'CB','DB':'CB','S':'S','FS':'S','SS':'S','SAF':'S'}
SIDE = {**{x:'offense' for x in ('QB','RB','WR','TE','OL')}, **{x:'defense' for x in ('DT','EDGE','LB','CB','S')}}
players = load('players.csv')
birth_pfr = {r['pfr_id']: r['birth_date'] for r in players if r.get('pfr_id') and r.get('birth_date')}
birth_gsis = {r['gsis_id']: r['birth_date'] for r in players if r.get('gsis_id') and r.get('birth_date')}
def age(b, y):
    return int((datetime.date(y, 9, 1) - datetime.date.fromisoformat(b[:10])).days / 365.25)
YEARS = range(2013, 2026)

# ---- Snap share: a player's side snaps over his team's side snaps in the team's games.
share = {}   # (pid, y) -> (pos, share, snaps)
for y in YEARS:
    rows = [r for r in csv.DictReader((root / f'snap_counts_{y}.csv').open()) if r['game_type'] == 'REG']
    team_game = collections.defaultdict(float)  # (team, game, side) -> team snaps (most by any player)
    for r in rows:
        for side in ('offense', 'defense'):
            n = float(r[f'{side}_snaps'] or 0)
            k = (r['team'], r['game_id'], side)
            team_game[k] = max(team_game[k], n)
    team_total = collections.defaultdict(float)
    for (t, g, side), n in team_game.items():
        team_total[(t, side)] += n
    acc = collections.defaultdict(lambda: [None, 0.0, collections.Counter()])
    for r in rows:
        pos = MAP.get(r['position'])
        if not pos:
            continue
        a = acc[r['pfr_player_id']]
        a[0] = pos
        a[1] += float(r[f'{SIDE[pos]}_snaps'] or 0)
        a[2][r['team']] += 1
    for pid, (pos, n, teams) in acc.items():
        t = teams.most_common(1)[0][0]
        tot = team_total[(t, SIDE[pos])]
        if tot > 0:
            share[(pid, y)] = (pos, min(1.0, n / tot), n)

def curve(pairs, lo=21, hi=36):
    """pairs: (age at y, delta, weight). Returns {age: level} with level 0 at lo."""
    by = collections.defaultdict(lambda: [0.0, 0.0])
    for a, d, w in pairs:
        by[a][0] += d * w
        by[a][1] += w
    level, out = 0.0, {lo: 0.0}
    for a in range(lo, hi):
        if by[a][1] > 0:
            level += by[a][0] / by[a][1]
        out[a + 1] = level
    return out, {a: round(v[1]) for a, v in by.items()}

def report(name, c, n, lo=22, hi=35):
    ages = [a for a in range(lo, hi + 1) if a in c]
    peak = max(ages, key=lambda a: c[a])
    top = c[peak]
    near = [a for a in ages if top - c[a] <= 0.1 * (top - min(c[a] for a in ages))]
    print(f'{name:22} peak {peak} (within a tenth of the rise: {min(near)}–{max(near)})  ' +
          ' '.join(f'{a}:{c[a] - top:+.2f}' for a in ages))

print('# Snap share, delta method (pairs with 100+ snaps both seasons, same position)')
for pos in ('QB', 'RB', 'WR', 'TE', 'OL', 'DT', 'EDGE', 'LB', 'CB', 'S'):
    pairs = []
    for (pid, y), (p, s, n) in share.items():
        if p != pos or (pid, y + 1) not in share:
            continue
        p2, s2, n2 = share[(pid, y + 1)]
        b = birth_pfr.get(pid)
        if p2 != pos or not b or n < 100 or n2 < 100:
            continue
        pairs.append((age(b, y), s2 - s, 2 * n * n2 / (n + n2)))
    c, n = curve(pairs)
    report(f'{pos} snap share', c, n)

# ---- EPA per play from seasonal stats (gsis ids).
stats = {}
for y in YEARS:
    for r in csv.DictReader((root / f'stats_player_reg_{y}.csv').open()):
        if r.get('season_type', 'REG') != 'REG':
            continue
        stats[(r['player_id'], y)] = r
def num(r, k):
    try:
        return float(r.get(k) or 0)
    except ValueError:
        return 0.0
METRICS = {
    'QB EPA/dropback': ('QB', lambda r: (num(r, 'passing_epa') + num(r, 'rushing_epa'), num(r, 'attempts') + num(r, 'sacks_suffered') + num(r, 'carries')), 200),
    'RB EPA/carry': ('RB', lambda r: (num(r, 'rushing_epa'), num(r, 'carries')), 80),
    'WR EPA/target': ('WR', lambda r: (num(r, 'receiving_epa'), num(r, 'targets')), 40),
    'TE EPA/target': ('TE', lambda r: (num(r, 'receiving_epa'), num(r, 'targets')), 30),
}
print('\n# EPA per play, delta method (pairs with the volume shown both seasons)')
for name, (pos, f, minv) in METRICS.items():
    pairs = []
    for (pid, y), r in stats.items():
        if r.get('position') != pos or (pid, y + 1) not in stats:
            continue
        r2 = stats[(pid, y + 1)]
        e1, v1 = f(r)
        e2, v2 = f(r2)
        b = birth_gsis.get(pid)
        if not b or v1 < minv or v2 < minv:
            continue
        pairs.append((age(b, y), e2 / v2 - e1 / v1, 2 * v1 * v2 / (v1 + v2)))
    c, n = curve(pairs)
    report(name, c, n)
    print(f'{"":22} pairs by age: ' + ' '.join(f'{a}:{n.get(a, 0)}' for a in range(22, 36)))
