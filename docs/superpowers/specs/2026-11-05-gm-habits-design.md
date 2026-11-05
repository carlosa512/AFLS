# GM habits and archetypes (Build A)

Date: 2026-11-05 · Branch: `claude/amazing-dirac-sa4npe` · Part one of two from the owner's AI-GM brainstorm. Build B
(how GMs talk to you, and what they remember about you) gets its own spec after this ships. Source material:
`docs/research/front-offices.md` (Charles Robinson's NFL Blue Book).

## Why

The AI GMs are the other players in the game. Today they differ only in hidden numbers: seven archetypes, six dials,
the same flat lines from every one of them ("The Squall would accept."), and a label on the Trades screen. You can't
tell two GMs apart from what they do.

Build A makes them different people. Each GM carries habits that form and fade through his career, from what happens
to him, and each habit leans one real decision. You never see a habit's name: you pick up clues from his moves, what
SNN writes and what your staff tells you, and his reputation lags behind him when he changes.

## Decisions (agreed in the brainstorm)

1. **Variety over realism.** GMs should feel like different people to deal with and to watch. The NFL is the
   foundation; fun and low micromanagement come first; departures are labeled (`docs/PRACTICE_SQUADS.md`'s rule).
   Blue Book is story fuel, not a set of rates to hit.
2. **Two builds.** A: archetypes and habits, and the clues that show them. B: the GMs' own voice in offers and counters,
   and memory of you that follows the person. This spec is A.
3. **Ten archetypes.** Keep the seven, sharpen three through the habits they start with, add three (Market Mover,
   Core Keeper, Slow Mover).
4. **Eleven habits, earned through a marble bag.** Each GM carries a bag, like the quirk, coach-quirk and owner bags.
   His archetype seeds it, what happens to him adds marbles, unused habits fade.
5. **A habit leans one existing decision.** No scripted moves (they could be gamed and break "no AI deal loses in its
   own eyes"), and no bare dial nudges (habits would blur together). No habit without a decision it changes.
6. **Hidden.** No archetype name, habit name, grip or number on any screen or in any mail. Clues come in words, only
   from public moves; a reputation comes from his dials in words.
7. **Spoken, not templated.** Every clue is a character speaking (SNN's reporter, the league's word on his card, your
   director), chosen through `voice.ts` (`say`) to fit the moment, never the same line each time, with dates only
   where a person would say one. Silence when nothing fits.
8. **A face in the mail.** Emails where a GM is the story open with his headshot row, like the player rows mail
   already uses (`Who` in `ui/mail.tsx`): FM's inbox feel, not a box of facts.
9. **League totals hold.** Habits make GMs different, not the league busier. `npm run trades` and `npm run offseason`
   stay green with no range loosened.
10. **Out of scope:** the owner blaming a Can-Kicker when deferred money lands, who has the final say at each club
    (both owner behavior, for a later "who runs the club" feature), Build B, and a habit that reads next year's draft
    class (the class is built when the new league year opens, so in season there is nothing to read).

## 1. Archetypes

A GM's archetype sets his dials and the habits his bag starts with. The **first** starting habit is active from his
first day (grip 2, §3); the others start as marbles only.

| Archetype | winNow | capAggr. | Pick chart | futureDisc. | loyalty | stubborn. | Activity | Starting habits |
|---|---|---|---|---|---|---|---|---|
| Cap Magician | 0.70 | 0.90 | analytics | 0.20 | 0.80 | 0.30 | 0.60 | Sells a Year Early |
| All-In | 0.95 | 0.70 | johnson | 0.38 | 0.40 | 0.20 | 0.85 | Trades Firsts for Stars, Signs a Bridge QB |
| Draft and Develop | 0.35 | 0.20 | analytics | 0.18 | 0.60 | 0.50 | 0.40 | Sticks With His Young QB, Drafts Best Available |
| Can-Kicker | 0.75 | 0.85 | johnson | 0.30 | 0.50 | 0.30 | 0.60 | Extends Early |
| Hard-Liner | 0.55 | 0.30 | johnson | 0.30 | 0.20 | 0.90 | 0.25 | Tags Before He Pays |
| Pick Hoarder | 0.20 | 0.20 | analytics | 0.15 | 0.30 | 0.60 | 0.70 | Drafts Best Available, Sells a Year Early |
| Balanced | 0.50 | 0.50 | johnson | 0.25 | 0.50 | 0.50 | 0.50 | One marble of each habit but Gun-Shy; starts with one at random |
| **Market Mover** (new) | 0.65 | 0.75 | analytics | 0.22 | 0.35 | 0.35 | 0.90 | Extends Early, Sells a Year Early, Prefers Player Swaps |
| **Core Keeper** (new) | 0.55 | 0.35 | analytics | 0.22 | 0.80 | 0.50 | 0.45 | Extends Early, Sells a Year Early |
| **Slow Mover** (new) | 0.45 | 0.30 | johnson | 0.28 | 0.65 | 0.70 | 0.20 | Tags Before He Pays, Sticks With His Young QB |

- The seven existing archetypes keep their dials. All-In, Draft and Develop and Can-Kicker are sharpened by their
  starting habits only.
- `generateGm` (`gmTraits.ts`) draws from all ten with the same jitter. The two archetype checks already in the engine
  stay (All-In's extra in-season trade in `trade/market.ts`, Pick Hoarder's extra picks in `trade/draft.ts`).
- `ARCHETYPE_ACTIVITY` (`trade/market.ts`) gains the three new rows. Its mean across archetypes moves from 0.557 to
  0.545, so trade volume should hold; `npm run trades` confirms.
- Existing saves keep every GM's archetype. New archetypes arrive as new GMs are hired. Nobody is re-rolled.

## 2. The habits

Shared rules:

- A habit applies at **grip 2 or 3** (§3), with the same lean at both. Leans read through one function,
  `habitOn(league, team, id)` (and `gunShyAt(league, team, pos)`), so no hook reads storage. Only AI clubs' GMs have
  habits; your club's hooks never see one.
- Each lean is small. The sizes below are starting points, tuned by `npm run gm-habits -- --effects` (§5) inside the
  league checks.
- **Logged:** the public move that records the habit in his log (§3) when it changed the decision. The log is what
  clues read and what outcomes are checked against.
- **+ / −:** the event marbles a logged move earns when it's resolved at a later new league year.
- **Used:** a habit is used in a league year if it logged a move or earned a marble. Unused, it gets a fade marble (§3).
- **Starter:** `seasonRole(...).role === 'starter'` (`scouting.ts`) for that season. **Blowup:** a release with dead
  money of at least 3% of that season's cap, on a contract signed while this GM ran the club and the player stayed
  there since (`Contract.signedSeason` inside his appointment, `Team.deadMoney`).
- Outcome checks use the truth (they are engine internals, like the owner's bag); clues read only the log.

### Signs a Bridge QB (`bridgeQb`)

- **Lean** (`offseason/ai.ts`, the bid loop in `aiFreeAgencyDay`): when his club's top-outlook QB is 25 or younger, a
  free-agent QB aged 30 or more (position-shifted) clears half the usual `minGain` and `upgradeBar`, and the offer is
  one year.
- **Logged:** signs a QB of 30+ to a one-year deal while holding a QB of 25 or younger (the young QB is the subject).
- **+** the young QB is a starter in the second season after the signing. **−** he isn't, or he's gone. Resolved at
  the second new league year after the signing.

### Trades Up for a QB (`tradeUpQb`)

- **Lean** (`trade/draft.ts`): in `tradeUpReason`, a QB target clears 0.75 × `covetMin`, and a jump past `LONG_JUMP`
  needs no extra gap; in `draftCovet`, a QB's covet is capped at 0.75 instead of `COVET_MAX` (0.6).
- **Logged:** trades up in round 1 and takes a QB with the pick.
- **+** the QB is a starter in either of his first two seasons. **−** two seasons pass without it, or he's gone.

### Extends Early (`extendEarly`)

- **Lean** (`offseason/ai.ts`, a new pass in `aiResignWindow` before cap compliance): starters with exactly two
  contract years left whom `resignCall` would keep, at `demand()`'s market price, through the path `aiSettle` uses
  (`extensionBlocker` respected), only when next year's cap plan carries the new money. At most two a year. This is
  the one habit that adds a behavior: today's AI never extends before a deal's final year.
- **Logged:** each early extension.
- **+** he's a starter in the first season of the new money. **−** the deal ends in a blowup.

### Sells a Year Early (`sellsEarly`)

- **Lean** (`trade/plans.ts`, `tradeBlock`): a new block reason, `secondDeal`, for a starter on a rookie contract with
  two years or fewer left, or a starter whose `injuryRisk` tier is High; keenness 0.45, in any stance.
- **Logged:** trades a player he listed for that reason.
- **+** the return included a round 1–2 pick. **−** the player makes an All-League team for another club within two
  seasons.

### Brings His Guys Back (`hisGuys`)

- **Lean:** players he drafted (`Player.draft.teamId` and season inside one of his appointments) are worth 8% more to
  him in `playerValue` (`trade/value.ts`) and in free agency's `needGain` (`offseason/ai.ts`), and +1 in `keepScore`.
  Opening GMs have no draft history from before the league began, so the habit starts to matter a few years in.
- **Logged:** signs or trades for a player he drafted who had left.
- **+** the returning player is a starter the next season. **−** he's cut within a year.

### Trades Firsts for Stars (`firstsForStars`)

- **Lean** (`trade/deals.ts`, `trade/judge.ts`): while his club's stance is contend, `maxOver` gains 0.2 and the extra
  cost of each first past the second (`FIRST_STEP` in `picksOut`) is halved for him.
- **Logged:** a trade sending two or more firsts for one player.
- **+** playoffs the next season. **−** missed.

### Prefers Player Swaps (`swaps`)

- **Lean** (`trade/deals.ts`, `dealFor`): `SWAP_EDGE` falls from 5 to 0 for him (a swap wins a tie with picks) and his
  swap search gets two more tries than `SWAP_TRIES`.
- **Logged:** each player-for-player swap.
- **+** each swap he makes. **−** none: an unused year fades it like any habit.

### Drafts Best Available (`bpa`)

- **Lean** (`offseason/draft.ts`, `boardScore`, which the trade-up board reuses): its need terms (+1, +0.8, −1.5)
  count 40% for him.
- **Logged:** a round 1–2 pick at a position where he already had his starters.
- **+** the pick is a starter within two seasons. **−** not a starter by his third season.

### Tags Before He Pays (`tagsFirst`)

- **Lean** (`offseason/ai.ts`, `aiResignWindow`): for a player `resignCall` labels `tag`, the tag comes before the
  re-sign attempt. Today the tag is the fallback when a re-sign fails.
- **Logged:** each tag.
- **+** each tag. **−** a tagged player leaves in free agency the next year.

### Sticks With His Young QB (`youngQb`)

- **Lean:** a QB of 25 or younger he drafted is untouchable for him (`untouchables` in `trade/plans.ts`, with no
  rating bar), is never listed `surplus`, and gets +2 in `keepScore`. The depth chart and the match engine are not
  touched.
- **Logged:** at the new league year, such a QB started a losing season (his club under .500) and is still on the club.
- **+** his overall rises the next season. **−** three seasons pass without it rising.

### Gun-Shy on Big [Position] Deals (`gunShy`)

- **Formed only by events:** a blowup (shared rules) starts it at grip 1 for that position at once (if he doesn't hold
  it) and adds 3 `gunShy` marbles, so it can turn active at the next draw: a burned GM changes quickly. A GM holds one
  position at a time: the latest blowup's.
- **Lean** (`offseason/ai.ts`, `aiOffer` on the free-agent and re-sign paths): at that position his `eager` is ×0.92
  and his `upgradeBar` ×1.3.
- **Logged:** the blowup itself.
- **+** another blowup at that position. **−** none: an unused year fades it.

## 3. The bag

**Storage** (on `GeneralManager`, so it follows the person; all optional, plain JSON):

- `habits`: the habits he holds, `{ grip: 1 | 2 | 3; pos?: Position }` by habit id (`pos` for Gun-Shy).
- `habitLog`: his logged moves, `{ habit, season, teamId, playerId?, otherId?, resolved?: 1 | -1 }`, pruned to the
  last eight league years.
- `habitMarbles`: this year's event marbles, by habit id and by `fade:<id>`.

**At each new league year** (`offseason/index.ts`, beside `generateDraftClass`), for every employed AI GM:

1. Resolve the log entries that are due (§2) into event marbles.
2. Give each held habit that went unused this year one fade marble.
3. Build the bag: blanks (30; 48 at age 55 or more, the coach bag's numbers), 2 marbles for each of his archetype's
   starting habits, and the year's event marbles.
4. Draw 3 marbles without replacement. A habit marble is grip +1 (a new habit starts at 1); a fade marble is grip −1
   (0 removes it; nothing for a habit he doesn't hold); a blank does nothing.
5. At most 3 habits at grip 2 or more: a draw that would make a fourth active leaves it at grip 1.
6. Clear the year's marbles.

**A new GM** (an opening incumbent in `generate.ts`, a promoted director in `appointDirectorAsGm`) with no habits yet
starts with his archetype's first habit at grip 2; a Balanced GM gets one at random (never Gun-Shy). A GM hired again
keeps what he has.

**Between jobs** he draws nothing; his log keeps resolving (an old club's QB becoming a starter is still his story)
and the marbles wait for his next job. Your GM and a vacancy's caretaker have no habits.

**Randomness:** draws use `${seed}:${season}:gm-habits:${gmId}`, and the Balanced pick
`${seed}:gm-habits:start:${gmId}`. No other stream moves.

**Target feel**, measured in §5: 1–2 active habits per AI GM on average, and about one habit gained or lost per GM
every two years.

## 4. Clues

### Fog rules

- Never shown, on any screen or in any mail: archetype names, habit names, grip, marbles, dials as numbers. A screen
  contract test enforces it (§5).
- Clues come from two places only: his log (public moves: trades, signings, tags, draft picks, extensions) and his
  dials, said as a reputation.
- Your own GM card is unchanged ("You set the roster strategy, spending and draft priorities.").

### Reputation

- `reputation(league, gm)` (`gmVoice.ts`) reads his two most distinctive dials (furthest from the league's typical GM:
  trade activity, stubbornness, winNow, loyalty, cap aggression) and says each in words. Each dial
  has a phrase bank for high and for low, and some phrases are shared, so a reputation is a clue, not an answer key:
  - activity: *always on the phone* / *hard to get on the phone*
  - stubbornness: *drives a hard bargain* / *easy to deal with*
  - winNow: *always chasing this year* / *plays the long game*
  - loyalty: *pays his own* / *lets players walk*
  - cap aggression: *lives on the edge of the cap* / *keeps a clean cap sheet*
- Chosen through `say` keyed by GM, so the same person reads the same way from one screen to the next.
- It replaces "GM style: …" in the Trades header (the pick-chart words stay) and the Finances header, and it opens
  "Public perception" on his card.

### His card: what the league has noticed

- In "Public perception" (`gmStyleNotes`, `ui/gm.tsx`), after the existing lines from his record: up to two
  sentences from his log, most recent first, in the league's voice.
- Wording follows the evidence without naming a tier: one logged move, two or more, or none in the last three league
  years (the reputation lag).
- Relative time in words where a person would use it (*last spring*, *two drafts ago*, *a few years back*), never a
  bare year in brackets. Several lines per habit and evidence, through `say` keyed by GM, habit and season: steady
  within a season, free to change between them.
- Examples: *"He's not shy about jumping the board for a quarterback."* · *"He was the one always jumping up for a
  quarterback. Lately he's let them come to him."* · *"He likes to bring back players he drafted."*

### SNN

- **Front-office digest** (`frontOffice` mail): a new hire's row carries his reputation in the reporter's words
  (*"Has a name as a deal-maker."*). The other rows' lines (out, extended, hot seat) are unchanged.
- **Trade stories** (`keyTradeNews`, `tradeNews.ts`) and draft-day mail: when the deal or pick is a logged habit move
  and his log holds an earlier one of that habit within three league years, one sentence on the pattern, facts only:
  *"Hollis has been here before: he climbed for a quarterback two drafts ago too."* At most one per story.

### Your staff's tips

- `dealAdvice` (`trade/advice.ts`) gains a scouts line in the director's hedged voice when the other GM's log bears on
  this deal: a player he drafted is in it (*"He has tended to pay for players he drafted. We may be able to ask more
  for Kline."*), he's shopping a starter near a second deal, he's paid in firsts before and we're selling a star, or
  he's offering a swap. Tone `note`. The log only, so a tip can be out of date: that's the fog working.

### A face in the mail

- `GmWho` in `ui/mail.tsx`, beside the players' `Who`: `GmAvatar` at 40px, his name as a `GmLink` to the full card,
  a sub line (*"GM, Baltimore · fifth season"*) and at most one line (his reputation, or the pattern being told).
- Emails it opens: the front-office digest (each hire, up to three; the rest stay in the table), a lone GM hire or
  firing story, and a trade or draft story that tells a pattern.

### Who speaks

| Speaker | Where | Voice |
|---|---|---|
| SNN's reporter | Digest, trade and draft stories | Neutral, facts from the log |
| The league's word | His card | Observational, a little colour |
| Your director | Deal advice | Analytical and hedged, as in all his mail |

Lines live in `gmVoice.ts` banks and go through `say` (the most specific line that fits, a stable tie-break, no repeat
of the sender's last five letters).

## 5. Save, checks, files

### Save

- `SAVE_VERSION` 88 → 89, with a `migrate.ts` step: each AI club's current GM with no habits gets his archetype's first
  habit at grip 2 (Balanced from his own stream) and an empty log. Your GM gets nothing. No archetype changes.

### `npm run gm-habits` (new, `scripts/gm-habits.ts`, built like `npm run quirks`)

- **The bag:** four leagues, ten seasons. Active habits per AI GM (mean 1–2), changes per GM per year (about 0.5),
  each habit's share of GMs (every habit carried by season five, none above 40%), nobody over three active, Gun-Shy
  formed at least once.
- **`--effects`:** each habit given to every AI GM at grip 2, the same league years replayed, its decision counted
  against the same leagues without it: more bridge QBs, more QB trade-ups, more extensions with two years left, more
  `secondDeal` sales, more returns of drafted players, more trades of two firsts or more, more swaps, fewer need picks,
  tags before re-signs, fewer young QBs traded or cut, less paid at the gun-shy position. Nothing may be flagged.
- Run it after changing `gmHabits.ts`, `gmTraits.ts` or a habit hook. `npm run check` runs it when those change
  (a new entry in `scripts/check.ts`'s planner, and a CI job like the others).

### League checks

- `npm run trades` and `npm run offseason` must stay green, no range loosened. The planner already picks them for
  `trade/` and `offseason/` changes.

### Tests

- `gmHabits.test.ts`: the bag (contents, three draws, grip, the cap of three active, fade when unused, blanks by age),
  starting habits, each habit's log and resolution rules, draws only from their own stream.
- Next to each hooked file: the habit on and off moves its one decision.
- `gmVoice.test.ts`: reputation from dials, wording by evidence, relative time words, steady within a season, never
  a habit or archetype name in the output.
- `ui/ui.test.ts` (screen contract): no archetype name or habit name for an AI GM in any rendered screen or mail.
- `migrate.test.ts`: a v88 save upgrades.
- A look at the mail: `npm run mail-preview`, then `npm run screens -- --mail` for the digest and trade stories.

### Files

- **New:** `src/engine/gmHabits.ts` (registry, bag, draws, log, `habitOn`), `src/engine/gmVoice.ts` (reputation, clue
  lines), `scripts/gm-habits.ts`, and their tests.
- **Hooks:** `offseason/ai.ts`, `offseason/draft.ts`, `trade/draft.ts`, `trade/plans.ts`, `trade/deals.ts`,
  `trade/judge.ts`, `trade/value.ts`.
- **Archetypes:** `gmTraits.ts`, `trade/market.ts` (activity).
- **Calendar and save:** `offseason/index.ts`, `gm.ts` (starting habit on appointment), `generate.ts`, `migrate.ts`,
  `types.ts`.
- **Writing:** `tradeNews.ts`, the front-office digest in `inbox.ts`, `trade/advice.ts`.
- **Screens:** `ui/gm.tsx`, `ui/mail.tsx` (`GmWho`), `ui/screens/Trades.tsx`, `ui/screens/Finances.tsx`.
- **Docs:** CLAUDE.md (the modules and the command), `docs/GAME_DESIGN.md` (the archetype list), `docs/TRADES.md`
  (the habits that lean trades).
- **Version:** this finishes no MVP item, so PATCH: 0.4.4 → 0.4.5, with a `src/ui/changelog.ts` entry.
