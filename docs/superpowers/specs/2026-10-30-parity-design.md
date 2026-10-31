# Parity: any given Sunday

Date: 2026-10-30, revised 2026-10-31 · Comes before #115 (fewer sulkers), which rebases on it

NFL figures marked *nflverse* are measured from nflverse's public play-by-play and schedules (every regular-season play
and closing line, 2015–2024; `github.com/nflverse/nflverse-data`), with the scratch scripts kept out of the repo.

## Why

Every pull request this week tripped over a different line of the sim check: #5 rushing, red-zone trips, #1 receptions,
overtime. Each sits on or near its limit on main, so any change that moves play (moods, injuries, anything) tips one.
Three attempts to tune rushing alone moved nothing over 60 seasons: the problem isn't one stat. It is the season's
shape, and digging into it turned up four causes, each hiding the next.

Measured on main (60 fresh leagues, `npm run sim -- 60`, and the four careers leagues):

| | Main | NFL |
|---|---|---|
| Margin that team strength predicts (SD) | 9.0 pts | 6.0, the closing line (*nflverse* 2015–24) |
| Final margin's spread around it | 12.6 pts | 12.8 around the line (*nflverse* 2015–24) |
| Favourites win straight up | 70.2% (better-rated) | 66.4% (*nflverse* 2015–24) |
| Spread of team wins in a new league's season (SD) | 3.80 | 3.09 (*nflverse* 2015–24) |
| The same, seasons 9–16 of a long league | 3.17 | 3.09 |
| Team seasons with 30+ rushing TDs (60 seasons) | 62 of 1,920 | 3 of 160 (2021–25) |
| Average depth of a throw (air yards) | about 10.9 | 7.9 (*nflverse* 2019–24; 7.7 in 2024) |
| Share of throws 10–19 yards downfield | 36% | 20.9% (*nflverse* 2019–24) |

1. **Strength decides too much** and a strong team never has a flat day: the margin strength predicts runs half again the
   line's. (The first version also read the game's own randomness as too small, against a remembered 13.5; *nflverse*
   puts the NFL's at 12.8 around the line, so the day is re-sized against that, below.)
2. **A new league is built lopsided.** Team ratings at kickoff spread too wide, and a club's real record lifted its whole
   roster, depth included: strong clubs shrugged off injuries weak ones couldn't, so a new league pulled further apart
   all season (team strength's spread grew 20% from kickoff to the season's average; 4% in a long league). A long league,
   built by the AI, is already the NFL's shape: its depth barely follows its strength and runs a point deeper.
3. **The passing game is shaped wrong in a way its totals hide.** Too many intermediate throws (chain-movers that walk
   drives into the red zone and give the leaders 14+ yards a catch), short throws that complete too often and gain too
   little. Completion and yards an attempt land inside their ranges because the two errors cancel.
4. **The coaching trees' winner bar was set on the old, too-predictable engine.** A tree grows only from a head coach at
   .600 or better over five seasons; the NFL has 8 such coaches (entering 2025), the sim 3.1 on main and 2.4 once
   upsets are realistic, so trees halve (careers flags all five tree lines).

## Decisions

1. **Fix the season's shape, not single stats.** No range is loosened. One range written for this work was wrong and is
   replaced (see Checks).
2. **Simple, realistic levers with a football reason, never a cap on a player.** Attributes keep separating players
   exactly as they do now; what changes is how often each kind of play is called, how a new league is built, a team's
   day, and a bar the trees are judged against.
3. **Running-back workloads, injuries and the AI's roster building stay as they are.**

## Stage 1: a team's day (done)

Each team draws a hidden form for each game, `teamDay` in `match/lineup.ts`: `normal(0, DAY_SD)` rating points on its
own stream (`${gameSeed}:day:${teamId}`), applied to every man in its lineup through the knocks overlay, the same for a
lineup rebuilt after an injury. ("Day", not "form": form is a player's in this engine.) `DAY_SD` was sized at 0.35
against a remembered 13.5; it is re-sized once against the real 12.8, with strength read the way a line reads it (below,
Checks), so it may come down. It stays for what it does to the season: strong teams' flat days.

## Stage 2: a new league built like a lived-in one (done)

- **Depth:** a franchise's record (`PEDIGREE`, unchanged at 4) lifts its starters only, and backups roll about a point
  deeper (next men about 9.7, as a built league carries them). Depth's tie to strength falls from 0.54 to a built
  league's 0.06–0.11.
- **An even deal:** half of a team's luck in its starters' rolls (`EVEN_DEAL = 0.5`, weighed as team overall weighs its
  units) is dealt back through every starter but the quarterback, who keeps the roll that makes him a star or not. A club
  that rolled a great quarterback has a little less around him, as the cap would leave it. Year one follows the real
  records more closely (correlation 0.60 to 0.73).
- `PEDIGREE` was tried first and dropped: at 2.5 the win spread still read 3.61 (the luck of each roll, not pedigree, made
  the gaps).

## Stage 3: the passing game's shape (to plan)

**Targets** (*nflverse*, 2019–24 regular seasons, every throw with its air yards; 2023 and 2024 alone read the same):

| Air yards | Share of throws | Completion | Yards an attempt | Interceptions | Yards after the catch |
|---|---|---|---|---|---|
| Behind the line | 16.6% | 81% | 4.7 | 0.8% | 9.1 |
| 0–9 | 50.9% | 70% | 5.8 | 1.4% | 4.2 |
| **All short (under 10)** | **67.5%** | **72.9%** | **5.5** | | |
| **10–19** | **20.9%** | **54.9%** | **9.6** | **3.4%** | 3.7 |
| **20+** | **11.6%** | **36.2%** | **12.2** | **6.3%** | 5.6 |
| All | average air yards **7.9** | 64.9% | 7.15 | | 5.2 |

The sim today: short 49.5% (79%, 5.1), 10–19 36% (60%, 9.8, 3.0%), 20+ 14.5% (38%, 12.5, 5.3%), average air yards about
10.9. The totals (completion, yards an attempt) already sit inside their ranges because the errors cancel.

**Levers**, all league-wide play calling and passing shape:

- **The call:** `coach.passDepth`'s situational mixes carry the intermediate throw at 20–40%; bring them to the NFL's
  share, more of it short. Scheme leans (`depth` in `schemes.ts`) stay relative to the league, so Air Coryell still
  throws deeper than West Coast.
- **Short throws as the NFL throws them:** screens and checkdowns behind the line as well as the quick game in front of
  it (the short air distribution), completing a little less often (`0.81` base today) and gaining more after the catch,
  the short game's yards coming from the run after it.
- **Already in:** Air Coryell's shots come off the drop, not play action (its description never claimed both).
- **Reverted:** the first-read change. It rested on star receivers' target shares; *nflverse* puts a team's top receiver at
  23.1% of its catches (22.4–24.2% a season) and the sim already read 24%. What the NFL has that the sim lacks is the
  top end: its #1 catches about 135 (127–149) against team leaders' 84. If #1 receptions still reads low once the mix is
  right, the lever is the receivers' own `targeting` (how much a receiver who gets open draws the ball), an attribute,
  measured against that gap first; never a fixed share for a depth-chart slot.

**Expected:** drives less steady (red-zone trips down), the leaders near the NFL's 12–13 yards a catch (#5 receiving
yards under 1,500), Air Coryell's 1.5-point edge narrowed. Measured, not assumed.

**Red-zone trips, counted alike:** the sim counts a drive that snaps a play at the 20 or inside. Counted the same way
from *nflverse*, the NFL ran 3.30, 3.62, 3.45, 3.25, 3.25 and 3.39 a team-game in 2019–24 (3.34 over 2021–24); the
check's range (3.0–3.4) came from TeamRankings and drive tables that count differently. Whether the range follows the
like-for-like count is the owner's call; until then it stands.

## Stage 4: the trees' winner bar (after Stage 3)

Measured in the careers leagues' steady state once Stages 1–3 are in: set `WINNER.share` in `trees.ts` so the number of
active head coaches with five or more seasons who clear it is about the NFL's **8** (Reid, Tomlin, J. Harbaugh, McVay,
McDermott, LaFleur, Payton, Jim Harbaugh, entering 2025, of about 15 with five or more seasons). The five tree lines
must then read green with no range moved. Why the sim has fewer lasting winners than the NFL (coaching's edge, how
sharply front offices read other clubs' players, the owner's suggested blurrier read for everyone, the user included,
of players nobody on the staff has worked with) is a finding for the owner, not part of this change.

## Checks

- **`npm run sim`**, Parity, with each game's strength read as a line reads it: both teams' overall before that week's
  games (injuries in), not the season's kickoff. Judged against *nflverse* 2015–24: the margin strength predicts (SD)
  5.5–6.5 (the line's 6.0), the margin's spread around it 12.3–13.3 (12.8; the first version's 13–14.5 rested on a
  remembered 13.5), the win spread 3.0–3.4 (3.09). How often the favourite wins is shown (the NFL's 66.4%), not judged:
  a line still knows more than a rating. (The first version judged the better-rated team at 65–69%.)
- **`npm run sim`**, Passing by depth (Stage 3): average air yards 7.4–8.3; the short, 10–19 and 20+ shares 65–70%,
  19–23% and 10.5–13%. Completion, yards an attempt and picks by depth are shown against the table above, not judged: the
  totals already are, and each judged line is one more edge to trip on.
- **`npm run careers`:** the steady-state win spread, reported; the five tree lines green (Stage 4).
- **Everything that reads play** runs on CI as usual (audit, size, weather, crews, quirks, endings, morale, offseason);
  nothing may be flagged and no range moves.
- **Unit tests:** the day (reproducible, zero-mean, carried by every lineup a game builds, moves a margin); the even deal
  (gives back `EVEN_DEAL` of the luck, the quarterback untouched); a new league's depth (a built league's depth and tie
  to strength). Stage 3's per-depth counts and Stage 4's bar get theirs in the plan.

## After it lands

#115 rebases on it and its sim check is read again.

## Files

| File | Change |
| --- | --- |
| `src/engine/match/lineup.ts`, `match/gameSim.ts` | the day; the first read reverted; Stage 3's short-throw shape and per-depth counts |
| `src/engine/match/coach.ts` | Stage 3's depth mix |
| `src/engine/schemes.ts` | Air Coryell without play action |
| `src/engine/generate.ts` | depth and the even deal |
| `src/engine/trees.ts` | Stage 4's bar |
| `scripts/calibrate.ts`, `scripts/careers*.ts` | parity and passing-depth checks, the steady win spread |
| `docs/MVP.md`, `package.json`, `src/ui/changelog.ts`, `CLAUDE.md`, `docs/ATTRIBUTES.md` | notes, 0.2.27, changelog, regenerated audit |

## Out of scope

- How one carry, catch or tackle is decided (the skill slopes), running-back committees, injuries.
- The AI's roster building and front-office reads (reported to the owner as a finding).
- Showing a team's day anywhere.
