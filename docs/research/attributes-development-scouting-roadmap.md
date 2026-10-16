# American Football Manager: Phased Design Roadmap for Attributes, Development, Training, and Scouting

Build a "true vs. perceived ratings" foundation first (an engine audit plus a data model that keeps each player's real ratings apart from what your staff believes), and almost every requested feature becomes a cheap layer on top: relative half-star ratings, fog-of-war ranges, scout reports, mentoring, and NFL-calendar training. Skip that foundation and each feature has to reinvent its own hidden-value logic.

## TL;DR

- **Do Phase 0 before anything else (low to medium effort).** Audit how the match engine reads attributes, then add an attribute registry (metadata for every attribute) and separate "true" ratings from "perceived" ratings. Every later feature depends on this, and it guarantees new attributes affect play outcomes instead of being cosmetic.
- **Quick wins come next (mostly low effort).** Position-relevant attribute views, a position-weighted overall, relative 0-4 half-star current-ability stars, attribute history graphs, a player comparison screen, plain-language scout summaries, NFL-style Full/Limited/DNP practice status, and tooltips. Each one reuses data the game already has.
- **Core and deep systems sit on that base.** Knowledge-percentage fog of war tied to scout and staff attributes, shaded potential stars, an NFL CBA-accurate practice calendar with padded-practice budgets, position-specific aging curves, and FM-style mentoring in position rooms driven by hidden personality attributes. Build them in dependency order: staff attributes, then fog, then stars and potential; personality, then mentoring.

## Key Findings

**How FM does it (the model to adapt):**
- **Two hidden numbers drive everything.** FM keeps Current Ability (CA) and Potential Ability (PA) on a shared 0 to 200 scale and never shows them directly. Stars give "an approximate idea of a player's ability and potential, showing up to 5 stars always in relation to your own squad."
- **Stars are relative and filtered through staff.** An SI developer described the stars as "loose guides rather than definitive measures… based on comparison to other players in your team in that position and the expected standards for your team/league they're in." Stars also change when you hire staff with better Judging Player Potential, even though the player has not changed.
- **Star colors encode certainty.** FM uses gold stars for the assessed level, silver for fractions below one gold star, and white stars to show "a range of potential ratings… with the gold or silver stars as a base and the white stars as a maximum." That is the shading model you asked for.
- **Attribute masking shows ranges.** Unless masking is disabled, attributes of players you know little about are "greyed out or displayed in a range" (for example Technique 11-16). Ranges narrow through scouting the nation or competition, assigning a scout to the player, or facing or watching him. The manager's own "player knowledge" and "young player knowledge" attributes control how much is revealed without scouting.
- **Hidden attributes carry the personality.** Commonly documented hidden attributes include Consistency, Important Matches, Injury Proneness, Versatility, Dirtiness, and a personality group of Adaptability, Ambition, Loyalty, Pressure, Professionalism, Sportsmanship, Temperament, and Controversy.
- **Development.** Community testing points to the CA-to-PA gap, age, Professionalism, and Ambition as the main drivers of growth. Match experience matters more as players age (one community tester puts it at roughly 50-50 with training at 18, with match experience dominant by 23). Training mostly decides *where* new CA points go, not how many there are. Physical attributes generally develop by about 24.
- **Mentoring.** FM22 reworked mentoring into a "more dynamic, personality-driven model." Community guides agree that it moves Determination, Professionalism, and personality, but "does not directly increase technical attributes." It works best in small groups: one tester found a 1-mentor, 10-mentee group had "almost no effect."

**Other sims (patterns worth borrowing):**
- **Front Office Football** draws each rating as a bar, with red for the scout's view of current ability and green for future potential. Ratings for young players "may vary as much as 50 percent" with X-Factor enabled, against "about 10 percent" for very experienced players. Scout accuracy varies by position ("Excellent" vs. "Poor"). Combine results "correlate to the player ratings" and are tunable by a Combine Accuracy setting.
- **Madden 26** reveals prospects in knowledge-threshold steps: 20% shows archetype, 45% shows skill grade ranges, 70% narrows those ranges, 90% shows draft talent, and 100% shows exact letter grades.
- **OOTP** keeps a league-wide consensus scout (OSA) next to your own head scout. Accuracy depends on scout ability, budget, and how much a scout has seen a player. Reports don't change until a player is re-scouted.
- **ZenGM (Basketball/Hockey GM):** "The displayed ratings are not the real ratings. They are estimates from your scouts." Raising the scouting budget improves accuracy "gradually… over 3 seasons." Potential is just an estimate, the "75th percentile ovr" of simulated career arcs, and players "should exceed his pot 25% of the time."
- **Draft Day Sports: Pro Football** gives scouting points from your staff budget. Players start with "prior knowledge" that depends on how prominent they are and on your coaches' scouting ability. Grades sit on 22 levels relative to the league average at the position. An interview costs 5 points and reveals personality "with no error margin."
- **Franchise Hockey Manager** has scouting levels from e (unscouted) to a (scouted four times, "error reduced heavily"). Scouts carry Evaluate Abilities and Evaluate Potential ratings (1-20) and take an accuracy penalty outside their home region.
- **Pocket GM 3** added a "Minicamp Review" that gives the first look at a draftee's actual ratings and potential, plus a Develop tab with a rating progression chart, injury history, and scouted potential.

**Real NFL rules (calendar constraints for the training system):**
- **Offseason (CBA Article 21).** A nine-week voluntary program in three phases. Phase One (2 weeks) is strength, conditioning, and rehab only. Phase Two (3 weeks) is drills at walk-through pace with no live contact or team offense vs. team defense. Phase Three (4 weeks) allows up to 10 OTA days with 7-on-7 and 11-on-11 work but no live contact. Contact work is "expressly prohibited in all offseason workouts." One mandatory veteran minicamp is allowed.
- **Training camp.** A maximum of 16 padded practices, no more than three in a row, after a five-day acclimation period. Practices are capped at 2.5 hours, with a 12-hour maximum at the facility per day.
- **Regular season (Article 24).** 14 padded practices total. Eleven must come in the first eleven weeks and three in the remaining six, with one allowed week of two padded practices. Postseason clubs may hold one padded practice per week. Bye weeks give "a minimum of four consecutive days off."
- **Days off (Article 35).** At least one day off each calendar week of the regular season, and at least three days off after a Thursday game.
- **Practice culture.** A typical week has installation practices Wednesday and Thursday, a lighter Friday, and a Saturday walkthrough. Teams openly ration padded practices: in December 2022, Green Bay's Matt LaFleur told the Green Bay Press-Gazette "We're out of them" after the Packers used their final padded practices around a Week 14 bye. Veteran rest days are formal: in 2022 Tampa Bay coach Todd Bowles said "we've got about six or seven guys that we have days off for... we call them veteran days," and Tom Brady was one of them (ProFootballTalk, Sept. 21, 2022).

**Aging curves (sources conflict, so model ranges rather than single ages):**
- **Running backs** peak earliest and fall hardest. Football Perspective found a peak at 26 followed by steady decline. ESPN Fantasy (2023) found that running backs who debuted since 2000 lost 25.2% of their PPR points per game, and 37.0% of their total PPR points, from age 28 to age 29. A per-snap, player-relative study (StatVault) puts the RB peak as early as 21.
- **Quarterbacks** last longest. Mike Braude's study for Apex Fantasy Leagues (April 2026) puts the average QB peak season at 28.5, with "pocket passers average a 30.7 peak age while dual-threat QBs average 26.1." About 13.9% of qualifying QB peak seasons came at 35 or older. ESPN Fantasy (2023) found QB rushing production in the age-27, 28 and 29 seasons was "within 0.23 points of each other," a clear plateau in scrambling ability.
- **Tight ends** showed strong longevity in one production study, still producing at 89% of baseline at age 34. That figure is subject to survivorship bias.

**Combine metrics:** The six core tests are the 40-yard dash, 225-lb bench press, vertical jump, broad jump, 20-yard shuttle, and 3-cone drill. A 2011 study in *Human Performance* (Lyons, Hoffman, Michel & Williams) found that college performance predicts NFL performance better than physical ability tests like the 40, vertical, shuttle, and 3-cone, and that past performance is "less susceptible to validity decay than physical ability." That is a useful design hook: combine numbers should be noisy, partial evidence.

## Details: The Phased Roadmap

Effort key: **Low** = days, mostly UI or data reuse. **Medium** = a new subsystem with modest balancing. **High** = a new simulation loop plus heavy tuning.
**[QW]** marks a quick win or QOL item.

### Phase 0: Audit and Foundations (do first; everything depends on it)

**0.1 Engine attribute audit (Low-Medium)**
- **What:** Instrument play resolution and log which attributes (or which overall) each play type reads, how they're weighted, and where randomness enters. Then run sensitivity tests: raise one attribute by 5 points on one player, simulate thousands of plays, and measure the change in outcomes (yards, completion %, sacks, pressures).
- **Why:** You currently don't know whether plays use per-attribute checks or overall ratings. Any attribute that shows no measurable effect is cosmetic today. The audit produces a written "attribute to engine" map that Claude Code can keep updated.
- **Connects to:** Everything. Its output decides whether new attributes plug into contests directly (0.3) or flow through position-weighted overalls (1.2).

**0.2 Attribute registry (Low)**
- **What:** One data table listing every attribute with: group, visible or hidden, positions it applies to, positional weight, aging-curve family (physical, technical, mental), trainability, and the engine hook(s) that consume it.
- **Why:** New attributes become data, not code. Views, overall formulas, development, and fog all read from one place.

**0.3 Engine "contest" layer (Medium)**
- **What:** Route play resolution through named matchups such as `pass_rush vs pass_block`, `release vs press`, `route vs coverage`, `ball_carrier vs tackler`, and `throw vs coverage window`. Each matchup reads attribute weights from the registry.
- **Why:** It works whichever way the engine resolves plays today. If the engine uses overall ratings, contests can start as overall-vs-overall and gain attribute detail over time. If it already does per-attribute checks, this makes them consistent. Design rule: **no attribute ships without at least one contest hook and a sensitivity test showing it moves outcomes.**

**0.4 True vs. perceived ratings split (Medium)**
- **What:** Store true values (attributes, CA, PA, hidden traits) separately from per-team "knowledge" records (knowledge %, perceived value, range width, the scout who produced it, last updated). The UI only ever reads perceived values. Your own roster starts at high knowledge.
- **Why:** This is the backbone for fog of war, scouting staff, shaded potential stars, AI teams making mistakes, and scout reports. It is cheap now and painful to retrofit later.
- **Design note:** Seed each scout's error per player so ranges don't change every time a screen refreshes. OOTP only updates a report when a player is re-scouted.

**0.5 Formal CA and PA (Low-Medium)**
- **What:** Define CA as the position-weighted value of a player's attributes, and give each player a hidden PA ceiling. The existing "Overall 13.7" can simply become the visible CA on the 1-20 scale.
- **Why:** Stars, development, and potential ranges all need CA and PA. FM's model (development pushes CA toward PA, and training decides where the points go) is easy to reason about and tune.

### Phase 1: Quick Wins and QOL (cheap, high-impact, build on Phase 0)

| Feature | What it is / why it matters | Depends on | Effort |
|---|---|---|---|
| **[QW] Position-relevant attribute view** | Show the player's position attributes first and collapse the rest under "Other." A QB showing Tackling 4 and Pass Rush 1 is noise. Keep the data so position changes still work. | 0.2 | Low |
| **[QW] Position-weighted overall** | Replace any generic average with registry weights per position (and later per scheme role). This keeps the overall meaningful as attributes are added. | 0.2, 0.5 | Low |
| **[QW] Relative CA stars (0-4, half steps)** | Nine visible levels (0, 0.5 … 4.0), set by the player's percentile within a reference group. See the star spec below. | 0.5 | Low |
| **[QW] Attribute history and progress graph** | Save an attribute snapshot every week or month and show sparklines plus green and red change arrows. Pocket GM 3 added exactly this as a "Develop" tab. | 0.2 | Low |
| **[QW] Player comparison view** | Two or three players side by side, with differences highlighted and the same fog rules applied (compare perceived ranges, not true values). | 0.4 | Low |
| **[QW] Plain-language scout summary** | Generate 3-5 sentences from perceived data: top strengths, top weaknesses, a projection, and confidence ("Limited looks; potential uncertain"). Templates are enough. | 0.4 | Low |
| **[QW] Fatigue and injury-risk indicators** | A condition bar, a load trend, and a risk badge (green, yellow, red) on roster and depth-chart screens. | 2.3 for full value; can start from existing game data | Low |
| **[QW] Practice status: Full / Limited / DNP** | NFL-native per-player participation, matching the real injury report. It is the simplest form of load management and doubles as a fatigue lever. | none | Low |
| **[QW] Tooltips everywhere** | For each attribute: what it does, which plays use it (straight from the 0.1 audit), and how it ages. For stars: "relative to QBs on your roster." | 0.1, 0.2 | Low |
| **[QW] Combine / measurables panel** | Height, weight, arm length, hand size, plus the six combine tests, generated from true physical attributes with noise. | 0.2 | Low |

**Star rating spec (feature 4):**
- **CA stars:** Compute the player's position-weighted CA, then his percentile among a **reference group**, and map that to 9 half-star bins. Recommended default group: **same position across the league** (stable and comparable across teams). Add a toggle for **"relative to my roster"**, which is FM's model: the SI developer said stars compare "to other players in your team in that position."
- **Why both:** The roster-relative view answers "who starts for me." The league-relative view answers "is he good." FM players regularly get confused when stars drop because a better teammate arrived, so label the reference group on screen.
- **PA stars (shaded):** Filled stars show perceived CA. Lighter shaded stars run from the low end to the high end of the perceived PA range, all on the same reference scale, so "3.5 potential" means "projects to play like a current 3.5-star player at his position." When the scout knows a lot, the shaded band shrinks to a single value. For veterans, PA collapses to CA, which already matches the screenshot (age 34, potential 14-15).
- **Staff dependence:** Perceived CA uses the evaluator's Judging Ability. Perceived PA uses Judging Potential. Hiring a better scout can change stars, just as in FM.

### Phase 2: Core Systems

**2.1 Staff attributes (Medium)**
- **What:** Give staff 1-20 attributes. Scouts get Judging Ability, Judging Potential, position specialty (or a positional accuracy profile, like FOF's "Excellent/Poor"), and a region. Position coaches get Technique teaching per unit. The S&C coach gets Physical development and Injury prevention. Medical staff get Recovery and Diagnosis. Coaches also get Mentoring/Motivation and Discipline. The user/GM gets "Player Knowledge" and "Prospect Knowledge," the FM manager-attribute equivalent.
- **Why:** These drive scouting accuracy, the size of training gains, and injury risk, turning hiring staff into a real decision.
- **Connects to:** 0.4 fog, 2.2 knowledge, 2.3 training, 2.5 development, 3.1 mentoring.

**2.2 Knowledge-percentage fog of war (Medium)**
- **What:** A knowledge value (0-100%) per team per player. Range width shrinks as knowledge rises, and accuracy improves with scout Judging Ability and position specialty. Knowledge comes from scout assignments, games played against the player, film review, combine and pro days, interviews (personality only), and having him on your roster.
- **Reveal thresholds** (Madden-style, which is easy to communicate): roughly 20% shows archetype and physicals, 45% shows attribute ranges, 70% narrows them, 90% gives a PA band, and 100% (or a season on your roster) shows exact visible values. Hidden traits come out only through hints in coach and scout reports.
- **Experience narrows uncertainty.** Follow FOF's pattern: wide variance for rookies and young players, about ±10% for established veterans. Add a league-consensus view (OOTP's OSA) so the user can compare his own scout with "the league."
- **Why:** It creates draft busts and late-round gems for structural reasons, and gives scouts real value.
- **Connects to:** Stars, comparison, scout summaries, the draft, free agency, and trade AI (AI teams should also use perceived values).

**2.3 NFL-calendar practice scheduler (Medium-High)**
- **Season phases with hard CBA budgets:**
  - Offseason Phase 1/2/3, OTAs, and minicamp: no live contact, so low injury risk, mental and technique gains, and scheme install.
  - Training camp: a 5-day acclimation period, at most 16 padded sessions, no more than 3 consecutive.
  - Regular season: 14 padded practices (11 in weeks 1-11, 3 in the final six, and one week allowed two).
  - Bye: 4 consecutive days off. Postseason: 1 padded practice per week. At least 1 day off every week, and 3 after a Thursday game.
- **Session types:** Padded (full contact), Helmets/Shells (full speed, limited contact), Walkthrough (mental reps, close to zero load), Recovery, Rest/Off, Film. Show the budget meter ("Padded: 9 of 14 used") as its own QOL element.
- **Weekly template:** Wednesday and Thursday install, Friday lighter situational work, Saturday walkthrough, with presets plus an "auto-intensity by condition" option, as FM does.
- **Unit focus** (offense install, defense install, red zone, two-minute, special teams) and **individual focus** (one attribute or a role) per player.
- **Tradeoffs:** Padded sessions give the most growth in contact skills (blocking, tackling, block shedding) and the highest load and injury risk. Walkthroughs grow Play Recognition and game-plan familiarity at almost no risk. Make the **veteran rest day** a one-click option per player.
- **Why:** Practice becomes a real resource-allocation puzzle grounded in actual NFL rules, which sets you apart from FM.

**2.4 Expanded attribute set (Medium, mostly data; engine hooks are the real cost)**

The aim is about 30 visible attributes per player (most players only see their ~12-15 relevant ones) and 8 hidden ones. Each visible attribute is listed below with its main engine hook.

- **Physical (all positions, visible):**
  - Speed: pursuit and separation
  - Acceleration: first step, burst
  - Agility / Change of Direction: cuts, route breaks, mirroring in coverage
  - Strength: blocking, shedding, breaking tackles
  - Explosiveness / Jumping: contested catches, pass deflections, power at contact
  - Stamina: snap-to-snap fatigue
  - Natural Fitness: recovery between games and how fast physicals decline with age
- **Mental (all positions, visible):**
  - Awareness is split into **Play Recognition** (defensive read speed and play-action resistance) and **Decision Making** (QB reads, ball-carrier choices)
  - **Composure:** performance under pressure and in late, close games
  - **Discipline:** penalty rate
  - **Leadership:** mentoring strength and team morale
  - **Work Ethic:** the visible counterpart to FM's Determination; drives training gains
- **QB:** Throw Power, Short Accuracy, Deep Accuracy, plus **Pocket Presence** (sacks and pressure-to-sack conversion), **Throw on the Run**, and **Release** (time to throw).
- **Ball carrier:** Ball Security, Elusiveness, plus **Vision** and **Power/Break Tackle**.
- **Receiving:** Hands, Route Running, plus **Release** (vs. press), **Contested Catch / Catch in Traffic**, and **Ball Tracking**.
- **Blocking:** Pass Blocking, Run Blocking, plus **Footwork/Technique** (handling counters, holding penalties).
- **Defense:** Tackling and Pass Rush stay. Run Stopping becomes **Block Shedding**. Add **Pursuit**. Coverage splits into **Man Coverage**, **Zone Coverage**, and **Press**. Add **Ball Skills** (interceptions and pass breakups).
- **Kicking:** Kick Power and Kick Accuracy, plus an optional **Punting Hang Time**.
- **Hidden (8):**
  - **Consistency:** variance in game-to-game performance
  - **Big Game:** FM's Important Matches, for playoffs and primetime games
  - **Injury Proneness**
  - **Professionalism:** development rate; protects against decline
  - **Ambition:** development rate and contract behavior
  - **Adaptability:** scheme or team change, learning a new playbook
  - **Versatility:** penalty for playing out of position
  - **Temperament:** personal fouls and ejections; covers FM's Dirtiness
- **Road game toughness:** Don't create a standalone attribute. Apply Composure (and Big Game) as a **small** modifier in hostile environments. A separate "road" stat adds clutter for very little decision value. Make it an optional hidden trait later if playtesting wants it.
- **Combine linkage:** 40 ← Speed and Acceleration. 3-cone and shuttle ← Agility/Change of Direction. Vertical and broad ← Explosiveness. Bench ← Strength. Generate results with noise so the combine is evidence, not truth.

**2.5 Development and aging engine v2 (Medium-High)**
- **Growth:** Each development tick (weekly or monthly), CA moves toward PA. The rate = f(PA−CA gap, age, Work Ethic and Professionalism, coaching and facility quality, practice load and type, snaps played). Training focus decides **where** the points go (FM's model).
- **Playing time:** Weight snaps more heavily as players age. Community FM testing suggests training and match experience are about equal at 18, with match experience dominant by the mid-20s.
- **Aging families:**
  - Physical attributes peak early and decline first, earliest for RBs.
  - Technical attributes peak in the mid-to-late 20s.
  - Mental attributes keep improving into the 30s.
- **Position curves:**
  - RB: peak at about 24-27, sharp decline from 28-29.
  - WR and CB: peak at about 25-28.
  - QB: peak at about 27-31, with pocket passers lasting longer and mobility fading from 27-29. Long tail to 35+.
  - TE, OL, K/P: long plateaus.
- Randomize each player's curve so some age gracefully and others fall off a cliff. Natural Fitness and Injury Proneness change the slope.
- **Why:** It produces believable careers and the real NFL roster puzzle (when to move on from a 28-year-old RB, how long to pay a QB).

### Phase 3: Deeper Systems

**3.1 Mentoring in position rooms (Medium)**
- **What:** Position rooms (QB room, WR room, OL room, and so on) where you assign one or two veterans to two to four young players. Influence = f(Leadership, years in the league, starter status, personality). Over time, mentees move toward the mentors' Work Ethic, Professionalism, Composure, and Discipline. Mentoring has no direct technical gain, which is FM's rule, though a mentee in the same room as the mentor can get a small Play Recognition boost from film study.
- **Small groups by design:** FM testing showed that large groups dilute the effect. Influence works in **both directions**: a low-Professionalism vet can drag rookies down, and FM players report Determination dropping in bad groups. Peak effect for ages 21-24, fading after that.
- **Depends on:** the 2.4 hidden personality attributes, 2.5 development (that is where personality pays off), and Leadership.

**3.2 Personality labels and morale (Medium)**
- **What:** Derive readable labels such as "Model Professional," "Film Junkie," "Volatile," or "Needs Reps" from hidden-attribute combinations, the way FM does, and show them even when the underlying numbers are hidden. Add morale based on playing time, contract, and team results, which feeds Consistency.

**3.3 Injury model v2 (Medium-High)**
- **What:** Risk = f(load in the last 7 and 28 days, padded sessions, fatigue, Injury Proneness, age, position contact level, medical staff quality). Add injury types with recovery ranges and reinjury risk, and an injury history tab (as in Pocket GM 3).

**3.4 Draft-season scouting loop (Medium-High)**
- **What:** A season-long scouting point budget, regional and position assignments, all-star games, the combine, pro days, a limited number of interviews (DDS-style: reveals personality without error), private workouts, and a post-draft "minicamp reveal" moment (Pocket GM 3).

**3.5 Scheme fit and role ratings (High)**
- **What:** Overall by scheme role (for example "Zone-scheme RB" vs. "Power RB," "Press-man CB" vs. "Zone CB"), using alternative weight sets in the registry. This makes coordinators and scheme choices matter.

### Dependency Map (build order)

- Engine audit (0.1) → contest layer (0.3) → **every new attribute** (2.4)
- Attribute registry (0.2) → position views, weighted overall, history, tooltips (Phase 1)
- True/perceived split (0.4) → staff attributes (2.1) → knowledge fog (2.2) → shaded PA stars, scout summaries, draft loop (3.4)
- CA/PA (0.5) → relative stars (Phase 1) → development v2 (2.5)
- Hidden personality (2.4) → mentoring (3.1) and personality labels (3.2)
- Practice scheduler (2.3) → fatigue/injury indicators (full version) → injury model v2 (3.3)
- Staff coaching attributes (2.1) → size of training gains (2.3) → development (2.5)

## Recommendations

1. **Ship Phase 0 plus the Phase 1 quick wins as one milestone.** Players see better screens right away, and you get the data model needed for everything else. Don't start fog of war before the true/perceived split exists.
2. **Treat "no engine hook, no attribute" as a hard rule.** Each new attribute needs a declared contest hook and a passing sensitivity test. If the audit shows the engine is overall-driven, still ship the contest layer, starting with overall-vs-overall and replacing it gradually.
3. **Default stars to league-relative by position, with a roster-relative toggle,** and label the reference group on screen. Cap at 4 stars in half steps, and keep the shaded potential band visible so uncertainty is part of the drama.
4. **Use the CBA calendar as the training system's skeleton.** The padded-practice budget, the bye rule, and the weekly day off are free design constraints that create meaningful choices, and no FM clone has them.
5. **Keep the hidden set small (8) and expose it through words, not numbers.** Scout and coach reports should hint ("Seems to shrink in big games"), as FM's reports do.
6. **Tune with telemetry.** Log league-wide aging outcomes (average RB decline at 29, QB share of top seasons after 33) and compare them with the real-world ranges above each time you balance.

## Caveats

- **The mechanics described for FM are mostly reverse-engineered by the community** (mentoring influence, match-experience weightings, CA attribute weights). SI has not published the formulas. Treat them as design inspiration, not specifications.
- **NFL aging studies disagree** because they use different metrics (fantasy points, EPA, per-snap impact, peak-season counts) and suffer from survivorship bias. RB peak estimates range from 21 to 26 depending on method. Use ranges and per-player randomness rather than one canonical curve.
- **CBA details reflect the 2020 agreement** as published by OverTheCap and NFL.com. Confirm that the rules still hold before hard-coding them, because the current CBA runs through 2030 but side letters can change practice rules.
- **College Football Revamped could not be documented.** It is a fan mod of NCAA Football 14, and its recruiting changes live in a separate add-on documented only in videos and on Discord. No reliable source describes its scouting fog, so it is left out of the comparisons.
- **Combine-based ratings should stay noisy:** the 2011 *Human Performance* study by Lyons et al. found college performance predicts NFL success better than physical ability tests, so don't let combine numbers reveal true attributes.