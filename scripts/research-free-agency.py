"""NFL benchmarks for free agency: who stays at a deal's end, how one-year deals and outside signings spread.

python scripts/research-free-agency.py --data work/nfl-contracts --download
Source: nflverse's Over The Cap contract history (historical_contracts.csv.gz). Research input only.
"""
import argparse
import collections
import csv
import gzip
import statistics
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data', type=Path, default=Path('work/nfl-contracts'))
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
args.data.mkdir(parents=True, exist_ok=True)
FILE = args.data / 'historical_contracts.csv.gz'
if args.download:
    url = 'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.csv.gz'
    with urllib.request.urlopen(url, timeout=120) as response:
        FILE.write_bytes(response.read())

GOOD = 0.02  # 2% of the cap: what AFLS's checks call a good player
FIRST, LAST = 2014, 2020  # deals ending in these years; the next deal is seen through 2021 (2022 is partial)

# A deal with more than one club reads 'DEN/SEA' (signed with the first, traded to the last); one club, its nickname.
ABBR = {'ARI': 'Cardinals', 'ATL': 'Falcons', 'BAL': 'Ravens', 'BUF': 'Bills', 'CAR': 'Panthers', 'CHI': 'Bears',
        'CIN': 'Bengals', 'CLE': 'Browns', 'DAL': 'Cowboys', 'DEN': 'Broncos', 'DET': 'Lions', 'GB': 'Packers',
        'HOU': 'Texans', 'IND': 'Colts', 'JAX': 'Jaguars', 'KC': 'Chiefs', 'LAC': 'Chargers', 'SD': 'Chargers',
        'LAR': 'Rams', 'STL': 'Rams', 'LV': 'Raiders', 'OAK': 'Raiders', 'MIA': 'Dolphins', 'MIN': 'Vikings',
        'NE': 'Patriots', 'NO': 'Saints', 'NYG': 'Giants', 'NYJ': 'Jets', 'PHI': 'Eagles', 'PIT': 'Steelers',
        'SF': '49ers', 'SEA': 'Seahawks', 'TB': 'Buccaneers', 'TEN': 'Titans', 'WAS': 'Commanders'}
def clubs_of(team):
    return [ABBR.get(t, t) for t in team.split('/')] if '/' in team else [team]

rows = [r for r in csv.DictReader(gzip.open(FILE, 'rt')) if r['year_signed'] not in ('', '0', 'NA')]
for r in rows:
    r['first'], r['last'] = clubs_of(r['team'])[0], clubs_of(r['team'])[-1]
by_player = collections.defaultdict(list)
for r in rows:
    r['ys'] = int(r['year_signed'])
    r['yrs'] = int(r['years']) if r['years'].isdigit() else 0
    try:
        r['pct'] = float(r['apy_cap_pct'])
    except ValueError:
        r['pct'] = 0.0
    by_player[r['otc_id']].append(r)
for deals in by_player.values():
    deals.sort(key=lambda r: r['ys'])

def age_at(r, year):
    try:
        return 22 + year - int(r['draft_year'])
    except ValueError:
        return None

# 1. A good deal reaching its end: stays (extended in its last year or re-signed/tagged by the club the next spring),
# moves (signs elsewhere the next spring) or no deal. Deals cut or extended early are someone else's question.
outcome = collections.Counter()
tier = collections.defaultdict(collections.Counter)
a28 = lambda d, y: '28 or younger' if (age_at(d, y) or 99) <= 28 else 'older'
by_age = collections.defaultdict(collections.Counter)
for deals in by_player.values():
    for i, d in enumerate(deals):
        end = d['ys'] + d['yrs'] - 1
        if d['pct'] < GOOD or d['yrs'] < 1 or not FIRST <= end <= LAST:
            continue
        nxt = deals[i + 1] if i + 1 < len(deals) else None
        # An extension any time before the deal ends is staying; a new club before his last year was a cut.
        if nxt and nxt['ys'] < end and nxt['first'] != d['last']:
            continue
        # A tag or a fifth-year option isn't a deal in this data: a long deal with the same club a year later stayed.
        same = bool(nxt) and nxt['first'] == d['last']
        if nxt and (nxt['ys'] > end + 2 or (nxt['ys'] == end + 2 and not same)):
            nxt = None  # nothing the next spring
        kind = 'none' if not nxt else 'stayed' if same else 'moved'
        outcome[kind] += 1
        tier[('5%+' if d['pct'] >= 0.05 else '2-5%', a28(d, end + 1))][kind] += 1
        a = age_at(d, end + 1)
        band = 'unknown' if a is None else '28 or younger' if a <= 28 else '29-31' if a <= 31 else '32+'
        by_age[band][kind] += 1

def shares(c):
    n = sum(c.values())
    return f"n={n} " + ' '.join(f"{k} {100 * c[k] / n:.0f}%" for k in ('stayed', 'moved', 'none'))

print('1. Good deals (2%+ of the cap) reaching their end, ended', FIRST, '-', LAST)
print('   all:', shares(outcome))
for band in ('28 or younger', '29-31', '32+', 'unknown'):
    print(f'   {band}:', shares(by_age[band]))

# 2. Outside signings: a good player signing with a new club (2%+ of the cap on the new deal), by league year.
per_year = collections.defaultdict(collections.Counter)
one_year = collections.Counter()
for deals in by_player.values():
    for prev, d in zip(deals, deals[1:]):
        if d['pct'] < GOOD or d['first'] == prev['last'] or not FIRST + 1 <= d['ys'] <= LAST + 1:
            continue
        per_year[d['ys']][d['first']] += 1
        one_year['one' if d['yrs'] == 1 else 'more'] += 1
for k in sorted(tier):
    print(f'   old deal {k[0]}, {k[1]}:', shares(tier[k]))
print('2. Good outside signings per club and league year (32 clubs)')
clubs = collections.defaultdict(set)
for r in rows:
    clubs[r['ys']].add(r['first'])
for y in sorted(per_year):
    counts = [per_year[y].get(t, 0) for t in clubs[y]]
    print(f'   {y}: total {sum(counts)}, clubs with 0: {counts.count(0)}, with 3+: {sum(c >= 3 for c in counts)},'
          f' median {statistics.median(counts)}, max {max(counts)}')
n = sum(one_year.values())
print('   clubs seen per year:', {y: len(clubs[y]) for y in sorted(per_year)})
print(f"3. Good outside signings on one-year deals: {100 * one_year['one'] / n:.0f}% of {n}")
