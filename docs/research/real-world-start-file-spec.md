# Real-World Start File: Pipeline Spec

Oct 15, 2026 · @Carlos Ancira

## Purpose and locked decisions

The pipeline builds one consistent 2026 start file from real NFL data: Week 1 rosters, real contracts, our own ratings, and each team's HC, OC and DC. Anything that leaves the dev machine uses fictional names.

| Decision        | Choice                                                                                                   |
|-----------------|----------------------------------------------------------------------------------------------------------|
| Snapshot moment | 2026 regular season, Week 1 rosters (preseason start, like FM)                                           |
| Mirror depth    | Build both layers now; set the realism dial later                                                        |
| Coaching scope  | HC, OC, DC per team (96 coaches), built into the coaching staff feature (shipped in PR #7)               |
| Ratings source  | Our own formulas on public data; never copied from Madden, PFF or other proprietary grades               |
| Names           | Always fictional outside the private mirror layer                                                        |
| Rerun cadence   | Reruns each season; returning players keep the same fake identity                                        |

**How Claude Code should use this spec**

1.  Run Phase 0 first and report findings before writing pipeline code.

2.  Treat field names and signals here as intent. Adapt them to the game's actual data model.

3.  When data can't support a signal, use the listed fallback and flag it in the validation report. Never invent numbers silently.

4.  Stack: two stages. Stage 1 is Python (nflreadpy, Polars): it pulls data and computes raw features, with no game logic, and its output lives outside the repo. Stage 2 is a TypeScript importer in the repo that turns features into a League using the engine's own functions (combine, aging, traits, overall, market, generators), so no game formula is ever rewritten in Python. Outputs are deterministic: same snapshot plus same seed equals the same file.

**Build order**

1.  **Phase 0 audit.** Claude Code reads the listed files and reports back.

2.  **In parallel:** the coaching staff feature (with HC, OC, DC and coach-held tendencies) and pipeline Phases 1-3 (snapshot, names, contracts). Neither touches the other.

3.  **Phase 4 ratings,** once dev-v2 is confirmed on main (it is: PR #6).

4.  **Phase 5,** once the coaching staff feature has shipped (it has: PR #7).

5.  **Phase 6** validation and team profiles.

This spec holds no real player data, so it can live in docs/research/ next to the roadmap doc.

## Two layers and the realism dial

One pipeline, two outputs: a private mirror layer that matches reality 1:1, and a ship layer generated from it through a configurable realism dial. The dial exists because fictional names alone may not be enough to avoid likeness claims (see Open questions).

1.  **Raw snapshot:** frozen downloads, never edited by hand.

2.  **Mirror layer:** real players, real contracts, computed ratings, real IDs. Private. Used for dev testing and as a base for a possible community file later.

3.  **Realism dial:** a config file of knobs applied to the mirror layer.

4.  **Ship layer:** fictional names, internal IDs only, dial applied. This is the only layer the game build may load by default.

| Knob          | What it changes                                     | Light | Medium                         | Heavy                          |
|---------------|-----------------------------------------------------|-------|--------------------------------|--------------------------------|
| Name          | First and last name                                 | Fake  | Fake                           | Fake                           |
| Age           | Birth date shift                                    | None  | Up to 1 yr                     | Up to 2 yr                     |
| Size          | Height and weight nudge                             | None  | 1 in, 5 lb                     | 1 in, 10 lb                    |
| Jersey number | Reassigned within legal numbers for the position    | Keep  | Reassign                       | Reassign                       |
| College       | Swapped within the same conference tier             | Keep  | Swap                           | Swap                           |
| Contract      | APY and guarantees nudged; team cap total preserved | None  | 5%                             | 10%, length 1 yr               |
| Ratings       | Random noise per attribute                          | None  | 0.5                            | 1.0                            |
| Draft info    | Round and pick                                      | Keep  | A few picks                    | Round 1 either way             |
| Career stats  | Past season stat lines                              | Real  | Perturbed 10%                  | 2025 games played only         |
| Combine       | Measurables shown in game                           | Real  | Regenerated by generateCombine | Regenerated by generateCombine |

**Guardrails**

- The AFLS repo is public, so mirror files live outside it (or in a gitignored folder) and are never committed or bundled into a build. This matches CLAUDE.md: real names are a community mod concern, and the mirror format can later become the documented mod format.

- The ship layer carries no real names, no gsis_id and no OTC id. Only internal IDs.

- The build fails if any ship-layer name matches a real NFL player name (automated check against the full player list).

- Age shifts flow through to aging and development, so a shifted player ages on his new birth date.

## Fit with the engine and development v2

The pipeline supplies data; the engine keeps every rule. This map shows what each side owns, so nothing gets built twice.

| Engine piece                                                     | Status          | Pipeline does                                                                                          | Pipeline does not           |
|------------------------------------------------------------------|-----------------|--------------------------------------------------------------------------------------------------------|-----------------------------|
| Attribute registry and contests (attributes.ts)                  | Shipped         | Fits ratings to contests, reading the CONTESTS weights at runtime                                      | Hard-code any blend         |
| Combine (scouting.ts)                                            | Shipped         | Inverts generateCombine to get physicals                                                               | Keep its own combine model  |
| Aging curves (aging.ts)                                          | Shipped         | Ages combine physicals forward with AGING and declineOnset                                             | Write its own aging model   |
| Hidden traits (traits.ts)                                        | Shipped         | Sets work ethic, durability and temperament from real signals                                          | Change what traits do       |
| Development and reps (development.ts)                            | Shipped         | Seeds 2025 games played, which sets first-year reps                                                    | Simulate growth             |
| Scouting fog and staff                                           | Shipped         | Nothing: knowledge comes from experience, scouts from staff.ts                                         | Mirror real scouts          |
| Contracts, cap, market                                           | Shipped         | Fills ledgers, dead money, carryover, tags, caps                                                       | Reprice contracts           |
| AI GMs (GmTraits)                                                | Shipped         | Sets the numeric GM traits per team                                                                    | Add AI behavior             |
| Expanded attributes (roadmap 2.4, about 30 visible and 8 hidden) | Planned         | Keeps every raw feature (jumps, splits, penalties by type), so new attributes refit without a new pull | Wait for it                 |
| Coaching staff (coaching.ts)                                     | Shipped         | Supplies HC, OC and DC names, ratings and tendencies in the feature's shape (see Phase 5)              | Design the coaching feature |
| Injuries, practice, mentoring                                    | Planned         | Saves games-missed history in the features file                                                        | Model injuries              |

## Data sources and known gaps

nflverse covers most of the start file through nflreadpy, its Python port. Gaps are coaches below HC, year-by-year contract detail, future pick ownership, and individual offensive line grades. Function names come from the [nflreadpy migration list](https://github.com/nflverse/nflreadpy/issues/6).

| Need               | nflreadpy function                       | Notes                                                                                                                                                        |
|--------------------|------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Week 1 rosters     | load_rosters_weekly()                    | Team, status (active, practice squad, IR), jersey, bio, college, draft info                                                                                  |
| Depth charts       | load_depth_charts()                      | Verify the 2026 format and how to pick the Week 1 version                                                                                                    |
| Player master list | load_players()                           | All-time list; also used for the fake-name collision check                                                                                                   |
| ID crosswalk       | load_ff_playerids()                      | Links IDs across sources                                                                                                                                     |
| Contracts          | load_contracts()                         | OTC-sourced; documented fields are contract-level only ([dictionary](https://cloud.r-project.org/web/packages/nflreadr/vignettes/dictionary_contracts.html)) |
| Athletic testing   | load_combine()                           | 40, bench, vertical, broad, 3-cone, shuttle, height, weight                                                                                                  |
| Draft capital      | load_draft_picks()                       | Round and pick for every drafted player                                                                                                                      |
| Production         | load_pbp(), load_player_stats()          | Play-by-play for custom splits (CPOE by depth, fumbles, penalties)                                                                                           |
| Usage              | load_snap_counts(), load_participation() | Snap share; participation availability for 2025 to verify                                                                                                    |
| Tracking           | load_nextgen_stats()                     | Separation, air yards, rush yards over expected, CPOE                                                                                                        |
| Charting           | load_ftn_charting()                      | Contested catches, drops, play-action, blitz counts                                                                                                          |
| Head coaches       | load_schedules()                         | Home and away coach per game, the real 2026 schedule, and past results for League history                                                                    |
| Trades             | load_trades()                            | Front office style signals (Phase 5) and future pick ownership; check nflreadpy support                                                                      |

**Known gaps and fallbacks**

- **PFR advanced stats** (pressures, missed tackles, coverage allowed): listed as not yet handled in nflreadpy. Check whether it has been added; if not, read the nflverse release files directly.

- **Contract detail:** the contracts dictionary documents value, APY, guarantees, length and year signed. Year-by-year cap hits, proration and void years may sit in an undocumented nested column. Verify in Phase 0; fallback in Phase 3.

- **Contract IDs:** contracts carry an OTC ID, not gsis_id. Join through the ID crosswalk if possible, else name plus position plus team, with a manual review list.

- **Coordinators:** no nflverse dataset. A hand-built table of 64 OC and DC names (Phase 5).

- **Future draft picks:** derive them from load_trades, where traded picks carry a season and round. Conditional picks go on the manual review list; untraded picks stay with their team.

- **Offensive line grades:** no free per-lineman pass or run block data. Ratings use proxies (Phase 4).

- **Data terms:** check each dataset's license and source terms before derived numbers ship (see Open questions).

## Phase 0: confirm in code before building

The repo's docs already answer most data model questions. Phase 0 shrinks to reading six files and reporting back, before any pipeline code. Sources: [GAME_DESIGN.md](https://github.com/carlosa512/AFLS/blob/main/docs/GAME_DESIGN.md) and [CLAUDE.md](https://github.com/carlosa512/AFLS/blob/main/CLAUDE.md).

**Already known from the repo**

| Area                         | What the game does                                                                                                                         | Pipeline impact                                                                       |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| Save format                  | One plain JSON League; shape changes bump SAVE_VERSION with a migration                                                                    | Start file must match the League shape                                                |
| Randomness                   | Seeded Rng; a seed reproduces the world                                                                                                    | Start file plus seed reproduces a career                                              |
| Ratings                      | 1-20; OVR_WEIGHTS per position; engine reads contests via skill(), never ratings directly                                                  | Every attribute in the registry needs a value                                         |
| Aging                        | Aging families in attributes.ts, age curves in development.ts                                                                              | Used to age combine-based physicals                                                   |
| Combine                      | Generated from true physicals plus noise (scouting.ts)                                                                                     | Invert it, so real combine numbers map to true physicals                              |
| Contracts                    | Year-by-year ledgers: base, guarantees, proration up to 5 years, void years; salaries in thousands                                         | Real deals map directly; never a single salary number                                 |
| Cap                          | \$301.2M, top-51 rule, carryover                                                                                                           | Confirm against the official 2026 figure                                              |
| Market                       | Pay by position rank as a share of cap; 7 AI GM styles                                                                                     | Real deals will differ from the market; offseason audit must stay stable              |
| Rosters                      | 53-man rosters, depth charts in roster.ts                                                                                                  | Practice squad and IR need a default (Phase 1)                                        |
| Staff                        | Scouting departments and coaching staffs (HC, OC, DC, S&C, seven position coaches) exist                                                   | Scouts stay generated; HC, OC and DC go in a side file                                |
| Not built yet                | Injuries, IR, practice, mentoring, medical staff, expanded attributes                                                                      | Don't map data the game can't use yet                                                 |
| Development v2               | On main (PR #6): AGING table per position, hidden traits (work ethic, durability, temperament), reps-based growth                          | The importer calls aging.ts and traits.ts directly; Phase 4 sets each player's traits |

**Confirm in code**

1.  attributes.ts: **done.** 19 attributes, 3 aging families, 35 contests, and the overall weights from ATTRIBUTES.md are now in Phase 4.

2.  positions.ts: confirm OVR_WEIGHTS matches the audit's overall weights.

3.  generate.ts: the rating distribution per position in a generated league (the calibration target), and where a seeded start file can plug in.

4.  scouting.ts: done. generateCombine is linear and inverts cleanly (Phase 4).

5.  finance/contract.ts and market.ts: ledger shape, and how the market prices a player.

6.  roster.ts: depth chart shape and roster limits.

7.  match/coach.ts and offseason/ai.ts: GM style is already per team (Team.gm in types.ts). Check how coach.ts reads tendencies today, before the coaching staff feature moves them onto coaches.

8.  The claude/development-v2 branch: done for aging.ts, traits.ts, development.ts and types.ts. Still confirm positions.ts (ATTRIBUTE_PROFILES, OVR_WEIGHTS), any SAVE_VERSION change, and whether it has merged: GAME_DESIGN.md on main still lists it under Next.

**Data coverage checks**

- 2026 Week 1 roster counts per team, split by status.

- Whether contracts include year-by-year detail, and the share of rostered players matched to a contract.

- Depth chart format for 2026 and whether a Week 1 version can be isolated.

- Whether PFR advanced stats, participation and trades load in nflreadpy.

- Combine coverage by position (share of players with a 40, 3-cone, bench).

**Report deliverables**

- A field mapping table: League field, source field, transform.

- A list of League fields with no source, filled by the existing generators (schedule, scouts, the 2027 draft class).

- A recommended loader: a new path in generate.ts that builds a League from the seed file and fills everything else with existing code.

- Any decision in this spec the data or the code can't support, with an alternative.

## Phases 1-2: snapshot and identity

**Phase 1: frozen snapshot**

- Pull every source once. Store the raw files with a manifest: pull date, nflreadpy version, row counts.

- Raw files are never edited by hand. Corrections live in a separate overrides file, applied in code.

- Roster: 2026 Week 1 from load_rosters_weekly(), active 53 only. Practice squad and reserve-list players join the free-agent pool by default, since the game has no practice squad or IR yet.

- Stats window for veteran ratings: 2023, 2024 and 2025 seasons, weighted 50 / 30 / 20 (most recent first).

- **No data from after Week 1 kickoff** enters ratings or contracts. 2026 game stats are excluded entirely.

- Contracts signed in 2026 go on a manual review list. If an extension came after Week 1, the prior contract applies.

**Phase 1: position mapping**

The game uses 12 positions (QB, RB, WR, TE, OL, DT, EDGE, LB, CB, S, K, P). Real positions collapse into them as below.

| Real position            | Game position | Rule                                                                                                               |
|--------------------------|---------------|--------------------------------------------------------------------------------------------------------------------|
| QB, RB, WR, TE, CB, K, P | Same          | Direct                                                                                                             |
| FB                       | TE or RB      | TE if he mostly blocks, RB if he carries the ball                                                                  |
| T, G, C                  | OL            | Keep his depth chart slot (LT, LG, C, RG, RT) as a tag, for run-gap credit in Phase 4                              |
| DT, NT                   | DT            | Direct                                                                                                             |
| DE                       | EDGE          | Direct                                                                                                             |
| OLB                      | EDGE or LB    | EDGE if the depth chart lists him as a rush OLB or his pressure rate ranks like an edge rusher; else LB            |
| ILB, MLB                 | LB            | Direct                                                                                                             |
| FS, SS                   | S             | Direct                                                                                                             |
| LS                       | None          | The game has no long snapper. His roster spot goes to the best practice-squad player at the team's thinnest group. |

Every mapping that isn't direct goes on the manual review list.

**Phase 2: stable IDs**

- Each player gets a numeric internal ID (Player.id is a number), assigned once and kept in the ledger. New players get the next free number.

- The crosswalk between internal ID and gsis_id lives only in the private mirror layer.

- Players with no gsis_id get a fallback key from other IDs and are flagged.

**Phase 2: fake name generator**

- Seeded by internal ID, so a player keeps the same name across reruns and future seasons.

- Pools of at least 2,000 first names and 5,000 last names from public-domain name frequency lists (for example US Census surnames and SSA first names).

- Names are assigned at random. They are never derived from the real player's name or background.

- A names ledger stores every name ever issued. Reruns reuse it; only new players get new names.

**Name rules** (a name failing any rule is redrawn)

1.  Full name is unique across the league.

2.  Full name matches no player in load_players(), all-time.

3.  Last name never equals the real player's last name.

4.  At least 3 character edits away from the real player's full name, so no near-spellings.

5.  Not on a blocklist of celebrities and joke combinations.

6.  Suffixes (Jr., II, III) at a low, realistic rate, around 5%.

## Phase 3: contracts and cap

Every rostered player gets the contract that was active at Week 1, mapped into the game's year-by-year ledger (salaries in thousands). The ledger already supports base salary, guarantees, proration up to 5 years and void years, so real detail maps directly. Each team's 2026 cap total must land within 3% (or \$5M) of OTC's figure.

| Game field                           | Primary source                            | Fallback if missing                                                |
|--------------------------------------|-------------------------------------------|--------------------------------------------------------------------|
| Total value, APY, guarantees, length | load_contracts()                          | None needed                                                        |
| Year-by-year cap hit                 | Nested yearly detail, if Phase 0 finds it | Structure model below                                              |
| Signing bonus and proration          | Yearly detail                             | Share of guarantees by tier, prorated over up to 5 years           |
| Void years                           | Yearly detail                             | Skip; flag teams with heavy void-year use for manual entry         |
| Minimum salary deals                 | Contracts data                            | CBA minimum by credited seasons (lookup table, verify 2026 values) |
| Practice squad pay                   | Not in contracts                          | Skip until the game has a practice squad                           |
| Dead money                           | Yearly detail of released players         | Per-team total entered by hand                                     |
| Adjusted cap (rollover)              | Not in nflverse                           | Per-team figure entered by hand                                    |

**Mapping onto the game's types** (types.ts)

- Contract.kind: rookie, veteran, tag or minimum. A 2026 franchise tag sets kind tag, the player's tagCount, and Team.taggedId.

- signedWeek: -1 for every deal, meaning it existed before the league began.

- years: one ContractYear per league year with base and guaranteed; void years carry void: true. paidBefore stays empty at Week 1.

- bonuses: one Proration per signing bonus or restructure, with its real start year and source.

- fifthYearOption: 2023 first-rounders get exercised or declined from the real spring 2026 decisions (hand-entered if missing); later first-rounders stay eligible.

- Team.deadMoney: each entry points at the released player, who stays in the league as a free agent or on his new team.

- Team.carryover: unused 2025 cap rolled into 2026, from OTC's adjusted cap.

- League.caps: the real 2026 cap; later years use the game's own projection.

**Structure model (fallback only)**

- Signing bonus is a tier-based share of guarantees, prorated evenly over the lesser of contract length or 5 years.

- The rest of the value becomes base salary with a mild yearly rise.

- Rookie deals follow draft slot, since the rookie wage scale makes them predictable.

- Every modeled contract is tagged modeled so it can be replaced by real detail later.

**Validation**

- The game uses a \$301.2M cap. Confirm it against the official 2026 figure and record the source.

- 32 team totals from OTC team cap pages are entered by hand as the check target.

- Teams outside tolerance get a diff report listing the 10 largest contributors.

- Ship layer: contract nudges from the dial are rescaled so each team's total matches the mirror layer.

## Phase 4: ratings

Each attribute is a weighted blend of public signals, ranked against peers, then mapped to the 1-20 scale through one shared curve. Nothing is copied from Madden, PFF or any proprietary grade.

**Method, per attribute**

1.  Compute raw signals per player per season as rates (per snap, per target, per attempt).

2.  Weight seasons 50 / 30 / 20, most recent first.

3.  Shrink small samples toward a prior, using the formula below.

4.  Standardize within the comparison group (z-scores), then blend signals using the weights in the signal map.

5.  Convert to a percentile and map to 1-20 with the calibration curve.

```math
\text{rating}_{raw} = r \cdot x + (1 - r) \cdot \text{prior}, \qquad r = \frac{n}{n + k}
```

Here x is the player's observed value, n his sample size (snaps or attempts), and k a stabilization constant per signal. The prior comes from draft capital and career snap share, not the league average, because backups are usually backups for a reason.

**Contest-first fitting** (QB, RB, WR, TE, CB, S, EDGE, DT)

Real stats describe contests better than single attributes. A receiver's deep separation reflects the deep routes contest (speed 45%, route running 35%, agility 20%), not route running alone. So for positions with rich data:

1.  Pin physical attributes (Speed, Agility, Strength) from the combine first.

2.  Estimate each contest's skill level from the real stat it decides (table below), using the shrinkage above.

3.  Solve for the remaining attributes so the blends in attributes.ts reproduce those skill levels as closely as possible (bounded least squares, kept within 1-20).

OL, LB and kickers use direct signals instead, because their contests share too few separate measurements.

| Contest                        | Real stat it should match                                                    |
|--------------------------------|------------------------------------------------------------------------------|
| Short passing                  | CPOE on throws under 10 air yards                                            |
| Intermediate passing           | CPOE on throws of 10-19 air yards                                            |
| Deep passing                   | CPOE on throws of 20+ air yards                                              |
| Decision making                | INT rate, adjusted for target depth                                          |
| Pocket presence                | Sack rate when pressured                                                     |
| Scrambling                     | Scramble yards per dropback                                                  |
| Inside and outside running     | Rush yards over expected, split by run location in play-by-play              |
| Breaking tackles               | Broken tackles per carry, yards after contact                                |
| Target share                   | Targets per route run (or per snap)                                          |
| Short and deep routes          | Average separation (NGS), read against average target depth; deep catch rate |
| Hands                          | Drop rate                                                                    |
| After the catch                | YAC over expected (NGS)                                                      |
| Returns                        | Kick and punt return average                                                 |
| Short and deep coverage        | Completion rate and yards per target allowed, short vs. deep                 |
| Ball skills                    | INTs per target                                                              |
| Edge and interior rush         | Pressures per pass-rush snap                                                 |
| Holding the point and run fits | Run stuffs per run snap                                                      |
| Open-field tackling            | Missed tackle rate                                                           |
| Discipline                     | Penalties per snap: false starts, holding, offside                           |

**Comparison groups**

- **Physical attributes** (Speed, Agility, Strength) use one league-wide scale, so a fast guard is still slower than a slow corner.

- **Skill attributes** compare within the position group that does that job (Pass rush across DL, EDGE and blitzing LBs).

- **Off-position attributes** (a QB's Tackling) are not computed. They come from the game's own generator (ATTRIBUTE_PROFILES in positions.ts), so they match a generated player.

- **Combine numbers are aged.** generateCombine is linear, so it inverts exactly. Speed comes from the 40 (0.035 seconds per rating point, adjusted for weight), Agility from the shuttle and 3-cone averaged, Strength from bench reps (adjusted for weight), with the jumps as a cross-check. That recovers his rating at combine age within about 1 to 1.5 points. The importer then ages it forward with the engine's own decline (aging.ts, development.ts), so a 31-year-old's speed reflects his body clock.

**Calibration: quantile matching**

The engine is already tuned on the ratings generate.ts produces: all 23 league stats land inside NFL ranges and the better-rated team wins about 68%. So real players map by quantile within position. A receiver at the 85th percentile of real WRs gets the rating found at the 85th percentile of a generated league's WRs, which keeps the engine's balance intact.

Rough reference for sanity checks only:

| Percentile | Rating | Rough meaning                |
|------------|--------|------------------------------|
| 99th       | 19     | Best in the league           |
| 95th       | 17     | All-Pro range                |
| 85th       | 15     | Pro Bowl range               |
| 65th       | 13     | Solid starter                |
| 45th       | 11     | Fringe starter or top backup |
| 25th       | 9      | Backup                       |
| 10th       | 7      | Depth or practice squad      |
| 1st        | 4      | Roster filler                |

A 20 stays reserved for generational outliers. If real data has a different shape than the generator (for example more elite QBs), flag it in the report rather than forcing it to fit.

**Attribute signal map** (registry from attributes.ts, overall weights from ATTRIBUTES.md)

Effort goes where weight is highest: weights of 2 or more get the best signals, and 0.5 weights can lean on fallbacks. For OL, DT and EDGE, penalties go to Temperament: dev-v2 adds temperament to the discipline contest (about 3 points either way), and counting penalties in Awareness or blocking too would double count.

| Attribute      | Ages      | Overall weight by position                                  | Signals                                                                                                                      |
|----------------|-----------|-------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| Speed          | Physical  | WR 2.5, CB 2.5, RB 2, EDGE 1.5, LB 1.5, S 1.5, TE 1, QB 0.5 | 40 time, aged. Fallback: position, weight, draft round                                                                       |
| Strength       | Physical  | DT 2.5, OL 2, EDGE 1.5, RB 1, TE 1                          | Bench reps and body weight. Fallback: position, weight                                                                       |
| Agility        | Physical  | RB 2, WR 1.5, CB 1.5, EDGE 1, QB 0.5, OL 0.5, DT 0.5        | 3-cone and shuttle, aged. Fallback: position, weight                                                                         |
| Awareness      | Mental    | QB 3, LB 2, S 2, OL 1, CB 1, RB 0.75, WR 0.75, DT 0.5       | QB: contest fit. OL, DT, EDGE: experience and snap trust (penalties go to Temperament). Others: experience plus contest fits |
| Throw power    | Physical  | QB 1.5                                                      | Intended air yards, longest completed air distance (NGS), plus contest fit                                                   |
| Short accuracy | Technique | QB 3                                                        | Contest fit                                                                                                                  |
| Deep accuracy  | Technique | QB 2.5                                                      | Contest fit                                                                                                                  |
| Ball security  | Technique | RB 1.5                                                      | Fumbles per touch                                                                                                            |
| Elusiveness    | Physical  | RB 2.5, WR 0.75                                             | Contest fit (breaking tackles, after the catch, returns)                                                                     |
| Hands          | Technique | WR 2.5, TE 2, CB 1, RB 0.75, S 0.75                         | Offense: drop rate. Defense: INTs per target                                                                                 |
| Route running  | Technique | WR 2.5, TE 1.5                                              | Contest fit (target share, routes)                                                                                           |
| Pass blocking  | Technique | OL 3, TE 1, RB 0.5                                          | Unit sack and pressure rate adjusted for QB time to throw, shared by snap share; market value; draft capital                 |
| Run blocking   | Technique | OL 3, TE 1.5                                                | Rush success through his gap (run gap and location in play-by-play, matched to his OL slot); market value; draft capital     |
| Tackling       | Technique | LB 2.5, S 1.5, DT 1, EDGE 1, CB 0.5                         | Missed tackle rate, tackles per snap                                                                                         |
| Pass rush      | Technique | EDGE 3, DT 2, LB 0.5                                        | Contest fit (pressures per pass-rush snap)                                                                                   |
| Run stopping   | Technique | DT 3, LB 2, EDGE 1.5, S 0.5                                 | Run stuffs and TFL per run snap                                                                                              |
| Coverage       | Technique | CB 3, S 2.5, LB 1.5                                         | Contest fit (coverage allowed, short and deep)                                                                               |
| Kick power     | Physical  | P 3, K 2                                                    | K: makes and tries from 50+, touchback rate. P: gross average                                                                |
| Kick accuracy  | Technique | K 3, P 2                                                    | K: FG rate by distance vs. league, XP rate. P: inside-20 rate, return yards per punt                                         |

**Market value signal:** a veteran's APY as a share of the cap, ranked within position. Teams pay for ability, so this is an honest public read on talent. It counts only for second contracts and later, at about 15% weight in key attributes, rising to about 35% for offensive line where direct data is thin.

**Rookies (2026 class)**

- Skill ratings start from draft slot: a top-10 pick lands near the 65th percentile of his position, a late first-rounder near the 50th, a third-rounder near the 30th, and day-3 picks and undrafted players near the 10th to 15th.

- Physical ratings come straight from the combine, unaged.

- College production can refine this later (optional source: the College Football Data API).

**Potential (hidden, true value)**

- Headroom above current rating depends on age, draft capital and each attribute's aging family: physical peaks in the mid-20s, technique holds through the late 20s, mental keeps growing into the 30s.

- Young, high picks get the most headroom; players past peak sit at or near current rating.

- Dev-v2 growth is the potential gap times work ethic times reps, so potential comes from draft capital, age and recent trajectory only. Work ethic lives in traits, never in potential, or it would count twice.

- Scouting fog comes free: the game's knowledge grows with years in the league, so real veterans start well known and rookies start fuzzy. The pipeline stores only true ratings and true potential.

**Hidden traits (dev-v2)**

Traits are written into the League so generateTraits never rolls over them. They stay in the ship layer too, since they are hidden and identify no one.

| Trait       | What it does in the engine                                                         | Real signal                                                                                        | Signal strength                                        |
|-------------|------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| Work ethic  | Growth toward ceiling (about x0.5 to x1.5); gentler decline                        | Rating path vs. draft-slot expectation after 3+ seasons; for veterans, aging slower than the curve | Weak: shrink hard toward 10.5                          |
| Durability  | Body clock (decline starts up to 2 years early or late), decline slope, retirement | Still performing past his position's peak; share of games played each season                       | Medium for veterans; young players get 10.5 plus noise |
| Temperament | Lineman discipline, about 3 points either way                                      | OL, DT and EDGE penalties per snap (false starts, holding, offside)                                | Strong for linemen; others default                     |

**Personality (negotiation, 0-1 each)**

- Greed: past deals signed above his market rank.

- Loyalty: re-signed with his own team at or below market.

- Winning: free-agent choices that favored contenders.

- Patience: lower after real holdouts.

- Players with no contract history get the game's generated personality. All four are soft nudges, never the whole value.

**Review loop**

- An overrides file lets Carlos adjust any rating with a written reason. Overrides survive reruns.

- Missing signals are filled by the fallback and tagged imputed, so they can be audited.

## Phase 5: coaches and front offices

Coaching staff is the next feature on the roadmap, so this phase should be designed alongside it, not after. Two asks for that feature: include HC, OC and DC roles (the roadmap names position coaches, S&C and medical), and store play-calling tendencies on the coach rather than the team, so they move when a coach changes jobs.

**Status (PR #7):** both asks shipped. Every team has an HC, OC and DC (plus an S&C coach and seven position coaches; medical waits for injuries). Each coach has two 1-20 ratings, youth development and veteran care, and tendencies live on the coach (`CoachStyle` in types.ts): the OC owns pass lean and the HC owns fourth-down aggression, read by match/coach.ts in ordinary situations only. Tempo and two-point attempts wait until the match engine models them (match-engine-v2-spec.md, Layer 6).

**5a. Coaching tendencies (land with the coaching staff feature)**

| Tendency               | Signal from 2025 play-by-play                      |
|------------------------|----------------------------------------------------|
| Pass lean              | Pass rate over expected, using the xpass field     |
| Fourth-down aggression | Go-for-it rate vs. expected on fourth down         |
| Tempo                  | No-huddle and shotgun rates, seconds between snaps |
| Two-point attempts     | Attempt rate vs. the game's two-point chart        |

- These become fields on the HC or play-caller in the coaching staff feature, read by match/coach.ts. Any coach.ts change must still pass npm run sim and npm run endings.

- Tendencies follow the play-caller. A new 2026 play-caller brings his tendencies from his last play-calling job, or league average if he has none.

**5b. Coach identities and ratings (side file)**

- Each team's real HC, OC and DC, with fake names from the same generator and rules as players (own ledger).

- HCs come from load_schedules() for 2026 Week 1. Coordinators come from a hand-built CSV: team, role, name, year hired, play-caller flag, and a source URL per row.

- Ratings: HC from career win rate vs. point-differential expectation, playoff trips and tenure. OC and DC from unit EPA per play in seasons they called plays, weighted 50 / 30 / 20. No history means a mid rating with a wide range, plus overrides.

- Stored as coaches.json, keyed by team, in whatever shape the coaching staff feature defines. Position coaches, S&C and medical staff stay generated, like scouts. The shape is now the `Coach` type: role, name, age, `youth` and `veterans` ratings, `style` (pass lean for an OC, fourth-down aggression for an HC, −1 to 1 with 0 as league average), and `since` (year hired).

**5c. Front office styles**

Each team's Team.gm gets numeric traits from real front office behavior, and its archetype label is the closest of the game's 7 styles. All 32 get a hand review.

| GmTraits field             | Real signal                                                                                  |
|----------------------------|----------------------------------------------------------------------------------------------|
| winNow                     | Picks traded for veterans, free-agent spending, starter age                                  |
| capAggression              | Restructures, void years, future dead money                                                  |
| pickChart                  | Johnson if they trade up for early picks; analytics if they trade down and value later picks |
| futureDiscount (0.15-0.40) | How readily they trade future picks for current help                                         |
| loyalty                    | Early extensions of their own draftees                                                       |
| stubbornness               | Few trades overall, or lopsided wins in the trades they make                                 |
| archetype                  | Closest of the 7 styles to the traits above                                                  |

Scouting departments stay generated by staff.ts. Real scouts are too obscure to source and add little.

## Bringing the league to life

Ratings make the league play right; these fields make it feel lived-in on day one. Each one already exists in the League type, so none needs engine work.

| League field               | Real data                                                                       | What it adds                                                              | Ship layer                                        |
|----------------------------|---------------------------------------------------------------------------------|---------------------------------------------------------------------------|---------------------------------------------------|
| Player.stats               | 2021-2025 season lines from load_player_stats(), mapped to the game's stat keys | Real career arcs on player pages; 2025 games played also sets dev-v2 reps | Dial: real, perturbed, or 2025 games played only  |
| Player.draft               | Real round, pick and drafting team                                              | Draft history, steals and busts                                           | Dial (draft info knob)                            |
| League.history             | 2021-2025 records, champions and runners-up                                     | Past champions, droughts, dynasties                                       | Kept: team-level, and teams are already fictional |
| League.games               | The real 2026 schedule                                                          | Week 1 matches the real Week 1                                            | Kept                                              |
| League.draftPicks          | Future pick ownership from trades                                               | Real trade capital from day one                                           | Kept                                              |
| Team.gm                    | Numeric GM traits (Phase 5c)                                                    | AI teams behave like their real counterparts                              | Kept                                              |
| Player.traits, personality | Phase 4                                                                         | Real career shapes and negotiation styles                                 | Kept (hidden)                                     |
| League.transactions        | Notable 2026 offseason moves                                                    | A news feed on day one                                                    | Kept, with fake names                             |
| Player.ratingHistory       | Ratings rerun for 2024 and 2025                                                 | Development charts show real arcs                                         | Optional, later                                   |

Career stat lines are the most identifying item here, which is why they get their own dial setting.

## Phase 6: export and validation

The pipeline writes two start files in the game's own format, mirror (private) and ship, plus a validation report. The same snapshot and seed must always produce an identical file.

**Validation report checklist** (every item passes or has an approved exception)

- [ ] Roster counts per team are within the game's limits.

- [ ] Every rostered player has a contract, full ratings and a depth chart slot.

- [ ] Every team's cap total is within tolerance of OTC (Phase 3).

- [ ] No ship-layer name matches any real NFL player or coach.

- [ ] Rating spreads per position match the generated league's spreads (Phase 4). Contest check: players ranked by each key contest's skill() track the real stat it decides (rank correlation, for example QB deep passing vs. deep CPOE).

- [ ] Top 15 per position list, for Carlos's eye test.

- [ ] Counts of imputed ratings and modeled contracts per team.

- [ ] Manual review list: 2026-signed contracts, unmatched IDs, players without gsis_id.

- [ ] npm run sim -- 10 from the real start file: all 23 stats inside NFL ranges, and the better-rated team still wins about 68%.

- [ ] npm run offseason -- 6: talent, cap space and roster sizes stay stable, with no mass cuts because real deals differ from the market formula.

- [ ] npm test and npm run typecheck pass; npm run audit shows nothing under "Needs attention".

- [ ] npm run endings passes, if Phase 5a changed coach.ts. npm run careers (dev-v2) keeps aging outcomes inside the research ranges, starting from real ages and traits.

**Team profiles: does it look like the real team?**

Each team gets a one-page card in the report, and the league gets parity checks. 2025 results lag offseason moves, so teams with a new starting QB or big free-agent changes are flagged as expected mismatches, not errors.

| Card section  | What it shows                                                                    | Real-world benchmark                                                                            |
|---------------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Unit ranks    | 1-32 rank for QB room, OL, receivers, run game, pass rush, run defense, coverage | 2025 unit EPA per play and rates from play-by-play (sack rate allowed, pressure rate, rush EPA) |
| Depth         | Rating drop from starter to backup, per position group                           | Eye test                                                                                        |
| Stars         | Players rated 15 or higher                                                       | Pro Bowl and All-Pro counts, if that table gets built                                           |
| Age           | Average starter age; share of starters 30 or older                               | Real roster ages                                                                                |
| Cap split     | Share of cap by position group; top-3 contracts' share                           | OTC positional spending                                                                         |
| Expected wins | Team strength vs. preseason expectation                                          | 2026 preseason win totals, entered by hand                                                      |

**League parity checks**

- [ ] The spread of team strength matches the spread of preseason win totals, best to worst.

- [ ] Over 10 simulated seasons, the yearly count of 12-win and 4-win teams looks like the real NFL.

- [ ] Division strength order roughly matches real expectations.

## Open questions

The realism dial setting and data terms need a games or IP attorney before any public release. Everything else is a product decision for Carlos.

**For an attorney** (this spec is not legal advice)

- Which dial setting keeps the ship layer clear of right-of-publicity claims. Relevant precedent: Keller v. EA (9th Cir. 2013) and Hart v. EA (3rd Cir. 2013), where nameless but matching player data was held to use likeness.

- Whether team identities (real cities, fictional nicknames) are safe, and whether team colors or logos resemble NFL marks.

- Whether derived ratings and contract figures can ship commercially under the terms of nflverse, OTC, Pro Football Reference, FTN and Next Gen Stats data.

- Whether to ship any real-data file at all, or only a documented import format the community fills.

**For Carlos**

- [ ] Dial setting for the itch.io prototype vs Steam.

- [ ] Start phase: regular season Week 1 (rosters already cut), or preseason so the user gets a camp and cutdowns first?

- [ ] Ship layer career stats: perturbed lines, or 2025 games played only?

- [x] Merge dev-v2 before the importer's Phase 4, or build against the branch? Phases 1-3 don't depend on it. **Answered:** dev-v2 is on main (PR #6).

- [ ] Practice squad and reserve players: free-agent pool (the default), or add a practice squad to the game first?

- [ ] Long snappers: OK to fill their roster spot from the practice squad, or add an LS position?

- [x] Coaching staff feature: confirm it includes HC, OC and DC, with play-calling tendencies stored on the coach. **Answered (PR #7):** yes for the HC and OC (OC run/pass, HC fourth downs). The DC chair exists but carries no tendencies until the match engine has defensive concepts.

- [ ] Worth hand-building a Pro Bowl and All-Pro table as an extra ratings signal?

- [ ] Add college production for rookies in a later pass?

**Later extensions**

- An annual update run that reuses the names ledger.

- A second start file at the beginning of the league year, for an offseason start.

- Historical start files (past seasons) built with the same pipeline.

## Sources

- [AFLS GAME_DESIGN.md](https://github.com/carlosa512/AFLS/blob/main/docs/GAME_DESIGN.md)

- [AFLS CLAUDE.md](https://github.com/carlosa512/AFLS/blob/main/CLAUDE.md)

- [nflreadpy function list and gaps (GitHub issue \#6)](https://github.com/nflverse/nflreadpy/issues/6)

- [nflreadr contracts data dictionary](https://cloud.r-project.org/web/packages/nflreadr/vignettes/dictionary_contracts.html)

- Uploaded repo files (not public links): types.ts, attributes.ts, aging.ts, traits.ts, development.ts, scouting.ts, ATTRIBUTES.md, and docs/research/attributes-development-scouting-roadmap.md
