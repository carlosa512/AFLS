"""NFL benchmarks for when free agents sign: the share of good and elite signings agreed by each day of the market.

python scripts/research-fa-timing.py --data work/nfl-contracts --download
Source: nflverse's Over The Cap contract history (historical_contracts.csv.gz), which has a year signed and no date
(checked 2026-11-20), so by default this prints that and stops. A file with signing dates (columns `otc_id`,
`year_signed`, `date_signed` as YYYY-MM-DD, e.g. scraped from a tracker) can be given with --dates and is then read.
Day 1 is the negotiating window (the Monday before the league year, 2021-25: March 14, 2022: March 14, ...), days 2-5
the league year's first four days (it opens on the Wednesday). Research input only.
"""
import argparse
import csv
import datetime
import gzip
import statistics
import collections
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data', type=Path, default=Path('work/nfl-contracts'))
parser.add_argument('--download', action='store_true')
parser.add_argument('--dates', type=Path, help='csv with otc_id, year_signed, date_signed (YYYY-MM-DD)')
args = parser.parse_args()
args.data.mkdir(parents=True, exist_ok=True)
FILE = args.data / 'historical_contracts.csv.gz'
if args.download:
    url = 'https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.csv.gz'
    with urllib.request.urlopen(url, timeout=120) as response:
        FILE.write_bytes(response.read())

GOOD, ELITE = 0.02, 0.05  # shares of the cap on the new deal
YEARS = range(2021, 2026)
WINDOW_DAYS = 5  # day 1 = negotiating window, then the league year's first four days

# Legal tampering opens the Monday of the league-year week (noon ET); the new year opens that Wednesday.
OPENS = {2021: datetime.date(2021, 3, 15), 2022: datetime.date(2022, 3, 14), 2023: datetime.date(2023, 3, 13),
         2024: datetime.date(2024, 3, 11), 2025: datetime.date(2025, 3, 10)}

reader = csv.DictReader(gzip.open(FILE, 'rt'))
columns = reader.fieldnames or []
dated = [c for c in columns if 'date' in c.lower() and c not in ('date_of_birth',)]
if not args.dates and not dated:
    print('No signing date in the contract history (columns: ' + ', '.join(columns) + ').')
    print('Give --dates a csv of otc_id, year_signed, date_signed to measure timing. Nothing printed below.')
    raise SystemExit(0)

dates = {}
if args.dates:
    for r in csv.DictReader(open(args.dates)):
        dates[(r['otc_id'], r['year_signed'])] = r['date_signed']
else:
    dates = None

by_player = collections.defaultdict(list)
for r in reader:
    if r['year_signed'] in ('', '0', 'NA') or not r['year_signed'].isdigit():
        continue
    by_player[r['otc_id']].append(r)
for deals in by_player.values():
    deals.sort(key=lambda r: int(r['year_signed']))

def day_of(r):
    raw = dates.get((r['otc_id'], r['year_signed'])) if dates is not None else r[dated[0]]
    try:
        d = datetime.date.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    return (d - OPENS[int(r['year_signed'])]).days + 1

days = {'GOOD': [], 'ELITE': []}
for deals in by_player.values():
    for prev, d in zip(deals, deals[1:]):
        ys = int(d['year_signed'])
        if ys not in YEARS or d['team'].split('/')[0] == prev['team'].split('/')[-1]:
            continue  # a veteran changing clubs, not a re-sign
        try:
            pct = float(d['apy_cap_pct'])
        except ValueError:
            continue
        n = day_of(d)
        if n is None or pct < GOOD:
            continue
        n = max(1, n)
        days['GOOD'].append(n)
        if pct >= ELITE:
            days['ELITE'].append(n)

for name, ds in days.items():
    if not ds:
        print(name, 'n=0')
        continue
    row = ' '.join(f'day {k}: {100 * sum(x <= k for x in ds) / len(ds):.0f}%' for k in range(1, WINDOW_DAYS + 1))
    print(f'{name} (n={len(ds)}) share agreed by: {row}')
if days['ELITE']:
    print(f"mean day an ELITE player agrees: {statistics.mean(days['ELITE']):.2f}")
