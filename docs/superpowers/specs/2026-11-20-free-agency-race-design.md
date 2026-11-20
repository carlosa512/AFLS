# The free-agency race: other teams want your players too

Owner: carlosa512 · 2026-11-20 · the first of three pieces of 0.5, "The offseason comes alive" (then compensatory
picks, then suspensions; each its own spec and PR, 0.5.0 lands with the last one)

Mockups from the brainstorm: `docs/superpowers/specs/2026-11-20-free-agency-race-mock.html` (variant B of "One
player's market" is the one chosen).

## Intent

The owner wants AFLS to stay a front-office game for now (the game plan, a coaching feature, is parked), and the
offseason is where it feels thin. The thinnest part is contract talks: "I almost always get the guys I want." Next to
Football Manager, modern Madden or EA FC, signing a free agent is one dialog with sliders and a one-line answer.
Nobody else is in the room.

The cause is in the calendar, not the numbers. Free agency opens on day 1 with no AI moves, and the AI teams only act
when you advance a day (`advanceOffseasonControlled`, `case 'freeAgency'` → `aiFreeAgencyDay`). Your offer is judged
alone against his walk-away (`makeOffer` in `offseason/negotiation.ts`) and he signs on the spot. So every year you get
first pick of the whole market. Meanwhile the AI teams already run an auction among themselves: each team builds a
bid on its own read and the player takes the best one that clears his floor (`aiFreeAgencyDay` in `offseason/ai.ts`).
You are just not in it.

The fix: one race that every team, yours included, runs in. Other teams bid on the players you want, you can see the
race, you can fight for a player, and sometimes you lose him.

## Goals

- **Competition you can feel.** A good free agent draws offers from several teams, you see who's in, where you stand
  and roughly what the leader offers, and you can answer.
- **A player decides when he's ready, not on a date you know.** He picks a team when one offer stands out, or when
  he's waited long enough. You can't know the day ahead of time (the owner: "I wouldn't know what day they plan to
  sign in real life").
- **Low stakes, never griefing.** You lose a player only when you chose not to pay. You always get one warning before
  a player you bid on signs somewhere else.
- **One world.** AI-only leagues run the same race. The teams on screen are the teams actually bidding.
- **A clean look.** The market list and the player's page follow the mockups: team chips, a dot for where you stand,
  his status in words, bars for how he sees each offer.

## Non-goals

- The re-sign window. It stays as it is: until free agency opens, only your team can talk to your own expiring
  players (as in the NFL). A player you let walk, or one who wants to test the market (`wantsMarket`), enters the race
  and you can bid on him there.
- The late passes after free agency (the draft and camp phases, the clearing passes, the last call, `campStarterSignings`).
  They keep working as they do now on whoever is left.
- Compensatory picks and suspensions (the next two specs). This spec only makes sure a departure is recorded the way
  comp picks will need (`noteDeparture` already records a player who walked).
- SNN coverage of the race (rumors such as "three teams are in on him"). SNN's free-agency big-day edition keeps
  reporting the signings from the public record. A rumor tile can come later.
- Restricted free agents, tenders and offer sheets.

## Anti-goals (a failure even if it works)

- **A player you bid on signs elsewhere with no warning.** Never.
- **Exact rival offers on screen.** Variant A of the mockup was turned down. Other teams' deals are known only as bars
  (how he sees them) and the agent's rounded number for the leader, and in the public record once signed.
- **A fake race.** If most good players are gone after the first day, or the market list is mostly empty, it failed.
- **A race you can game.** Bidding on every star to block the AI, or bidding up a rival and walking away, must not pay.
- **A tuning break.** No band in any check is moved to get green (the owner's rule in `CLAUDE.md`).

## How it plays (the owner's decisions)

### The days

1. **Free agency opens (the step into day 1).** After the expiring deals lapse (`openFreeAgency`), every AI team puts in
   its opening offers before you see the market. Nobody signs yet. You arrive to a live market. Opening offers use the
   same bid logic and limits as a day's pass (a team's need and upgrade bars, its room, `dailyLimit`), so a team does
   not bid on everyone: most depth players draw no offer and sign on the spot or later.
2. **During a day** you look at the market, make offers, raise them or pull them. Nothing is decided while you look.
3. **When you advance the day,** in this order: the AI teams update their offers (raises included), then every player
   with offers is judged (pool order, best first, budgets shrinking as teams sign, as today), then the warnings fire
   (below). The free-agency days stay at five (`FA_DAYS`).
4. **The last day.** At day 5's end every player with an offer at or above his floor picks his best ("waited long
   enough" is forced). Offers that don't win lapse. A player with none goes on to the late passes as today.

### Who goes through the race

- An offer must clear his walk-away to stand. One under it is refused as today and costs his agent's patience;
  nothing is stored. So "2nd of 4" only ever counts real offers.
- A player with no other offer signs with you on the spot when your offer clears his walk-away, as today.
- A player with any other team's offer goes through the race, backup or star (the owner: "there's fighting if someone
  else offers"). Your offer becomes a standing offer. After the opening offers this is the usual case for anyone worth
  fighting over: instant signing becomes the depth players' path.
- If every rival drops out overnight (an AI team's offers are rebuilt each day), he's yours, at that day's end.
- A staff-run user team (`includeUser: auto`) places, raises and pulls offers under the AI's rules, like any AI team.

### When he decides

He picks a team at a day's end when his best offer stands out, or when he has waited long enough. "Stands out" weighs
his best offer against his walk-away and against the next best, the days he's been on the market and his own patience
(`Personality.patience`). An offer at or above his full ask that clearly leads the rest signs that day. The exact rule
and its numbers are the builder's (see "Left to the builder"), tuned to the NFL's timing: the best free agents go early,
most in the first days, and depth players later.

He weighs offers as he does today (`offerValue`: money, guarantees, years, a contender for a player who wants to win,
loyalty to his old team, `contractLean`'s homecomings and grudges, his mood). The race changes when he chooses, not what
he values.

### Fighting for a player

- **AI teams answer.** An AI team that's behind on a player it wants can raise its offer once a day, up to the most
  it would pay him (its own read and need, and its GM: win-now raises more, gun-shy less). So a bidding war can happen,
  and it ends at a team's limit. (The owner confirmed it: without it the race is static, since an AI team's offer would
  be rebuilt the same every day.) An AI raise never goes past the team's own read of what he's worth to it, so bidding a rival up only makes it pay
  what it already thought he was worth.
- **The agent's warning.** At a day's end, if he would sign with another team, you have an offer in, you're behind,
  and you haven't been warned about him since you last led, he waits a day instead and his agent calls: "He's close.
  Kansas City is ahead." It's an inbox letter (it needs you, `needsYou`) and a flag on his row. You get one warning
  each time you lose the lead, so you are never lost without one, and the warnings end because AI raises stop at a
  team's limit. If you answer and are still behind at the next day's end, he signs.
- **The game stops for a warning** (the owner's call). Until every warning is answered, the advance button reads
  "Answer 1 agent" (or "Answer N agents"), as it reads "Decide N contracts" in the re-sign window (`offseasonStep` in
  `ui/App.tsx`, the blockers it reads). Two answers, on the letter and on his page: improve your offer (any raise
  answers it, even one that leaves you behind) or "Let him go", which pulls your offer with no penalty. A staff-run
  user team never stops.
- **Your offers must fit together.** The dialog's own check (`offerProblem`) over all your standing offers at once:
  their year-one cap hits add up to no more than your cap space, and they fit on your roster with the players you
  have. Anything that would break it (a new offer, a raise, a signing on the spot, a trade that takes on salary) is
  refused with the reason, where the button is. You are not held to the AI's multi-year books; your planning is yours.
- **Pulling an offer** is allowed. Pulling one that leads or is second ends talks with him for the rest of free agency
  (the broken talks the negotiation already has); pulling one further back is free.
- **Patience still counts.** An offer under his walk-away uses up his agent's patience as today (`Negotiation.patience`;
  an insult costs two). Out of patience, talks end for this phase.

### What you see

**The market list** (the Free agents tab, `FreeAgents` in `ui/screens/FrontOffice.tsx`), the players in the race:

```
Player              Ovr   Teams in          Your offer   Status
Marcus Hale   WR    15.8  KC PHI SF CHI     2nd of 4     Close to a decision
Dante Okafor  EDGE  15.1  CHI MIA           Leading      Weighing offers
Jalen Price   CB    14.4  DAL GB WAS +2     None         Waiting on more offers
```

- Teams in: a chip per team with an offer in (team colours, yours in the marker yellow), the first few and "+n".
- Your offer: Leading, "2nd of 4", or None, with a coloured dot.
- Status, in words from the same rule that decides: Waiting on more offers, Weighing offers, Close to a decision.
  "Close" is a hint, never a promise of the day.
- A yellow edge on rows you have an offer on. The players nobody else wants (the sign-on-the-spot ones) stay listed
  as today.

**One player's page** (the negotiation dialog, `NegotiationDialog` in `ui/negotiation.tsx`, when he's in the race),
variant B of the mockup:

- What matters to him, in words, through your own read of him (as `personalityRead` and the character notes do: the
  top one or two of money, a winner, staying with his old team, home). Never a number.
- A bar per team: how much he likes each offer, the leader's full. Bars are coarse (a few steps, not exact). Yours in
  yellow, with your own offer written under it.
- His agent's line: who leads and the leader's money per year, rounded (about $13M a year). The agent rounds honestly.
- The offer controls stay (years, per year, guaranteed, bonus, void years, the patience pips). "Make offer" places or
  updates your standing offer. "Pull offer" next to it.

**When the day ends** one short letter for each player you had an offer on, win or lose ("Dante Okafor signs with
us", "Marcus Hale picks Kansas City"), saying what tipped it in his words when one thing did. Letters go through
`deliverMail`, keyed so nothing doubles, written to the house rules (`docs/NEWS.md`, "Words in a letter"; a new file
that words a letter goes in `LETTER_FILES`).

## Approaches considered

1. **One race for every team (chosen).** Split today's daily pass in two: teams place offers (the bids the pass already
   builds), then players decide. Your offer stands beside theirs. AI-only leagues run the same race. Costs: it touches
   the most-tuned code in the offseason, so the free-agency and cap-books lines of `npm run offseason` must be checked
   and may need tuning; the save gains the race's state. Gain: the world is real, and the screen reads real offers.
2. **A race only around you.** AI teams keep signing at once; only players you bid on wait. Cheap, and AI-only leagues
   don't move, but most good players would be gone on day 1, so the list would be nearly empty. A fake race.
3. **Show the race, keep instant signing.** Only the screen changes. Cheapest, and doesn't fix the problem.

The owner handed over the how; option 1 is the builder's call, stated to the owner.

## Constraints

- **Engine rules** (`CLAUDE.md`): pure TypeScript, no `Math.random`, every draw through the seeded `Rng` on its own
  stream; `League` stays plain JSON, so the race's state (offers by player, warned players, who pulled an offer) bumps
  `SAVE_VERSION` with an upgrade step in `migrate.ts`. A save upgraded in the middle of free agency starts the race at
  its next day.
- **Money rules stay the same.** Every AI offer still passes the cap books (`shapeToBooks`, `fits`, `booksOk`), the
  in-season reserve, the daily limits, restructure plans (a borrowing team makes its room only when he picks it),
  `CLEARING_DAY`'s fallback once the market has passed him by, and the free-agency spending rules (`SPEND_FIRST`).
  An open offer doesn't hold an AI team's money across days; its offers are rebuilt from today's room each day, so a
  team that signs someone may drop or lower another offer. That's realistic ("Kansas City has moved on").
- **Fog of war** (`docs/UI.md`): no true rating, trait or personality number on a screen. The bars are the player's own
  view told by his agent, coarse; what matters to him is words through your read.
- **Speed.** The free-agency pass is a known hot spot (its comments record several speed fixes, and `npm run careers`
  runs near its limit). The race may add the opening offers and one decision pass a day, no more; measure a league's
  free-agency time before and after.
- **Who's paid spills into everything** (`CLAUDE.md`, lessons from 0.4.48): a change to who signs where reshuffles
  every seeded world, moves tests that pinned a scene, and spills into moods, stories and meetings. Make the engine
  changes first, then fix moved tests once. Lines near their edge on main after 0.4.48: win spread 3.58 (fails 3.6),
  margin spread 13.33 (fails 13.6), meetings a club a season 5.55 (fails 6), young starting QBs 27.6% (floor 22.5%).
  Re-list them on main before starting.
- **Words.** American football English everywhere a reader sees: a team, never a club. Screen text follows `docs/UI.md`'s
  "Words on a screen" (run `npm run copy`); letters follow the house rules (`letterRules.test.ts`).

## Checks and tolerance

- `npm run offseason -- 6` is the area's check: the free-agency market against the NFL's (who stays, who moves, who
  signs nowhere, good outside signings, one-year deals, no young star unsigned at kickoff, `scripts/free-agency-core.ts`)
  and the cap books' drift (`scripts/cap-books-core.ts`). Every existing line stays inside its band; no band moves.
- **First task: measure the NFL.** The share of good free agents agreeing to terms by each day of the market (the
  negotiating window counts as day 1) from public signing dates, in a research script like the others
  (`scripts/research-*.py`), written up in `docs/research/free-agency-market.md`. Many of the best agree in the first
  two days, so a lot of signings on our day 1 can be right: you always see the whole market before anyone decides.
- **New line: when the market signs.** The share of good free agents (`GOOD` in `free-agency-core.ts`) signed by each
  day, and the day a star signs on average, against the measured NFL. Warn-only (⚠) until the owner sets its band.
- **New line: contested signings.** The share of good free agents who had two or more offers when they signed: the
  measure of a fake race. Warn-only at first, same as above.
- **Stop rule for the race's numbers.** Tune `RACE` until the existing offseason lines are green and the new lines sit
  near the NFL's measured timing, or for three rounds, whichever comes first; then bring the numbers to the owner.
- Unit tests: the decision rule, the sign-on-the-spot rule, the warning (never lost without it, never twice), offers
  fitting together, pulling an offer, AI raises stopping at a team's limit, and the save upgrade.
- `npm run morale` once before the PR: who plays spills into moods and meetings.
- The CI planner picks the rest from what changed.

## Delivery and version

A 0.4.x patch with the usual changelog entry. `docs/MVP.md` gets a new section for 0.5, "The offseason comes alive",
with three items (the free-agency race, compensatory picks, suspensions); this one is marked Done when it ships.
`docs/VERSIONING.md` gets one line: after alpha, the middle number goes up when a milestone in `docs/MVP.md` is
finished. 0.5.0 lands with the third item. The stale "Next" list in `docs/GAME_DESIGN.md`'s roadmap (morale, holdouts and
training listed as to do) is brought up to date in the same PR.

## Left to the builder

- The exact "stands out" rule and its numbers, in one constant (like `RACE`), with a tuning step and a stop rule: steer
  with a fast probe (one league's free agency, a few seasons), judge with `npm run offseason`.
- How the daily pass splits into placing offers and deciding, keeping the pool's best-first order and the budgets that
  shrink as teams sign.
- How AI raises are priced inside a team's limit, and how often an AI team adds an offer for a player it skipped.
- The status words' thresholds, the bars' steps and the agent's rounding.
- Where the race's state lives in `League` and how the screens read it (a view function in the engine, the way
  `moraleView` and `disputeView` work).
- The letters' exact words, inside the house rules.

## The owner's answers after the review (2026-11-20)

- AI teams fight back: once a day when behind, up to their own read of him (a bidding war that ends).
- The game stops for an agent's warning until you raise or let him go.

## Calls made in the brainstorm, for the owner to check

- An offer under his walk-away doesn't stand; it's refused and costs patience, as today.
- Your standing offers must fit your cap space and roster together, by the dialog's own check, not the AI's books.
- One agent's warning each time you lose the lead; if you're still behind a day later, he signs.
- Pulling an offer that leads or is second ends talks for the rest of free agency; one further back is free, and so is
  "Let him go" on a warning.
- At day 5's end everyone with an offer at or above his floor picks; offers that don't win lapse.
- Free agency stays five days, with the opening offers placed as it opens, under the same limits as a day's pass.
- The NFL's signing timing is measured first; the new lines warn only until you set their bands.
- The agent rounds honestly.
