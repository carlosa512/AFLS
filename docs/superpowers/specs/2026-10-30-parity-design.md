# Parity: any given Sunday

Date: 2026-10-30, revised 2026-10-31 · Comes before #115 (fewer sulkers), which rebases on it

## Why

Every pull request this week tripped over a different line of the sim check: #5 rushing, red-zone trips, #1 receptions,
overtime. Each sits on or near its limit on main, so any change that moves play (moods, injuries, anything) tips one.
Three attempts to tune rushing alone moved nothing over 60 seasons: the problem isn't one stat. It is the season's
shape, and digging into it turned up four causes, each hiding the next.

Measured on main (60 fresh leagues, `npm run sim -- 60`, and the four careers leagues):

| | Main | NFL |
|---|---|---|
| Margin that team strength predicts (SD) | 9.0 pts | about 5.5–6 (the closing line) |
| Final margin's spread around it | 12.6 pts | about 13.5 |
| Spread of team wins in a new league's season (SD) | 3.80 | 3.0–3.3 |
| The same, seasons 9–16 of a long league | 3.17 | 3.0–3.3 |
| Team seasons with 30+ rushing TDs (60 seasons) | 62 of 1,920 | 3 of 160 (2021–25) |
| Average depth of a throw (air yards) | about 10.9 | 7.7 (2024) |
| Share of throws 10–19 yards downfield | 36% | about 20% |

1. **A game's own randomness is a little small** (12.6 against 13.5): a strong team never has a flat day.
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
lineup rebuilt after an injury. `DAY_SD = 0.35`, sized so a margin sits about 13.3 points either side of what strength
predicts. ("Day", not "form": form is a player's in this engine.)

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

**Targets.** Verified: average intended air yards **7.7** (NFL, 2024); throws of 20+ yards about **7.7 a game**, under
**12%** of attempts since 2019; deep completion **36–40%** (35.9% over 2016–, 39.6% in 2025). The existing completion
(63–66.5%) and yards-an-attempt (6.7–7.3) ranges stay. From those, an intermediate (10–19) share of about **20%** and
short throws (under 10, behind the line included) about **68%** completing about **73%**; the plan pins these from a
per-depth table it can reach, or the owner supplies one, before they are judged.

**Levers**, all league-wide play calling and passing shape:

- **The call:** `coach.passDepth`'s situational mixes carry the intermediate throw at 20–40%; bring them to the NFL's
  share, more of it short. Scheme leans (`depth` in `schemes.ts`) stay relative to the league, so Air Coryell still
  throws deeper than West Coast.
- **Short throws as the NFL throws them:** screens and checkdowns behind the line as well as the quick game in front of
  it (the short air distribution), completing a little less often (`0.81` base today) and gaining more after the catch,
  the short game's yards coming from the run after it.
- **Already in:** the first receiver is the first read (more of his looks underneath, fewer deep; #1 receptions 117 to
  131, his share of the team's catches 24% to 26%, the NFL's typical leader 25–26%), and Air Coryell's shots come off the
  drop, not play action (its description never claimed both).

**Expected:** red-zone trips back inside 3.0–3.4 (drives less steady), the leaders near 12–13 yards a catch (#5
receiving yards under 1,500), Air Coryell's 1.5-point edge narrowed. Measured, not assumed.

## Stage 4: the trees' winner bar (after Stage 3)

Measured in the careers leagues' steady state once Stages 1–3 are in: set `WINNER.share` in `trees.ts` so the number of
active head coaches with five or more seasons who clear it is about the NFL's **8** (Reid, Tomlin, J. Harbaugh, McVay,
McDermott, LaFleur, Payton, Jim Harbaugh, entering 2025, of about 15 with five or more seasons). The five tree lines
must then read green with no range moved. Why the sim has fewer lasting winners than the NFL (coaching's edge, how
sharply front offices read other clubs' players, the owner's suggested blurrier read for everyone, the user included,
of players nobody on the staff has worked with) is a finding for the owner, not part of this change.

## Checks

- **`npm run sim`**, Parity: the margin strength predicts (SD) 5.5–6.5 (against the closing line), the margin's spread
  around it 13–14.5, the win spread 3.0–3.4. How often the better-rated team wins is shown, not judged: it follows from
  the first two (about 63–64%), and betting favourites win more (66–67%) because a line knows more than a rating. (The
  first version judged it at 65–69%; that contradicted the other two.)
- **`npm run sim`**, Passing by depth (Stage 3): average air yards 7.2–8.2, the deep share 10–13%, deep completion
  34–41%; the intermediate and short rows reported until their NFL figures are pinned, then judged.
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
| `src/engine/match/lineup.ts`, `match/gameSim.ts` | the day; the first read; Stage 3's short-throw shape and the per-depth counts |
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
