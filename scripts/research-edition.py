"""How often a week's games make news in the NFL: the cutoffs behind SNN's weekly edition (snnStory.ts).

python3 -I scripts/research-edition.py [cache dir, default work/nflverse]

nflverse play-by-play 2021-25 (regular seasons); missing files are downloaded into the cache. For each angle a game
can carry (an upset, a comeback, a result against the yardage, one player's day, a blowout, a run ending) it prints
how many a week qualify at several cutoffs, and the biggest real examples.
Spec: docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md.
"""
import sys
import urllib.request
from pathlib import Path

import pandas as pd

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/nflverse')
root.mkdir(parents=True, exist_ok=True)
for year in range(2021, 2026):
    f = root / f'play_by_play_{year}.csv.gz'
    if not f.exists():
        with urllib.request.urlopen(f'https://github.com/nflverse/nflverse-data/releases/download/pbp/{f.name}',
                                    timeout=300) as r:
            f.write_bytes(r.read())

COLS = ['game_id', 'play_id', 'season', 'week', 'season_type', 'home_team', 'away_team', 'posteam', 'qtr',
        'play_type', 'yards_gained', 'total_home_score', 'total_away_score', 'home_score', 'away_score',
        'spread_line', 'interception', 'fumble_lost', 'td_player_id', 'td_player_name', 'td_team',
        'rusher_player_id', 'rusher_player_name', 'rushing_yards', 'receiver_player_id', 'receiver_player_name',
        'receiving_yards', 'passer_player_id', 'passer_player_name', 'passing_yards', 'pass_touchdown', 'qb_dropback',
        'sack_player_id', 'sack_player_name', 'half_sack_1_player_id', 'half_sack_1_player_name',
        'half_sack_2_player_id', 'half_sack_2_player_name', 'interception_player_id', 'interception_player_name',
        'two_point_attempt']
d = pd.concat([pd.read_csv(f, usecols=COLS, low_memory=False) for f in sorted(root.glob('play_by_play_202[1-5].csv.gz'))])
d = d[d.season_type == 'REG'].sort_values(['game_id', 'play_id'])
WEEKS = d[['season', 'week']].drop_duplicates().shape[0]

# ───────────── One row a game: the score, the line, each quarter's end, yards and turnovers.
g = d.groupby('game_id').agg(season=('season', 'first'), week=('week', 'first'), home=('home_team', 'first'),
                             away=('away_team', 'first'), hs=('home_score', 'first'), as_=('away_score', 'first'),
                             line=('spread_line', 'first'), quarters=('qtr', 'max')).reset_index()
for q in (1, 2, 3):
    end = d[d.qtr <= q].groupby('game_id')[['total_home_score', 'total_away_score']].max()
    g[f'h{q}'] = g.game_id.map(end.total_home_score)
    g[f'a{q}'] = g.game_id.map(end.total_away_score)
scrim = d[d.play_type.isin(['pass', 'run'])]
yards = scrim.groupby(['game_id', 'posteam']).yards_gained.sum()
gave = d.assign(to=d.interception.fillna(0) + d.fumble_lost.fillna(0)).groupby(['game_id', 'posteam']).to.sum()
for side, col in (('home', 'h'), ('away', 'a')):
    key = list(zip(g.game_id, g[side]))
    g[f'{col}yds'] = [yards.get(k, 0) for k in key]
    g[f'{col}to'] = [gave.get(k, 0) for k in key]
g['margin'] = (g.hs - g.as_).abs()
g['tie'] = g.hs == g.as_
g['home_won'] = g.hs > g.as_
GAMES = len(g)
print(f'{GAMES} regular-season games, {WEEKS} weeks, 2021-25: {GAMES / WEEKS:.1f} games a week\n')

# Each club's record before the game, and its streak.
rec = {}
rows = []
for r in g.sort_values(['season', 'week', 'game_id']).itertuples():
    out = {}
    for side, team in (('h', r.home), ('a', r.away)):
        w, l, t, streak = rec.get((r.season, team), (0, 0, 0, 0))
        out[f'{side}w'], out[f'{side}l'], out[f'{side}ties'], out[f'{side}streak'] = w, l, t, streak
    rows.append({'game_id': r.game_id, **out})
    for team, won, lost in ((r.home, r.hs > r.as_, r.hs < r.as_), (r.away, r.as_ > r.hs, r.as_ < r.hs)):
        w, l, t, streak = rec.get((r.season, team), (0, 0, 0, 0))
        if won:
            rec[(r.season, team)] = (w + 1, l, t, streak + 1 if streak > 0 else 1)
        elif lost:
            rec[(r.season, team)] = (w, l + 1, t, streak - 1 if streak < 0 else -1)
        else:
            rec[(r.season, team)] = (w, l, t + 1, 0)
g = g.merge(pd.DataFrame(rows), on='game_id')
pct = lambda w, l, t: (w + t / 2) / (w + l + t).clip(lower=1)
g['hpct'], g['apct'] = pct(g.hw, g.hl, g.hties), pct(g.aw, g.al, g.aties)
won = lambda h, a: h.where(g.home_won, a)       # the winner's value
lost = lambda h, a: a.where(g.home_won, h)      # the loser's
d_ = g[~g.tie].copy()                            # decided games


def line(label, n, extra=''):
    print(f'  {label:<58}{n / WEEKS:5.2f} a week  ({100 * n / GAMES:4.1f}% of games){extra}')


def tag(r):
    a, h = (r.away, r.home)
    return f'{r.season} wk{r.week:>2} {a} {r.as_}, {h} {r.hs}'


# ───────────── Upsets
print('UPSETS, by record (the winner\'s winning percentage before the game, against the loser\'s)')
d_['gap'] = lost(d_.hpct, d_.apct) - won(d_.hpct, d_.apct)
d_['dog'] = (d_.line.where(~d_.home_won, -d_.line))   # points the winner was getting (positive: he was the underdog)
for wk in (4, 5):
    late = d_[d_.week > wk]
    for cut in (0.25, 0.3, 0.35, 0.4, 0.5):
        hit = late[late.gap >= cut - 1e-9]
        dogs = (hit.dog >= 3).mean() if len(hit) else 0
        line(f'after week {wk}, {cut:.3f} or more below', len(hit), f'  {100 * dogs:3.0f}% of them were 3+ point underdogs')
print('UPSETS, by the closing line (an underdog winning outright)')
for cut in (3, 6.5, 9.5, 13.5):
    line(f'underdog of {cut}+', (d_.dog >= cut).sum())
print('  the biggest by record after week 4:')
for r in d_[d_.week > 4].sort_values('gap', ascending=False).head(6).itertuples():
    w, l = (r.hw, r.hl) if r.home_won else (r.aw, r.al)
    w2, l2 = (r.aw, r.al) if r.home_won else (r.hw, r.hl)
    print(f'    {tag(r)}: the winner was {w}-{l}, the loser {w2}-{l2}, the winner a {r.dog:+.1f} underdog')

# ───────────── Comebacks
print('\nCOMEBACKS (the winner trailed)')
d_['half'] = (d_.a2 - d_.h2).where(d_.home_won, d_.h2 - d_.a2)   # how far the winner trailed at halftime
for cut in (7, 10, 14, 17):
    line(f'by {cut}+ at halftime', (d_.half >= cut).sum())
run = d[['game_id', 'total_home_score', 'total_away_score']].copy()
run['gap'] = run.total_home_score - run.total_away_score
worst = run.groupby('game_id').gap.agg(['min', 'max'])
d_['deficit'] = (-d_.game_id.map(worst['min'])).where(d_.home_won, d_.game_id.map(worst['max']))
for cut in (10, 14, 17, 21):
    line(f'by {cut}+ at any point', (d_.deficit >= cut).sum())
behind = pd.concat([(d_[f'a{q}'] - d_[f'h{q}']).where(d_.home_won, d_[f'h{q}'] - d_[f'a{q}']) for q in (1, 2, 3)], axis=1).max(axis=1)
for cut in (10, 14, 17):
    line(f'by {cut}+ at the end of a quarter', (behind >= cut).sum())
print('  the biggest:')
for r in d_.sort_values('deficit', ascending=False).head(5).itertuples():
    print(f'    {tag(r)}: trailed by {int(r.deficit)} ({int(r.half)} at the half)')

# ───────────── Against the yardage
print('\nAGAINST THE YARDAGE')
d_['yds'] = won(d_.hyds, d_.ayds) - lost(d_.hyds, d_.ayds)       # the winner's yards less the loser's
d_['lto'] = lost(d_.hto, d_.ato)
for cut in (50, 75, 100, 150):
    line(f'the winner outgained by {cut}+', (d_.yds <= -cut).sum())
for cut in (2, 3, 4):
    line(f'the loser outgained him by 100+ with {cut}+ turnovers', ((d_.yds <= -100) & (d_.lto >= cut)).sum())

# ───────────── Blowouts, overtime, ties
print('\nBLOWOUTS, OVERTIME, TIES')
lead = lambda q: (d_[f'h{q}'] - d_[f'a{q}']).where(d_.home_won, d_[f'a{q}'] - d_[f'h{q}'])
every = (lead(1) > 0) & (lead(2) > 0) & (lead(3) > 0)
for cut in (17, 21, 24, 28):
    line(f'won by {cut}+', (d_.margin >= cut).sum())
    line(f'won by {cut}+ and led after every quarter', ((d_.margin >= cut) & every).sum())
line('overtime', (g.quarters >= 5).sum())
line('a tie', g.tie.sum())

# ───────────── One player's day
print('\nONE PLAYER\'S DAY (players a week)')
td = d[d.td_player_id.notna() & (d.two_point_attempt != 1)].groupby(['game_id', 'td_player_id', 'td_player_name']).size()
rush = d.groupby(['game_id', 'rusher_player_id', 'rusher_player_name']).rushing_yards.sum()
recv = d.groupby(['game_id', 'receiver_player_id', 'receiver_player_name']).receiving_yards.sum()
rush.index.names = recv.index.names = ['game_id', 'id', 'name']
scr = rush.add(recv, fill_value=0)
pas = d.groupby(['game_id', 'passer_player_id', 'passer_player_name']).agg(yds=('passing_yards', 'sum'),
                                                                           td=('pass_touchdown', 'sum'),
                                                                           db=('qb_dropback', 'sum'))
sk = pd.concat([d.groupby(['game_id', 'sack_player_id', 'sack_player_name']).size().rename_axis(['game_id', 'id', 'name']),
                (d.groupby(['game_id', 'half_sack_1_player_id', 'half_sack_1_player_name']).size() / 2).rename_axis(['game_id', 'id', 'name']),
                (d.groupby(['game_id', 'half_sack_2_player_id', 'half_sack_2_player_name']).size() / 2).rename_axis(['game_id', 'id', 'name'])])
sk = sk.groupby(level=[0, 1, 2]).sum()
it = d.groupby(['game_id', 'interception_player_id', 'interception_player_name']).size()


def per(label, n):
    print(f'  {label:<58}{n / WEEKS:5.2f} a week')


for cut in (3, 4):
    per(f'{cut}+ touchdowns scored', (td >= cut).sum())
for cut in (150, 175, 200):
    per(f'{cut}+ scrimmage yards', (scr >= cut).sum())
for cut in (350, 400, 450):
    per(f'{cut}+ passing yards', (pas.yds >= cut).sum())
for cut in (4, 5):
    per(f'{cut}+ passing touchdowns', (pas.td >= cut).sum())
for cut in (2.5, 3, 4):
    per(f'{cut}+ sacks', (sk >= cut).sum())
for cut in (2, 3):
    per(f'{cut}+ interceptions', (it >= cut).sum())
any_day = set((td[td >= 3]).index.get_level_values(0)) | set(scr[scr >= 150].index.get_level_values(0)) | \
    set(pas[(pas.yds >= 400) | (pas.td >= 4)].index.get_level_values(0)) | set(sk[sk >= 3].index.get_level_values(0)) | \
    set(it[it >= 2].index.get_level_values(0))
line('games with a day at 3 TD / 150 / 400 or 4 TD / 3 sacks / 2 INT', len(any_day))
strict = set((td[td >= 3]).index.get_level_values(0)) | set(scr[scr >= 200].index.get_level_values(0)) | \
    set(pas[(pas.yds >= 400) | (pas.td >= 5)].index.get_level_values(0)) | set(sk[sk >= 3].index.get_level_values(0)) | \
    set(it[it >= 3].index.get_level_values(0))
line('games with a day at 3 TD / 200 / 400 or 5 TD / 3 sacks / 3 INT', len(strict))

# ───────────── Two quarterbacks
print('\nTWO QUARTERBACKS (a club with two passers of 10+ dropbacks in a game)')
two = pas[pas.db >= 10].reset_index().merge(
    d[['game_id', 'passer_player_id', 'posteam']].dropna().drop_duplicates(), on=['game_id', 'passer_player_id'])
line('club-games', (two.groupby(['game_id', 'posteam']).size() >= 2).sum())

# ───────────── Runs
print('\nRUNS (a season)')
SEASONS = g.season.nunique()
unb = d_[((lost(d_.hl, d_.al) + lost(d_.hties, d_.aties)) == 0)]
wless = d_[((won(d_.hw, d_.aw) + won(d_.hties, d_.aties)) == 0)]
for n in (4, 5, 6):
    print(f'  an unbeaten club at {n}-0 or better loses          {(lost(unb.hw, unb.aw) >= n).sum() / SEASONS:5.1f} a season')
for n in (4, 5, 6):
    print(f'  a winless club at 0-{n} or worse wins              {(won(wless.hl, wless.al) >= n).sum() / SEASONS:5.1f} a season')
print('  unbeaten clubs at 5-0 or better that lost:')
for r in unb[lost(unb.hw, unb.aw) >= 5].sort_values(['season', 'week']).itertuples():
    print(f'    {tag(r)} (the loser was {r.aw if r.home_won else r.hw}-0)')
print('  winless clubs at 0-5 or worse that won:')
for r in wless[won(wless.hl, wless.al) >= 5].sort_values(['season', 'week']).itertuples():
    print(f'    {tag(r)} (the winner was 0-{r.hl if r.home_won else r.al})')
ws, ls = lost(d_.hstreak, d_.astreak), won(d_.hstreak, d_.astreak)
for n in (4, 5, 6):
    print(f'  a winning streak of {n}+ ends                       {(ws >= n).sum() / SEASONS:5.1f} a season')
for n in (4, 5, 6):
    print(f'  a losing streak of {n}+ ends                        {(ls <= -n).sum() / SEASONS:5.1f} a season')

# ───────────── Examples of a day
print('\nEXAMPLES OF A DAY')
meta = g.set_index('game_id')
where = lambda gid: f"{meta.season[gid]} wk{meta.week[gid]:>2} {meta.away[gid]} at {meta.home[gid]}"
for label, series, n in (('touchdowns scored', td, 6), ('scrimmage yards', scr, 5), ('sacks', sk, 5)):
    print(f'  most {label}:')
    for (gid, _, name), v in series.sort_values(ascending=False).head(n).items():
        print(f'    {name} {v:g}, {where(gid)}')
print('  most passing touchdowns:')
for (gid, _, name), v in pas.td.sort_values(ascending=False).head(5).items():
    print(f'    {name} {v:g}, {where(gid)}')
