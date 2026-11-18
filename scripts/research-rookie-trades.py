"""NFL benchmark for trading a player in his rookie season: how often, by round and by when (docs/TRADES.md, `freshPick`).

python scripts/research-rookie-trades.py --data work/nfl-trades --download
Source: nflverse's nfldata trades.csv (one row a player or pick a side gave) and draft_picks.csv. Research input only.
A traded pick carries the id of the player taken with it, so only rows without a pick are player trades.
"""
import argparse
import collections
import csv
import datetime as dt
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data', type=Path, default=Path('work/nfl-trades'))
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
args.data.mkdir(parents=True, exist_ok=True)
RAW = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data'
if args.download:
    for name in ('trades.csv', 'draft_picks.csv'):
        with urllib.request.urlopen(f'{RAW}/{name}', timeout=120) as response:
            (args.data / name).write_bytes(response.read())

# Each draft's first day: a rookie's league year runs from it to the next March.
DRAFT_DAY = {2002: '04-20', 2003: '04-26', 2004: '04-24', 2005: '04-23', 2006: '04-29', 2007: '04-28', 2008: '04-26',
             2009: '04-25', 2010: '04-22', 2011: '04-28', 2012: '04-26', 2013: '04-25', 2014: '05-08', 2015: '04-30',
             2016: '04-28', 2017: '04-27', 2018: '04-26', 2019: '04-25', 2020: '04-23', 2021: '04-29', 2022: '04-28',
             2023: '04-27', 2024: '04-25', 2025: '04-24'}
WINDOWS = ['draft weekend', 'spring and summer', 'final cuts', 'in season']

draft = {r['pfr_id']: r for r in csv.DictReader(open(args.data / 'draft_picks.csv')) if r['pfr_id']}
trades = [r for r in csv.DictReader(open(args.data / 'trades.csv')) if r['pfr_id'] and not r['pick_season']]


def window(day, year):
    start = dt.date.fromisoformat(f'{year}-{DRAFT_DAY[year]}')
    if (day - start).days <= 4:
        return WINDOWS[0]
    if day < dt.date(year, 8, 24):
        return WINDOWS[1]
    return WINDOWS[2] if day < dt.date(year, 9, 6) else WINDOWS[3]


def traded_in(year_offset):
    """Each player trade in the league year `year_offset` after his draft's (0: his rookie season), once a deal."""
    seen, out = set(), []
    for r in trades:
        p = draft.get(r['pfr_id'])
        if not p or int(p['season']) not in DRAFT_DAY:
            continue
        year = int(p['season'])
        day = dt.date.fromisoformat(r['trade_date'])
        start = dt.date.fromisoformat(f'{year}-{DRAFT_DAY[year]}') if year_offset == 0 else dt.date(year + year_offset, 3, 1)
        if not (start <= day < dt.date(year + year_offset + 1, 3, 1)) or (r['trade_id'], r['pfr_id']) in seen:
            continue
        seen.add((r['trade_id'], r['pfr_id']))
        out.append((int(p['round']), window(day, year) if year_offset == 0 else '', r['trade_date'], r['pfr_name'], p['pick']))
    return out


rookies = traded_in(0)
years = len(DRAFT_DAY)
count = collections.Counter((rd, w) for rd, w, *_ in rookies)
print(f'Players traded in their rookie league year, {min(DRAFT_DAY)}-{max(DRAFT_DAY)} ({years} drafts):')
print('round ' + ''.join(f'{w:>19}' for w in WINDOWS) + '   total  a year')
for rd in range(1, 8):
    n = [count[(rd, w)] for w in WINDOWS]
    print(f'{rd:>5} ' + ''.join(f'{x:>19}' for x in n) + f'   {sum(n):>5}  {sum(n) / years:>6.2f}')
for rd, w, day, name, pick in sorted(rookies):
    if rd <= 2:
        print(f'  round {rd}, No. {pick}: {name}, {day} ({w})')

second = traded_in(1)
by_round = collections.Counter(rd for rd, *_ in second)
print(f'\nTraded in their second league year, by round: {dict(sorted(by_round.items()))}')
for rd, _, day, name, pick in sorted(second):
    if rd == 1:
        print(f'  No. {pick}: {name}, {day}')
