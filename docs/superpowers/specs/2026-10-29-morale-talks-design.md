# Morale, part 2: players speak up (G3)

Date: 2026-10-29 · Chunk G3 of the owner's notes (Oct 28–29, 2026) · Follows G1 (`2026-10-29-morale-core-design.md`, 0.2.21)

## Why

G1 gave every player a mood you can see, but nothing you can do about it except the roster moves you'd make anyway.
G3 lets an unhappy player say so, and lets you answer him: a promise you then have to keep, a word of reassurance, or a
firm line. Promises are tracked, kept or broken by what actually happens, and remembered. This is the groundwork for
FM-style talks; G2 then gives moods their effects and G4 their escalations (hold-ins, holdouts, trade requests).

Order stays G1 → G3 → G2 → G4. **G3 changes no play**: moods still drive nothing on the field, and no club bends a
depth chart or a contract decision to keep a promise (that comes with G4).

## Decisions (agreed with the owner)

1. **Who writes:** a player who has been unhappy for a while, with a cause you could act on. Not every sulk, not
   happy players.
2. **Promise what he asks for:** more snaps when he wants snaps, a new deal when he wants a deal. Nothing else can be
   promised in G3 (the losing and a feud get an answer, not a promise).
3. **Three answers:** Promise, Reassure, Be firm.
4. **AI clubs too:** every club's players speak up by the same rule, and each AI GM answers its own the same way you
   could (by its tendencies, no letters). Their promises are kept or broken by what happens; the AI doesn't act to
   keep them in G3.
5. **Fixed deadlines, a big drop when broken:** snaps within four weeks, a new deal by the end of the next re-sign
   window. A broken promise costs about twice what the promise gave, and he trusts your word less next time.
6. **Letters with reply buttons** (approach A): the talk lives in the inbox, like the contracts letter's buttons; no new
   talks screen.

## Who speaks up

At each morale step a player on a club's roster **asks** when all of these hold:

- his mood (level plus live jolts) has read **Poor or worse for three steps in a row** or more;
- he has a **cause**, from his biggest reason that weighs on him (`moraleReasons`):

  | His reason | Cause | Can be promised |
  | --- | --- | --- |
  | Wants more snaps, Still stung by the benching | `snaps` | yes: more snaps |
  | Wants a new deal, Noticed who got paid | `deal` | yes: a new deal |
  | The losing is wearing on him | `losing` | no |
  | A feud in the room | `feud` | no |
  | anything else (Hard to please, Misses a friend who left…) | none: he doesn't ask | — |

- he has **no open promise** and **no open ask**, and he wasn't answered in the **last six steps**;
- it's a step where players talk: a **regular-season or playoff week**, the **re-sign window** (the new league year's
  step) or **camp**. Not every free-agency day or the draft.

**At most two asks per club per step**, the unhappiest first (lowest mood, then lowest player id). No randomness: who
asks is a pure function of the league, like the rest of morale.

## The answers

| Answer | When it can be given | Right away | Later |
| --- | --- | --- | --- |
| **Promise** | cause `snaps` or `deal` | a `promised` jolt, +2 × his trust (below) | kept: a `kept` jolt +2; broken: a `broken` jolt −4 and one more broken promise on his record |
| **Reassure** | any cause | a `reassured` jolt, +1, halved for each reassurance he's had this league year | — |
| **Be firm** | any cause | a `firm` jolt: nothing for an even-tempered man, down to −1.5 for a volatile one (−0.5 per sd of temperament below average, capped) | — |
| *No answer* | your letter left unanswered by the second step after it was filed | treated as Be firm, plus −1 (a `ignored` jolt) | — |

**Trust:** each broken promise he remembers takes a quarter off what your next promise lifts him (four broken: a
promise does nothing). Remembered broken and kept promises fade one each at every new league year.

**The promises factor** (G1 left it at 0): +0.5 per kept promise he remembers, −1.5 per broken one, clamped −3…+1. The
jolts carry the moment; the factor carries the memory.

All the new jolts follow G1's rules (halve every two weeks, the four biggest kept). New reasons, in his words:
promised "Holding you to your word", kept "You kept your word", broken "You broke your word", reassured "Feels valued",
firm "Didn't like your answer", ignored "Feels ignored"; the factor: "Trusts your word" / "Doesn't trust your word".
The broken, firm, ignored and "Doesn't trust" reasons weigh on him (they join `DOWN_REASONS`).

## Promises: kept or broken

**More snaps.** The promise records the role he expects (G1's `expectedRole`: starter or rotation), his season snaps
and his club's games played when it's made. It's **kept** at the first in-season step where, since the promise, over
at least two of his club's games, he has averaged the snap share of that role (a starter 60%, a rotation player 20% of
a league-average starter's snaps per game, G1's live yardstick; a kicker or punter, games dressed). It's **broken** if
that hasn't happened by its deadline: **four in-season weeks** after it's made, or **week four** when it's made in the
offseason. Each step he's injured or on IR pushes the deadline back a week.

**A new deal.** **Kept** when he signs a new deal above his old one (G1's `paid` moment) before the deadline: the
**end of the next re-sign window** (the window that's open, if he asks during one). **Broken** if the window closes
without it.

**Leaving the club.** If he's traded, cut, or walks in free agency with a promise open, it's broken (the `broken` jolt
lands on him wherever he goes), and his talk record clears: a new club starts with a clean slate.

## AI clubs

Same asks, same deadlines, same jolts. An AI GM answers at once, from its tendencies (`GmTraits`, 0–1):

- cause `snaps` or `deal`: **promise** when `loyalty − stubbornness ≥ 0.2`; **be firm** when `stubbornness ≥ 0.6`;
  otherwise **reassure**;
- cause `losing` or `feud`: **be firm** when `stubbornness ≥ 0.6`, otherwise **reassure**;
- no GM in the chair: **reassure**.

The AI never changes a lineup, a cut or a contract to keep a promise in G3, so its promises are kept only when what it
would have done anyway keeps them. No letters, and nothing about another club's talks reaches a screen.

## Your letters

- **Filed by `deliverMail`** from the ask on file (the sim never sends mail): one letter per ask, from the player
  himself, id `talk:{season}:{clock}:{playerId}`, filed with the locker room's mail. It **needs you** while the ask is
  open.
- **His words** come from a new bank, `playerVoice.ts`, through `say`: the opening by his cause, sharper from an
  outspoken man (controversy) and plainer from a calm one, with what he wants in his own terms ("I want to be out there
  on Sundays", "I've earned a new deal"). No mood numbers; week numbers and the re-sign window are fine.
- **The buttons:** *Promise more snaps* or *Promise a new deal* (only for his cause), *Reassure him*, *Be firm*. Each
  calls one engine function, `answerTalk(league, playerId, reply)`, through `store.mutate`.
- **Once answered**, the letter shows what you said and his reply in one line from the same bank ("Four weeks. I'll
  hold you to that."), read from his talk record; no buttons.
- **Left unanswered** for two steps it closes as above, and the letter says he took the silence as an answer.

## Where you see it (your players only)

- **Locker Room:** a **Promises** list on the morale board: who you promised what, and by when ("Snaps by week 9",
  "A new deal by the end of the re-sign window"), then this league year's kept and broken ones.
- **Player card:** a pill beside Morale while a promise is open ("Promised snaps"), the deadline in its tooltip.
- **The head coach's locker room report:** a kept or broken promise since the last report is a row in its Morale
  section, in his voice ("You told Davis he'd play. He's still waiting.").
- `moraleView` grows the open promise and the reasons above; screens still read nothing else (fog of war).

## Data

```ts
// Player.morale (G1), one new optional field, absent for most players:
talk?: {
  /** He's asked and not been answered yet (your club only: an AI GM answers at once). */
  ask?: { cause: 'snaps' | 'deal' | 'losing' | 'feud'; at: number };
  /** The clock his mood first read Poor or worse in the current run (cleared when it lifts). */
  downSince?: number;
  /** The last answer and when: the six-step quiet after it, and what the letter shows. */
  answered?: { reply: 'promise' | 'reassure' | 'firm' | 'ignored'; at: number };
  /** An open promise. `role`, `snaps`, `games`: the snaps promise's terms and where he stood when it was made. */
  promise?: { kind: 'snaps' | 'deal'; made: number; due: number; role?: number; snaps?: number; games?: number };
  /** Reassurances this league year; promises kept and broken that he still remembers. */
  reassured?: number;
  kept?: number;
  broken?: number;
};
```

Every field is left out when empty, and `talk` itself when it holds nothing: G1 had to trim morale to fit the
offseason check's save budget (17,500 KB; G1's local run measured 17,481), so **G3 has almost no room**: the plan
measures it first, and a talk record must be a few bytes on the few players who have one. If it can't
fit, stop and ask the owner rather than raise the budget.

`SAVE_VERSION` 67 → 68; nothing to fill in (the field is optional and starts absent). New jolt kinds join
`MoraleJolt`: `promised`, `kept`, `broken`, `reassured`, `firm`, `ignored`.

## Where it lives

| File | Change |
| --- | --- |
| `src/engine/talks.ts` (new; `trade/talks.ts` is unrelated) | asks, the AI's answers, `answerTalk`, promise checks, the promises factor |
| `src/engine/morale.ts` | call the talk step inside `moraleAdvance`; the factor; new jolts and reasons; `moraleView` |
| `src/engine/types.ts`, `generate.ts`, `migrate.ts` | `talk`, jolt kinds, save v68 |
| `src/engine/playerVoice.ts` (new), `inbox.ts`, `senders.ts` | the letters, his words, a player as a sender, `needsYou` |
| `src/engine/lockerReport.ts`, `lockerVoice.ts` | kept and broken promises in the report |
| `src/ui/mail.tsx`, `src/ui/morale.tsx`, `screens/LockerRoom.tsx`, `screens/PlayerCard.tsx` | the buttons, the Promises list, the pill |
| `scripts/morale.ts` | the new ranges |

## Checks

- **Unit tests:** each cause and who asks (three steps down, the cooldown, two per club, worst first, no ask while a
  promise or an ask is open); each answer's jolt (trust, the halving reassurance, firm by temperament, ignored after two
  steps); snaps promises kept by snaps (and not by a single game), broken at the deadline, the deadline pushed by
  injury, an offseason promise due at week four; deal promises kept by a raise and broken when the window closes;
  leaving the club breaks and clears; the AI's answer by its GM's tendencies; the letter's buttons, `needsYou` and what
  it shows once answered; nothing about another club's talks in any screen; the save step.
- **`npm run morale`** gains (fixed here; never loosen one to get green):
  - asks per club per season (every club counted alike) between 4 and 30;
  - of promises made league-wide, between 25% and 75% kept;
  - G1's ranges all still hold (bands, underpaid starters, benchings, winning rooms, no drift).
- **No play moves:** `morale.rng.test.ts` extended to talks: a season and an offseason with and without the talk step
  play out the same, and nothing in `talks.ts` reads or fills a shared cache (G1's market lesson). CI's sim, careers,
  audit and offseason checks must not move.
- **Save budget:** the offseason check's six-season save stays under its cap.
- Screenshots on the owner's save before the PR: a letter before and after answering, the Locker Room's Promises list,
  the card's pill; desktop and phone, dark theme.

## Out of scope (later parts)

- Any effect of morale, talks or promises on practice, development, play, asks in negotiations or patience (G2).
- AI clubs acting to keep promises; hold-ins, holdouts, trade requests, fines (G4).
- Starting a talk yourself ("Talk to him"), more promise kinds (improve the team, settle a feud), tones and
  back-and-forth (later FM-style talks).
