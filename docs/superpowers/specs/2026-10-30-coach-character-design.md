# Coaches with character: traits, agency and pedigree

Date: 2026-10-30 · Follows the MVP follow-up "Coaching trees run at the floor of their NFL bands" (`f2eb90b`) ·
Builds on the trees spec (`2026-10-28-personality-relationships-design.md` §4)

## Why

Two problems, one cause: coaches are furniture. Clubs decide everything and coaches never choose.

1. **Trees are thin.** Every tree number sits at the floor of its band (`npm run careers`): 2.2 live trees a league,
   0.15–0.18 of head coaches in one, 0.11–0.16 of head-coach hires from one, and births that swing from 1.5 to 3.5
   between worlds that play almost alike. Head-coach searches ignore pedigree until a tree already exists, and
   `coachAsk` charges a winner's assistants more, so the budget filter prices them out instead of drawing owners to
   them.
2. **Nobody feels alive.** A coordinator never turns down a head-coach job, a content DC can't stay a DC, and a fired
   head coach can't step back down to coordinator: a market coach only competes for the chair he last held
   (`fillChairs`, `sameChair(chairOf(c), chair)`), and promotions only go up (`promotionFor`). A coach has on-field
   habits (`coachQuirks.ts`) and nothing else to his character.

## Decisions (agreed with the owner)

1. **One PR**, built in order: traits, then agency, then pedigree. Everything is calibrated once at the end, because
   traits and agency both change who gets hired.
2. **Four traits, stored, each with a job:** ambition, loyalty, adaptability, discipline. Each one is hidden, 1–20, and
   shown only in words.
3. **Pedigree is demand.** Head-coach and coordinator searches lean toward men who served 3+ seasons on a winner's
   staff, from the season he becomes a winner, before any tree exists.
4. **The strongest pull wins.** A candidate can have up to four pulls: his tie to the hiring head coach, his tree's
   standing, pedigree, and a riser's winning-staff pull (`HOT`). Only the strongest counts. Penalties (a withering
   tree, a tree that already landed a job this offseason, a losing staff's riser) still add on top.
5. **Price changes only if the gate says so.** The plan's first measurement checks whether the budget filter is what
   drops pedigree men. If it is, the owner gets a concrete price proposal before any code. Whatever happens, a club
   checks its budget against the same ask it pays, for AI clubs and for you alike, and the league's average ask
   doesn't move.
6. **Same rules for you.** A lifer turns down your promotion just as he turns down an AI club's.
7. **A small character box on the coach card,** under the scheme row, styled like the player scout's report. No other
   new UI, and no new mail.
8. **No band or check range changes.**

## 1. Coach traits

`Coach.traits?: CoachTraits` (`types.ts`): `{ ambition, loyalty, adaptability, discipline }`, each 1–20 on the player
traits' scale (`TRAIT_MEAN` 10.5, sd 3.5). A new module, `coachTraits.ts`, owns the rolls, the drift and the words.
No screen or letter reads a number from it.

**Each trait acts only in the chairs where it has a job, and the box only describes it there:**

| Trait            | Acts for                    | High                                                    | Low                                                             |
| ---------------- | --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| **Ambition**     | everyone                    | goes after the step up (§2)                              | stays put; a fired head coach steps down readily (§2)            |
| **Loyalty**      | everyone                    | answers his old boss's call; re-signs readily, a little cheaper | ignores old ties; tests the market; asks a little more to stay   |
| **Adaptability** | coordinators                | bends to his head coach's vision                         | runs his own system wherever he goes                             |
| **Discipline**   | head coaches                | fewer pre-snap and personal fouls; a slightly quieter room | a happier room; slightly more of those flags                     |

**Hooks** (starting values; calibration sets the final ones):

- **Loyalty:**
  - **His tie to the hiring head coach:** `TREE_PULL` (`trees.ts`) is scaled by loyalty, from about half at 1 to
    about one and a half times at 20.
  - **Re-signing:** in `aiCoachMoves`' `decide`, `KEEP[role]` moves by up to ±0.15 at the extremes, and his ask to
    stay with his own club by up to ±5%. Both are centred, so the league's re-sign rate and payroll hold.
    `coachResignForecast` reads the same rule, so your forecasts match what happens.
- **Adaptability** (read at the moment, nothing stored): under a head coach, a coordinator runs a bent version of his
  own plan. The share he bends goes from 0 at 1 to 0.8 at 20.
  - **Offense:** his pass lean moves that share of the way toward the head coach's `Vision.pass` (`callerStyle`).
  - **Defense:** with that share as the chance, on a roll seeded by the coordinator and head coach ids, he runs the
    front and coverage the head coach wants (`teamScheme`).
  - **Hiring and keeping read the same bend.** `visionFit` scores the bent plan, so the hiring score and
    `cleanHouse`'s keep chance agree with what happens on the field.
- **Discipline** (head coach only, centred on the mean, so a typical head coach changes nothing):
  - **Fouls:** his team's false starts, offsides and personal fouls (roughing the passer, unnecessary roughness, face
    mask, horse collar, unsportsmanlike conduct) are scaled by up to ±8% at the extremes. The multiplier is read once
    per game, like the crew's (`match/gameSim.ts`). The engine already has a player-level `discipline()`; the coach's
    multiplier gets its own name, so the two can't be confused.
  - **Mood:** his players' `room` factor moves by up to ±0.5 at the extremes (player's coach up, disciplinarian down),
    read once per pass through `moraleContext`.

**Where traits come from:**

- **New coaches:** `rollCoachTraits(seed, c)` runs wherever a coach is born, on its own stream
  (`${seed}:coachTraits:${id}`), just as `generateCoachQuirks` does. Ambition at birth leans young: about +0.15 for
  each year under 45.
- **Former players** (`exPlayerCoach`) carry their character in, with a little noise:
  - ambition from his `personality.winning`
  - loyalty from his `personality.loyalty`
  - discipline from his sportsmanship and temperament
  - adaptability from his versatility
- **Drift** (at the new league year, no draws): ambition cools by a point a year from 56, and drops 3 after he's fired
  as a head coach for the second time. The other traits stay put.

## 2. Agency

**Wanting the step up.** `wantsStepUp(league, c, chair)` answers once per coach per offseason, on a pure roll
(`${seed}:wants:${season}:${id}`), so every club's search sees the same answer.

- **Head-coach chair:**
  - **Lifers** (ambition 5 or less) always say no.
  - **Climbers** (15 or more) always say yes.
  - **Everyone else:** a yearly chance that rises with ambition, from (ambition − 5) / 10, less 0.05 a year past 55.
- **Coordinator chair** (position coaches): the same shape, a step easier: lifers at 3 or less, climbers at 13 or
  more.
- **Where it applies:**
  - every riser in `fillChairs` (his own club's, the market's, and a poach)
  - your promote and poach moves (`promoteProblem`, `poachProblem`), where the refusal is the existing reason line,
    e.g. "He's happy running your defense: he won't take head-coach talks."
- **Interim appointments ignore it:** finishing a season is duty, not a career move.
- **Owner mandates still win:** a promised coach is not a candidate either way.

**A refusal is a moment, not a filter.** The search scores every candidate as it does today, the unwilling included
(one noise draw each, so the stream is unchanged), then hires the best man who wants the job. If the best overall said
no, for a head-coach or coordinator chair, the league log records it with `logCoach`: "NYX's top choice, DC Ray Holt, turned down head-coach talks."

**Stepping down.** `stepsDown(league, c, when)` is decided on its own pure roll (`${seed}:stepDown:${season}:${id}:${when}`):

- **When:** right after a head coach is dismissed (`dismiss`), including an interim who isn't kept
  (`resolveInterimHeadCoach`). Anyone still unhired at camp (`ensureCoached`, before `CAMP_DRIFT`) decides again.
- **The chance:** starting near 0.3. It rises with age (+0.04 a year past 50) and with a prior firing (+0.2), and falls
  with ambition (−0.05 a point above 10). An interim who isn't kept adds +0.4; the camp decision adds +0.2. It stays
  between 0.05 and 0.9.
- **Where he goes:** the coordinator chair of his own side, from his career rows (his last `offCoord` or `defCoord`
  season). A coach who never coordinated waits for a head-coach job.
- **Stepping down** changes his `role` on the market. He keeps the style and scheme he had; anything missing is rolled
  as `asPromoted` does. The log reads: "Former NYX head coach Ray Holt will look for coordinator jobs."
- **He can still climb back:** as a market coordinator he's a riser for head-coach chairs. If he gets one, he counts
  as a retread (`scripts/offseason.ts`).

**Out of agency's reach (on purpose):** climbers don't demand promotions or quit, and a sitting head coach never
resigns to take a coordinator job.

## 3. Pedigree

`pedigreeDemand(league, c)` in `trees.ts`, next to `winnerAsOf`, returns 0–1. Nothing is stored and nothing is drawn.

- **The links:** `linksOf(league, c.id)` with `as === 'headCoach'`, so 3+ seasons on that man's staff while he was
  head coach.
- **The mentor:** he counts once he's a winner as of this league year, by `winnerAsOf(league, mentorId,
league.season)` (`WINNER`: .550 or better over 5+ head-coach seasons).
- **Strength:** 0.4 for a bare winner, rising in a straight line to 1.0 for a .700 winner, read from his head-coach
  win share through his last head-coach season by now (as `winnerAsOf` reads it). A founding
  root (`'always'`), who has no record, gets 0.4. Win shares are cached by season in `Index.winners`, so a search never
  rebuilds `coachRecord` per candidate.
- **Fade:** demand halves for every 3 seasons since `link.last`, counted as `max(0, season − 1 − last)`. Pre-league
  service (`pastUnder`, `last = −Infinity`) fades to 0. Those men already sit in founding trees, which `treeLean`'s
  standing term covers.
- **More than one mentor:** the best one counts; they don't add.

**The pull lives in `treeLean`.** It gains an optional `riserPull` argument (≤ 0) that `fillChairs` passes from the
`HOT` term. Scores are lower-is-better:

```
tie       = linked to the hiring head coach ? −TREE_PULL × loyaltyScale : 0
standing  = head-coach chair and in a tree ? TREE_STANDING[standing] : 0
pedigree  = −PEDIGREE_PULL[role] × pedigreeDemand      (head coach ~0.5, coordinators ~0.3, others 0)
lean      = min(tie, min(0, standing), pedigree, riserPull) + max(0, standing) + crowd
```

`fillChairs` keeps `HOT`'s penalty side (`max(0, …)`, a losing staff) in its own score and hands only the pull side to
`treeLean`. With no pedigree and no riser pull, `treeLean` returns exactly what it does today.

**Price (gated):** see decision 5. `coachAsk`'s `pedigree` term stays as it is unless the gate says otherwise.

## 4. The character box

On the coach card (`CoachCard`, `ui/screens/Coaches.tsx`), under `SchemeRow` and `CoachTags`, before "Habits over
time". It reuses the scout report's `report` box:

> **Around the league**
> **Climber.** He wants his own team, and soon. Runs whatever his head coach asks.

- **The name:** the trait furthest from the middle among those that act in his chair, if it's at least 4 points out
  (about one sd). Ties go by a fixed order: ambition, loyalty, adaptability, discipline. **The sentence** is that
  trait's line, then the next one's if it's also 4 points out. A retired coach is read by his last chair.

| Trait        | High                                                                  | Low                                                                   |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Ambition     | **Climber.** He wants his own team, and soon.                          | **Lifer** (not head coaches). Happy where he is; he doesn't chase the next job. |
| Loyalty      | **Loyal Lieutenant.** Answers when his old boss calls, and stays when he's wanted. | **Hired Gun.** Goes where the job is best; don't count on a hometown discount. |
| Adaptability | **Chameleon.** Runs whatever his head coach asks.                      | **True Believer.** Runs his own system wherever he goes.               |
| Discipline   | **Disciplinarian.** Runs a tight ship: few flags, a quieter room.      | **Player's Coach.** His players love him; so do the officials' flags.  |

- **No trait stands out:** **Steady Hand.** "Nothing extreme: a pro's pro."
- **A head coach with low ambition** takes no name from it, but can get the line "If he lost this job, he'd run a side
  of the ball again rather than wait."
- **Public:** a coach's reputation is league knowledge, so the box shows for every coach, yours or not, in words only.
  `docs/UI.md`'s fog-of-war list gains "a coach's character (`coachCharacter`), in words".
- **The scheme row shows what he runs now:** on a staff, a coordinator's `SchemeRow` reads his bent plan, and his own
  leaning goes in the tip.

## 5. Randomness and saves

- **Every new draw has its own stream:** traits, wanting the step up, stepping down, and the defensive bend. The
  search's noise is unchanged (one draw per candidate, the unwilling included), so turning agency on reshuffles
  nothing else.
- **Pure where possible:** pedigree, adaptability's bend, the box's words and trait drift draw nothing.
- **Saves:** `SAVE_VERSION` 69 → 70. A `migrate.ts` step gives every coach, active or retired, the traits
  `rollCoachTraits` would give him, so an upgraded save matches a new league from its seed. Stepped-down coaches need
  no migration (`role` already exists).

## 6. Calibration and done

**Research first** (`docs/research/coaching-carousel.md`): what fired NFL head coaches do next (coordinator within two
seasons, another head-coach job, out), and how often coordinators turn down head-coach interviews. Agency is tuned to
it. Hand counts are marked (est.).

**Measured on 8 worlds** (the 4 careers seeds plus 4 more), with every number compared to main:

- **Trees** (`npm run careers`): every number inside its band with 10% of the band's width to spare at each edge, on
  every world:

  | Number                                | Pass zone   |
  | ------------------------------------- | ----------- |
  | live trees (steady)                    | 2.3–4.7     |
  | head coaches in a live tree            | 0.175–0.375 |
  | hires from a tree                      | 0.125–0.325 |
  | biggest tree (steady)                  | 3.3–5.7     |
  | trees born per league                  | 1.3–3.7     |
  | most hires from one tree in an offseason | 0.36 or less |
  | founding trees alive at the end (fewest) | at least 1 |

  Births also vary less between worlds than on main. If they don't, stop and bring a step-two proposal (a simpler
  birth rule) to the owner before coding it.
- **Carousel** (`npm run offseason -- 6`): every check in range and near main, including new head coaches per season,
  the retread share and the coordinator share of head-coach hires. The coaching ledger holds at ×1.00. New
  informational lines report refusals and step-downs per season, read against the research. They aren't failing
  checks.
- **Morale** (`npm run morale`): nothing flagged. Discipline's room term is centred, so there's no drift.
- **Fouls** (`npm run sim`, `npm run crews`): flags per game in range. Discipline is centred.
- **Parity:** head-coach changes about 7 a year, and year-to-year win-share correlation about 0.335 (measured by the
  plan's scratch runner).
- **Trades** (`npm run trades`): doesn't move.

## Out of scope

- New mail, or any screen besides the character box and the scheme row's bent plan.
- Climbers demanding promotions or quitting; a sitting head coach resigning to coordinate.
- Coaches' own moods or morale.
- The tree-birth rule (step two, only with the owner's OK).
- Any band or check range.
