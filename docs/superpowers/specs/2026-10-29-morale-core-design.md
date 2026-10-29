# Morale, part 1: the core (G1)

Date: 2026-10-29 · Chunk G1 of the owner's notes (Oct 28–29, 2026)

## Why

Players have characters (work ethic, temperament, what they want from a deal) but no mood. A star on an
underpaid final year, a starter benched for a rookie, a veteran on a losing team: none of it shows, and none of
it can matter. The roadmap has "Morale (playing time, contract, results) and holdouts" (`docs/GAME_DESIGN.md`).
The owner chose a full morale system, built in four parts:

| Part | What | Touches play? |
| --- | --- | --- |
| **G1. Morale core** (this spec) | a mood per player, its reasons, and where you see it | No |
| G3. Players speak up | letters from players, your replies, tracked promises (groundwork for FM-style talks) | No |
| G2. Effects | practice and development, a small game-day edge, asks and patience in talks | Yes |
| G4. Hold-ins, holdouts, trade requests | what unresolved issues escalate into, for every club | Yes |

Order: G1 → G3 → G2 → G4. G1 makes morale visible on the owner's save before anything reads it, so we can see
that it behaves before it changes play.

## Decisions (agreed in the brainstorm)

1. **Full morale system, league-wide.** Every rostered player on every club has a mood; AI clubs will act on
   their own players' moods in G2 and G4. (An edge only your team had would skew league stats.)
2. **Hybrid model.** Each week a target is worked out from where the player stands (contract, role, team,
   locker room, promises); the stored mood moves part of the way toward it, plus short-lived jolts from big
   moments that fade. Memory without drift.
3. **You shape it by actions and promises** (promises arrive in G3), with groundwork for FM-style talks later.
4. **A small game-day edge** comes in G2 (about ±0.5 of a rating point at the extremes, centred). G1 has none.
5. **Seen as a coloured smiley in tables and a pill on the player card,** the same seven-step colours, never a
   number. Your players only (fog of war).
6. **The player card gets cleaned up:** the facts at the top become pills only; text that doesn't belong there
   moves to the section it's about or goes.

## What feeds morale

Each factor gives a score; their sum, plus his resting level, is the **target**. Every factor is capped so none
dominates. Scale: −10 (abysmal) to +10 (superb), 0 is Okay.

| Factor | Reads | Range | Pulls down | Pulls up |
| --- | --- | --- | --- | --- |
| **Contract** | his APY against his market (`marketApy`, what an agent reads), scaled by his greed dial; ×1.5 in his deal's final year. Rookie deals count only from his third season (the NFL's extension window) | −4…+2 | well under his market | at or above it |
| **Role** | the role he plays (`seasonRole` from his snaps: starter, rotation, backup, idle) against the role he expects (his standing in his position room on his own true overall, and his experience: veterans expect more than rookies). This season's snaps once three games are in; last season's before | −3…+1.5 | playing well under what he expects | as expected or more |
| **Team** | our win share this season (last season's until week 4), scaled by his "wants to win" dial | −2…+2 | losing | winning |
| **Locker room** | friends on the roster, a feud in his room, the captaincy, mentoring a young player | −1.5…+1.5 | a feud | a friend, the C, a mentee |
| **Promises** | reserved for G3 (0 until then) | — | a broken promise | a kept one |

**Resting level:** a calm, patient, loyal man rests above Okay; a volatile, impatient one below
(temperament, patience and loyalty, read through their accessors; ±1.5).

**How fast it moves:** each week the mood moves 25% of the way to its target, between 15% and 40% by
temperament (volatile men swing faster).

### Jolts: big moments that fade

At most four kept (the biggest). Each halves every two weeks and is dropped below 0.25.

| Jolt | Size | When |
| --- | --- | --- |
| Benched | −3 | the role reading drops from starter, mid-season or at the new league year |
| Snubbed | −2 × greed | a teammate at his position signs a bigger deal (the same "snub" `relationships.ts` already reads) |
| Friend gone | −2 | a friend cut or traded away (the same departure the locker room report tells) |
| Paid | +3 | he signs a new deal above his old one |
| Named captain | +2 | camp's captains |
| Playoffs | +2 | his team clinches a berth |

## Where it updates

- **In season:** once a week in `playWeek`, after the games (beside `mentoringWeek`).
- **In the offseason:** at each calendar step (`beginOffseason`, each free-agency day, the draft, camp, cut-down
  day), so a signing or a release lands when it happens.
- **Free agents** have no target but "wants a job" (a flat −1), and keep no jolts.
- **No randomness:** mood is a pure function of the league's state and its history; it draws nothing from the
  sim's streams, so the same save always gives the same moods.

## Data

```ts
// Player
morale?: {
  /** −10…+10; the words are bands of it. */
  level: number;
  /** Recent big moments, newest last; at most four. */
  jolts: { kind: MoraleJolt; size: number; season: number; week: number }[];
};
```

`SAVE_VERSION` bump; the upgrade step starts every rostered player at his current target with no jolts.

`morale.ts` (new) holds: the factor reads (`moraleFactors`), the target, the weekly step (`moraleWeek`,
`moraleStep` for the offseason), the jolts, the words (`moraleWord`), and the reasons in plain words
(`moraleReasons`: his biggest factors and live jolts, e.g. "Wants a new deal", "Wants more snaps", "The losing is
wearing on him", "Lost his best friend in the cuts", "Proud to wear the C", "Loving the winning").

**Fog of war:** screens read `moraleView(league, p)`, which returns the word, the step and the reasons for your
own players and `null` for anyone else's. Nothing else on a screen may read `p.morale`.

## The seven steps

| Step | Word | Band | Smiley |
| --- | --- | --- | --- |
| 7 | Superb | ≥ 6 | big grin |
| 6 | Very good | ≥ 3 | grin |
| 5 | Good | ≥ 1 | smile |
| 4 | Okay | > −1 | flat mouth |
| 3 | Poor | > −3 | slight frown |
| 2 | Very poor | > −6 | frown |
| 1 | Abysmal | ≤ −6 | deep frown |

Each step has a colour token (`--mood-1` … `--mood-7`, red through amber to green), defined for light and dark
themes. The smiley is a small inline SVG drawn in that colour, with the word as its accessible label and
tooltip; the pill uses the same colour.

## Where you see it

- **Roster:** a Mood column (the smiley), sortable happiest to unhappiest (`SortTh`, sorting by level).
- **Locker Room screen:** a "Morale" section: the room's mood (the roster's average, as a smiley and word), then
  who's unhappy and why, worst first, then the happiest few. Smileys in its tables too.
- **Player card (your players):** a Morale pill in the facts, its reasons in the pill's tooltip.
- **The head coach's locker room report** (chunk A) gets a Morale section at each check-in: who slipped and who
  came around since the last report, in his voice ("Davis is sulking about snaps. I'd talk to him before it
  spreads."). Banks in `lockerVoice.ts`.
- Other clubs' players: nothing in G1.

## The player card cleanup

The facts at the top become pills only; text moves to the section it's about or goes.

| Fact | Today | After |
| --- | --- | --- |
| Makeup | personality pill, a text line ("Learning from Jay Davis" / "Mentoring …"), makeup pills | pills only; the mentor line goes (the Locker Room screen shows every pair) |
| Habits | habit pills, then "Has fixed: …" text | pills only; "Has fixed" moves into the collapsed Habits over time section |
| Form | red text | a pill |
| Fit | "Good · Speed, Hands" | the grade as a pill; the skills in its tooltip |
| Morale (new) | — | a pill in its colour, reasons in its tooltip |
| Read by (under the facts) | a paragraph ("Read by … A scouting visit doubles as a sit-down…") | moves into the Scout's report box as its footer |

The Scout's report stays as the card's one block of prose. Health, Ratings, Development, Contract and Stats are
unchanged.

## Checks

- **Unit tests** (`morale.test.ts`): each factor's direction and cap; the target and the weekly step
  (deterministic, bounded); jolts fade and cap at four; free agents; words for each band; `moraleView` is `null`
  for another club's player; the save step.
- **`npm run morale`** (new script, added to `scripts/check.ts` and CI for changes to `morale.ts`): plays a few
  seasons league-wide and checks the moods look like a real league:
  - most players sit between Okay and Very good (band shares within ranges);
  - underpaid final-year starters mostly read Poor or worse;
  - a benched starter dips, then recovers within about six weeks;
  - winning teams' rooms average happier than losing teams';
  - nothing runs away: the league's average mood stays within a band season to season, and no level leaves
    −10…+10.
- **UI:** the screen contract (`ui.test.ts`); the smiley renders for every step with its label; the Mood column
  sorts by level; the card shows no mentor line and no "Has fixed" text in its facts.
- G1 changes no play, contracts or AI, so the sim, careers, audit and offseason checks can't move (CI's planner
  still runs them on `src/engine` changes).
- Screenshots of the Roster, Locker Room and player card on the owner's save, desktop and phone, before the PR.

## Files

| File | Change |
| --- | --- |
| `src/engine/morale.ts` | new: factors, target, weekly and offseason steps, jolts, words, reasons, `moraleView` |
| `src/engine/league.ts`, `offseason/index.ts` | call the steps |
| `src/engine/types.ts`, `generate.ts`, `migrate.ts` | `Player.morale`, save bump and step |
| `src/engine/lockerReport.ts`, `lockerVoice.ts` | the report's Morale section |
| `src/ui/morale.tsx` | new: `MoodFace` (the smiley), `MoodPill` |
| `src/ui/screens/Roster.tsx`, `LockerRoom.tsx`, `PlayerCard.tsx`, `src/ui/scouting.tsx` | the column, the section, the pill and the card cleanup |
| `src/styles.css` | the seven mood colours (light and dark) |
| `scripts/morale.ts`, `scripts/check.ts`, `.github/workflows/ci.yml`, `package.json` | the new check |

## Out of scope (later parts)

- Players' letters, replies and promises (G3); the Promises factor stays 0 until then.
- Any effect of morale on practice, development, play, asks or patience (G2).
- Hold-ins, holdouts, trade requests, fines, AI clubs settling with unhappy players (G4).
- The Locker Room screen's full sortable table and NFL-style captain rules (chunk D).
