# Morale, part 4: being heard, and when talks fail (G4)

Date: 2026-10-30 · Chunk G4 of the owner's notes (Oct 28–30, 2026) · Follows G1 (0.2.21), G3 (0.2.22) and G2 (0.2.24):
`2026-10-29-morale-core-design.md`, `2026-10-29-morale-talks-design.md`, `2026-10-29-morale-effects-design.md`

## Why

Two things, one fix and one feature.

1. **Answers don't land.** The owner's save (2029, free agency): four of his players were reassured about a new deal and
   still read Very poor weeks later; one was promised a deal and still sulked. The reason: an answer only adds a small
   jolt that fades (a reassurance +0.5, a promise +2, both halving every two steps), while the grievance behind it (the
   contract factor, −3.5 to −4 for an underpaid man in his final year) keeps pulling his target down. Nothing about a
   promise softens what it promised to fix. So a mood drifts back down until the raise actually lands.
2. **Talks that fail lead nowhere.** A man who's ignored, told no, or lied to just stays unhappy. In the NFL he holds in,
   holds out or asks to be traded. G4 adds those, handled through the head coach's letters, and AI clubs now act to keep
   the promises they make.

## Decisions (agreed with the owner)

1. Approach A: one escalation per player at a time, started only by a talk that ended badly, run on morale's clock.
2. **Hold-ins, holdouts and trade requests.** No separate discipline system: fines are the league's, automatic.
3. **Trigger: an unresolved talk only.** No man escalates without first asking and getting a bad answer (ignored, firm)
   or a broken promise.
4. **Your side runs through letters with choices** from the head coach, like G3's.
5. **Holdouts can run into the season.**
6. **Fines are automatic and can be forgiven in a deal.** (The 2020 CBA forbids forgiving a veteran's camp fines; only a
   rookie-deal player's can be. The owner chose forgivable for everyone; noted here in case that changes.)
7. **AI clubs act to keep their promises.**
8. **Trade requests start private and can leak.** Once public, other clubs call, some with low offers.

## Part 1: being heard (the fix)

An answer now softens the grievance it answered, not just his mood for a week or two. Each cause has a factor behind it:
snaps → `role`, a deal → `contract`, the losing → `team`, a feud → `room`.

- **An open promise** leaves a quarter of that factor's pull (only when it's negative), scaled by how much he still
  trusts your word: the weight is `1 − 0.75 × trust`, `trust = max(0, 1 − 0.25 × broken)` (the same trust G3's promise
  lift reads). No broken promises: a quarter of the grievance. Four or more: all of it. It lasts while the promise is
  open; kept, the raise or the snaps fix the factor itself; broken, the full grievance is back on top of the −4 jolt.
- **A reassurance** takes a quarter off that factor's pull until he could ask again (G3's eight-step quiet). A second
  in the same league year takes an eighth (G3's halving).
- **Words:** while a promise is open, the factor's reason reads "Waiting on his new deal" or "Waiting on his snaps"
  instead of "Wants a new deal" or "Wants more snaps".

The owner's players, worked through: Warren (contract −4, role −1.5) promised a deal moves from a −5.5 target to about
−2.5 (Poor, not Very poor), and his snaps complaint still shows because nobody answered it. Reassured, he's at about
−4.5: words alone don't fix a pay grievance, and they shouldn't.

Data: `Talk.answered.cause` (what the answer was about; old records without it soften nothing).

Ships first, on its own: a fix (0.2.26).

## Part 2: who escalates

A man escalates when **his last talk ended badly** (ignored, answered firm, or a promise broken), and **he's read Very
poor or worse for four steps in a row since**, with that talk's cause still his top reason. A step at Poor or better
resets the count. One escalation per player at a time; at most one new one per club per step (the unhappiest first).

What he does depends on the cause:

| Cause | Escalation | When it can start |
| --- | --- | --- |
| A deal | Hold-in, or holdout for some veterans | The re-sign window to camp (steps 0–7). Due in season, it waits for the new league year and is checked again then. |
| Snaps, the losing, a feud, a broken snaps promise | Trade request | Any step talks run (in season, the re-sign window, camp) |
| A deal, after a hold-in or holdout that ended without one | Trade request | In season (Aiyuk 2024, Reddick 2024) |

A contract dispute needs a deal he can be extended out of: two years or fewer left (`extensionBlocker`), past his
third season on a rookie deal. A man in a deal's last year who is heading to free agency doesn't hold out; he walks.

**Holdout or hold-in:** a holdout when he's a veteran off his rookie deal (or in its fifth-year option), expects to
start, and is greedy (`greed ≥ 0.6`). Otherwise a hold-in. Since the 2020 CBA's fines, hold-ins are the NFL's usual
way.

NFL numbers it's checked against (2023–25 trackers): about 5–10 notable contract disputes a summer, 1–4 of them true
holdouts, 0–2 into the regular season (Chris Jones 2023: one game; Haason Reddick 2024: seven weeks, about $12M lost);
about 5–10 public trade requests a year, roughly half traded within the year.

## Part 3: hold-ins

He reports but won't practice.

- At the spring program and camp steps: no position learning (`training.ts`), and G2's growth tilt reads his pull as −1
  (Abysmal) for those steps.
- **Rust:** a man who missed camp's practice plays week 1 a point worse in every contest, week 2 half a point, gone
  after (through the same knocks overlay as G2's game-day edge).
- **It ends** with a deal, a trade, a promise he takes, or **week 1**: he's under contract and in the building, so he
  plays. If nothing was settled, the talk counts as ended badly again, so a trade request can follow in season.
- No fines (he reported).

## Part 4: holdouts

He doesn't report to camp.

- **Camp fine:** $50K a day of camp (the 2020 CBA's veteran rate), charged at camp's step as one fine: about $1.0M.
- **The Reserve/Did Not Report list:** off the 53 (`rosterList` returns `didNotReport`), unavailable, not counted in
  roster limits. His club can sign a cover.
- **Each regular-season week out:** his game check (1/18 of base) is withheld, and his club's cap charge drops by it
  (`ContractYear.withheld`, read by `capHit`). Fines and withheld checks go to no club.
- **Accrued season:** a man who misses all of camp doesn't accrue the season (the CBA's report-30-days-before rule),
  through `personnel/service.ts`.
- **He gives in** once what he's lost (fines and withheld checks) reaches his limit: `base × (0.05 + 0.45 × resolve)`,
  `resolve = (greed + 1 − patience) / 2`. A calm man reports for week 1 having lost his camp fine; the most stubborn
  holds out about nine weeks. Giving in: a −2 jolt ("Gave in"), and the talk counts as ended badly.
- **It ends** with a deal (fines forgiven), a trade (a new club is a clean slate), a promise he takes, or giving in.
- **Rust** as for a hold-in, from the week he reports.

## Part 5: trade requests

- **Private first:** he tells his club. Only his club knows (fog of war: other clubs' AI and screens see nothing).
- **It leaks** after six steps (three for an outspoken man, `controversy` well above the mean), or at once if his club
  refuses him and he's outspoken. Leaked: a rumor in `league.market`, and every club knows he wants out.
- **Public:** buyers call his club more often and open low, knowing he wants out (10–25% under their price). His club's
  floor drops 15% (his value to a club he wants to leave is lower), still through `judge`: no side loses in its own eyes.
- **Refused:** he stays. Still Very poor or worse at the next camp with a contract cause in reach, it hardens into a
  hold-in.
- **It ends** with a trade, a promise he takes (snaps or a deal, when his cause allows one), or **withdrawn**: his mood
  back to Poor or better for four steps, or his cause answered (a raise, snaps kept). Open at the new league year, it's
  checked again: still Very poor with a cause, it stands.

## Part 6: your letters

From the head coach, one when a dispute starts (buttons drawn live from the league, like G3's, nothing stored on the
message) and one when it ends. While it runs, his locker room report (four check-ins) says where it stands.

| Dispute | Buttons |
| --- | --- |
| Hold-in, holdout | **Negotiate** (opens his contract talks), **Promise a deal** (by week 1; two weeks on in season), **Hold firm** (fines run, he may give in), **Shop him** |
| Trade request | **Shop him** (quietly: on your block, offers come), **Refuse**, **Promise** snaps or a deal (when his cause allows) |

A promise needs his trust: past four broken promises the button reads "He won't take your word". A promise in a dispute
that's broken restarts the dispute at once (no four-step count).

**Screens:** the Locker Room gains a Disputes section (your players only). The Roster lists a holdout under Did Not
Report, like IR. What's public shows for anyone's player where an injury shows: Holding out, Holding in, Wants a trade
(public only). A private request shows only to his club.

## Part 7: AI clubs

- **Disputes:** an AI GM answers by its tendencies, the same way `aiReply` does: a loyal one negotiates (an extension at
  its own price, `resignCall`'s rule, if the cap fits), a stubborn one holds firm, the rest shop a trade request once
  it's public or a holdout past week 1.
- **Keeping promises:** a deal promised, the AI extends him in the re-sign window by `resignCall`'s rule (extensions
  with two years left included), or the promise breaks when its own read says he isn't worth his ask. Snaps promised,
  its depth chart starts him for the promise's games when he's within a point of the man he'd replace on its own read;
  further back, the promise breaks.

## Data

- `Talk.answered.cause` (Part 1).
- `Morale.dispute?: { kind: 'holdIn' | 'holdOut' | 'trade'; cause; since; public?; refused?; fined?; promise? }`.
- `ContractYear.withheld?: number` (weeks of game checks withheld).
- `SAVE_VERSION` 71 (Part 1 needs no bump: an optional field old saves don't have); the upgrade step fills nothing.

## Checks

- **Unit tests:** the softening (weights by trust, by reply, only negative factors, gone when the promise ends); the
  trigger (bad end, four steps, the reset, one per club a step); hold-in effects (no learning, the tilt, rust); holdouts
  (fine, the list, game checks, cap credit, accrued season, giving in at the limit); trade requests (private, the leak,
  public pricing, refused hardening, withdrawn); AI promises (an extension, a depth-chart start, broken when not worth
  it); letters' buttons and the fog of war (a private request invisible to other clubs and their screens).
- **`npm run morale`** adds: disputes a league season 3–12, holdouts 0.5–5, into the regular season ≤ 2 on average, no
  holdout past his limit; trade requests 4–15 a season, 40–90% going public, 25–75% of those resolved ending in a trade.
- **Ranges that move by design (the owner's call, never loosened quietly):** the promises-kept share (25–75%) was set
  when no club acted on its promises; with AI clubs keeping them it should rise. The underpaid-final-year check (60%+
  Poor or worse) may fall once an open promise softens the grievance. The plan measures both; if either leaves its
  range, stop and bring the owner the numbers before any range changes.
- **Play moves** (holdouts miss games, rosters cover them): CI's planner runs `sim`, `offseason`, `trades`, `careers`
  and the rest; no range is loosened to get green.

## Three pull requests

1. **Being heard** (Part 1), 0.2.26: the fix the owner sees now. Small; runs the morale check.
2. **G4a: contract disputes and promises kept** (Parts 2–4, 6 and 7 for contracts), 0.2.27.
3. **G4b: trade requests** (Part 5 and its letters and AI), 0.3.0: finishes the Morale and holdouts MVP item.

## Files

| File | Change |
| --- | --- |
| `src/engine/morale.ts` | the softening, the waiting words |
| `src/engine/playerTalks.ts` | `answered.cause`; the trigger; disputes' promises |
| `src/engine/disputes.ts` (new) | hold-ins, holdouts, trade requests: start, run each step, end |
| `src/engine/roster.ts`, `finance/contract.ts`, `personnel/service.ts` | Did Not Report, withheld checks, accrued season |
| `src/engine/training.ts`, `development.ts`, `match/lineup.ts` | no learning, the tilt, rust |
| `src/engine/offseason/ai.ts`, `roster.ts` (AI depth) | AI keeps promises |
| `src/engine/trade/plans.ts`, `offers.ts`, `judge.ts`, `market.ts` | a public request: calls, low openers, the floor |
| `src/engine/disputeMail.ts` (new), `lockerReport.ts`, `lockerVoice.ts`, `playerVoice.ts` | the letters |
| `src/ui/screens/LockerRoom.tsx`, `Roster.tsx`, player card | Disputes, Did Not Report, the public status |
| `src/engine/types.ts`, `generate.ts`, `migrate.ts` | the data, save v71 |
| `scripts/morale.ts`, `scripts/check.ts` | the new checks |
| `docs/MVP.md`, `package.json`, `src/ui/changelog.ts`, `CLAUDE.md` | the Morale line, versions, changelog, notes |

## Out of scope

- Discipline beyond the league's fines (suspensions, conduct, a club's own fines).
- Franchise-tag holdouts and unsigned tenders.
- Agents' media campaigns, a contract-year player coasting, preseason-game penalties.
