"""NFL starters' ages and what happens to a starter the next year, by age and position (nflverse snap counts).

python3 -I scripts/research-aging.py --download          # data in work/nfl-aging (git-ignored)
Research input only: the targets `scripts/league-age-core.ts` and `npm run careers` judge AFLS against.
See docs/research/league-age.md.
A team-season's starters at a position are its top N players there by season snaps (N = AFLS's STARTERS), offense
snaps for offense, defense snaps for defense, special teams snaps for K/P. Age on Sept 1 of the season, in whole years
(AFLS keeps whole years).
"""
import argparse, collections, csv, datetime, statistics, urllib.request
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--data', type=Path, default=Path('work/nfl-aging'))
p.add_argument('--download', action='store_true')
a = p.parse_args()
root = a.data
root.mkdir(parents=True, exist_ok=True)
YEARS = range(2013, 2026)
BASE = 'https://github.com/nflverse/nflverse-data/releases/download'
if a.download:
    files = [('players.csv', f'{BASE}/players/players.csv')] + [
        (f'snap_counts_{y}.csv', f'{BASE}/snap_counts/snap_counts_{y}.csv') for y in YEARS]
    for name, url in files:
        if (root / name).exists():
            continue
        with urllib.request.urlopen(url, timeout=120) as r:
            (root / name).write_bytes(r.read())

def load(name):
    with (root / name).open() as s:
        return list(csv.DictReader(s))

MAP = {'QB': 'QB', 'RB': 'RB', 'HB': 'RB', 'WR': 'WR', 'TE': 'TE', 'T': 'OL', 'G': 'OL', 'C': 'OL', 'OT': 'OL',
       'OG': 'OL', 'OL': 'OL', 'DT': 'DT', 'NT': 'DT', 'DE': 'EDGE', 'OLB': 'EDGE', 'LB': 'LB', 'ILB': 'LB',
       'MLB': 'LB', 'CB': 'CB', 'DB': 'CB', 'S': 'S', 'FS': 'S', 'SS': 'S', 'SAF': 'S', 'K': 'K', 'P': 'P'}
STARTERS = {'QB': 1, 'RB': 1, 'WR': 3, 'TE': 1, 'OL': 5, 'DT': 2, 'EDGE': 2, 'LB': 2, 'CB': 3, 'S': 2, 'K': 1, 'P': 1}
SIDE = {**{x: 'offense_snaps' for x in ('QB', 'RB', 'WR', 'TE', 'OL')},
        **{x: 'defense_snaps' for x in ('DT', 'EDGE', 'LB', 'CB', 'S')}, 'K': 'st_snaps', 'P': 'st_snaps'}

births = {r['pfr_id']: r['birth_date'] for r in load('players.csv') if r.get('pfr_id') and r.get('birth_date')}
# season -> player -> total snaps of any kind; season -> (team, pos) -> player -> side snaps
anysnaps = {}
side = {}
posof = {}
for y in YEARS:
    rows = [r for r in load(f'snap_counts_{y}.csv') if r['game_type'] == 'REG']
    tot = collections.Counter()
    sd = collections.defaultdict(collections.Counter)
    for r in rows:
        pid = r['pfr_player_id']
        tot[pid] += sum(float(r[k] or 0) for k in ('offense_snaps', 'defense_snaps', 'st_snaps'))
        pos = MAP.get(r['position'])
        if not pos:
            continue
        sd[(r['team'], pos)][pid] += float(r[SIDE[pos]] or 0)
        posof[(y, pid)] = pos
    anysnaps[y] = tot
    side[y] = sd

def age_frac(pid, y):
    b = births.get(pid)
    if not b:
        return None
    return (datetime.date(y, 9, 1) - datetime.date.fromisoformat(b[:10])).days / 365.25

def age(pid, y):
    a = age_frac(pid, y)
    return None if a is None else float(int(a))  # whole years, as AFLS keeps them

starters = {}  # y -> {pid: pos}
for y in YEARS:
    s = {}
    for (team, pos), c in side[y].items():
        for pid, n in c.most_common(STARTERS[pos]):
            if n > 0:
                s[pid] = pos
    starters[y] = s

print('# NFL starters by position (age on Sept 1)')
for span, ys in (('2021-25', range(2021, 2026)), ('2016-25', range(2016, 2026))):
    print(f'\n## {span}')
    allages = []
    for pos in STARTERS:
        ages = [age(pid, y) for y in ys for pid, ps in starters[y].items() if ps == pos and age(pid, y) is not None]
        allages += ages
        print(f'{pos:5} n={len(ages):5}  mean {statistics.mean(ages):.2f}  <=24 {100*sum(x<25 for x in ages)/len(ages):4.1f}%'
              f'  31+ {100*sum(x>=31 for x in ages)/len(ages):4.1f}%  33+ {100*sum(x>=33 for x in ages)/len(ages):4.1f}%')
    print(f'ALL   n={len(allages):5}  mean {statistics.mean(allages):.2f}  <=24 {100*sum(x<25 for x in allages)/len(allages):4.1f}%'
          f'  31+ {100*sum(x>=31 for x in allages)/len(allages):4.1f}%')

# What happens to a starter next year, by age (whole years), pooled 2013-2024 -> next season.
GROUPS = {'all': list(STARTERS), 'QB': ['QB'], 'long prime (TE OL DT)': ['TE', 'OL', 'DT'],
          'short prime (RB WR CB EDGE LB S)': ['RB', 'WR', 'CB', 'EDGE', 'LB', 'S'], 'K/P': ['K', 'P']}
BANDS = [(21, 24), (25, 26), (27, 28), (29, 29), (30, 30), (31, 31), (32, 32), (33, 33), (34, 34), (35, 36), (37, 45)]
print('\n# A starter next season: still a starter / plays, not a starter / gone (no snaps next season)')
print('# gone for good = no snaps in either of the next two seasons (2013-2023 only)')
for g, poss in GROUPS.items():
    print(f'\n## {g}')
    for lo, hi in BANDS:
        n = keep = play = gone = 0
        n2 = gone2 = 0
        for y in range(2013, 2025):
            for pid, pos in starters[y].items():
                if pos not in poss:
                    continue
                ag = age(pid, y)
                if ag is None or not (lo <= int(ag) <= hi):
                    continue
                n += 1
                if pid in starters[y + 1]:
                    keep += 1
                elif anysnaps[y + 1].get(pid, 0) > 0:
                    play += 1
                else:
                    gone += 1
                if y <= 2023:
                    n2 += 1
                    if anysnaps[y + 1].get(pid, 0) == 0 and anysnaps[y + 2].get(pid, 0) == 0:
                        gone2 += 1
        if n:
            lab = f'{lo}' if lo == hi else f'{lo}-{hi}'
            print(f'{lab:6} n={n:5}  starter {100*keep/n:5.1f}%  plays {100*play/n:5.1f}%  gone {100*gone/n:5.1f}%'
                  f'  gone for good {100*gone2/max(1,n2):5.1f}%')

print('\n# Age when a starter left for good (a starter in Y, no snaps in Y+1 or Y+2; 2013-2023), median and mean')
for pos in STARTERS:
    xs = [age(pid, y) for y in range(2013, 2024) for pid, ps in starters[y].items() if ps == pos and age(pid, y)
          and anysnaps[y + 1].get(pid, 0) == 0 and anysnaps[y + 2].get(pid, 0) == 0]
    if xs:
        print(f'{pos:5} n={len(xs):4}  median {statistics.median(xs):.1f}  mean {statistics.mean(xs):.1f}')
