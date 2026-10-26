"""Reproduce the NFL benchmark without installing dependencies.

python scripts/research-squads.py --data work/nfl-squads --download
Raw roster/snap CSVs are research inputs, never game rosters. See docs/research/practice-squad-outcomes.md.
"""
import argparse
import collections
import csv
import datetime
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data', type=Path, default=Path('work/nfl-squads'))
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
root = args.data
root.mkdir(parents=True, exist_ok=True)
YEARS = (2022, 2023, 2024)
BASE = 'https://github.com/nflverse/nflverse-data/releases/download'
if args.download:
    files = [('players.csv', f'{BASE}/players/players.csv')]
    for year in YEARS:
        files += [(f'roster_weekly_{year}.csv', f'{BASE}/weekly_rosters/roster_weekly_{year}.csv'),
                  (f'snap_counts_{year}.csv', f'{BASE}/snap_counts/snap_counts_{year}.csv')]
    for filename, url in files:
        with urllib.request.urlopen(url, timeout=60) as response:
            (root / filename).write_bytes(response.read())

def load(filename):
    with (root / filename).open() as stream:
        return list(csv.DictReader(stream))

rosters = {year: [r for r in load(f'roster_weekly_{year}.csv')
                  if r['game_type'] == 'REG' and 1 <= int(r['week']) <= 18] for year in YEARS}
snaps = {year: [r for r in load(f'snap_counts_{year}.csv') if r['game_type'] == 'REG'] for year in YEARS}
ids = {r['gsis_id']: r['pfr_id'] for rows in rosters.values() for r in rows if r['gsis_id'] and r['pfr_id']}
ids.update({r['gsis_id']: r['pfr_id'] for r in load('players.csv') if r['gsis_id'] and r['pfr_id']})
# Stable IDs only. Missing links stay in the denominator, so reported rates are lower bounds.

def percent(n, denominator):
    return round(n / denominator * 100, 2) if denominator else None

def outcome(cohort, years):
    appeared, regular, special_teams = set(), set(), set()
    for year in years:
        roles, special = collections.Counter(), collections.Counter()
        for row in snaps[year]:
            player = row['pfr_player_id']
            if sum(float(row[key] or 0) for key in ('offense_snaps', 'defense_snaps', 'st_snaps')) > 0:
                appeared.add(player)
            if max(float(row['offense_pct'] or 0), float(row['defense_pct'] or 0)) >= .5:
                roles[player] += 1
            if float(row['st_pct'] or 0) >= .3:
                special[player] += 1
        regular.update(player for player, games in roles.items() if games >= 8)
        special_teams.update(player for player, games in special.items() if games >= 8)
    counts = {'anySnaps': sum(ids.get(player) in appeared for player in cohort),
              'regularRole': sum(ids.get(player) in regular for player in cohort),
              'specialTeamsRole': sum(ids.get(player) in special_teams for player in cohort)}
    return {'n': len(cohort), 'mapped': sum(player in ids for player in cohort), **counts,
            'anySnapsPctOfAll': percent(counts['anySnaps'], len(cohort)),
            'regularRolePctOfAll': percent(counts['regularRole'], len(cohort))}

results = {}
for year, rows in rosters.items():
    dev = [r for r in rows if r['status'] == 'DEV']
    week1 = {r['gsis_id']: r for r in dev if r['week'] == '1' and r['gsis_id']}
    young = {player: r for player, r in week1.items() if int(r['years_exp'] or 99) <= 2}
    rookies = {player: r for player, r in week1.items() if r['years_exp'] == '0'}
    ages = [(datetime.date(year, 9, 1) - datetime.date.fromisoformat(r['birth_date'])).days / 365.25
            for r in dev if r['birth_date']]
    active = {r['gsis_id'] for r in rows if r['status'] == 'ACT' and int(r['week']) > 1}
    results[year] = {
        'week1': len(week1), 'devPlayerWeeks': len(dev),
        'distinctSeasonPlayers': len({r['gsis_id'] for r in dev if r['gsis_id']}),
        'meanUniquePerTeam': sum(len({r['gsis_id'] for r in dev if r['team'] == team})
                                 for team in {r['team'] for r in dev}) / 32,
        'rookiePct': percent(sum(r['years_exp'] == '0' for r in dev), len(dev)),
        'exp4PlusPct': percent(sum(int(r['years_exp'] or 0) >= 4 for r in dev), len(dev)),
        'meanAgePlayerWeeks': sum(ages) / len(ages),
        'positions': dict(collections.Counter(r['position'] for r in dev)),
        'week1LaterACT': len(set(week1) & active),
        'week1SameYearSnaps': outcome(week1, [year]),
        'youngSameYear': outcome(young, [year]),
        'rookiesSameYear': outcome(rookies, [year]),
    }
    if year < 2024:
        results[year]['youngNextYear'] = outcome(young, [year + 1])
        results[year]['youngThrough2024'] = outcome(young, list(range(year, 2025)))
        results[year]['rookiesThrough2024'] = outcome(rookies, list(range(year, 2025)))
    if year == 2022:
        results[year]['youngFutureYearsOnly'] = outcome(young, [2023, 2024])

(root / 'findings.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
