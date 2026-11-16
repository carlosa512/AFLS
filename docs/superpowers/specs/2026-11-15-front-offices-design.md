# Front offices that run their rosters like NFL teams (project B)

Status: design, 2026-11-15, for the owner's approval. Follows the league-age work (A and A2, PR #185, `2026-11-14-league-age-design.md`), which
made players develop, peak and retire like the NFL's and left three gaps to the front offices, shown as a known issue
in `npm run careers`.

## Intent and the why

The owner wants saves that still look like the NFL twenty and more seasons in. After A, players age right, but the
teams that employ them don't behave like NFL front offices:

- **Too few young starters.** Seasons 11–20 of `npm run careers`: 25% of starters are 24 or younger against the NFL's
  32% (QBs 13–16% against 32%).
- **Too little job turnover.** A starter is still starting the next season 75–80% of the time before 29, against the
  NFL's 63–69%.
- **A market about half the NFL's size.** AI teams sign 57–74 good players (2% of the cap or more) from other teams a
  year against the NFL's 84–109, with one-year deals at about 41% of them against 20%
  (`docs/research/free-agency-market.md`).

The owner's own read as a player: free agency "feels ok"; he couldn't tell whether teams weren't signing cheap depth or
were holding money back. Measured on main (4 offseasons, seed `market-recon`), neither is the problem: AI teams sign
190–230 near-minimum players a year, 70–80% of them as backups, and 53–91 veterans of 30+ as depth; their spendable
room at free agency's open (median 1–9% of the cap, 4–14 teams at 10%+) looks like the NFL's February, and they spend
it by kickoff (median 2–3%, none above 6%).

## What the recon found (the causes)

1. **Who starts is current rating only.** `coachOrder` (`coachDecisions.ts`) sorts by `slotOvr` plus a coach quirk's
   ±0.2; age, draft position, contract and upside never count. A young player starts only once he is already rated
   higher. The A work found coaches aren't biased against youth (a clearly better player 3+ years younger sat in at
   most 0.1% of starting spots); NFL teams go further and give young players, high picks above all, the job early.
   A decomposition during A put the young gap in **rounds 2–7 and undrafted players** aged 21–24 (first-rounders
   started at the NFL's rate); it was taken mid-way through A's tuning and must be re-checked on main.
2. **Deal length follows age, not worth.** `preferredYears` (`finance/market.ts`) gives 5 years at 25 or younger on a
   position's clock, 4 at 27, 3 at 29, 2 at 31, then 1, whatever the player is paid. NFL veteran deals signed 2018–21
   (nflverse/Over The Cap) against AFLS's (seasons 2–5, seed `pay-recon`):

   | Pay (APY, % of cap) | NFL years, mean (1-year share) | AFLS years, mean (1-year share) |
   | --- | --- | --- |
   | under 0.8% | 1.17 (84%) | 2.34 (48%) |
   | 0.8–2% | 1.38 (70%) | 2.94 (25%) |
   | 2–5% | 2.26 (31%) | 2.61 (34%) |
   | 5–10% | 3.11 (20%) | 2.77 (26%) |
   | 10%+ | 3.83 (11%) | 3.38 (11%) |

   Cheap and mid-priced players are locked up for three or more years, so few of their deals end in a spring: about
   10% of AFLS's mid-priced players change teams in a year against about 29% in the NFL, and the pay spread is thinner
   in the middle too (per team, 0.8–2%: AFLS 7.6–8.5 against the NFL's ~11; 2–5%: 6.6–6.9 against ~9).
3. **The NFL's market is a quarter released veterans.** Of NFL players signing with a new team at 0.8% of the cap or
   more, 20–27% a year (41–59 players) left a deal that still had years to run: March cap cuts of veterans whose pay
   outran their worth. AFLS cuts for cap compliance only (`capCut`).
4. **The 31–32 exits are retirement, not the market.** Of last season's starters aged 30–33, only 1–3 a year are
   unsigned at kickoff; 16–25 retire. That gap belongs to A's retirement tuning (`RETIRE_BODY`, cliffs), not here.

## Goals

Judged in seasons 11–20 of `npm run careers` and over `npm run offseason -- 6` unless said otherwise:

- **Young starters:** starters 24 or younger near the NFL's 32.2% (band 28.2–36.2), quarterbacks near 32.5% (22.5–42.5).
- **Turnover:** a starter still starting the next season inside the NFL's bands by age (21–24 61.7–75.7%, 25–26
  57.8–71.8%, 27–28 56–70%, 29 53.7–67.7%, 30 47–61%); the share demoted on the same team and the share starting for
  a new team move toward the NFL's (8.7% and 5.0% against AFLS's 5.4% and 1.3% before A's final tuning).
- **Deal lengths by worth:** veteran deals' mean length and one-year share by pay band near the NFL's table above.
- **The market:** good outside signings in the planning spec's bands (75–120 usual, 60–135 normal); one-year deals
  10–30% of them (5–40% normal); no player 28 or younger priced at 5%+ of the cap unsigned at kickoff (as today).
- **Everything else holds:** every other line of every check stays inside its bands (`sim` at 60 seasons, `careers`,
  `offseason`, `trades`, `morale`, `gm-habits`, `audit`, `size`, the tests).

## Non-goals

- **The 31–32 exits.** Out of B: a follow-up to A's retirement tuning. The careers lines for them stay soft.
- Save size and the pruning of retired players (its own project); game shape (comebacks and margins, project C).
- The talent level, the price curve's ranking (`marketApy`, `ageFactor`), the rookie scale, trade valuation, and the
  owner's existing bands.
- Your own lineup and your own negotiations' rules: you keep setting your lineup; a player's asks follow the same new
  lengths as everyone's (below), but nothing decides for you.

## Anti-goals (failure even if the numbers pass)

- AI teams starting a clearly worse player and losing games for it: a team's season must not visibly suffer for
  playing its young.
- A churn of meaningless one-year deals or players changing teams every year for no reason.
- Contract disputes, holdouts and trade requests rising past their bands because more players are always negotiating
  (a 2-year prove-it deal for the young was tried in 0.4.13 and dropped for exactly this).
- A lean read from hidden truth: AI coaches judging upside the fog of war hides from them.

## Constraints

- **The sim check plays every season as a brand-new league** (`calibrate.ts`, `createLeague` per season), so anything
  that changes who starts in a founding league's first season moves the match engine's calibrated lines. A2 learned
  this: reshaping founding ratings moved margins around strength and punts past their bands. The lineup lean must stay
  small enough that `sim` at 60 seasons holds, or the founding league must be left as it is for season one.
- Deterministic: no new randomness, or new draws on their own streams; a seed reproduces its world.
- `League` stays plain JSON. Nothing below needs a new stored field (the lean reads age, experience and the draft
  record; lengths are a rule); if one turns out to be needed, bump `SAVE_VERSION` with a migration. Existing contracts
  keep their lengths: saves in progress move to the new lengths one deal at a time.
- Fog of war: the lean reads public facts only (age, years in the league, draft round and pick, seasons with the team)
  and the coach's own read of his own players as today. AI front offices keep reading other teams' players through
  their own scouts.
- The owner's bands are his call; never loosened to get green. Lines that swing with the league are already two-band.
- Working agreement from A: steer with fast probes and one small check at a time; run the affected checks locally
  and push once when green (the owner asked for no rounds of pushing to see what CI says).

## Approaches considered

**Who plays** (the owner picked a, 2026-11-15):

- **(a) A small "let's see what we have" lean** in the starting-job decision for any young player close to the veteran
  ahead of him, larger for high picks. Picked: the gap sits in rounds 2–7 and undrafted players, which a high-pick
  lean alone wouldn't reach.
- (b) High picks only, with the middle rounds' gap closed by better mid-round draft classes. Rejected: it changes
  player ratings, so careers and the draft checks move again, and it leaves the NFL's habit of trying a young player
  out of the game.

**The market** (the owner picked 3, 2026-11-15):

- (1) **Deal length by worth, then age:** cheap and mid-priced players mostly 1–2 years, starters 2–4, stars longest,
  youth adding a year for good young players. Fixes the root cause; the market and turnover grow on their own.
- (2) **Spring cuts of overpaid veterans:** AI GMs release veterans whose pay outruns their worth before the market
  opens, the NFL's other quarter of the market. Costs dead money (an `offseason` band) and some cut veterans retire.
- **(3) Both, (1) first, then (2) only if the market still falls short.** Picked: the root cause first, the second
  lever only if the numbers ask for it.

## The design, as decided

### Part 1: deal length by worth (first)

- A deal's length comes from the player's worth first (his price as a share of the cap, the tier the table above uses),
  then his age: near-minimum and mid-priced players get mostly one or two years, starters two to four, stars the
  longest; a good young player gets a year more than an older one at the same price. Targets: the NFL's mean length and
  one-year share by pay band (the table above), within a tolerance the builder sets and the owner approves.
- One rule for everyone who makes or asks for a deal: the AI's offers (`aiOffer`), a player's ask (`preferredYears`
  and `demand`, so your own talks follow it too), fitted offers and the late market, re-signing, and a new league's
  contracts (`dealCycle` in `generate.ts`), so a new league starts in the same shape. Rookie deals and the fifth-year
  option are untouched.
- A new line in `npm run offseason` judges veteran deals' length by pay band against the NFL's table (the research
  numbers above go into `docs/research/free-agency-market.md` with the script that measures them).
- **Your re-sign window, grouped by the deal's size** (the owner, 2026-11-15). Shorter deals mean more of your
  contracts expire each spring (the owner accepted that as the NFL's way). So the Re-sign tab lists expiring players in
  groups by the size of the new deal they ask for, biggest first: key players (2% of the cap or more), role players
  (0.8–2%) and depth (near the minimum), each with its count, sortable inside the group, the depth group with its own
  "Let all N walk". The head coach's contracts letter lists them in the same order. A sketch:

  ```
  Re-sign window · 14 expiring
  Key players · asking 2%+ of the cap (3)
    J. Ruiz   CB 27  14.2   $8.1M → asks $9.4M   [Talk] [Let walk]
  Role players · 0.8–2% (4)
  Depth · near the minimum (7)                    [Let all 7 walk]
  ```

### Part 2: the lineup lean (second)

- In the starting-job decision (`coachOrder`), a young player gets a small edge over the veteran ahead of him: a
  bigger one for a high pick, a smaller "let's see what we have" one for any young player close to the veteran. A
  clearly better veteran still starts.
- It fades with age and years in the league: by about 25, or his third season, a player competes on rating alone.
- It reads public facts only (constraints above).
- AI teams use it; your staff use it too when they sort your depth chart for you (the coaches' call). When you set your
  own lineup, nothing changes.
- The careers lines it moves (starters 24 or younger, still starting by age, demoted and new team) become judged once
  they pass, with the owner's bands; the 31–32 exits stay soft.

### Part 3: spring cuts (only if needed)

- Built only if, after parts 1 and 2, good outside signings sit below the usual band (75). If built: before the market
  opens, AI GMs release veterans whose pay outruns what they're worth to the team, about the NFL's quarter of the
  market (41–59 players a year at 0.8% of the cap or more), with dead money inside the `offseason` bands.

## Calls made in review (2026-11-15)

Settled from the code or as the designer's call; the owner can overturn any of them.

- **The lean and the benching chain.** The lean decides the chart from camp as ratings do today, and jobs are set on
  cut-down day (`setJobs`), so a veteran who loses the job to a young player in camp was never its holder and asks
  nothing, as when a better player wins camp today. A swap in season happens only when ratings move across the lean's
  margin, and then it is a benching like any other. `morale`'s benching, talk and dispute lines must hold.
- **The lean in a new league's first season: on.** Founding players carry draft records (`draftHistory`), so the lean
  works from the first kickoff, and the `sim` check, which plays first seasons, judges it honestly. Switching it off for
  season one would hide its effect on play from the one check that measures play.
- **What the length target covers.** Every veteran deal signed in the offseason (re-signs, extensions and signings
  from outside; not rookie deals, options or tags), as both sides were measured. The extra year for youth spreads
  within those means, not on top of them.
- **Bands that move.** Every band holds; the builder may retune the AI's levers (prices, reserves) to hold them. A line
  that can't hold comes to the owner with the evidence, as a band question, never loosened.
- **The draft-round breakdown** is re-checked on main first; if it overturns "the gap is in rounds 2–7 and undrafted",
  the owner hears before the lean is tuned, since approach (a) rests on it.

## Left to the builder

- The lean's size, how it splits between high picks and others, how it fades, and whether a team's win-now leans it
  (my proposal: a rebuilding team plays its young more, a contender less, as the NFL does; a builder's call within
  the goals). Tuned against the careers lines with fast probes, then `sim` at 60 seasons.
- The length table's tiers and steps, how it treats age within a tier, and the tolerance for the new length line.
- Re-checking the draft-round decomposition on main before tuning the lean.
- How the new lengths reach the fitted and late-market offers (the prove-it deals) without raising disputes.
- Test design, fixtures and which checks to run when.
- Updating `docs/MVP.md` (the free-agency market item and the starters-leaving item), `docs/GAME_DESIGN.md`,
  `CLAUDE.md`'s check descriptions and the careers known-issue banner; a patch version bump (both are follow-up items).

## What was built (2026-11-15)

- **Deal length by worth** (`dealYears`, `DEAL_YEARS` in `finance/market.ts`): a deal's length reads the share of the cap
  first, then age on the position's clock. Lengths by pay against the NFL's are judged in `npm run offseason`.
- **The re-sign window grouped** by the size of the deal asked: Key players, Role players, Depth (2% and 0.8% of the
  cap), on the screen and in the director's letter; Depth has "Let the other N walk".
- **The lineup lean** (`START_LEAN`: first round 2.4, second 1.5, any young player 1.0, full through a player's second
  season, half in his third, gone at 25), larger than the plan's 0.8/0.5/0.4, which left both lines short.
- **Camp battles** (owner's choice, not in the first design): `CAMP.sd` 1.0, a pure function of the player and his age,
  kickers and punters skipped (with them in, a worse kicker started and points fell under the careers floor).
- **Results** (careers, four leagues): 30.7% of starters 24 or younger, quarterbacks 24.8%, starters 25–26 keep their
  jobs 70% (77% before), 27–28 68% (75%); points 21.72. `sim -- 60`, morale and endings pass.
- **Stories**: more young starters made more sore veterans and Split rooms; the owner kept the amount shown and asked
  for the best of it: `ROOM_STORIES` = 3 rooms a league year.
- **Left as follow-ups**: spring cuts (task 5, not needed for a green run), the free-agency market's size and one-year
  share, the 31–32 exits (retirement), and by-position young shares (receivers).
