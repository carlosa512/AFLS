# Locker room, part 1: who runs the room (L1)

Date: 2026-11-01 · Branch: `claude/bold-fermat-4pxknq` · First of four parts (L1–L4) from the owner's locker-room
brainstorm (Nov 1, 2026)

## Why

Every player already has a mood (`morale.ts`), a personality (`personality.ts`), friends and feuds
(`relationships.ts`), and every club names three captains at camp. But the room has no shape. A Born Leader's mood
counts for the same as a third-string guard's, a unit has no mood of its own, and the head coach can only talk about
men one at a time.

The owner's brainstorm asks for a living locker room: team meetings, groups, chemistry on Sunday, a staff the room
believes in or doesn't. All of that needs the same foundation: **who the room listens to, the groups it splits into,
and how each group is feeling**. L1 builds that foundation and tells it in words a GM wants to read.

## The arc

| Part | What it adds | Reads |
| --- | --- | --- |
| **L1: who runs the room** (this spec) | Leaders and voices; units; a voice's mood rubs off on his unit; each unit's read; the coaches' words for all of it | personality, ties, captains, morale |
| **L2: team meetings** | You call a meeting with a topic and a tone; each group reacts by its makeup and who leads it; moods move through jolts; mixed reactions you can read and understand | L1 |
| **L3: chemistry on Sunday** | A unit that's together plays a little better and a split one a little worse, centred on the league; time playing together counts | L1, the match engine |
| **L4: backing the staff** | Whether the room believes in the coordinators; a lawyer stirs doubt after losses; you answer it in a meeting; a room that has lost faith executes worse, and the inbox warns you first | L1–L3 |

Hold-ins, holdouts and trade requests (G4, `2026-10-30-morale-escalations-design.md`) stay their own track.

**What changed from the rough brainstorm, and why:**

- **No separate `dynamics/` module.** It would duplicate `morale.ts` and `relationships.ts`. L1 adds one small module
  (`standing.ts`) and extends the ones that own each piece.
- **No pairwise matrix.** A matrix for every pair would be about 44,000 pairs across the league. The house approach is
  to work things out from what's stored and store only what can't be. Friendships and feuds stay the only stored
  pairs.
- **No `Map` in the save.** `League` stays plain JSON.
- **The gauges stay inside the engine.** Screens show words, never the numbers.
- **The faction view lives on the Locker Room screen**, which already exists, not on a new Front Office tab.

## Decisions (proposed; the owner checks these in review)

1. **Standing does something from day one.** A voice's mood rubs off on his unit, and a captain's on his whole side.
   A label that changes nothing would break the house rule that nothing is shown without a hook (`TRAITS_ON`, "no
   attribute without an engine hook"). This moves moods a little, so `npm run morale` and `npm run careers` must stay
   green.
2. **Two words, and quiet is the default.** A player is a **leader**, a **voice**, or neither. The thresholds are
   absolute, not ranks, so a young room can have no leader past its captains, and the head coach will say so.
3. **Units are the groups that carry mood.** The seven position coaches' rooms plus the specialists (§2), so every
   unit has one coach who writes about it. Veterans against young players is a lens
   the coaches read the room through, with no mechanic of its own until L2 gives it one.
4. **Nothing new in the save.** Standing, units and their reads are worked out on the spot. Reports remember what
   they told through `covered` keys, as they do now. No `SAVE_VERSION` bump.
5. **Your club on screen, every club in the engine.** AI clubs' moods follow the same rules. No AI decision reads
   standing yet.
6. **The player card stays as it is** (the same call as G2). The Locker Room screen and the head coach's report carry
   L1.
7. **Position coaches speak about their own unit** in the weekly staff notes when it turns, so a change never waits
   for the next quarterly report.
8. **Captains are named by the same weight** as everything else (§1.1), so seniority and stature count, not only
   leadership and snaps. Most NFL captains are veterans; today a second-year starter with a high leadership read can
   wear the C over a ten-year starter.
9. **The writing is the feature.** Every line follows §6. A test enforces the rules a machine can check.

## 1. Standing: who the room listens to

### 1.1 Weight

How far a man's word carries in the room, worked out from what's already stored:

```
weight = leadFactor(leads) × field × seniority × stature
```

- **Leadership:** `leadFactor` (`mentoring.ts`), from ×0.3 for the quietest to ×1.5 for a Born Leader.
- **Field:** a starter 1, a rotation player 0.7, a backup 0.4 (the values of `standingFactor` in `mentoring.ts`). It
  reads the role morale's grievance reads (`actualRole` in `morale.ts`): this season's snaps once his club has three
  games in, last season's before that. So a rookie who wins a job earns his say during the year instead of a year
  late, and the room and the role grievance never disagree about who starts. A man hurt in season counts at last
  season's role.
- **Seniority:** 0.6 for a rookie, rising 0.1 a year to 1.0 at four seasons in the league, then on to 1.15 at eight
  or more. In his first season at the club, ×0.8: a newcomer has to earn the room.
- **Stature:** ×1.2 with a season award or an All-League team in the last three seasons (`awards.ts`). The starting
  quarterback gets ×1.15, because he's the offense's voice whether he wants to be or not.

The engine reads true traits, as mentoring does. Screens read our staff's read, which for our own players is exact
(`knowledge` is 1 for your own roster).

### 1.2 Leader, voice, quiet

- **Leader:** a captain, or weight ≥ 1.25.
- **Voice:** weight ≥ 0.85.
- **Quiet:** everyone else, which is most of the 53.

`leadersOf` (`personality.ts`) becomes "the leaders who aren't captains" from these tiers and moves to `standing.ts`.

**Targets to calibrate** (design targets, not NFL data; there is no public count of who leads an NFL room):

- Leaders per club, captains included: 3–6 on average.
- Voices per club: 6–12.
- A club with no leader past its captains: 10–30% of club-weeks.

### 1.3 How a voice sounds

- **Stirs:** controversy z ≥ 1, the same line the Locker-Room Lawyer and Volatile names use. His bad mood spreads
  half again as far as an even voice's, and his good mood a quarter less.
- **Steadies:** leadership z ≥ 1 and temperament z ≥ 0.5. His bad mood spreads half as far.
- Anyone else is even. A man who would qualify for both stirs, because it's the louder of the two. Every
  Locker-Room Lawyer stirs.

### 1.4 Rising and fading

Standing moves as weight does: a second-year starter finds his voice, a benched veteran loses his, a newcomer earns
his. No history is stored. The report compares a man's tier against the one it told last time
(`standing:{season}:{checkin}:{playerId}:{tier}` in `covered`).

## 2. Units

The units are the position coaches' rooms (`COACH_ROOMS`, `ROOM_OF` and `ROOM_LABEL` in `coaching.ts`), plus the
specialists, who have no position coach:

| Unit | Positions | The coaches say |
| --- | --- | --- |
| QB | QB | "the quarterbacks" |
| RB | RB | "the backs" |
| WR | WR, TE | "the receivers" |
| OL | OL | "the line" |
| DL | DT, EDGE | "the D-line" |
| LB | LB | "the linebackers" |
| DB | CB, S | "the secondary" |
| Specialists | K, P | "the specialists" (no read of their own) |

A player belongs to his own position's unit, even when he lines up somewhere else ("Play at…", `Team.playingAt`), the
same way `sameRoom` keeps him in his position room. **Sides:** offense is QB, RB, WR and OL; defense is DL, LB and
DB; special teams is the specialists. The offense captain's voice reaches every offensive unit, the defense captain's
every defensive unit, and the special teams captain's the specialists and his own unit.

### 2.1 A voice's mood rubs off (the mechanic)

`roomScore` in `morale.ts` gains one term, **tone**:

```
tone = Σ w(v) · loud(v) · lean(v)  /  max(Σ w(v), 2.0)
       over v = the leaders and voices in his unit, plus his side's captain (counted once), v ≠ him

roomScore += 0.5 × clamp(tone, −1, 1)
```

- `lean(v)` is `moodLean(moraleLevel(league, v))`, −1…+1, at the last morale step.
- `loud(v)` is 1 for an even voice. For a voice who stirs, it's 1.5 when he's down and 0.75 when he's up. For one who
  steadies, it's 0.5 when he's down.
- The floor of 2.0 under the sum keeps a unit with one weak voice from being pulled hard. Two solid voices pull
  fully.
- **Friends:** each friend at the club adds `0.15 × lean(friend)`, at most two friends counted, on top of the +0.5 a
  friendship already gives.
- The room score still clamps to ±1.5, and it is one of six factors in the target.

**Why it can't run away.** Quiet players never feed tone. Voices read other voices, but each step a level moves only
part of the way to its target, and tone is at most ±0.5 of a room score that is one factor of six, so the loop gain
is well under 1. `npm run morale`'s no-drift check guards it.

**Cost.** Tone is worked out once per morale step in `moraleContext` (per club: each unit's voices with their weight
and loudness, and each side's captain), so a pass reads each player once.

**Downstream.** G2's effects read `moodPull` against the league's mean, so league totals hold however moods cluster
by room.

### 2.2 A unit's read

Each unit with three or more men on the 53 gets a read (so a two-man quarterback room has none), from its men's levels weighted by `max(weight, 0.3)`, so a
voice counts for more but a quiet man still counts:

| Read | When |
| --- | --- |
| **Split** | at least 25% of the unit's weight sits at Good or better and at least 25% at Poor or worse (this overrides the rest) |
| **Tight** | the weighted mean level is 1.5 or more (well into Good) |
| **Settled** | between Restless and Tight |
| **Restless** | the weighted mean level is −0.5 or less |
| **Down** | the weighted mean level is −1 or less (Poor or worse) |

A unit's mean runs far narrower than one man's mood (its tenth worst reads only Poor), so the words sit where a
unit's spread puts them, calibrated in `npm run morale` (`READ_AT`, `SPLIT_SHARE` in `standing.ts`), not on the
seven mood steps.

Each read also carries:

- **Who sets the tone:** the unit's heaviest leader or voice, or its side's captain, and which way he's pulling.
- **What it's about:** the unit's most-felt reasons, read off `moraleView` (the same phrases the Locker Room's "On
  their minds" uses), with how many men feel each.
- **No voice:** a flag when the unit has no leader or voice of its own and its side's captain isn't in it.

**Targets to calibrate** (design targets; a read that is always "Settled" says nothing): Split 5–15% of unit-weeks,
Down 5–20%, Tight 15–35%.

## 3. The room as a whole

- **The room's mood**, today an average on the Locker Room screen, becomes the same weighted mean: a captain's mood
  is more the room's than a backup's.
- **The vets and the young guys:** "the vets" are men with six or more seasons in the league, "the young guys" those
  in their first three. When the two groups' weighted means sit two mood steps or more apart, the coaches say so. It's
  a lens only, with no mechanic.

## 4. Where you see it

### 4.1 The Locker Room screen

- **"Captains and leaders" becomes "Who the room follows":** the captains as now, then leaders, then voices. Each
  shows his personality pill and a short reason in words, read off the biggest parts of his weight ("Eight years in,
  starts, the line goes to him").
- **New section, "The rooms"** (revised after the owner saw it in game): one card per room with a read, the ones in
  trouble (divided, down, restless) first and marked. Each card shows the room's mood as the smiley and the same mood
  word the rest of the screen uses, a **Divided** tag when it's split, **"Listens to"** (a man in that room, or "no
  one yet": a captain from another room is never shown as a room's voice), and **one line on what stands out**: a
  complaint first ("Two want a new deal."), then something this room feels that the rest of the team doesn't, then
  "Winning keeps them happy." for a happy room that only has the winning, else "Nothing to flag." No new read words
  reach the screen.
- The morale board, mentoring and "In the room" stay as they are.

### 4.2 The head coach's locker room report (four check-ins)

The room's news (both sections below and the verdict's room facts) goes only in the season's first report (camp's,
or cut-down's when camp went by unseen, since captains are named on the way out of camp) and the season's end. The
deadline report stays as it was; in season the position coaches carry the rooms. Rows read in the screen's words:
Divided, or the room's mood.

- **New section, "The room":** a row for any unit that is Split or Down (with "still" when it was told so last
  time), one that came together (turned Tight), and one back from Split, Down or Restless. A unit that only cooled
  from Tight, or went a little restless, waits until it's news. Columns: Unit, Read, and a note in one sentence.
- **Standing changes** go in the captains section, now titled "Who the room follows": a man who became a leader or
  a voice, or stopped being one, since the last report. A GM's first report has nothing to compare against, so it
  lists no changes. A leader on injured reserve hasn't left: only a man off the club counts as gone, and a man off
  the 53 but still ours keeps the place he had, so he isn't told as new when he's back. A captain named in the same
  report is listed once. Last season's captains lead the room until camp names new ones.
- **The verdict's facts** gain the room's shape (split units, down units, a tight unit, a unit with no voice, the
  vets and the young guys apart when the lower group reads Poor or worse), so the opening line can speak about it.
  A split or down room outranks everything but a feud on the field; with a feud still on, the verdict names both.

### 4.3 Position coaches in the weekly staff notes

When a unit's read turns between weeks (into Split or Down, or back from them), the coach of that unit adds a note
to the week's staff notes (`staffNotes.ts`). A turn is measured against what was last told about the unit, by a
report or an earlier note, so the two never repeat each other; a room nobody has reported on yet has no turn, and a
week when the head coach's report goes out leaves the rooms to the report. At most one unit note a week (Split, then
Down, then a recovery), never for a unit told about in the last three weeks, and none when the room has no position
coach. Good news waits until no room has been told about for three weeks, so the inbox isn't a weekly mood ticker; a
room only going Tight from Settled is the report's to tell. A week with nothing to say adds nothing.

### 4.4 Not shown

- Other clubs' rooms (the fog of war). SNN may cover them in a later part.
- Any weight, threshold, tone or score.
- Nothing new on the player card.

## 5. AI clubs

Same rules for every club. In L1 no AI decision reads standing or a unit's read. Valuing a leader in a trade or
cutting a stirrer comes later, if at all.

## 6. How it reads

The owner's ask for this arc: every reaction and every piece of feedback must read naturally and be worth a GM's
time. This section is the contract for every line L1 adds, and L2–L4 inherit it.

### 6.1 House rules already in force

- **The sim makes the facts; the writing says what they mean.** Every sentence is chosen by a condition on what our
  staff can see, so a letter is reproducible (CLAUDE.md, prose rules).
- **`say()` picks the line** (`voice.ts`): the most specific line that fits wins, ties break on a stable hash, and a
  line the sender used in his last five letters steps aside.
- **Salience before variety:** a line that names the benching behind a split beats three ways of saying "they don't
  get along". Vary the parts a GM reads every time (the verdict, the section openers); keep the rows plain and
  scannable.
- **No numbers for hidden traits, no game jargon.** Never promise what the engine doesn't do. Never NFL nicknames or
  real people's words.
- **The room's business stays in the room.** Captains are the room's call.

### 6.2 New rules for the room

1. **A judgment comes with the fact behind it.** Not "Mack is a voice in the room" but "Mack's been here six years
   and starts. The young receivers listen to him." Each standing line names the biggest part of his weight: years,
   starting, the C, an honour, or his makeup.
2. **Name the man, then the room.** Rooms don't feel things; men do. A unit line names who is setting the tone or who
   is down: "The secondary's split. Ward and Pope want Ellis's snaps, and Ellis knows it." Use a group noun only when
   it's most of the unit.
3. **Say why in the player's terms.** The unit's note reads off its most-felt reasons and says them the way a coach
   would: the role reason becomes "want more snaps", the contract reason "think they're underpaid", the team reason
   "the losing", the room reason "a feud". Never the factor's name.
4. **Count like a coach.** Up to four in words ("two of them", "three of the young guys"). Past that, "half the
   line", "most of the secondary", "the whole room". Unit and standing lines carry no digits.
5. **Only what changed, unless it matters.** A unit is told when its read turned, or when it's Split or Down. A
   steady room gets one line, not seven.
6. **"Still" is a fact.** A read told last time and still true says so: "The receivers are still split."
7. **Claim only what the engine does.** In L1 a voice's mood rubs off, so a coach may say "it's rubbing off" or "the
   room follows his lead". He never says a split unit is costing us on Sunday: there is no such hook until L3, and
   that line opens then. G2's existing "costing" lines stay the only claims about the field.
8. **The coach never claims an action the game didn't take.** No "I talked to him", no "we held a meeting", until L2
   lets you call one. When he suggests something, it's something you can actually do today: the depth chart, a
   mentor, answering a player's letter.
9. **Each sender keeps his lane.** The head coach writes about the whole room: short and dry, a verdict and a few
   rows, his motto at most once. A position coach writes about his own unit only, in the first person ("my guys"),
   specific and a little protective of his players. The director never comments on the room; he reads character
   before you sign, as he does now. Players don't write about the room in L1.
10. **Plain football words.** No term from this spec reaches a screen or a letter:

| Never on screen | Say instead |
| --- | --- |
| standing, weight, influence, tier, hierarchy | "the room goes to him", "his word carries", "one of the voices in that room" |
| faction, clique, cohesion | "the vets", "the young guys", "the line", "a tight group", "split" |
| contagion, spread, a score of any kind | "it's rubbing off", "the room follows his lead", "he's dragging them down" ("sets the tone" is fine: it's how coaches talk) |
| atmosphere, gauge, chemistry score | "the room's in a good place", "quiet room", "the room's tense" |
| morale level, step | the seven mood words already in use |
| a trait as a number or a z-score | personality names and `characterLine` |

### 6.3 Sample lines

Illustrative; the banks are written in the implementation. Each line shows the facts it needs. A unit that is
**Split**, most specific first:

| Reads | Facts it needs | Line |
| --- | --- | --- |
| 4 | split · cause: snaps · the tone-setter on the down side stirs · the up side is mostly young guys | "The receivers are split. Mack thinks Hill took his job, and he isn't keeping it to himself. Hill's got the younger guys." |
| 3 | split · cause: snaps · a named voice who stirs | "The receivers are split, and Mack's doing the talking. It's about snaps." |
| 2 | split · a named voice on the down side | "The receivers are split. Mack's on one side of it." |
| 1 | split | "The receivers are split. I'm keeping an eye on it." |
| 1 | still split | "The receivers are still split. Same reason as last time." |

**Tight:**

- A captain sets the tone: "The line's a tight group. That's Okafor. They'd follow him anywhere."
- Tight through a losing run of three or more: "Three losses in a row and the line hasn't blinked. Okafor won't let
  it."
- Turned Tight since the last report: "The secondary came together this month. Nobody planned it."

**Down:**

- The losing, with the vets and the young guys apart: "The defense is down. Losing does that. The vets have been
  here before; the young guys haven't."
- A steady voice pulling up in a Down unit: "The linebackers are down, but Reyes is holding them together."

**No voice:**

- A leader left since the last report: "Nobody's taken charge of the secondary since Cole left."
- A man close to the voice line: "No one in the secondary has the room yet. Pope might, give him another year."

**Standing changes** (rows in "Who the room follows"):

- Became a voice in his second season: "Second year, starting, and the receivers listen. That came quicker than I
  expected."
- A newcomer who's already a leader: "Eight years in the league. He walked in and the line made room for him."
- Lost his voice after a benching: "Since the benching, Mack's not the voice he was."
- A voice who stirs, new to the tier: "Mack's got a following now. Not all of it's good."

**The verdict** (the first line of the report):

- "Good room. The line's as tight as I've seen it."
- "Mostly fine. The receivers are the exception."
- "Two units pulling different ways. The defense is fine; the receivers aren't."

**Position coaches** (weekly staff notes, first person):

- Split, with friends of the stirrer on his side: "My room's split. Hill's got the job and Mack doesn't think he
  earned it. Two of the others are with Mack."
- Tight, a captain in the unit: "Good week in the line room. Okafor's got them right."
- Still down, a steady voice: "The secondary's still down. Reyes is the one keeping them together."

### 6.4 What the tests check

- **No banned words:** every bank's output, over a set of generated leagues, contains none of the "never" column.
- **No digits** in unit or standing lines.
- **Only what the staff can see:** each bank's fact type holds words and our staff's read (from `moraleView`,
  `personalityRead`, the unit's read), never a `Player` or a rating, so a line can't reach the truth.
- **Reproducible:** building the same report twice gives the same text.
- **No empty slots:** every fact combination that reaches a report finds a line (each bank has a fallback that reads
  0).
- **Read by eye:** `npm run mail-preview` and `npm run screens -- --mail locker` shoot the reports and staff notes at
  each check-in, and the owner reads a sample before merge.

## 7. Data

Nothing stored. Worked out on the spot:

- `standing.ts`, new: `weightOf`, `standingOf(league, p, ctx?)` returning the tier (`'leader' | 'voice' | null`),
  the voice (`'stirs' | 'steadies' | null`) and the parts of his weight for the screen's reason; `UNITS`, `unitOf`,
  `unitRead`; `leadersOf` moves here.
- `MoraleContext` gains each club's voices by unit (weight and loudness) and each side's captain, for tone.
- `covered` keys, stamped with morale's clock (`moraleClock`, which only moves forward) so the report and the staff
  notes read one memory, naming the club so a GM hired across the league starts fresh:
  `standing:{clock}:{teamId}:{playerId}:{tier}` for every leader and voice at each report (and the place a man off
  the 53 had), and `unit:{clock}:{teamId}:{unit}:{read}` for every read unit at each report and for each unit a staff
  note tells.

## 8. Checks

`npm run morale` (four seasons), extended:

- **Standing per club, in season:** leaders (captains included) 3–6 on average; voices 6–12; no leader past the
  captains in 10–30% of club-weeks.
- **Unit reads league-wide:** Split 5–15% of unit-weeks, Down 5–20%, Tight 15–35%.
- **Room moods cluster but don't run away:** club rooms at Poor or worse in at most 25% of club-weeks. (Proposed
  0–25%, pending the owner: the first draft's 5% floor was a guess, and played leagues sit at 2%.)
- **Direction checks, like against like:** the unit-mates of a down voice who stirs have a lower room factor than the
  unit-mates of a down voice who is even, and the unit-mates of a down voice who steadies a higher one (✗ if not).
- **The mechanic's size:** the average size of the voices' pull on a player's room factor sits at 0.05–0.4, so it
  does something without running the room.
- **Existing checks hold:** band shares, underpaid final-year starters, a benching's dip and recovery, winning rooms
  happier than losing ones, no drift, no level out of range.

`npm run careers`: mood tilts young players' growth, so nothing may be flagged ▲/▼.

Unit tests:

- `standing.test.ts`: weight rises with each of its parts; captains are always leaders; a rookie is never a leader
  unless he's a captain; stirs and steadies never both hold.
- `morale.test.ts`: tone is zero for a unit with no voices, and bounded.
- `lockerVoice.test.ts`: the §6.4 rules.
- `ui.test.ts`: the screen contract for the new section.

`npm run sim` isn't needed for L1: the game-day edge reads each player's pull against the league's mean, so totals
hold. CI's planner decides what runs on the pull request in any case.

## 9. Files

| File | Change |
| --- | --- |
| `src/engine/standing.ts` | new: weight, tiers, how a voice sounds, units, a unit's read, `leadersOf` |
| `src/engine/standing.test.ts` | new |
| `src/engine/morale.ts` | tone in `roomScore`; voices and captains in `moraleContext`; the room's mood weighted |
| `src/engine/personality.ts` | `nameCaptains` rates by weight; `leadersOf` moves out |
| `src/engine/roomFacts.ts` | new: the facts a line reads (a unit's, a standing change's, a leader's reason), built from our club only |
| `src/engine/roomVoice.ts` | new: the banks for unit reads, standing changes, a leader's reason and the position coach's note |
| `src/engine/lockerVoice.ts` | the verdict's room-shape facts and lines |
| `src/engine/lockerReport.ts` | "The room" section, standing rows, verdict facts |
| `src/engine/staffNotes.ts` | the position coach's unit note |
| `src/ui/screens/LockerRoom.tsx` | "Who the room follows", "The units" |
| `scripts/morale.ts` | the §8 checks |
| `src/ui/changelog.ts`, `package.json` | the version bump and its entry |

## 10. Version

L1 doesn't finish an MVP item, so it's a patch bump with a changelog entry. Whether the locker room arc gets its own
line in `docs/MVP.md` is the owner's call.

## 11. Out of scope (later parts)

- **L2:** team meetings; draft classes and circles of friends as groups (they get a job there).
- **L3:** any effect on the field; time playing together.
- **L4:** the room's backing for the staff; the lawyer after a bad loss; players' relationships with the
  coordinators.
- Other clubs' rooms on screen or on SNN.
- AI decisions that read standing.
