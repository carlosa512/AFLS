# How a play ends: a sack's yards, the slide, and why he went out

**Status:** designed (2026-11-07), not built. Follows 0.4.9. MVP follow-ups: "Medium: a sack's yards and strip (L3815)"
(the strip done in 0.4.7, the yards left) and "Medium: a scramble's slide (L3945)", with the reason for every ending a
man chooses (out of bounds, a slide) in the play's words and on film.

## Why

How a dropback or a run ends is still a flat roll or a silent choice:

- **A sack's yards:** normal(6.5, 2.5) clamped to 1–15, whatever the down, the rush, the man or where he is. The NFL's
  mean is right (6.7) but its shape isn't: 7% of sacks lose nothing, 19% lose 10 or more, 2% lose 15 or more.
- **A slide:** a flat 40% of scrambles that stay in bounds, whatever the sticks, the score, the clock or the man; and
  nobody is credited with the tackle, where the NFL credits one on 93% of in-bounds scrambles (touching a slider down is a
  tackle).
- **Why he went out:** `sideline.ts` already weighs the clock, the chase and the man, but the text says only "steps out of
  bounds" or "pushed out of bounds", and the film shows a man leaving the field without the reason behind it.

The owner's calls: one new module beside `looseBall.ts` and `defendedPass.ts` (approach 1); the league's slide share stays
40% (no data records slides; scramble fumbles were fitted on it) and only who slides and when move; the reasons read the
man's habits and makeup as well as the situation: flavor and variety, not uber realism, using the hooks the game has. The
first-half kneel the owner noticed (kneeling with 30 seconds and timeouts in hand) is clock management: it goes to the
next item, "a play's time".

## 1. The NFL (nflverse 2021–25 regular seasons, FTN charting 2022–25; `scripts/research-dropback.py`)

**Sacks** (6,552): loss mean 6.66, sd 3.66; quantiles 5% 0, 10% 1, 25% 4, 50% 7, 75% 9, 90% 11, 95% 12; no loss 6.7%,
10+ 19.2%, 15+ 2.0%.

| By | Mean loss (n) |
| --- | --- |
| Down 1 / 2 / 3 / 4 | 6.10 (1,842) / 6.39 (1,876) / 7.16 (2,641) / 7.83 (193) |
| 3rd and 8+ / 3rd and under 8 | 7.43 (1,296) / 6.90 (1,345) |
| Rushers 3 / 4 / 5 / 6+ | 5.68 (192) / 6.41 (3,341) / 6.89 (1,290) / 7.5 (484) |
| In the pocket / out of it (FTN) | 7.00 (4,100) / 5.26 (1,208): 22.8% of sacks come after he left the pocket |
| Ball at own 21+ / own 11–20 / own 6–10 / own 1–5 | 6.71 / 6.28 (349) / 5.09 (58) / 2.0 (11) |
| Sacker: edge / interior / linebacker / DB | 6.68 / 6.71 / 6.24 / 6.86: the rusher's group barely matters |

Between quarterbacks (55 with 40+ sacks) the mean loss spreads 0.72 yards against 0.39 from luck: about 0.6 a man.

**Scrambles** (5,356): of the 3,307 that end in bounds without a touchdown, 93.2% credit a tackler (226 none). The play
text records no slides (one "slid" in five seasons) and no public source counts them.

## 2. A sack's yards (`match/dropbackEnd.ts`)

A pure module: no draws, no league reads.

- **`escapeOdds(f: SackFacts): number`** — the share of sacks that come after he left the pocket: 0.228 for the league,
  more for a quarterback with legs (`scrambling`) and Bails Early.
- **`sackLoss(f: SackFacts, escaped: boolean, u: number): number`** — the loss on draw `u` from the NFL's shape (in the
  pocket and out of it, each its own table from §1, no loss included), shifted by:
  - the down (§1's means against the league's), longer on 3rd and long;
  - the defense's call, read as its rush: a coverage call (`passD`) as three rushers, base and run calls as four, a
    blitz as five or more;
  - the man: pocket presence takes off, Muddy Pockets adds (aimed at the NFL's 0.6-yard spread between quarterbacks);
  - backed up: from his own 20 in the loss leans shorter (§1);
  - never past his own goal line: reaching it is a safety, as today.
- **`SackFacts`**: `{ down, toGo, yardLine, call: DefenseCall, qb: { pocketPresence, scrambling, has(q) } }`.

The strip-sack odds (0.4.7), who has the sack, the clock and the duration are unchanged.

## 3. The slide (`match/dropbackEnd.ts`)

- **`slideOdds(f: SlideFacts): number`** — the in-bounds scrambler's choice, after today's sideline call keeps him in, never
  on a touchdown. Held at 0.40 for the league (the owner's call); it leans:
  - **toward the slide:** the first down already in hand; leading late (the clock runs); a hitter closing (the chaser's
    tackling, Thumper); tired or carrying a knock; a concussion in his history; a cool temperament, a veteran's years;
    Bails Early, Sees Ghosts;
  - **toward fighting for it:** short of the sticks on 3rd and 4th; trailing late; inside the 5 with a score on offer; a
    runner's legs (`scrambling`) and a big body; a hot temperament; Gunslinger.
  (Contact Averse and Finishes Forward are backs' habits; they lean the out-of-bounds reasons in §4, not the slide.)
- **`SlideFacts`**: `{ down, toGo, gained, scoreDiff, late, toGoal, qb: { scrambling, weightZ, temperament, poise, age,
  concussions, energy, hurt, has(q) }, chaser: { tackling, has(q) } }`.
- **What a slide does:** no hit, so no fumble; the yards are today's (the NFL's scramble yards include its slides); the man
  who touched him down has the tackle (`TOUCHED`, fitted so in-bounds scrambles credit one 93% of the time); nobody
  otherwise.

## 4. Why he ended it (text and film)

A read of the facts the odds already use: no draws, so no fitted number moves.

- **`stepReason(f: SidelineFacts): 'clock' | 'hit' | null`** (`sideline.ts`) — a step-out's reason: the clock asking for a
  stop; else a defender closing (not free) with the man's leans (Contact Averse, tired, a knock, a cool temperament, a
  veteran); else none (open grass).
- **`slideReason(f: SlideFacts): 'firstDown' | 'clock' | 'hit'`** — the strongest of the three toward-the-slide groups.
- **`fightsForIt(f: SlideFacts): boolean`** — tackled in bounds short of the sticks on 3rd or 4th down, or on 2nd down with
  a hot temperament (6 or under).

| Ending | Text |
| --- | --- |
| Stepped out, the clock | `, steps out of bounds to stop the clock` |
| Stepped out, a defender closing | `, gets out of bounds before the hit` |
| Stepped out, no reason | `, steps out of bounds` (as today) |
| Pushed out | `, pushed out of bounds` (the man who ran him out named in the tackle, as today) |
| Slide, first down in hand | `, slides with the first down in hand` |
| Slide, protecting a lead | `, slides to keep the clock running` |
| Slide, the hit | `, slides to avoid the hit` |
| Fought for it | `, fighting for the extra yard` before the tackle |

On film (your games): a reason travels in `FieldFacts` (`ow`: 1 the clock, 2 the hit; `sw`: 1 the first down, 2 the clock,
3 the hit) and the field
plays it: stopping the clock he heads for the sideline early with nobody sent; before the hit a defender is closing as he
crosses; pushed out the contact is at the sideline; sliding from the hit the hitter is arriving as he goes down. An old
save's text, without the words, draws as today.

## 5. Counting scramble fumbles the NFL's way

`npm run fumbles` reads the NFL's scramble fumbles over every scramble that ends in bounds (slides included) but the
engine's contact tap over the scrambles that weren't slides only, so the engine runs at about 60% of the NFL's per
in-bounds scramble and the check can't see it. A slide now taps as a contact that can't fumble, and the scramble contact
odds are refit so the rate per in-bounds scramble lands on the NFL's.

## 6. An escaped sack on film

`FieldFacts.ex` (1: he'd left the pocket): the pocket plays him breaking out (the rollout the pocket already has) and run
down on the move at the sack's spot; a sack in the pocket stays as staged, at its new depth.

## 7. The engine (`match/gameSim.ts`)

- `sack()`: the escape draw and `sackLoss` in place of the normal roll; `ex` to the pocket.
- `scramble()`: `slideOdds` in place of the flat 40%; the toucher credited; `slideReason`, `fightsForIt` and the step
  reason in the text; `ow`/`sw` to the field; a slide taps as a contact that can't fumble.
- Runs and catches: `stepReason` in the out-of-bounds text and `ow` to the field.
- `SimOptions.dropbackTap?: (tap: DropbackTap) => void`: each sack (down, toGo, call, escaped, loss, backed up) and each
  scramble that ends in bounds (slid, its reason, a tackler credited, the situation).
- No save change. The dice move: pinned results are re-taken.

## 8. Checks

- **`npm run dropback [-- games]`** (`scripts/dropback.ts`, `scripts/dropback-core.ts`, the shape of `npm run picks`):
  - judged: the sack loss's shape (no loss, 10+, 15+), its mean by down, in the pocket and out of it, the escaped share,
    backed up; in-bounds scrambles crediting a tackler;
  - reported: the loss by the defense's call (against the NFL's by rushers: the mapping is approximate), the slide share
    overall and by situation, each ending reason's share.
  A share is judged once its tolerance clears 3.5 standard errors and the NFL's sample is 200 or more; a mean is judged
  the same way on its standard error. Nothing may be ✗.
- **`npm run sim`** judges the same lines (`calibrate.ts`).
- **The film check** gains a line per reason: before the hit, a defender within 2 yards as he crosses (most of the time);
  sliding from the hit, the hitter within 2.5 yards as he goes down; stopping the clock, nobody required.
- **Must hold:** `fumbles` (scrambles per in-bounds, refit), `passer`, `sideline`, `sim`, `parity`, `film`, `endings`,
  `quirks --effects`, `audit`.

## 9. Tests

- `dropbackEnd.test.ts`: the loss never past the goal line; no loss possible; longer on 3rd and long and on a blitz,
  shorter escaped and backed up; pocket presence shortens, Muddy Pockets lengthens; escape odds rise with legs and Bails
  Early; slide odds up with the first down and a lead late, down short of the sticks on 3rd and trailing late; the
  reasons pick as §4 says.
- Engine: a tap per sack and in-bounds scramble; a slide credits its toucher; a slide taps as a contact that can't
  fumble; the reason words in the text.
- Film: each reason staged as §4 says; an escaped sack caught on the move; an old save's text draws as today.

## 10. Riding along

- A ball batted down at the line on a throw behind the line ends at the nearer of the line and the throw's target, never
  past the target (0.4.8's deferred minor).
- `PlayResult`'s "man in coverage" comment back above `defender` (0.4.8's deferred minor).

## 11. Docs

`docs/MVP.md`: "a sack's yards and strip" and "a scramble's slide" ticked; the first-half kneel added to "a play's time".
CLAUDE.md: `npm run dropback` beside `npm run picks`; `match/dropbackEnd.ts` beside `match/defendedPass.ts`. A 0.4.10
changelog entry; `package.json` 0.4.10.
