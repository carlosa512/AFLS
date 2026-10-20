# Training, practice and position moves

> **Status.** Position moves are built (phase 2 below, with AI moves from phase 6): the pairs and
> learning clock, cut-down-day flips, the coaches' read with a **reason** for every move (§4.7), AI
> front offices on the same planner, playing a player out of position in a pinch with the hidden
> **Versatility** trait (§4.8), the player card, Coaches and Roster screens and two kinds of mail. The
> calendar split, weekly development, practice, focus and mentoring are still plan only.
>
> This is the spec for an FM-style training layer: an
> offseason program and training camp as calendar steps, player development that moves week by
> week, coaches teaching a player a new position over time (no instant switch), an optional
> weekly practice plan, and hooks for mentoring later. It merges six research reports (the
> calendar, development, positions, the owner's 2030 Dallas save, NFL and FM research, the UI)
> and two independent design proposals. Every number marked **(T)** is a tuning target to be set
> by the new `npm run training` audit, not a measured fact.

## The plan on one screen

- **Zero input still works.** Coaches run everything by default. Nothing here ever blocks the
  primary button, and at most one question waits for you at a time.
- **Time.** In season the click stays one week. The offseason gains two steps after the draft:
  *Offseason program* and *Training camp*, then the existing cut-down day. No day-by-day stepping
  anywhere: a day earns a click only when it holds a decision (free-agency days do, practice days
  don't).
- **Development moves weekly.** Each player's year is still rolled once (so breakout years and
  busts survive), but it is *released* in steps through the new league year, camp and the 18
  weeks, shaped by that week's practice and playing time. Released all at once, it is exactly
  today's game, so the split is a dial walked away from today one measured step at a time.
- **Position moves are taught, never switched.** You (or the AI) start a plan; the destination
  room's coach teaches it; a learning clock ticks through the program, camp and season; the label
  changes only on cut-down day, once he is ready. Six pairs to start: CB→S, S→LB, LB→S, EDGE→LB,
  EDGE→DT, S→CB.
- **"Is it worth it?"** The coaches answer in words before you start: worth it, only if you need
  him there, or not worth it, with the time it takes and what you leave behind.
- **Cheese-proof by structure.** His body keeps its original aging clock, his ceiling is rebased
  so a move never improves a prospect, pay and tag can't be dodged, a mover can't be traded until
  the next league year, a player moves at most once in three years, and a team runs at most two
  plans at once.
- **Mentoring later**, with hooks built now (a mentor slot, one work-ethic accessor, a guard test).

## 1. What the research found

**How the owner plays (Dallas, 2030, week 16, 11-3).** Hands-on for the big calls (staff changes,
a personal draft board, a free-agent splash, shopping a quarterback for picks), delegated
everywhere else: injuries are left to the staff and the depth chart, although flagged manual, is
identical to the auto order. Every one of the 300 mails is triaged; 114 of them (38%) are medical.
So training must run itself, ask rarely, and mail little.

**Young players sit.** League-wide, 263 rostered players aged 25 or under have a ceiling gap of
1.5+; 154 of them (59%) played under a quarter of their team's games. Reps only come from game
days (`gp`, `match/lineup.ts:276`), and a player who never plays grows about 35% slower
(`development.ts:53-56`). This is the gap a practice layer can speak to.

**What a switch costs today, on paper.** Every player already has every rating, so any player
can be rated at any position (`ovrAt`, `injuries.ts:681`). The gap between a quality-14 player's
own overall and his overall at another position:

| Move | Gap (OVR) | What's missing | Verdict |
|---|---|---|---|
| EDGE→DT, TE→OL, S→CB | 0.1-0.2 | size (EDGE→DT +26 lb, TE→OL +44 lb) or speed (S→CB) | cheap on ratings, gated by body or legs |
| LB→S, S→LB, CB→S | 0.5-0.8 | tackling/run fits (CB→S), coverage and hands (LB→S) | natural moves |
| EDGE→LB, LB→EDGE, DT→EDGE, RB→WR | 1.2-1.4 | coverage (EDGE→LB: 7 vs 13), pass rush, speed, routes | real retraining |
| WR→TE, CB→LB, DT→LB | 2-3 | blocking, size | young players only, if ever |
| DT↔OL, QB→WR, WR→CB, OL→anything | 4-7 | whole skill sets frozen at about 4 | not a position move |

Ratings outside a position's profile never grow or decline (`development.ts:78`; they are rolled
around 4 at birth, `generate.ts:39`), which is why the last row is impossible.

**Age changes the answer.** Overall at the new position minus overall at the old, with aging:

| Move | 24 | 27 | 29 | 30 | 31 | 32 | 33 |
|---|---|---|---|---|---|---|---|
| CB→S | -0.78 | -0.55 | -0.23 | **+0.02** | +0.31 | +0.64 | +0.96 |
| EDGE→LB | -1.36 | -1.10 | -1.08 | -0.73 | -0.39 | **+0.02** | +0.50 |
| EDGE→DT | -0.15 | -0.05 | -0.05 | +0.08 | +0.18 | +0.31 | +0.45 |
| LB→S | -0.51 | -0.52 | -0.51 | -0.54 | -0.52 | -0.50 | -0.46 |
| S→CB | -0.20 | -0.39 | -0.41 | -0.73 | -0.98 | -1.27 | -1.59 |

So an aging corner becomes a safety around 30, an aging edge rusher a linebacker around 32, and
an EDGE can slide inside at any age if he carries the weight. **A linebacker moving to safety late
in his career stays about half a point worse at every age**: in the engine, as in the NFL, it is
a move for a team that needs a safety, not a way to extend a career. (The engine has one S
position; FS and SS are depth-chart spots, `schemes.ts:363-370`.)

**The real NFL agrees.** Light moves (CB to S for a former safety, S to a "money backer"): weeks to
one offseason. Medium moves (4-3 DE to 3-4 OLB, tackle to guard, WR to RB): an offseason plus a
season, with the staff hiding the player in year one (Kampman 2009, Cole 2013: coverage never
really came). Heavy moves (DL to OL, WR to CB, TE to tackle with +70 lb): two to three years, done
young. Veterans move to extend careers once speed fades and almost always toward the less
speed-critical spot (Rod Woodson, Charles Woodson, Ronde Barber); a veteran with no history at the
new spot declined (Antoine Winfield Sr.). Players need live contact reps to learn OL and DL
assignments; walk-through work suits coverage and recognition.

**Football Manager's model.** Position familiarity on a 0-20 scale, read in words: Natural (18-20),
Accomplished (15-17), Competent (12-14), Unconvincing (9-11), Awkward (5-8), Ineffectual. About
6-9 months from nothing, faster young, with a versatile, professional player, and with matches at
the spot. An instant, reversible switch is the classic exploit (Madden's "lower his overall,
spend skill points, move him back").

**Where cheese hides here.** Not on the field (a relabelled player plays at his real ratings), but
in everything priced off the label:
- **Aging.** Relabelling a 27-year-old back as a receiver gives him +3.8 OVR by 31 from the WR
  aging curve alone.
- **Pay.** An average starting EDGE relabelled LB drops from $19.7M to $4.6M at his next deal; an
  LB relabelled EDGE rises from $10.3M to $17.6M.
- **Tag.** The EDGE tag is $29.3M, the LB tag $14.2M.
- **Ceiling.** Growth is `potential - overall` at the current position (`development.ts:83`), so
  a bare relabel hands a 22-year-old a free retrain: DT to OL goes from 7.3 to 15.2 in five years.

**Calibration headroom is nearly gone.** `npm run careers` has the steady-state mean starter
overall at 13.19 against a 13.2 ceiling and the coaching growth ledger at 0.987 against a 0.985
floor; a +10% growth lever moved mean starter overall by up to +0.10. `npm run sim` has hamstrings
at 6.48 against 7.0, and the league practice-injury rate can only move between about ×0.7 and ×1.3.
**So nothing here may add growth: training changes when and where it lands, not how much.**

**What a tick costs.** A league-wide per-player loop on keyed streams is about 1.7 ms; `playWeek`
is about 250 ms; one free-agency day is 1.8-2.4 s on the owner's save (the AI bidding). Weekly and
camp ticks are affordable; anything that runs the AI market or games per day is not.

## 2. Time: how the calendar moves

| Period | Engine unit | Your click | Change |
|---|---|---|---|
| Regular season, playoffs | week (`playWeek`, `league.ts:107-130`) | "Play Week N" | none; the week also runs the training tick |
| Re-sign, free agency (5 days), draft | unchanged | unchanged | none |
| **Offseason program** (9 weeks: S&C, walk-throughs, OTAs, minicamp) | 3 blocks | "Run the offseason program" | new step |
| **Training camp** (5 acclimation days, 4 padded weeks) | 5 blocks | "Open training camp" | new step |
| Cut-down day | today's `case 'preseason'` body, unchanged | "Cut down and start the {season} season" | position changes happen here |

- **State.** One optional counter, `League.stage?: number` (absent = 0), indexes a registry in a
  new `src/engine/calendar.ts`, the same pattern as `faDay`/`FA_DAYS`. No new `Phase` values: a new
  phase touches about 15 files and old saves' transaction history.
- **CBA numbers are data.** One table in `calendar.ts` (16 padded practices in camp, at most three
  in a row and three such runs; 14 in season, 11 in the first 11 weeks; 1 per playoff week; 5
  acclimation days; 9-week program, 10 OTA days). The 2020 CBA runs through 2030, the year of the
  owner's save, so the numbers live in one place. A unit test proves the registry is CBA-legal.
- **Grain is a registry choice.** The default shows three preseason steps; a one-line registry
  edit shows seven (program, acclimation, camp weeks 1-4, cut-down). Engine blocks are identical
  either way, and a test proves stepping block by block equals running them at once.
- **"Run camp for me…"** is the secondary button in the preseason (the existing confirm-dialog
  pattern): the coaches run the program and camp and stop at cut-down day. Net cost against today:
  two clicks a year.
- **No preseason games in v1.** Adding them to `league.games` shifts `nextGameId` (and with it every
  future game's seed), about 12 inline `!g.playoffRound` filters, crew rotation and the climate
  month, and adds about 1 MB a save. Camp weeks carry the exposure instead. If wanted later, they go
  in a separate `league.exhibitions` array with its own id range.

**Traps the calendar change must handle** (all pinned in code today):
- `simOffseason` stops after 20 calls (`offseason/index.ts:196`, copied at `scripts/trades.ts:633`):
  replace with a bound from the registry.
- The cut to 53 and the position minimums apply to the whole `preseason` phase
  (`offseasonBlockers`, `offseason/index.ts:108-123`), and `rosterLimit` is 53 there
  (`negotiation.ts:41`): both become cut-down-day only, so camp keeps 90.
- Six streams and caches key on `(phase, week, faDay)` (`trade/market.ts:126`, `trade/offers.ts:205`,
  `trade/physicals.ts:92`, `negotiation.ts:74`, `trade/value.ts:94`, `scouting.ts:549`): one helper
  appends the stage **only when it is above 0**, so every existing key string is unchanged.
- `expireOffers` runs only where a market moment runs (not on program or camp steps).
- New steps never draw on `league.rngState`. Measured: one stray draw on the shared stream moved 24%
  of the league's players to other teams and changed 216 draft picks; 1,000 draws on a keyed side
  stream changed nothing. New streams are namespaced after the seed (`${seed}:train:…`), never
  `${seed}:${season}:${n}:<name>`, which collides with game sub-streams.
- `offseason.test.ts` (phase sequence, blockers on arrival in preseason) changes on purpose;
  `ledger.test.ts:148-161` and `coaching.test.ts:188-190` (determinism) must pass untouched.

## 3. Weekly development: roll once, release in steps

Today a player's whole year of growth or decline lands in one jump at the new league year
(`beginOffseason`, `offseason/index.ts:62-63`). The plan keeps the **roll** yearly and makes the
**release** weekly.

**Why not a fresh coin flip every week.** Fifty small independent rolls average out: breakout
years and busts would mostly vanish unless every band were retuned. And ratings are integers;
`developPlayer` dithers with `N(0, 0.35)` and rounds (`development.ts:111`), which is unbiased for a
yearly step but would make about 15% of ratings jitter ±1 every week.

**How it works.**
1. **Roll.** At the new league year, each player's year is rolled exactly as today: same stream
   (`${seed}:dev:${season}:${id}`), same draws, same order. The growth draw (or prime-years drift),
   the body's good-or-bad year, and each attribute's dither give a per-attribute target for the
   year. The retirement roll that follows on the same stream is unchanged.
2. **Release.** The target is released in shares: some at the new league year (as today, so free
   agency and the draft price the new ratings), some across the program and camp blocks, the rest
   across the 18 weeks. Each release applies `round(cumulative) - applied` per attribute, so
   ratings stay integers and never jitter.
3. **Inputs per release.** The new-league-year and camp shares use last season's playing time (as
   today). Each in-season week uses **that week**: a player who played gets the starter's reps
   factor, a player who sat gets the bench factor (the same linear `reps()` formula, so a full
   season averages to today's number). Later, the practice plan (§5) and focus (§6) shape these
   weekly shares too.
4. **Decline is released the same way:** a 31-year-old loses a little through the season instead
   of all at once in March. Physical decline can be weighted toward the offseason (T).
5. **True-up.** At the next new league year any unreleased remainder lands, then the next year is
   rolled.

**Starting split (T):** half at the new league year, a tenth across program and camp, the rest
over the season. **100/0/0 reproduces today's game byte for byte**, so the PR ships at 100/0/0
(golden hash green), then moves the split in measured steps. If the starter-overall path rises
(young players now improve during the season instead of after it), `GROWTH_NORM` (1.1,
`development.ts:58`) is retuned in the same PR; a band is never loosened.

**State.** Nearly none: the year's targets can be recomputed from the seed at any time. Per
player, only the integer amounts already applied this year (sparse; scars from injuries subtract
on top, as today). Deleted at the true-up.

**What it touches.** Mid-season ratings now change, so the trade-value and scouting caches must
key on the week (they already do); `ratingHistory` stays the league-year snapshot
(`development.ts:17-19`) and the player card gains a "this season" line. The two script replays
of development (`careers-league.ts:86-96`, `offseason.ts:229-242`) call one shared builder so they
measure the same thing.

**One edge.** A new career starts at week 1 of a season (`generate.ts:290-293`) with no rolled
year: the first season either rolls at creation (in-season shares only) or releases nothing until
the first new league year (simplest, and today's behaviour).

## 4. Position moves

### 4.1 The rules

- **Start:** only in the offseason (re-sign through camp), for a player under contract. Never in
  season.
- **Learn:** a learning clock ticks in the program, in camp, and each regular-season week. He keeps
  playing his old position the whole time: there is no dual listing in v1, so the depth chart still
  stores each player once (`roster.ts:47-62`).
- **Flip:** the label changes only on cut-down day, once his clock is done, in one function,
  `changePosition`, the only writer of `player.position` in the game. Cut-down day comes after the
  re-sign window, so a flip can never be timed against that year's tag or option, and a season's
  stats and awards are never split across two positions (`awards.ts:304,327`).
- **Slots:** at most two learners per team, user and AI alike.
- **Cooldown:** after a move, no new plan for 3 league years (T). It follows the player across
  teams and through release and re-signing.
- **Stop:** discards the progress. A trade or release ends the plan (the new staff starts over).
- **Mover lock:** a player who changed position this league year cannot be traded until the league
  year rolls over (`playerTradeBlocker`, `trade/rules.ts:43`, which every trade path already uses).

### 4.2 The pairs

| Move | Tier | Learning weeks (T) | Ages | Ready (Monte Carlo, T) | Why it's on the list |
|---|---|---|---|---|---|
| CB→S | A | 8 | 24-36 | this camp 97% | the classic late-career move; S overtakes CB around 30 |
| S→LB | A | 11 | 23-32 | this camp 72%, next 28% | money-backer; +17 lb |
| LB→S | A | 12 | 23-34 | this camp 52%, next 48% | for a team that needs a safety; never a career extender |
| EDGE→LB | B | 22 | 23-34 | next camp 97% | the owner's DE→LB; coverage is the missing piece |
| EDGE→DT | B | 24 | 25-34 | next camp 92% | slide inside with age; +26 lb |
| S→CB | B | 22 | 21-25 | next camp 99% | young only: speed can't be trained after 25 |

"This camp" means a plan started in the spring flips on this year's cut-down day: 9 program weeks
plus camp at ×1.5 is about 13.5 learning weeks. Every other ordered pair is refused (132 pairs
checked). **Next pairs, behind the economics probe (§11):** LB→EDGE and TE→OL (young only),
RB→WR. They are pay-up moves (LB to EDGE $10.3M to $17.6M) and TE→OL only looks cheap because size
isn't modelled.

### 4.3 The learning clock

`weekly progress = coach × age × work ethic × pace × contact × mentor`, bounded to 0.3-2.0:
- **coach:** the destination room's coaching rate, `coachingFor(league, teamId, to).rate`
  (0.7-1.3, `coaching.ts:230`). CB→S and EDGE→DT stay in one room; S→LB is taught by the
  linebackers coach.
- **age:** `1 - 0.02 × max(0, age - 24)`, at least 0.6 (T).
- **work ethic:** `1 + 0.03 × (workEthic - 10.5)`, 0.7-1.3 (T), read through `workEthicOf(p)` (§8).
  No new Versatility trait in v1: it would cost a migration and a draw per player, and work ethic
  already says "quick study".
- **pace:** hidden, 0.85-1.15, rolled once when the plan starts on `${seed}:train:pace:${season}:${id}`.
- **contact:** spring practice has no live contact (CBA), so contact-heavy moves learn at half speed
  in the program: EDGE→DT and S→LB ×0.5 in program blocks, coverage moves ×1.0.
- **mentor:** 1 in v1 (reserved, §8).
- Program blocks count their weeks, camp counts ×1.5 (full-time install), each season week 0.5.
  The clock has no randomness beyond `pace`, so stepping order can't matter.

Shown to you as words on the FM ladder (Awkward, Unconvincing, Competent, Accomplished), and as
"ready by this camp / next camp / the camp after", never as numbers or remaining weeks. The coaches'
estimate uses his expected rate, not the hidden pace, so it leaks nothing about hidden traits.

### 4.4 What changes when he flips (`changePosition`)

1. **Ceiling rebase.** When the new label rates him lower today, he keeps his headroom plus half of
   the lost points: `potential' = ovrNew + gap + 0.5 × drop` (T); otherwise `max(ovrNew, potential)`.
   It is never raised above what he had. Measured on young players five years on, converting is
   always a net loss against staying (CB→S at 23: -0.43; EDGE→LB at 23: -0.77): a move puts a
   prospect where the roster needs him, it never makes him better.
2. **The body keeps its clock.** Physical decline (onset and slope) follows the first position he
   ever held; technique and the mental game follow the new one. An optional `DevContext` input,
   inert (bit-identical) for everyone who never moved. It kills the aging arbitrage: a plain
   relabel lets an aging corner buy +1.1 OVR three years out; with the body clock, CB→S at 29
   breaks even after 3 years. `retireChance` and the market's `ageShift` follow the label.
3. **Skills.** Under 26, his development release while learning (and after) points at the new job:
   the share that would have gone to skills the new position doesn't weigh goes to the ones it needs
   (rating points conserved). At 26+, no ratings move in v1: a veteran's case rests on his skills
   already fitting, which is the NFL pattern (an aging corner already reads the field; an aging edge
   rusher's coverage never really comes). Retraining veterans would be new talent against a ceiling
   with 0.01 of headroom.
4. **Quirks.** Habits outside the new position's pool are dropped and his bag refilled
   (`quirks.ts:146, 203`); DLINE, DBS and RECEIVERS share pools, so EDGE→DT and CB↔S keep theirs.
5. **Depth chart.** He is inserted by rating, not appended last (with auto-sort off, a newcomer
   lands at the bottom today, `roster.ts:59-60`), then `syncDepthChart` runs.
6. **History.** `moves` records `{season, from, to}`; stat columns use the positions he has played;
   the text lookups that match `"<POS> First Last"` by current position (`ui/moves.tsx:20-31`,
   `inbox.ts:~928`) also try former positions, or better, transactions gain `playerIds`.
7. **Caches.** `leagueMarket` is invalidated explicitly (its key ignores positions,
   `finance/market.ts:60`); a `'position'` transaction is logged, which also moves the trade-value
   and scouting cache keys.
8. **Weight** moves toward the new position's range as he learns. It is cosmetic (the engine reads
   weight in one place, `gameSim.ts:1907`); body time is already inside each pair's learning weeks.

### 4.5 Pay, tag, trades

- His signed contract doesn't change (contracts carry no position). His next negotiation prices
  him as what he now is (`marketApy`, `finance/market.ts:96`). Moving to a cheaper position costs
  him money, which is natural friction.
- For two league years after a move, the franchise tag and fifth-year option use the **higher** of
  his old and new positions (`finance/market.ts:150, 159`).
- Learners and movers are valued at their current label. A mover can't be traded until the next
  league year; a trade or release ends a plan.

### 4.6 The coaches' "is it worth it?" read

One pure function, `conversionRead(league, teamId, p, to)`, for your own players only (exact
ratings; nothing about rivals). Words first, numbers one tap away:
- **Verdict:** Worth it / Only if you need him there / Not worth it.
- **Fit:** "He would start at LB ahead of Lawrence" or "depth only".
- **Leaves:** "You would have 3 EDGE left."
- **Time:** "Ready by this camp / next camp."
- **Price:** "His next deal would be priced as a linebacker (lower)."
- **Notes:** "He keeps playing EDGE until cut-down day."

A cross-position overall is never shown without its words. On the owner's roster, a 30-year-old
EDGE rates 13.0 at LB against 12.7 at EDGE, and that number alone would read like a free switch.

Your examples, as the coaches would read them:

| Case | Read |
|---|---|
| A young DE to LB | Not worth it unless you need an LB: he gives up about 1.4 OVR and needs an offseason plus a season to learn it. |
| An EDGE at 31-32 to LB | Worth it: near parity, and the gap grows the other way as he ages. |
| A CB at 30 to S | Worth it: he's already the better safety. |
| An LB to S late in his career | Only if you need a safety: about 0.5 worse at every age. |

### 4.7 Reasons: no move "just because"

A move is only ever *worth it* for a reason, and the coaches name it. `conversionRead` collects every
reason that holds (`Motive`, with a strength 0-1), each read from the team's own roster and plans:

| Reason | When it holds | In words |
|---|---|---|
| `hole` | the new position is short of starters now, he's no more than 1.5 worse there and his room can spare him | Fills a hole at S |
| `nextYear` | a starter there is well past his prime, or past it with his deal running out, and he'd be next in line | Takes over at S next year |
| `scheme` | the coordinator's scheme wants his skills at the new spot clearly more than at his own (the measure trade value uses), and he'd start | Smith's scheme wants him at LB |
| `upside` | 24 or younger, already as good there, and he'd start | His game fits S better |
| `reps` | 25 or younger, stuck behind starters signed two more years who aren't aging out, and he'd start there | Gets him on the field |
| `age` | past his body's physical turn, the new job leans less on legs, and he'd start | Extends his career: S asks less of his legs |
| `upgrade` | a point or more better than the starter there, at no cost to his own room | A clear upgrade at S |

Being a little better at the new spot is not a reason. Without one the verdict is at best "Only if you
need him there". AI teams weigh each reason by their GM (`motiveWeight`): every team fills a hole, a
patient GM looks to next year and gets young backups on the field, a win-now GM keeps veterans useful
and takes upgrades, a coordinator new this year gets his way more often. A reason must clear
`MOTIVE_BAR` (0.5) after weighting. The plan stores its reason (`Learning.why`) and the transaction
line says it ("KC moved LB Sam Reed to S: they were short at S"); the cut-down-day mail repeats it.

### 4.8 Out of position in a pinch

On the Roster screen, "Play at…" lines any player up at any position for as long as you leave him
there (it hand-sorts the chart, like a drag). He plays with his own ratings, which suit the job less,
plus a broad **knock** on every skill the engine reads for him (`knockFor` in `familiarity.ts`, applied
through `skill()`'s overlay while he's on the field): 2.5 points, half within his own room (CB↔S,
EDGE↔DT, WR↔TE), a quarter at a position he used to play, fading to nothing as he learns a position
he's training for. The hidden **Versatility** trait (1-20, drawn for every player, migrated at v30)
scales it from ×0.4 to ×1.6 and speeds learning a little (×0.75-1.25). Scouts read it in words ("Plays
anywhere", "One-position player"); screens show the knock as none / small / big, never a number. AI
lineups only use this to fill a hole (`FILL_IN`, by knocked overall).

## 5. Practice plan (later phase, optional)

Both design reviews argued against a team intensity dial in v1, and for good reason: a dial with a
free extreme (practice light every week, fewer injuries, no cost) is cheese, and padded work is not
a growth source here. With weekly development, practice *does* get a real hook, so the dial below
is designed to have no free extreme. It ships only after §3 and only if wanted.

- **One setting per week (and per camp step):** Light / Normal / Hard. Normal is today's practice,
  exactly. AI teams stay Normal.
- **The padded budget is the currency.** Season 14 (11 in weeks 1-11, 3 after), camp 16 (CBA).
  Normal follows the coaches' standard pacing. **Light saves one padded practice; Hard spends one
  you saved.** So Hard weeks can never outnumber Light weeks, and your season averages Normal or
  less. Shown as "Padded practices: 9 of 14 · 1 saved".
- **Effects (T), each inside the measured safe windows:**
  - practice-injury odds: Light ×0.7, Hard ×1.3. Thresholds are scaled, the draws stay the same, so
    the default rolls are byte-identical;
  - learning clock: Light ×0.6, Hard ×1.4;
  - development: a Light week cuts young players' practice-carried share of that week's release;
    a Hard week only restores what Light weeks took, never more;
  - **load:** two or more Light weeks in a row raise the next game's soft-tissue risk ×1.1 (×1.2
    after three). This is the 2020 natural experiment: no preseason ramp-up, soft-tissue injuries
    up by about half. A light camp carries it into the first two games.
- **Gates:** an all-Light season must come out worse than Normal (injuries no better, growth
  lower); all-Hard is impossible by the bank; league bands unchanged because AI teams stay Normal.
- **Not built:** per-player rest days (measured as inert: resting six veterans all season saves
  about 0.12 injuries) and a Mon-Sat grid (no engine consumer for "red zone day"). The coaches'
  weekly template can be *shown* on Home as flavour.
- **Camp injuries** (same phase, optional): camp rolls on per-player keyed streams, stamped week 0
  so they heal correctly (`injuries.ts:533`), with their own band in the audit. `npm run sim`
  counts any record with `week <= 18`, which would push the practice share to about 30%, so its
  scope becomes regular-season weeks (a stated redefinition for the owner to approve, not a
  loosened range).

## 6. Individual focus (later phase)

FM's "where do the points go", on top of weekly development:
- **Pin one attribute** for a player aged 25 or under: technical, weighted 1.5+ at his position,
  never awareness (starter awareness already drifts up about a point over 16 seasons and inflates
  scoring).
- **Zero-sum:** the focus attribute gets up to twice its share of each release, the others give it
  up so his overall at his position is unchanged. Probe: +1.4-1.6 in the attribute by 26, overall
  within 0.03 of neutral.
- **Strength grows with weeks held;** changing the pin resets it, so it can't be set just before a
  release.
- **Limits:** at most 5 pins per team. AI teams never pin, which is safe because it is
  overall-neutral.

## 7. AI front offices

- **Practice and focus:** AI teams run the default, so their development and injuries are exactly
  today's.
- **Position moves use the same `suggestMove` function the coaches use for you** (built). As the
  draft closes (`planMoves`), each AI team starts its best move if one is *worth it* for a reason its
  GM acts on (§4.7) and it has a free slot; the old position keeps `KEEP_MIN`. About six plans start
  a league year across the league, for mixed reasons.
- **Limits:** one plan per team (two for you); `trainingConfig.aiMoves` is the kill switch.
- **Still to do:** the twin-league audit (AI moves on vs off, same seeds). Filling holes with surplus
  players is real allocation gain (measured +0.008 to +0.019 mean starter overall per offseason at a
  plain rule, against 0.01 of headroom), so if the twins show drift the bar rises or `GROWTH_NORM` is
  retuned in the same PR.
- **Same locks as you:** cooldown, slots, the mover's trade lock. Learners are never on an AI
  trade block.

## 8. Mentoring (later; hooks now)

The agreed rules, kept small and hard to game, for you and the AI alike:
- **Small:** work ethic moves at most 1 point a year, only for players about 21-24.
- **Cuts both ways:** a lazy veteran drags a young player down.
- **Needs time together:** it builds week by week while both are on the active 53 (IR pauses it).
  A veteran signed for two weeks does nothing; trading either ends it.
- **Small groups:** one mentor per player, at most two players per mentor, no stacking.
- **Position bonus:** only if the mentor plays or played the target position (read from `moves`),
  capped at ×1.1-1.15.
- **Words only:** "learns well from Smith".

Hooks that land with the earlier phases, so mentoring is a small change later:
1. **`workEthicOf(p)`.** One accessor replaces the direct reads of work ethic (growth, decline,
   quirk bag, trade value, ex-player coaches). Mentoring later adds a bounded, stored offset
   behind it rather than mutating `traits` (traits never change today, and `npm run careers`
   relies on that).
2. **`learning.mentor`** is a reserved slot on the plan, and **`mentor`** a named factor in the
   learning clock (returns 1).
3. **The weekly training tick** is where weeks-together accrue.
4. **A guard in `npm run training`:** work ethic is identical for every player over a 6-season
   league. The mentoring PR changes it on purpose: per-player change at most 1 a year, league mean
   within ±0.02. The owner signs off on `npm run careers`.

## 9. UI and mail

| Where | What | Phase |
|---|---|---|
| Header, Home stepper, primary button | `calendarLabel(league)` replaces the four hard-coded "day N" strings (`App.tsx:95, 280`, `Home.tsx:473`, `FrontOffice.tsx:873`). The stepper keeps 5 steps; a thin bar under "Camp" shows program → camp → cut-down. | 1 |
| PlayerCard, new "Position" section (own players, folded by default) | Could learn (up to 3 targets, each with the read), Learning (ladder word, "ready by…", coach), Moves (history). Outside the offseason: "Position moves start in the offseason." on screen, not in a tooltip. | 2 |
| Coaches tab, "Position work" panel | Learners and the one suggestion; the single setting **"Coaches may start position moves on their own"**, off by default (you keep the big calls; *Sim offseason* never moves anyone otherwise). | 2 |
| Roster | Pills "Learning LB" (own players) and "Out of position (RB)"; "Play at…" on each of your rows lines him up elsewhere (it hand-sorts the chart, as a drag does) with the knock in words per choice. | 2 |
| Mail (2 kinds) | **Suggestion** (Needs you; at most one a year; lapses quietly when you advance; "Not now" is remembered two seasons) and **"Howard is now a linebacker"** (folded, with "placed by rating on your depth chart"). Category `staff`, tag "Training". | 2 |
| PlayerCard, "This season" line | Weekly arrows ("+1 coverage since camp") and the development chart, own players only. | 3 |
| PlayerCard, focus row | "Focus: Coaches choose / Tackling / …", styled like the returner picker. | 4 |
| Front office, Training tab | Only when the practice plan ships: this week's setting, the padded meter, position work, focus list. | 5 |

- **Fog of war.** Nothing about a rival's plan is stored in any view or rendered. You see the
  public label change, the transaction line and his position history; scouts read him at his new
  label through `perceive`. A static test forbids learning internals and hidden traits in `src/ui`
  (the `development.test.ts:282-290` scan).
- **Mail budget.** Never a weekly training mail, never a per-player progress mail; at most two
  mails per move in its whole life.

## 10. Data model and migration

```ts
League.stage?: number;                       // §2: index into the preseason registry, absent = 0
Player.learning?: {                          // §4: at most 2 per team
  to: Position; done: number; pace: number;  // learning-weeks banked; hidden pace 0.85-1.15
  since: number; teamId: number;             // a team change ends the plan
  mentor?: number;                           // reserved for §8
};
Player.moves?: { season: number; from: Position; to: Position }[];  // newest last, keep 4
Player.devApplied?: Partial<Record<Attribute, number>>;            // §3: this year's released ints
Player.focus?: { attr: Attribute; weeks: number };                 // §6
Team.training?: { coachesDecide?: boolean; passed?: Record<number, number>;
                  week?: 'light' | 'normal' | 'hard'; saved?: number };  // §4, §5
Transaction.kind += 'position'; Transaction.playerIds?: number[];
```

- **Everything is optional:** absent means today's behaviour. Each phase bumps `SAVE_VERSION`
  (`generate.ts:27`, now 26) with the one-line no-op migration idiom (`migrate.ts:38-52`). The
  owner's v25 save passes through the chain in microseconds.
- **Size:** learners about 90 B each (at most 64), moves about 45 B each, `devApplied` a few
  entries per developing player, cleared yearly. All under 25 KB, far from the save-size bands.
  `learning` and `focus` are deleted at retirement, like `quirkBag` (`offseason/index.ts:77`).
- **New streams:** `${seed}:train:pace:…` (§4.3), `${seed}:train:camp:…` (§5), and
  `${seed}:train:convert:…` (§7). `league.rngState` is never touched.

## 11. Exploits and how each is closed

| Exploit | Who | Closed by |
|---|---|---|
| Instant relabel (the Madden switch) | both | No API: `changePosition` runs only on cut-down day, after the clock; audit counts any other write as a failure |
| Relabel and back to reset aging or the ceiling | both | 3-year cooldown on the player; each move rebases the ceiling down; the body clock never resets |
| Aging-curve arbitrage (RB→WR +3.8 by 31) | both | Physical decline keeps the first position's curve |
| Pay arbitrage (cheap LB → EDGE, sell) | both | Pay-up pairs not in v1; mover can't be traded until next league year; next deal priced as what he is |
| Cheap tag or option via a lower-paid label | both | Flip comes after the re-sign window; tag and option use the higher position for two years |
| Free retrain for a young player | both | Ceiling rebase; audit: young convert-minus-stay never above 0.00 at +1 and +3 years |
| Veteran retraining minting talent | both | No ratings move at 26+ in v1; audit hashes every rating across training calls |
| Hop through allowed pairs to a forbidden one | both | Directed list, age windows, cooldown; audit tries every 2-hop path |
| Stack learners | both | Two slots per team |
| Start, stop, restart to bank progress | user | Stop discards progress |
| Buy a learner, or trade to dodge the lock | both | A team change ends the plan; the mover lock lives on the player |
| Mine the estimate for hidden traits | user | Estimate uses the expected rate, quantized to camps, words only |
| Read a rival's plans | user | Never stored in views; static UI scan |
| AI mass conversion inflating talent | AI | Need-gated, tier A, league dial set by twin-league audit, 0 kill switch |
| AI leaves a hole or breaks a depth chart | AI | Source stays at `KEEP_MIN`; moves complete before AI camp cuts; hole counts stay 0 |
| Practice light every week | user | Load rule raises game soft-tissue risk; young growth drops; audit: all-Light is worse than Normal |
| Practice hard every week | user | Hard spends a saved padded practice: impossible more often than Light |
| Focus on the best-per-point attribute, or awareness | user | Technical only, weight 1.5+, no awareness, overall-neutral, 5 pins |
| Re-pin focus right before a release | user | Strength grows with weeks held; a change resets it |
| Save-scum a roll | user | Every roll keyed by (seed, season, player); the clock has no randomness |
| Mentor farming: rent a veteran, stack mentors | both | 12+ weeks together on the active 53, resets on separation; 1 mentor, 2 mentees; ±1 a year, both ways |

## 12. Phases and checks

Every PR runs `npm run check` (engine changes route to typecheck, test, sim, endings, offseason,
careers and more); treat each as `--all`. A range is never loosened.

| # | Phase | World | Must pass |
|---|---|---|---|
| 1 | **Calendar.** `calendar.ts` with the CBA table and registry, `League.stage`, the preseason split with the old body as cut-down day, `calendarKey`, step-aware blockers and roster limit, the guard in two places, `calendarLabel` and button strings, "Run camp for me…", migration | **identical** (golden hash vs main) | `check --all` logs equal main's; `offseason.test.ts` updated on purpose; determinism tests untouched; `training` §A |
| 2 | **Position moves for your team.** `training.ts` (pairs, clock, read, start/stop, tick, `changePosition`), `suggestMove`, body clock in `DevContext`, locks, tag rule, text-lookup fix, PlayerCard and Coaches panels, Roster pill, 2 mail kinds | identical unless you start a plan | `careers` unchanged to the digit; `training` §B-D, I, J; manual run at phone width |
| 3 | **Weekly development.** Roll once, release in shares, weekly reps inputs, true-up, PlayerCard "this season" | identical at 100/0/0, then changes on purpose | golden at 100/0/0; then `careers`, `sim -- 30`, `offseason -- 6`, `trades` at the chosen split; retune `GROWTH_NORM` in the same PR if needed |
| 4 | **Focus.** Zero-sum pin, `workEthicOf` accessor | only pinned players | `careers` Part 1 identical; focus cohort overall at 26 within ±0.05; `audit` |
| 5 | **Practice plan** (+ camp injuries, optional). Weekly setting, padded bank, load rule, Training tab | AI identical; user changes | `sim` bands for AI-only leagues unchanged; `training` §G extremes |
| 6 | **AI position moves.** Same planner, dial, twin leagues | changes on purpose | `training -- --twins 12`: starter overall within ±0.005, holes / below keep-min / bad depth all 0; `offseason -- 6`; `careers` |
| 7 | **Mentoring** | changes on purpose | owner signs off `careers`; `training` §K rewritten |

**Later, not scheduled:** preseason games (separate array); playing a learner at his new spot in
season (now possible by hand with "Play at…", §4.8); the next pairs
(LB→EDGE, TE→OL, RB→WR); a derived Full/Limited/DNP line; automatic veteran rest days; a practice
squad (the real home of bench youngsters' reps).

**`npm run training`** (new, about 60-90 s, wired into `scripts/check.ts` with the usual
"N number(s) outside target range" summary):
- **A Calendar:** CBA legality; stepping block by block equals running at once; golden hash vs main;
  `rngState` untouched by early steps.
- **B Invariants:** position written only on cut-down day; no flip in season; slots, cooldown and
  locks hold; quirks valid for the new position; the ceiling never rises at a flip; ratings unchanged
  by learning calls for 26+.
- **C Pair table:** readiness by pair and age against the table in §4.2; convert-minus-stay at +1,
  +3, +5 years; every 2-hop path refused.
- **D Economics probe:** pay, tag and a trade-value proxy before and after; flip profit at most 10%
  of trade value for every pair (this decides the "next pairs").
- **E Weekly development:** 100/0/0 bit-identical; at the chosen split, `careers`-style cohorts in band.
- **F Focus cohort.**
- **G Practice extremes:** all-Light worse than Normal; Hard bounded by the bank; camp band.
- **H Twin leagues** (AI moves on vs off).
- **I Fog:** static scan of `src/ui`.
- **J Size and speed:** under 25 KB added; the weekly tick under 2 ms league-wide.
- **K Mentoring guard:** work ethic unchanged for every player until phase 7.

## 13. Open questions for the owner

**Decided (owner):**
- **Order:** position moves first, then weekly development.
- **Veterans:** a mover carries the skills that make sense at the new spot and gains no new ones.
  This is what the engine already does: ratings belong to the player, the new position's weights
  decide what counts (a corner's coverage and hands carry to safety), and skills the new position
  never uses simply stop changing. No technique retraining at 26+.
- **AI moves:** built now, tested after. Every move needs a reason (§4.7): a hole, next year, the
  coordinator's scheme, upside, reps, age or a clear upgrade, never "why not".
- **Out of position:** you can line anyone up anywhere in a pinch; he takes a broad knock, smaller
  for a versatile player (§4.8).

**Still open:**

1. **Weekly release split:** start at half at the new league year, a tenth in program and camp, the
   rest in season? (100/0/0 = today.)
2. **Pairs:** six to start; add LB→EDGE, TE→OL, RB→WR later behind the economics probe?
3. **One flip window,** cut-down day: a vet ready in week 12 becomes a safety next camp. OK?
4. **AI moves volume:** about six a year now; the twin-league test decides whether that stays.
5. **Practice plan (§5):** build it as designed, or leave practice to the coaches for good? Both
   design reviews leaned "leave it".
6. **Camp grain:** 3 preseason steps (default) or 7 (each camp week its own step)?
7. **Camp injuries:** wanted? They redefine what `npm run sim` counts as the season.
8. **"Coaches may start position moves"** off by default. Right?
9. **Suggestion bar:** a reason must score 0.5 after the GM's weighting (yours count fully). Raise
    it if the coaches speak up too often?
10. **Mentoring:** a stored, bounded work-ethic offset behind `workEthicOf`, or change the trait
    itself?

## Sources

- CBA practice rules (Articles 21, 23, 24, 35): https://overthecap.com/collective-bargaining-agreement/article/23 ,
  https://mail.overthecap.com/collective-bargaining-agreement/article/24/section/1 ,
  https://overthecap.com/collective-bargaining-agreement/article/35 ; offseason program:
  https://operations.nfl.com/updates/football-ops/nfl-offseason-workout-program-dates-announced ;
  2026 dates: https://www.nfl.com/news/2026-nfl-training-camps-report-dates-locations-announced-for-all-32-teams
- No-preseason injury spike (2020): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9158490/
- Conversions: Kampman https://nfl.com/news/kampman-packers-make-progress-in-3-4-switch-but-far-from-done-09000d5d810ff1d4 ;
  Woodson to safety https://www.packers.com/news/woodson-steps-into-safety-position-7637275 ;
  Barber https://www.buccaneers.com/news/switch-to-safety-opens-new-possibilities-for-barber-8178498 ;
  Winfield Sr. https://www.cbssports.com/nfl/news/winfield-puts-talk-of-playing-safety-to-rest ;
  Neal, tackle to guard https://www.nfl.com/news/evan-neal-giants-doing-well-so-far-in-transition-from-tackle-to-guard
- FM familiarity and retraining: https://sortitoutsi.net/content/67473/fm24-guide-how-to-retrain-players-position ,
  https://www.footballmanager.com/node/145
- Madden reposition exploit: https://www.madden-school.com/how-to-increase-your-overall-rating-much-quicker-in-madden-20-franchise-mode/
- Research notes behind this doc: `docs/research/attributes-development-scouting-roadmap.md`
  (§2.3 practice scheduler, §3.1 mentoring).
