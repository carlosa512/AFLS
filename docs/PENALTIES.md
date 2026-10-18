# Penalties

> **Status.** Phases 1, 2, 3a and 3b built. Phase 1: the foul registry and enforcement, accept or decline,
> offsetting fouls, live-ball offside, untimed downs, every accepted flag charged to a player. Phase 2:
> the defense's personal fouls, the crews' QB Protection, star protection, an offense retune. Phase 3a:
> special-teams units (backups first) and the user's own returners; holds and blocks in the back on
> returns, kickoffs out of bounds or short and lined up wrong, kick-catch interference, running into and
> roughing the punter; kick units tire and face injury risk; a goal-line stack for runs. Phase 3b: the
> special teams coordinator (fewer flags and better returns from a good one) and a field goal and extra
> point unit with its own flags (decision 6). Next: Phase 4.
> Numbers from the NFL's 2023–2025 seasons (below), tuned to their average (decision 5).

## The NFL, by the numbers

From nflpenalties.com (accepted penalties, playoffs included) and Pro Football Reference (regular
season), 2023–2025. The research could only read search extracts of these pages, not the pages
themselves, so treat the numbers as checked against two sources where both are given, not audited.
Sources at the end.

**The league** (both teams together, per game):

| Season | Accepted | Declined | Offsetting | Penalty yards | Special teams share |
| --- | --- | --- | --- | --- | --- |
| 2023 | 11.3–11.4 | 1.66 | 0.44 | 93.5 | 12.0% (1.36 a game) |
| 2024 | 12.8–12.9 | 1.69 | 0.62 | 103.7 | 13.5% (1.73) |
| 2025 | 12.5–13.1 | 1.88 | 0.52 | 100.6 | 17.4% (2.18) |

About 14.9 flags a game in all (2025). Offense and defense fouls held flat from 2023 to 2025; the rise
is special teams, after the 2024 kickoff rules took kickoff returns from 22% of kickoffs to 75%. The
2026 season so far is running near 15 accepted a game, a record pace (partial season, one source).

**By foul** (2025, both teams, accepted per game; the engine's status in the last column):

| Foul | Per game | Enforcement | In the engine |
| --- | --- | --- | --- |
| Offensive holding | 2.40 (+0.43 declined) | 10 yards from the previous spot | Built |
| False start | 2.39 | 5 yards | Built |
| Defensive pass interference | 1.01 | Spot of the foul, automatic first down | Built |
| Defensive holding | 0.64 (+0.33 declined or offset) | 5 yards, automatic first down | Built |
| Defensive offside | 0.51 (+0.33 declined) | 5 yards | Built (as "offside") |
| Neutral zone infraction / encroachment | 0.27 / about 0.12 | 5 yards | Phase 4 (split from offside) |
| Delay of game | 0.64 | 5 yards | Phase 4 |
| Unnecessary roughness | 0.64 | 15 yards (+ first down on the defense) | Phase 2 |
| Illegal formation | 0.39 (doubled in 2024, likely kickoff alignment) | 5 yards | Phase 3–4 |
| Face mask | 0.34 | 15 yards | Phase 2 |
| Illegal contact | 0.34 | 5 yards, automatic first down | Phase 4 |
| Roughing the passer | 0.33 | 15 yards, automatic first down | Phase 2 |
| Offensive pass interference | about 0.2–0.26 | 10 yards from the previous spot | Phase 4 |
| Illegal use of hands | 0.21 (mostly defense) | 5 + first down (defense), 10 (offense) | Phase 4 |
| Intentional grounding | 0.21 | Loss of down, 10 yards or the spot, whichever is worse; safety from the end zone | Phase 4 |
| Illegal block above the waist / in the back | 0.20 | 10 yards from the spot of the foul | Phase 3 |
| Illegal shift / motion | 0.18 / about 0.06 | 5 yards | Phase 4 |
| Ineligible man downfield | 0.16 (+0.18 declined) | 5 yards | Phase 4 |
| Too many men (both sides) | 0.14 | 5 yards | Phase 4 |
| Unsportsmanlike conduct / taunting | 0.14 / 0.09 | 15 yards | Phase 2 |
| Kickoff short of the landing zone / out of bounds | 0.16 / 0.14 | Ball at the receiving team's 40 | Phase 3 |
| Offensive offside, tripping | 0.08, 0.06 | 5, 10 yards | Phase 4 |
| Rare (under 0.05): horse collar, kick-catch interference, roughing or running into the kicker, chop block, illegal forward pass, clipping | – | 15 (5 for running into the kicker; 5 and loss of down for an illegal forward pass) | Phases 2–4 |

These per-foul counts cover every phase of the game, so special-teams holding and blocks sit inside
the holding and illegal-block rows; no source splits them by kickoff, punt and return.

**Crews** (2025, 13–18 games each): 10.1 to 16.1 accepted a game (busiest ÷ quietest 1.59, inside the
officiating spec's 1.3–1.7); offensive holding 1.72 to 3.20 a game; roughing the passer 3 to 8 calls a
season (0 to 4 in 2022).

## Opportunities in the engine today

Per team-game, three leagues of `createLeague` + a regular season. Halve an NFL per-game rate (both
teams) and divide by these to get each foul's odds per opportunity: roughing the passer, for one, is
0.33 ÷ 2 ÷ 5.5 hits, or about 3% of hits on the passer.

| Opportunity | Per team-game | Opportunity | Per team-game |
| --- | --- | --- | --- |
| Scrimmage plays | 64.5 | Hits on the passer (sacks included) | 5.5 |
| Pass attempts | 32.9 | Sacks | 2.3 |
| Completions | 21.2 | Tackles | 46.2 |
| Rushes | 26.4 | Kickoff returns | 2.9 |
| Punts | 4.0 | Punt returns | 1.5 |
| Field goal tries | 1.9 | Extra point tries | 2.4 |

Flags today, per team-game: holding 2.37, false start 1.85, offside 1.19, pass interference 0.30,
defensive holding 0.21; 5.93 in all.

## Today's baseline

| Foul | When the engine rolls it | Base odds | What moves them | Enforcement today |
| --- | --- | --- | --- | --- |
| False start | Every scrimmage snap (not punts, field goals or kneels) | 2.7% | Offensive line discipline, Hard-Count QB, crew volume | 5 yards (half the distance inside the 10) |
| Offside | Same roll as false start | 1.7% | Defensive line discipline, First-Step, Jump-Happy, Hard-Count QB, crew volume | 5 yards, first down if it reaches the line |
| Offensive holding | Runs and passes without a turnover or an 8+ yard loss | 3.8% | Offensive line discipline, Loses Hand Placement, crew volume × holding | 10 yards (half the distance), down replayed |
| Pass interference | Incomplete passes thrown past the line | 0.8% / 3% / 6% by depth | Handsy defender, crew volume × coverage | Spot of the foul (the air yards), automatic first down |
| Defensive holding | Same as pass interference | 2% | Handsy defender, crew volume × coverage | 5 yards, automatic first down |

Discipline is the line's average of Awareness (the `discipline` contest) plus or minus each player's
hidden temperament (`temperOffset`, about ±3 at the extremes). League total: 5.89 penalties per
team-game (`npm run sim`, target 5.5–7). Every flag is accepted; nothing is declined or offset.

**The total is right for the wrong reasons.** Per team-game against the NFL's 2025 rates:

| Foul | Engine | NFL | Engine ÷ NFL |
| --- | --- | --- | --- |
| Offensive holding | 2.37 | 1.20 | 2.0× |
| False start | 1.85 | 1.20 | 1.5× |
| Offside (with neutral zone and encroachment) | 1.19 | 0.45 | 2.6× |
| Pass interference | 0.30 | 0.51 | 0.6× |
| Defensive holding | 0.21 | 0.32 | 0.7× |
| **All penalties** | **5.93** | **6.3–6.5** | **0.93×** |

The three line fouls are inflated to stand in for the twenty-odd fouls that don't exist yet, and the
coverage fouls run short. Each new foul has to take its share back from them, or the league's flag
count climbs past the NFL's.

## What the plan changes, in one line each

1. **A penalty framework** so every new foul is a registry entry, not new engine code: who commits it,
   when it's rolled, its enforcement, and whether the other side takes it.
2. **Roughing the passer** and the other personal fouls on ball carriers and passers.
3. **Special teams**: return units, holding and illegal blocks on returns, kick fouls.
4. **The rest of the scrimmage fouls**: pre-snap (delay of game, illegal formation and motion,
   neutral zone, too many men), during the play (offensive pass interference, illegal contact,
   intentional grounding, fouls on runs, sacks and scrambles).
5. **Crews, screens and checks** grown to match: new crew tendencies, player penalty stats, a
   penalties breakdown on the team and player pages.

## Phase 1: the penalty framework (do this first)

Both fouls you asked for need things the engine can't do yet: a choice to decline, enforcement from
somewhere other than the line of scrimmage, a player to charge, and fouls on kicks. Building that once
keeps every later foul to a registry entry plus a hook.

**A foul registry** (`src/engine/penalties.ts`, the `FOULS` table moves here from `officials.ts`):

| Field | What it says | Example: roughing the passer |
| --- | --- | --- |
| `side` | Who commits it: offense, defense, kicking or receiving team | defense |
| `when` | Which roll it joins: pre-snap, run, pass, sack, scramble, return, kick | pass, sack |
| `yards` | 5, 10 or 15 (or `spot` for pass interference) | 15 |
| `from` | Previous spot, spot of the foul, end of the run, or where the kick ended | end of the run on a completion past the line, else previous spot |
| `autoFirst` / `lossOfDown` | Defensive fouls that give a first down; offensive fouls that cost the down | automatic first down |
| `committer` | Who did it: weights by position and role on the play | the rusher who hit him |
| `tendency` | The crew tendency that scales it, if any | QB protection (new, Phase 2) |
| `odds` | Base rate per opportunity, from the research table | per hit on the passer |

**Enforcement** becomes one pure function: it applies half the distance near the goal lines, spots
fouls, gives first downs or takes the down, turns an offensive foul in its own end zone into a safety,
wipes out a touchdown on an offensive foul, and plays an untimed down when the defense fouls on the
last play of a half. The two `PENALTY on …` blocks in `gameSim.ts` today become calls to it.

**Accept or decline** (`coach.acceptPenalty`, a pure function like the rest of `match/coach.ts`): the
side fouled against takes whichever leaves it better off by down, distance and field position. Typical
cases: a defense declines holding on an incomplete third down to force fourth down; an offense declines
pass interference on a touchdown catch. Declined fouls are counted (`declined` on the box score) and
named in the play-by-play, but cost no yards. When both teams foul on one play, they offset and the
down is replayed.

**Charge a player.** Each flag names the player who drew it (picked by the foul's `committer` weights,
leaning on the men with the worst discipline). New stat keys `penalties` and `penaltyYds` on
`StatLine`, so player cards and box scores can show them. The pick draws from its own stream, like
`creditRng`, so who gets charged never changes how a game plays out.

**Keep the league at baseline.** Adding fouls adds flags, so every foul's base odds, old ones included,
are re-anchored to its research rate: holding roughly halves, offside drops to about 40%, pass
interference and defensive holding rise by half. The league target becomes 12.5–13 accepted a game
(6.25–6.5 per team-game), 1.7–1.9 declined and about 0.5 offsetting. `npm run sim` gets one target per
family (pre-snap, holding, coverage, personal, special teams, declined) instead of today's single
"penalties" line. Fewer holding calls and more pass interference move scoring and drive success too,
so the rest of `npm run sim` is re-checked with each phase.

**Save:** new optional fields only (`StatLine` keys, more `flags` keys, `declined`), so a version
bump with nothing to fill in. Results played before it simply have fewer kinds.

## Phase 2: roughing the passer and other personal fouls

**Built.** All five are the defense's, on scrimmage plays (the offense's personal fouls come with Phase
4, kicks with Phase 3). A foul at the end of a run or a catch past the line goes on from where the play
ended and the play stands; behind the line, on an incompletion, a sack or a turnover it goes from the
previous spot and the play is wiped out (roughing wipes out an interception: the foul came first). One
on a touchdown is declined for now (the NFL carries it to the try or the kickoff). Rates per team-game
in `npm run sim -- 10`: roughing 0.17, personal fouls in all 0.61, accepted flags 6.20 (NFL 6.15); the
line fouls gave back their share (holding 0.039 → 0.0362, false start 0.027 → 0.0257, offside 0.017 →
0.0158).

**The retune.** NFL-rate personal fouls hand offenses about a point a game (15 yards and a first down,
0.6 times a game): `npm run sim -- 10` read 23.93 points with every foul in, against 22.66 before. The
engine's offense had been tuned with a penalty mix too hard on offenses (too much holding, too few
defensive fouls), so the plays give the point back: runs average 3.86 yards before breakaways (was
3.97), completions are 1.5 points less likely at every depth, and yards after the catch 0.3 shorter.
Result: 22.84 points, 6.94 yards an attempt, 4.22 a carry, 63.8% completions, 20.1 first downs, every
`npm run sim` target in range. Later phases move the mix again (more offensive fouls in Phase 4), so
each one re-checks scoring.

**Roughing the passer.** The hook is the pass rush: a rusher who gets home (a sack, or a pressure that
reaches the quarterback) can hit him late, low or high. The roll lives on the main stream, after the
pass resolves, so it can change the play.

- **Odds:** 0.33–0.37 calls a game, steady at 93–100 a season since the 2022 clarifications (which cut
  flags for incidental contact and for a rusher blocked into the passer's legs). That's about 3% of hits
  on the passer, or one per 13 sacks. Raised by the rusher's temperament (a hothead lands more late
  shots), lowered by his Awareness, scaled by the crew. Averages 13.5 yards, not 15: half the
  distance applies near the goal line.
- **Enforcement:** 15 yards and an automatic first down. On a completion past the line it's added to the
  end of the play; on an incompletion or a sack, from the previous spot. On an interception the offense
  keeps the ball (the foul came before the change of possession), so the pick is wiped out.
- **Choice:** the offense takes it unless the play was better (a long touchdown).
- **Injuries:** a roughing hit carries a little more injury risk than a clean one (`collide` in
  `gameSim.ts` already models hits on the passer).

**The other personal fouls**, on the same rules (15 yards, automatic first down when on the defense):

| Foul | Per game (NFL) | Hook | Odds lean on |
| --- | --- | --- | --- |
| Unnecessary roughness | 0.64 | Tackles near the sideline or after the whistle, hits on a receiver just as the ball arrives | Tackler temperament, crew |
| Face mask | 0.34 | Any tackle (about 1 in 270) | Tackling, temperament |
| Horse collar | about 0.05 | Tackles from behind, mostly by defensive backs and linebackers | Tackling, pursuit angle |
| Unsportsmanlike conduct / taunting | 0.14 / 0.09 | After sacks, big hits and touchdowns | Temperament |

Together that's about 1.6 personal fouls a game, roughing included.

**Crews:** a fourth tendency, **QB Protection** (1–20, same 0.8–1.2 multiplier), scales roughing the
passer. Built; saves from before it (v17) get the one a new league from their seed would roll, and the
crews page has a Roughing/g column. **Star protection** (decision 4) is built too: `starLean` scores a
quarterback's MVPs (3), OPOYs (2) and All-League teams (2 first, 1 second) and adds up to +30% to the
roughing odds at 10 points; his card shows the roughing calls he draws. That's the officiating spec's "QB protection" later phase; its blocker ("needs pass-rush
penalties modeled") is this phase. It gets a column on the crews page, keeping the spec's rule that
every hidden tendency shows up in a stat a player can read.

## Phase 3: special teams

**3a built.** Units: `Lineup.st`, ten men a kick both ways, one backup from each position in turn
(linebacker, safety, corner, tight end, receiver, back, edge, tackle), starters only when the backups run
out; they tire and face a scrimmage snap's injury risk on every kick (×1.5 on a return, ×0.4 on a
touchback or a fair catch). Returners: the user picks them on the depth chart (`Team.returners`, save
v18), or Auto. Flags, per team-game in `npm run sim -- 10` (special 0.6 in all): holds and blocks in
the back on returns (10 yards from a spot behind the returner, half the distance near the goal; a
return touchdown called back), kickoffs out of bounds or short (the receivers' ball at their 40, more
for a kicker short on accuracy), a kicking team lined up wrong (5 more yards), kick-catch interference
(15 from the catch), running into the punter (taken when it moves the chains) and roughing him (15 and a
first down). Returns run 1.5 yards longer on kickoffs and 1 on punts before flags, so drives still
start at the 31.0 after kickoffs and the 23.3 after punts (30.9 and 23.5 before). Not yet: punts' own formation fouls, personal fouls on
kicks, a re-kick after a kicking team's foul (field goals and extra points came with 3b).

**3b built.** Two parts:

- **Special teams coordinator** (`coaching.ts`, save v19): a twelfth chair on every staff, with the
  budget, contracts, market, ageing and AI hiring every chair has, his own tab on the Coaches screen,
  and a migration that hires one for every team in an old save. He is the kickers' and punters'
  position coach (they had only the head coach and the S&C coach before), and the one coach whose
  quality shows on game day (`specialTeamsEdge`, his overall quality against a typical coach): each
  point is half a point of discipline for every kick unit (a +4 coach: about 11% fewer flags on kicks
  and returns), and a quarter of a yard on each kickoff return and 0.15 on each punt return, his returners
  against the other coach's coverage. A typical coach changes nothing, so league totals hold. His card
  shows both (`kickCoaching` in `match/lineup.ts`, the engine's own numbers). The coaching budget grew
  from 0.095 to 0.102 of the cap, his chair's share of the going rates.
- **Field goal and extra point unit** (`Lineup.fg`): the starting line with a backup lineman and the
  second tight end on the wings; the block unit is the defense's front and linebackers. One roll a kick:
  a false start (no kick, 5 yards back, and the coach decides again: a long try may become a punt) or a
  hold on the kick unit; offside, running into or roughing the kicker on the block unit. A hold costs a
  good kick (10 yards back and kick again) and is declined on a miss; the block unit's fouls give a
  missed kick another go, closer, or the chains. Over a good field goal the offense keeps its points
  unless the flag brings a first down inside the 10 with more than two minutes left in the half; over a
  good extra point it keeps the point (the NFL would let it carry the foul to the kickoff, which the
  engine doesn't). A flag on a kick at the gun gives an untimed down, the NFL's rule for a kick. Only a
  kick that stands counts in the box score. About 0.1 accepted flags a game, and as many declined; the
  kick unit and the block unit spend half a snap's energy and half a quiet kick's injury risk on each
  try (the NFL injury rates the engine is tuned to already include the men hurt on kicks).

**3b balance.** The new flags put `npm run sim -- 10` at 6.18 penalties per team-game (target 6.15).
Passing touchdowns sat at the band's top (1.60) with the season's top passers near the floor of their
yards, and red-zone trips still ended in touchdowns 67% of the time: too many short scores near the
goal line. Short throws inside the 10 now complete 5 points less often (3 before), the same squeeze
medium and deep throws get there. `npm run sim -- 10`: 22.81 points, passing touchdowns 1.57, field
goal tries 1.98, completions 63.7%, every stat in range.

Punt and kickoff units stay as they are: in the NFL their front men (snapper, guards, tackles on a punt)
are linebackers, tight ends and backs who block, then cover 40 yards, so offensive linemen rarely play
there.

**The balance.** With the special-teams share taken back from the line fouls (holding 0.0362 → 0.0306,
false start 0.0257 → 0.0226, offside 0.0158 → 0.0137), offenses got some of their point back, and
the engine still scored too easily at the goal line: 67% of red-zone trips ended in touchdowns (the NFL:
about 55–60%) and 78% of runs from inside the 3 (about half in the NFL). So defenses now stack the box
at the goal line (up to 1.75 yards off a run's mean at the 1, none by the 6) and short throws inside
the 10 complete 3 points less often (medium and deep already lost 6); yards after the catch give back
0.15 of Phase 2's cut so the season's top passers stay in range. `npm run sim -- 10`: 22.98 points,
passing touchdowns 1.59 (the band's top is 1.6: watch it in Phase 4), field goal tries 1.97 (top 2.0).

Returns today are one draw for the yards; nobody blocks. Fouls need the men around the returner.

- **Return and coverage units** (`Lineup.st`): the ten men on a kick besides the kicker, punter and
  returner, picked from the backups the NFL uses there (linebackers, safeties, corners, tight ends,
  receivers, backs). Their discipline drives the flags. Later this is where a special-teams coach and a
  special-teams depth chart would plug in.
- **Return fouls** (receiving team): holding, illegal block in the back, illegal block above the waist.
  Enforced from the spot of the foul (on punts, from where the kick ended when the foul is beyond it),
  so a flag turns a good return into a long field, and sometimes calls back a return touchdown. The
  kicking team declines it when the return was short anyway.
- **Kick fouls** (kicking team): kickoff offside and illegal formation (the 2024 kickoff setup), kicks
  out of bounds, fair-catch and kick-catch interference on punts, an illegal formation on punts.
- **Fouls against the kicker** (defense): running into the kicker (5 yards) and roughing the kicker or
  holder (15 yards, automatic first down) on punts and field goals, plus offside on field goals. These
  bring a real coaching choice: take the points or take the penalty and the first down
  (`coach.acceptPenalty` again).
- **Calibration:** special teams drew 1.36 accepted flags a game in 2023 and 2.18 in 2025, the jump
  coming with the 2024 kickoff (returns went from 22% of kickoffs to 75%; touchbacks now come out to the
  35, which the engine already uses). No source gives flags per return, so the odds per return come
  from that share and the engine's return counts (2.9 kickoff and 1.5 punt returns per team-game),
  scaled to how often the engine's kickoffs are returned. Average starting field position after
  kickoffs and punts must stay where it is now.
- **New kickoff rules:** a kickoff out of bounds or short of the landing zone gives the receiving team
  the ball at its 40 (0.14 and 0.16 a game in 2025). Both are kicker misses rather than fouls, so they
  hang off kickoff distance and accuracy.

## Phase 4: the rest of the scrimmage fouls

**Before the snap** (one roll, as today, with more outcomes):

| Foul | Per game (NFL) | Side | Odds lean on | Enforcement |
| --- | --- | --- | --- | --- |
| Delay of game | 0.64 | Offense | Tempo (the hurry-up and the two-minute drill), a young quarterback's Awareness, road crowd noise | 5 yards |
| Illegal formation / shift / motion | 0.39 / 0.18 / 0.06 | Offense | How much motion the coordinator's scheme uses (`schemes.ts`), receivers' Awareness | 5 yards |
| Neutral zone infraction, encroachment | 0.27, 0.12 | Defense | Split out of today's offside, same drivers | 5 yards |
| Too many men on the field | 0.14 (mostly defense) | Either | Substitution: the hurry-up, rotations | 5 yards |
| Offensive offside | 0.08 | Offense | Line discipline | 5 yards |

**During the play:**

| Foul | Per game (NFL) | Hook | Enforcement |
| --- | --- | --- | --- |
| Offensive pass interference | about 0.2–0.26 | Any target, more on contested and deep balls; a physical receiver more | 10 yards from the previous spot |
| Illegal contact | 0.34 | Pass plays, against press coverage | 5 yards, automatic first down |
| Illegal use of hands | 0.21 | Pass rush (defense, most of them) and pass blocking (offense) | 5 and a first down (defense) or 10 (offense) |
| Intentional grounding | 0.21 | Today's "throws it away under pressure", when no receiver is near and he's still in the pocket | Loss of down and 10 yards from the previous spot, or the spot of the pass if that's worse; a safety from his own end zone |
| Ineligible man downfield | 0.16 | Screens, quick passes and run-pass options | 5 yards |
| Illegal forward pass | under 0.05 | A scramble that crosses the line and then throws | 5 yards, loss of down |
| Defensive holding on runs, holding on sacks and scrambles | (inside the holding rows) | The run, sack and scramble results that roll nothing today | As their kind; holding on a sack is almost always declined |

**Enforcement spots:** an offensive foul before a catch goes from the previous spot; after a catch the
play is a run, so fouls are spotted where they happened, or at the end of the run if it's beyond it.
Half the distance caps any penalty longer than half the way to the goal, except spot fouls.

**End-of-half rules:** a defensive foul on the last play gives an untimed down (built in Phase 1),
offsetting fouls on the last play extend the half too (not yet: Phase 1 ends it), and some offensive
fouls in the last minute bring a 10-second runoff. `npm run endings` must check all three.

## Phase 5: crews, screens and checks

- **Crews:** four tendencies (Flag Volume, Holding, Coverage, QB Protection). The crews page shows a
  column for each, plus a per-foul breakdown when you open a crew. `npm run crews` keeps today's 1.3–1.7
  busiest-to-quietest band (the NFL's 2025 crews: 1.59) and adds one for holding (2025: 1.86).
- **Box score:** every foul by team, declined ones listed apart; the play-by-play says "declined" and
  "offsetting".
- **Player card:** penalties and penalty yards by season; the scouting notes on temperament already
  speak of drawing flags.
- **Team stats:** penalties by kind for the season.
- **AI front offices:** discipline already counts for linemen; the new hooks bring defensive backs,
  pass rushers and special teamers into it. Any change to `OVR_WEIGHTS` goes through `npm run audit`.
- **Checks:** `npm run sim` per foul family and declined per game; `npm run crews` per tendency;
  `npm run endings` for untimed downs and runoffs; a save migration test.

## Order and size

| Phase | Depends on | Size | Why this order |
| --- | --- | --- | --- |
| 1. Framework | – | Medium | Both requested fouls need accept/decline, other enforcement spots and player charging |
| 2. Roughing the passer, personal fouls | 1 | Small | One hook on the pass rush, one new crew tendency |
| 3. Special teams | 1 | Large | Needs return and coverage units first |
| 4. Other scrimmage fouls | 1 | Medium | Many entries, few new hooks |
| 5. Crews, screens, checks | 2–4 | Medium | Grows with each phase; listed last but done alongside |

## Decisions (owner, Oct 18 2026)

1. **Declined penalties show**, beside the accepted ones: in the box score and in the play-by-play
   ("declined", "offsetting").
2. **Special-teams units are picked automatically**, from the backups first, so starters don't pile up
   extra snaps and injuries across the league (kick coverage is a real injury risk, so these snaps
   count toward fatigue and injury exposure, and `npm run sim`'s injury targets still have to hold).
   **You pick your own kick and punt returners** (today they're automatic). A **special-teams
   coordinator** joins the coaching staff, with a hand in the units' discipline and returns.
3. **QB Protection** becomes the crews' fourth tendency in Phase 2.
4. **Stars get some protection.** Roughing calls lean toward the league's most decorated passers, up to
   about +30% for a Mahomes- or Brady-level résumé. It reads their public record (MVPs, all-league
   selections, seasons as a starter), never hidden ratings, so it stays explainable, and the
   quarterback's card shows the roughing calls he draws. The crew's QB Protection scales it.
5. **Tune to the 2023–2025 average**: 12.3 accepted a game (6.15 per team-game), 1.74 declined and 0.53
   offsetting. Flags are rising in the real league; crews and their yearly drift let a long career
   wander around that average on its own.
6. **Field goals and extra points get their own unit in Phase 3b** (owner, after 3a): special teams
   is a key part of the game, so the kicking unit that puts linemen on special teams comes with the
   special-teams coordinator rather than waiting for Phase 4.

**Three-year averages per game** (both teams, accepted), the targets each phase tunes to: false start
2.37, offensive holding 2.30, pass interference 1.03, defensive holding 0.65, unnecessary roughness
0.63, delay of game 0.60, defensive offside 0.54, illegal formation 0.35, roughing the passer 0.34,
face mask 0.33, neutral zone infraction 0.31, illegal contact 0.28, offensive pass interference about
0.25, illegal use of hands 0.23, ineligible man downfield 0.20, intentional grounding 0.18, illegal
block 0.17, illegal shift 0.17, encroachment 0.14, too many men 0.18, unsportsmanlike conduct 0.12,
taunting 0.07; special teams 1.76 in all.

## Checks left red when Phase 1 landed (handle separately)

Phase 1 changes how every game plays out (new flags, declines, free plays), so every league is a new
draw. Three checks that sit near their edges went over; none traces to a mechanism that's wrong. Left
as they are on purpose, like the crews' (`docs/OFFICIALS.md`). Numbers from `npm run check` on c4dd6a6;
the "a defense keeps its takeaway" fix came after it and touches about one play in two thousand games.

**1. `npm run quirks -- --effects`: Thumping Tackler (`thumper`, yards per carry) flagged NO EFFECT.**

| Run | yds/carry | z | Verdict |
| --- | --- | --- | --- |
| `main`, 3 + 9 seasons | −0.04 | −2.2 | weak (passes) |
| Phase 1, 3 + 9 seasons | −0.02 | −1.2 | NO EFFECT (fails) |
| Phase 1, 6 + 18 seasons | −0.03 | −2.3 | weak (passes) |

Borderline on `main` too. One part may be real: accepted holding now wipes out the best runs (the
defense keeps a stuffed run and takes the flag on a long one, as in the NFL), which are the runs
Thumper shortens, so its measured effect shrinks a little. Pat-The-Rock passed this time (z 2.8).

**2. `npm run weather`: rain's kicking ratio 1.000, target 0.95–1.0.**
Field goals made in rain against calm-day rates from the same distances:

| Leagues | `main` | Phase 1 |
| --- | --- | --- |
| 0–2 (the check's) | 0.980 | 1.000 |
| 3–5 | 0.989 | 1.003 |
| 6–8 | 0.978 | 0.985 |
| 9–11 | 0.989 | 0.986 |
| All 12 (about 12,700 rain kicks each) | 0.985 | 0.993 |

Kicking is unchanged (rain still adds `wx.kick` yards to every kick in `fgProb`); the games around the
kicks are new. Each three-league sample swings about ±0.01, the 0.008 gap over twelve is about 1.4
standard errors, and this check has no larger sample for close calls.

**3. `npm run careers`: points per team-game and two leaders.** CI on b02412e: points 24.23 (band
21–24), sacks #5 11.6 (band 11.9–16.3), interceptions #5 4.6 (band 4.8–6.8); interceptions #1 6.8 is
back in range. Locally before the takeaway fix: points 24.35, interceptions #1 6.4 and #5 4.8. Points
are the known long-run creep (23.64 on `main` before crews, 24.15 with crews; see `docs/OFFICIALS.md`).
The leaders swing between runs of the same engine; fresh leagues (`npm run sim -- 10`) went the other
way (interceptions #1 8.0 → 9.2, inside 7–10.5), and interceptions per team-game went 0.79 → 0.73 (band
0.65–0.85). Flags now wipe out 3.3% of interceptions (a defense's offside gives the offense a free
play, 76 of 123 in a 2,176-game replay; defensive holding 46; the last one was a defense taking holding
over its own pick, fixed since), as they do in the NFL; the rest is the leagues taking different paths.

**4. `npm run offseason -- 6`: one team over the cap (2030, band 0).** Atlanta kicks off 2030 $1.2M
over the cap with 42 players; the check already lists short rosters at kickoff as a known engine issue
(⚠), and this league's path also broke the hard cap rule. It passed before the takeaway fix, which
re-rolled every league: the front office's cap and roster logic (`offseason/ai.ts`, `finance/`) is
untouched here.

## Checks when Phase 2 landed

`npm run check` on 9ff314b: 10 of 11 pass. The offense retune brought `careers` (long-run points), `weather`
and `offseason` back to green. Only `quirks` is red: four borderline quirks re-rolled under the bar.

| Quirk (stat) | 3 + 9 seasons | 6 + 18 seasons |
| --- | --- | --- |
| Pat-The-Rock (sack%) | +0.12, z 1.4 | +0.14, z 2.2, weak |
| Plan Adjuster (pressure%) | +0.41, z 2.0 | +0.52, z 3.6, moves play |
| Thumping Tackler (yds/carry) | −0.03, z −1.5 | −0.03, z −2.3, weak |
| Spot Drop (cmp%) | −0.40, z −1.9 | −0.36, z −2.5, weak |

All four move their stat the right way with the larger sample: the check's three seasons (nine for close
calls) leave borderline quirks to luck. Handled with the other borderline checks, outside this work.

## Checks when Phase 3a landed

`npm run check` on a4598c0: 9 of 11 pass. `quirks`: the same borderline three re-rolled under the bar
(Pat-The-Rock z 1.9, Thumping Tackler −1.0, Spot Drop −1.6); Thumping Tackler reads z −3.4, moves play,
over 6 + 18 seasons. `careers`: long-run points 24.54 (band 21–24) and sacks #5 11.7 (11.9–16.3). Aged
leagues score about 1.5 points more than fresh ones (the known creep: 23.64 against 22.47 on `main`
before crews), so 3a's fresh 22.98 (Phase 2: 22.84) put the long run back over 24. Both go with the
borderline-checks work on its own branch; trimming fresh scoring toward the NFL's 22.5 would also bring
the long run back.

Looked at again from the logs (no new runs), it's partly noise and partly a real drift:

- **Noise:** about half a point a run. The crews change gave 23.64 and then 24.15 on an engine that
  plays the same on average (a paired replay put the crews at +0.05 ± 0.08); the readings since are 24.35,
  24.23 and 24.54. So the true long-run level sits around 24.2–24.4, right on the band's edge, and the
  check will flip from run to run.
- **Drift:** the two red numbers share a cause. Aged leagues sack and pick the quarterback less than
  fresh ones, and score more:

  | | Fresh (`sim`) | Aged (`careers`) |
  | --- | --- | --- |
  | Points per team-game | 22.98 | 24.54 |
  | Sacks per team-game | 2.32 | 2.12 |
  | Sacks, #5 | 13.5 | 11.7 (floor 11.9) |
  | Interceptions, #5 | 6.1 | 4.8 (floor 4.8) |

- **Likely cause (not yet tested):** starter Awareness climbs from about 11.2 to 12.3 over sixteen
  seasons (`careers` prints it as informational). It is most of a QB's `pocketPresence` (whether pressure
  becomes a sack) and all of his `decisionMaking` (interceptions), but only a small share of any
  defender's contest, so the mental game's growth with age helps offenses.

Decision: leave the engine as it is here. The fix belongs to an attribute-scaling pass on its own
branch (how each attribute ages and what it feeds, now that penalties, special teams and schemes read
them too), listed under "Next" in `docs/GAME_DESIGN.md`.

## Checks when Phase 3b landed

`npm run check` on 5569f91: 9 of 11 pass (`sim` with every stat in range: 22.81 points, passing
touchdowns 1.57, field goal tries 1.98, 6.18 penalties per team-game). The same two as before are red,
both with the borderline-checks work on its own branch:

- `quirks`: Thumping Tackler (z −1.5) and Spot Drop (z −1.4) under the bar at the check's sample;
  Pat-The-Rock passed this time (z 3.0). Both read "weak" or better over 6 + 18 seasons in Phases 2
  and 3a.
- `careers`: long-run points 24.45 (band 21–24) and sacks #5 11.8 (floor 11.9), the drift traced to
  Awareness aging under "Checks when Phase 3a landed" (fresh leagues: 22.81).

## Sources

Search extracts only; the pages themselves couldn't be fetched from the research sandbox.

- nflpenalties.com: season totals ([2025](https://www.nflpenalties.com/index.php?year=2025&view=total), [2024](https://nflpenalties.com/index.php?year=2024&view=total)), by phase ([2023](https://nflpenalties.com/phase.php?year=2023&view=total), [2024](https://www.nflpenalties.com/phase.php?year=2024&view=total), [2025](https://www.nflpenalties.com/phase.php?year=2025&view=total)), [special teams 2025](https://www.nflpenalties.com/position/special-teams?year=2025&view=penalties), [referees 2025](https://nflpenalties.com/all-referees.php?year=2025&view=total), and each foul's season view (`/penalty/<foul>?view=season`)
- Pro Football Reference penalties: [2024](https://www.pro-football-reference.com/years/2024/penalties.htm), [2023](https://www.pro-football-reference.com/years/2023/penalties.htm)
- [StatMuse: league penalties per game by year](https://www.statmuse.com/nfl/ask/nfl-league-average-penalties-per-game-by-year-2001-to-2025)
- [Deseret News, Oct 2026](https://www.deseret.com/sports/2026/10/10/its-time-for-nfl-officials-to-be-flagged/); [Yahoo: officials calling more penalties](https://sports.yahoo.com/articles/nfl-officials-calling-more-penalties-173817924.html)
- Roughing the passer: [Pro Football Network](https://www.profootballnetwork.com/what-is-roughing-the-passer-in-the-nfl-breaking-down-the-often-controversial-penalty/), [CBS Sports on the 2022 emphasis](https://www.cbssports.com/nfl/news/nfl-will-yet-again-crack-down-on-roughing-the-passer-calls-but-it-should-result-in-fewer-penalties-in-2022/)
- Kickoffs: [NFL.com, 2024 dynamic kickoff](https://www.nfl.com/news/2024-nfl-season-explaining-rules-for-new-dynamic-kickoff), [NFL.com, touchbacks to the 35](https://www.nfl.com/news/nfl-owners-vote-to-make-dynamic-kickoff-permanent-adjust-ball-spot-on-touchbacks-to-35-yard-line), [Yahoo: 74.5% returned](https://sports.yahoo.com/articles/nfl-had-74-5-percent-154754180.html)
- Enforcement: Football Zebras on [spot fouls on pass plays](https://www.footballzebras.com/2025/12/why-a-spot-foul-on-a-pass-play/) and [fouls around a change of possession](https://www.footballzebras.com/2024/08/competition-committee-refines-penalty-enforcement-when-there-is-a-possession-change/); [NFL rulebook](https://operations.nfl.com/rules-officiating/2026-nfl-rulebook)
