# Quirks — design sketch

Status: **steps 1–3 built, plus a fine-tuning pass** (§7): the bag, grip, 83 quirks (every Tier A quirk), the engine hooks,
scouting, the player card, AI front offices valuing what their scouts see, game states (Rattled,
Shaken, kicking slumps) and event, season and scheme marbles. Goal: FM-style player habits ("Stares down his first read",
"Ice-water veins") that make players feel alive. A player can carry several, and gains and loses
them across a career and within a season, driven by a seeded **marble bag**.

## 1. Quirks vs. the traits we already have

| | Traits (exist today) | Quirks (new) |
|---|---|---|
| What | Who he is inside: work ethic, durability, temperament | How he plays: on-field habits |
| Scale | Hidden 1–20 numbers | Named tags, 0–3 per player |
| Changes? | Never | Yes: gained, reinforced, lost |
| Seen through | Sit-downs (scouting visits), slowly | **Film**: habits show on tape, so they reveal faster than makeup |
| Drives | Development, aging, flags | One situational lean in the match engine |

Traits stay as they are. They become **inputs to the bag**: a hard worker draws more "fix it"
marbles, a hothead draws more "Jump-Happy" ones.

### Two layers: quirks and states
- **Quirk**: a habit that lasts (weeks to a career). Example: *Sees Ghosts*.
- **State**: what is happening *right now*, within a game or across a few weeks. Example: *Rattled*
  (after 2+ sacks this game) or *Yips slump* (after a big miss). States are what make some
  quirks "fire". *Sees Ghosts* only matters while the QB is Rattled, and a kicker with *Yips
  Susceptibility* enters a slump after a high-profile miss.

States are game- or week-scoped and never saved past the season. Only players with the matching
quirk get a state: an ordinary QB who takes three sacks just had a bad day.

| State | Starts | Lasts | Ends early |
|---|---|---|---|
| **Rattled** (*Sees Ghosts*) | His 2nd sack in a game | The rest of **that game** | Halftime, or three straight completions, each a coin flip |
| **Shaken** (hangover) | A game with 5+ sacks while Rattled | The **next game**, at half strength | Never early |
| **Yips slump** (*Yips Susceptibility*) | A miss late in a close game, or two misses in one game | Up to 3 weeks | Making a kick in a close fourth quarter |

On top of the state, the game also drops event marbles in the bag: a Rattled game adds a *Sees
Ghosts* marble, so a QB who keeps getting hit is more likely to keep the habit.

## 2. The marble bag

Each player owns a small bag of marbles. A marble is either a **quirk marble** (one of his
position's quirks), a **fix marble** (works against a quirk he holds), or **blank**. At each
checkpoint we draw from the bag, seeded like everything else
(`${seed}:${season}:${week}:quirks:${playerId}`), so a league replays identically.

**Why a bag and not plain dice:** it's a shuffle bag. Drawn marbles stay out until the bag is
refilled at the new league year. So streaks are bounded (no player gains three bad habits in
three weeks by pure luck), and whatever happened earlier changes the odds later. Each player's
"story" has memory.

### Grip: habits form and fade gradually
Each quirk a player holds or is building has a **grip** from 0 to 3:

```
draw its marble  → grip +1      grip 1 = "starting to show" (early word on film)
draw a fix marble → grip −1     grip 2+ = an established quirk (engine applies it)
grip hits 0      → gone         grip 3  = ingrained (fix marbles only half as likely to stick)
```

So nothing flips overnight. A scout can say "he's started bailing early", and the player can
still kick the habit before it settles in.

### What goes into the bag
Refilled each league year. Counts are per player, with a handful of each:

| Source | Adds |
|---|---|
| Position | A base mix of that position's 12 quirks, weighted toward neutral/style |
| Traits | Work ethic → fix marbles. Temperament (low) → *Jump-Happy*, *Sees Ghosts*, *Handsy*. Durability (low) → *Contact Averse* |
| Age | Young players: more of everything (still forming). Veterans 30+: mostly blanks (set in their ways) |
| Position coach | A good coach adds fix marbles for negatives and seeds positives that fit the scheme |
| Scheme | Playing in it builds it: outside-zone RB → *Patient Presser*, press-man CB → *Physical Jammer* |
| Last season's numbers | 6+ fumbles → *Loose Carriage*; most passes defensed in the league → *Plays the Ball* |
| In-season events | Added mid-season (below) |

### Checkpoints
- **Offseason (big draw):** 3–4 marbles. Most career change happens here.
- **Weekly (small draw):** 1 marble with about a 25% chance, so 4–5 draws a season.
- **Event marbles (added, not drawn):** a game where he took 5 sacks adds *Sees Ghosts*
  marbles; a game-winning kick adds *Ice-Water Veins*. Events shift the odds; the draw decides.

### Limits and targets (tune with a script, below)
- At most **3** quirks at grip ≥2 are applied, strongest grip first. One past the cap stays held but
  dormant (shown as "starting to show") until another fades. He holds at most 5 at any grip.
- **The 4th slot is for special players**: a rare ceiling (potential 17+, about the top 4%),
  elite now (overall 15.5+) or 10+ seasons in the league, about one player in ten. Any
  established quirk can fill it, and a special player's bag holds a quarter fewer blanks, so the
  players people remember have more habits. About 0.5% of the league carries four.
- Rookies start with 0–2, rolled from their own seed (like traits and the combine).
- Targets are **per quirk**, so they hold however many quirks a position has (`npm run quirks`
  checks them): each quirk carried by 6–12% of the players who can draw it, gained by 0.8–1.8% and
  lost by 0.5–1.5% of them each season. With the full list (twelve a position) that puts about 60%
  of players on at least one quirk. Today: about 7% a quirk in `npm run quirks` (no turnover, so
  the league ages) and about 5.5% in a real league with drafts and retirements (45% of players on
  at least one).
- Tuned numbers (`quirks.ts`): blanks 96 / 154 / 240 (age ≤24 / 25–29 / 30+), a fixed count so
  a position with more quirks doesn't dilute each one; fix marbles
  11 against a bad habit (±1 for the position coach, +1 for a hard worker), 8 against a good or
  style one. Fix marbles far outnumber a quirk's own 2–3, so a habit lasts a few seasons, not a
  career, unless it gets ingrained.

## 3. Engine rule: every quirk is a situational lean

This follows the project rule (no attribute without an engine hook) and keeps quirks from
double-counting ratings:

1. **Situational, never flat.** *Boomer Leg* isn't "+kick power"; it's "+range on 50+ yard tries
   and more touchbacks". A flat bonus belongs in the ratings.
2. **Small.** About ±2–3 skill points in its situation, or ±10–25% on a rate (drops, flags, ints).
3. **Neutral/style quirks trade something.** Same rule as schemes: every lean costs something
   elsewhere.
4. **League totals stay in range.** Positive and negative quirks are spread evenly across the
   league, so `npm run sim` holds, and `npm run audit` gains a quirk section: each quirk must
   move its own stat.

## 4. The list, checked against the engine

**A** = a hook already exists (a contest or event in `gameSim.ts`/`schemes.ts`) · **B** = needs a
small new engine event · **C** = needs a whole system the engine doesn't have yet (weather,
injuries, hash marks, line stunts, kick trajectory). Tier C quirks wait. Shipping them now would
break the "no hook, no attribute" rule.

What the engine already has: pressure, sacks, scrambles, man/zone and press coverage, blitzes,
play action, tempo (hurry/milk, two-minute), separation by depth, drops, interceptions, fumbles,
YAC, broken tackles, false starts/offside/holding/DPI, touchbacks, returns, blocked punts.

### QB
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | Navigates Muddy Pockets | Fewer sacks from pressure (pocket presence) | A |
| 2 | Manipulates Safety Eyes | Less safety help vs. zone/two-high | A |
| 3 | Pitches Layered Balls | Batted passes don't exist yet | B |
| 4 | Protects the Reader *(rename: Protects His Receivers)* | Needs injuries | C |
| 5 | Thrives in No-Huddle | Better decisions/accuracy in hurry tempo | A |
| 6 | Sees Ghosts | Rattled state (2+ sacks): worse decisions, more ints | A + state |
| 7 | Bails Early | More scrambles under pressure, fewer deep throws | A |
| 8 | Stares Down Hot Route | More short ints vs. zone | A |
| 9 | Gunslinger Mindset | More deep shots and ints, fewer sacks | A |
| 10 | Pat-The-Rock | More sacks now; strip-sacks need a new event | A/B |
| 11 | Sidearm Deliverer | Batted passes (vs. tall DTs) | B |
| 12 | Hard-Count Fiend | More offside drawn, a few more own false starts | A |

### RB
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | Patient Presser | Line counts more on zone runs | A |
| 2 | Finishes Forward | Higher floor on short-yardage runs | A |
| 3 | Elite Blitz Pickup | Pass pro when the back takes the blitzer | A |
| 4 | Soft-Hands Outlet | YAC on checkdowns | A |
| 5 | Boundary Toe-Tapper | Sideline catches aren't modeled | B |
| 6 | Bounces External | Inside runs bounce: more TFLs, some big gains | A |
| 7 | Loose Carriage | Fumbles in traffic (not flat: ball security is a rating) | A |
| 8 | Dwells in the Hole | Lower floor, higher ceiling on runs | A |
| 9 | Short-Arm Catcher | More drops when covered | A |
| 10 | Contact Averse | Fewer yards after contact, fewer fumbles | A |
| 11 | High-Knee Stride | More broken tackles, more fumbles on big hits (injury side is C) | A |
| 12 | Jump-Cutter | Open-field elusiveness up, more TFL variance | A |

### WR / TE
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | Late-Hands Specialist | Contested catches when tightly covered | A |
| 2 | Stems DB In-Break | Separation vs. man | A |
| 3 | Moss Mentality *(rename: Goes Up and Gets It; real player name)* | Deep contested catches | A |
| 4 | Crackback Willingness | Receivers don't block on runs yet | B |
| 5 | YAC Slasher | YAC up | A |
| 6 | Hear the Footsteps | Short drops vs. zone/LBs | A |
| 7 | Rundown Traitor *(rename: Loafs Off-Script)* | Decoys aren't modeled | B |
| 8 | Gets Jammed at Line | Separation vs. press-man | A |
| 9 | Body-Catcher | Drops in tight coverage (weather side is C) | A |
| 10 | Runs East-West | Lower YAC, more variance | A |
| 11 | Boundary Drag-Toe | Sideline catches | B |
| 12 | Physical Route Tree | Separation up; OPI flag is new | B |

### OL
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | Anchor Monster | Pass pro vs. interior rush | A |
| 2 | Second-Level Hunter | Yards past the line on runs | A |
| 3 | Finished to the Dirt | Run yards at the line | A |
| 4 | Pass-Block Stunt Communicator | No stunts in the engine; could become "vs. blitz" now | C → A |
| 5 | Heavy Snapping Punch | Less early pressure on quick throws | A |
| 6 | Waist-Bender | Worse vs. agile (finesse) rushers | A |
| 7 | Loses Hand Placement | More holding | A |
| 8 | Heavy Feet | Worse vs. fast edge rushers | A |
| 9 | Lunges at Stunts | Same as #4: "vs. blitz" now | C → A |
| 10 | Pulls Soft | Worse on gap/power runs | A |
| 11 | Two-Tapped Set | Better vs. speed, worse vs. power | A |
| 12 | Pancake Preacher | Run variance: bigger wins, some blown blocks | A |

### EDGE / DT
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | First-Step Flash | Quick pressure, a few more offsides | A |
| 2 | Pass-Rush Plan Adjuster | Pressure on long-developing throws | A |
| 3 | Unblockable Disruption | TFLs on runs | A |
| 4 | High-Motor Chaser | Caps big runs/scrambles | A |
| 5 | Batten-Down the Hatches | Linebackers' run fits get a boost | A |
| 6 | Bites on Play-Action | Play action works better against him | A |
| 7 | Loses Edge Containment | Scramble yards allowed | A |
| 8 | Arm Tackler in Traffic | Weaker run stops | A |
| 9 | Gassed in High-Tempo | Worse vs. hurry tempo | A |
| 10 | Jump-Happy | Offside, but only against hard counts and pump fakes (pairs with QB *Hard-Count Fiend*). Kept apart from *Hothead*: see below | A |
| 11 | Bends the Arc | Edge sacks up, softer vs. inside runs | A |
| 12 | Bull-Rush Primary | Interior pressure up, sack share down | A |

### LB
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | Diagnoses Before Snap | Run fits; less fooled by play action | A |
| 2 | Sideline-to-Sideline Scraper | Outside runs | A |
| 3 | Zone Hawk | Ints in zone | A |
| 4 | Thumping Tackler | Less YAC/yards after contact | A |
| 5 | Green-Dog Blitz Specialist | Pressure from LBs on blitzes | A |
| 6 | Over-Scrapes Outside | Cutbacks aren't modeled (could be inside-run variance now) | B |
| 7 | Stuck on Blocks | Weaker run fits vs. strong lines | A |
| 8 | Man-Coverage Deficit | Coverage in man | A |
| 9 | Slow Flow | Weaker run fits | A |
| 10 | Misreads Keys | Play action works better (reverses would be B) | A |
| 11 | Gap-Shooter | TFLs up, big runs up | A |
| 12 | Spot-Drop Coverer | Better short zone, worse deeper | A |

### CB / S
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | Fluid Hip-Turn | Deep coverage | A |
| 2 | Baits the Quarterback | More ints, more short completions | A |
| 3 | Physical Jammer | Receiver separation in press-man | A |
| 4 | Alley Crusher | Run fits on outside runs and screens | A |
| 5 | Ball-Stripper | Forced fumbles | A |
| 6 | Bites on Double-Moves | Better short, worse deep | A |
| 7 | Handsy in the Route | More DPI | A |
| 8 | Tackling Business Decision | Missed tackles vs. big backs | A |
| 9 | Peeks in the Backfield | Deep play action works better | A |
| 10 | Struggles at the Catch Point | More completions allowed in tight coverage | A |
| 11 | Off-Man Specialist | Fewer deep completions, more short ones | A |
| 12 | Play the Ball, Not the Receiver | More ints and more separation allowed | A |

### K / P
| # | Quirk | Hook | Tier |
|---|---|---|---|
| 1 | Ice-Water Veins | Late, close-game kicks | A |
| 2 | Coffin-Corner Specialist | Punt placement from plus territory | A |
| 3 | Boomer Leg | 50+ yard range and touchbacks only | A |
| 4 | Low-Trajectory Line-Drive | Needs weather | C |
| 5 | Quick-Release Operation | Blocked punts (blocked FGs would be B) | A |
| 6 | Yips Susceptibility | Slump state after a big miss | A + state |
| 7 | Out-Kicks His Coverage | Punt return yards | A |
| 8 | Hash-Mark Splitter | Needs hash marks | C |
| 9 | Weather Sensitive | Needs weather | C |
| 10 | Sling-Foot Starter | Blocked punts | A |
| 11 | High-Arc Boot | Shorter punts, fewer return yards | A |
| 12 | Draw-Kicker | No trajectory model. Replace, e.g. "Long-Range Gambler" (coaches trust him from 55+, he misses more there) | C |

**Tally:** about 80 A, 10 B, 6 C. Ship A first, add B as small engine events, park C until
weather/injuries exist (each of those systems then unlocks its quirks for free).

## 5. Fog of war

- Quirks use the same rule as makeup: screens show your scouts' **words**, never the truth.
- Habits show on **film**: each quirk reveals at a knowledge threshold seeded per team and player,
  lower than makeup's 0.5. A veteran's quirks are mostly known; a prospect's need tape or visits.
- Grip 1 shows as "early word" (dashed pill); a lost quirk lingers on the card as "seems to have
  fixed…" until your scouts notice.
- AI front offices value the habits **their own** scouts have spotted (`quirkWorth` in
  `scouting.ts`): +0.3 overall for a good one, −0.3 for a bad one, 0 for a style, half for early
  word, capped at ±0.9. Draft boards, free-agent bids, re-signings, cuts and trade values all read
  it, so teams disagree, and a habit nobody has seen on film counts for nothing.

## 6. Where it lands in the code

- `engine/quirks.ts` (new): registry (id, position, tone, label, words, hook), bag building,
  draws, grip, limits. Pure functions, seeded `Rng`.
- `engine/types.ts`: `Player.quirks: Record<QuirkId, grip>` plus a per-season bag (plain JSON).
  Bump `SAVE_VERSION` (10 → 11) and add a `migrate.ts` step that rolls quirks for existing players
  from their own seed.
- `engine/generate.ts`: rookies' starting quirks.
- `engine/offseason/index.ts`: offseason refill and big draw. `league.ts`: weekly draw.
- `engine/match/gameSim.ts`: the hooks, plus game states (Rattled, slump) and an event tally that
  feeds marbles back to the bag after each game.
- `engine/scouting.ts` + `ui/scouting.tsx`: `quirkNotes`, pills on PlayerCard, Compare and the
  draft board. A "Habits" timeline on the player card ("Picked up *Bails Early*, Wk 9 2031").
- `scripts/quirks.ts` (new, `npm run quirks`): ten seasons; checks the league targets in §2 and
  churn per season. `audit.ts` gains a quirk section.

## 7. Build order

1. ✅ **Data + bag + 2–3 quirks per position group (all Tier A) + UI pills.** Built:
   - QB: Navigates Muddy Pockets, Stares Down Hot Route, Gunslinger
   - RB: Finishes Forward, Loose Carriage, Dwells in the Hole
   - WR/TE: YAC Slasher, Goes Up and Gets It, Hears Footsteps
   - OL: Anchor Monster, Loses Hand Placement, Pancake Preacher
   - DT/EDGE: First-Step Flash, Bites on Play-Action, Bull-Rush Primary
   - LB: Zone Hawk, Man-Coverage Deficit, Gap-Shooter
   - CB/S: Fluid Hip-Turn, Bites on Double-Moves, Plays the Ball
   - K: Ice-Water Veins, Boomer Leg · P: Coffin-Corner Specialist, Out-Kicks His Coverage

2. ✅ **The rest of Tier A** (56 more, 81 in all), plus **AI front offices valuing quirks**:
   - QB: Manipulates Safety Eyes, Thrives in No-Huddle, Bails Early, Pat-The-Rock, Hard-Count Fiend
   - RB: Patient Presser, Elite Blitz Pickup, Soft-Hands Outlet, High-Knee Stride, Jump-Cutter,
     Bounces External, Short-Arm Catcher, Contact Averse
   - WR/TE: Late-Hands Specialist, Stems DB In-Break, Gets Jammed at Line, Body-Catcher, Runs East-West
   - OL: Second-Level Hunter, Finished to the Dirt, Heavy Snapping Punch, Stunt Communicator
     (reworked: against the blitz), Waist-Bender, Heavy Feet, Lunges at Stunts (against the blitz),
     Pulls Soft, Two-Tapped Set
   - DT/EDGE: Pass-Rush Plan Adjuster, Unblockable Disruption, High-Motor Chaser, Batten-Down the
     Hatches, Loses Edge Containment, Arm Tackler in Traffic, Gassed in High-Tempo (tires after five
     snaps in a drive or in the hurry-up), Jump-Happy (rarer; hotheads draw more), Bends the Arc
   - LB: Diagnoses Before Snap, Sideline-to-Sideline Scraper, Thumping Tackler, Green-Dog Blitz
     Specialist, Stuck on Blocks, Slow Flow, Misreads Keys, Spot-Drop Coverer
   - CB/S: Baits the Quarterback, Physical Jammer, Alley Crusher, Ball-Stripper, Handsy in the Route
     (hotheads draw more), Tackling Business Decision, Peeks in the Backfield, Struggles at the
     Catch Point, Off-Man Specialist
   - P: Quick-Release Operation, Sling-Foot Starter, High-Arc Boot (blocked punts are now a stat)

   Not yet: scheme and last-season marbles in the bag, the "seems to have fixed…" note for a lost
   quirk, the draft-board column, Long-Range Gambler for kickers. The 4th slot is possible now but
   very rare (an ingrained fourth quirk); tuning it is part of the fine-tuning pass.
3a. ✅ **Fine-tuning pass.**
   - **Stacking**: a unit's shared quirk has diminishing returns (`stack` in `gameSim.ts`): each
     teammate adds 60% of the one before, so five anchors are worth about 2.3, never 5. Flags
     (holding, offside) stay per man.
   - Weak quirks tuned up (Safety Eyes, No-Huddle, Ice-Water, Coffin-Corner, Spot-Drop, Stems DB,
     Gets Jammed, Physical Jammer, Misreads Keys, Baits the QB, Green-Dog, Short-Arm, Man-Coverage
     Deficit, Business Decision); the run game rebalanced so quirks don't tilt it (style costs and
     run-defense quirks were net negative, which also inflated receiving leaders).
   - **Fog over time**: a team keeps believing in a habit a player has shaken until its scouts
     notice (at once for its own players, most of a year for one it barely knows); then the card
     says "Seems to have fixed…". AI valuations see the same stale belief.
   - **Habits over time** on the player card and a "Lately…" line in the scout's report, both
     limited to what your scouts know. The draft board has a Habits column.
3. ✅ **States and event marbles.**
   - Two new quirks: **Sees Ghosts** (QB) and **Yips Susceptibility** (K).
   - **Rattled**: a QB who sees ghosts is rattled after his 2nd sack (−3 decisions, −1.5
     accuracy) until halftime or three straight completions (a coin flip each). Five sacks while
     rattled leave him **Shaken** for his next game (half strength from the start).
   - **Kicking slump**: a kicker with the yips is shakier for the rest of a game after any miss
     (misses ×1.8); a miss in a close fourth quarter, or a second miss, starts a slump of up to
     3 weeks; a clutch make ends it. Form lives on `Player.form`, is shown on the player card and
     clears each new league year.
   - **Event marbles** (`EVENTS` in `quirks.ts`): a game past a threshold drops one marble in his
     bag (5 sacks taken → Sees Ghosts, 3 picks thrown → Stares Down, 2 fumbles → Loose Carriage,
     2 sacks allowed → Heavy Feet, 2 sacks → First-Step Flash, 3 TFLs → Gap-Shooter, 2 picks →
     Plays the Ball, 2 forced fumbles → Ball-Stripper, a blocked punt → Sling-Foot); a clutch
     make → Ice-Water, a slump → Yips.
   - **Season marbles**: the same table on last season's totals adds two each to the refill.
   - **Scheme marbles**: zone runs → Patient Presser, Second-Level Hunter; gap runs → Pancake
     Preacher; heavy play action → Manipulates Safety Eyes; press man → Physical Jammer; zone
     coverage → Zone Hawk, Spot-Drop Coverer; a blitz-happy front → Green-Dog.
4. **Tier B engine events** (batted passes, strip-sacks, OPI, sideline catches, decoys, WR run blocking).
5. **Tier C** after weather and injury systems exist.

### Hothead vs. Jump-Happy
Both stay, because they're different things:

| | Hothead | Jump-Happy |
|---|---|---|
| Is | Personality (low temperament) | A habit |
| Flags | All of them: false starts, holding, offside | Offside only, against hard counts and pump fakes |
| Changes? | Never | Can be gained and fixed |
| How common | ~15% of linemen | ~5% of linemen, **rarer** |

A hothead gets extra *Jump-Happy* marbles, so the two often go together (that's the worst case: a
short fuse who also bites on the count). But a calm player can pick up the habit too, and a
hothead can stay clean of it.

## Decisions

1. Max active quirks: **3**, plus a 4th slot for special players (§2).
2. Coaches targeting a habit ("work on…", adding fix marbles): **yes, later**, alongside the
   weather and injury systems.
3. *Hothead* and *Jump-Happy*: **keep both**; Jump-Happy is the rarer one (above).
