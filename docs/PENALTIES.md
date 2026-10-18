# Penalties

> **Status.** Plan, not built. Today the engine calls five fouls (false start, offside, offensive
> holding, pass interference, defensive holding), every one accepted, charged to a team and never to
> a player, and none on kicks, sacks or scrambles (see "Today's baseline"). This plan grows that into
> the NFL's full rulebook of common fouls in five phases, starting with the two the officiating spec
> already points at: roughing the passer (its "QB protection" later phase) and special-teams holding.

## Opportunities in the engine today

Per team-game, three leagues of `createLeague` + a regular season. NFL per-game rates (research table,
to come) divide by these to give each foul's odds per opportunity.

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
are re-anchored to its research share; `npm run sim` gets one target per family (pre-snap, holding,
coverage, personal, special teams, declined) instead of today's single "penalties" line.

**Save:** new optional fields only (`StatLine` keys, more `flags` keys, `declined`), so a version
bump with nothing to fill in. Results played before it simply have fewer kinds.

## Phase 2: roughing the passer and other personal fouls

**Roughing the passer.** The hook is the pass rush: a rusher who gets home (a sack, or a pressure that
reaches the quarterback) can hit him late, low or high. The roll lives on the main stream, after the
pass resolves, so it can change the play.

- **Odds:** base rate per hit on the passer (research), raised by the rusher's temperament (a hothead
  lands more late shots) and lowered by his Awareness; scaled by the crew.
- **Enforcement:** 15 yards and an automatic first down. On a completion past the line it's added to the
  end of the play; on an incompletion or a sack, from the previous spot. On an interception the offense
  keeps the ball (the foul came before the change of possession), so the pick is wiped out.
- **Choice:** the offense takes it unless the play was better (a long touchdown).
- **Injuries:** a roughing hit carries a little more injury risk than a clean one (`collide` in
  `gameSim.ts` already models hits on the passer).

**The other personal fouls**, on the same rules (15 yards, automatic first down when on the defense):

| Foul | Hook | Odds lean on |
| --- | --- | --- |
| Unnecessary roughness | Tackles near the sideline or after the whistle, hits on a receiver just as the ball arrives | Tackler temperament, crew |
| Face mask | Any tackle | Tackling, temperament |
| Horse collar | Tackles from behind, mostly by defensive backs and linebackers | Tackling, pursuit angle |
| Taunting / unsportsmanlike conduct | After sacks, big hits and touchdowns | Temperament |

**Crews:** a fourth tendency, **QB Protection** (1–20, same 0.8–1.2 multiplier), scales roughing the
passer. That's the officiating spec's "QB protection" later phase; its blocker ("needs pass-rush
penalties modeled") is this phase. It gets a column on the crews page, keeping the spec's rule that
every hidden tendency shows up in a stat a player can read.

## Phase 3: special teams

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
- **Calibration:** flags per return and per kick from the research table, while average starting field
  position after kickoffs and punts stays where it is now.

## Phase 4: the rest of the scrimmage fouls

**Before the snap** (one roll, as today, with more outcomes):

| Foul | Side | Odds lean on | Enforcement |
| --- | --- | --- | --- |
| Delay of game | Offense | Tempo (the hurry-up and the two-minute drill), a young quarterback's Awareness, road crowd noise | 5 yards |
| Illegal formation / shift / motion | Offense | How much motion the coordinator's scheme uses (`schemes.ts`), receivers' Awareness | 5 yards |
| Neutral zone infraction, encroachment | Defense | Split out of today's offside, same drivers | 5 yards |
| Too many men on the field | Either | Substitution: the hurry-up, rotations | 5 yards |

**During the play:**

| Foul | Hook | Enforcement |
| --- | --- | --- |
| Offensive pass interference | Any target, more on contested and deep balls; a physical receiver more | 10 yards from the previous spot |
| Illegal contact | Pass plays, against press coverage | 5 yards, automatic first down |
| Illegal use of hands | Pass blocking (offense) and pass rush (defense) | 10 (offense) or 5 and a first down (defense) |
| Intentional grounding | Today's "throws it away under pressure", when no receiver is near and he's still in the pocket | Loss of down, from the spot of the pass (a safety from his own end zone) |
| Ineligible man downfield | Screens and quick passes | 5 yards |
| Illegal forward pass | A scramble that crosses the line and then throws | 5 yards, loss of down |
| Defensive holding on runs, holding on sacks and scrambles | The run, sack and scramble results that roll nothing today | As their kind; holding on a sack is almost always declined |

**End-of-half rules:** a defensive foul on the last play gives an untimed down, and some offensive fouls
in the last minute bring a 10-second runoff. `npm run endings` must check both.

## Phase 5: crews, screens and checks

- **Crews:** four tendencies (Flag Volume, Holding, Coverage, QB Protection). The crews page shows a
  column for each, plus a per-foul breakdown when you open a crew.
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

## Decisions for the owner

1. **Declined penalties:** show them (box score and play-by-play), or keep them silent and only count
   accepted ones like most stat sites?
2. **Special-teams units:** picked automatically from the depth chart, or a special-teams depth chart
   you set (more management, FM-style)? And is a special-teams coach worth adding to the staff?
3. **QB Protection:** a fourth crew tendency now (Phase 2), or keep three and let roughing ride on Flag
   Volume?
4. **Star treatment:** never give star quarterbacks extra protection from crews (it would feel rigged,
   like the home lean the officiating spec already holds back). Agreed?
