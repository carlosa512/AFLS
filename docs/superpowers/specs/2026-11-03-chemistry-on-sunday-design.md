# Locker room, part 3: chemistry on Sunday (L3)

Date: 2026-11-03 · Branch: `claude/bold-fermat-4pxknq` · Third of four parts (L1–L4) from the owner's locker-room
brainstorm. Follows L1 (`2026-11-01-locker-room-voices-design.md`: leaders, voices, rooms and their reads) and L2
(`2026-11-02-team-meetings-design.md`: meetings and a coach's credibility).

## Why

L1 shows who runs a room and how it feels; L2 lets a coach (and you) do something about it. Neither touches the field.
L3 closes the loop: a room's mood and its time together show up a little on Sunday, and the men a room listens to
lift it or drag it. The goal is a reason to care about who sets the tone and to keep a good line together, felt over a
season rather than in any one game, with league totals held exactly.

## Decisions (agreed in the brainstorm)

1. **Subtle: up to ±0.3 rating points** for a room at its best or worst (ratings run 1–20). For scale, a player's own
   mood is worth up to ±0.5 on game day (`MOOD_EDGE`) and a team's day about ±0.35 (`DAY_SD`).
2. **Two parts.** The room's **mood** counts for every room. **Time together** counts only where football says it
   does: the offensive line (protection calls), the quarterback with his receivers (timing) and the secondary
   (communication).
3. **A voice rubs off, both ways** (L1 §2.1 comes back here). A man whose mood spreads, good or bad, is a **Spark**; a
   man who keeps a room calm is an **Anchor**. Close friends pull a little too.
4. **Plain names.** Spark and Anchor for the voices; **Clicking, Gelling, Still learning each other, Out of sync** for a
   room's chemistry. "Chemistry" itself stays a design word: letters never use it (L1 §6.2's banned list).
5. **One knock per room in the lineup** (approach A). Chemistry joins the knocks `buildLineup` already applies (a
   man's mood edge, the team's day, rust, playing out of position), so it reaches every contest through `skill()`
   with no change to `gameSim.ts`. Hooks on specific plays (approach B) and a team-wide nudge (approach C) were
   weighed and set aside.
6. **You see it, your club only, in words:** a line on each Locker Room card, Spark and Anchor tags beside names, and
   the head coach's locker report when a room's chemistry changes.
7. **Nothing new is stored** and nothing is drawn from any stream.

## 1. Chemistry

A new module, `src/engine/chemistry.ts`, gives each room of each club one number for a game: its **edge**, in rating
points, never past ±0.3 (`CHEM.cap`). It has two parts.

### 1.1 Mood (every room), up to ±0.2

- The room's mood is L1's weighted mean (`unitRead`: the voices count more). `UnitRead` gains that mean as `level`.
- The mood part is `CHEM.mood × clamp((level − mean) / ROOM_SPAN, −1, 1)`, where `mean` is the league's mood
  (`moraleMean`) and `ROOM_SPAN` is set so a room that reads Tight lands near +0.15 and one that reads Down near
  −0.15. A room's mean runs far narrower than a man's mood (L1 §2.2), so it can't use `moodPull`'s ±6 span.
- **A divided room** (`Split`) takes another 0.05 off, inside the mood part's ±0.2: half happy and half sour plays
  worse than its average says.
- A room with no read (fewer than `READ_MIN` men, the specialists) has no mood part.

### 1.2 Time together (three rooms), up to ±0.15

- **Pairs, from what's already kept.** Two men's seasons together at a club are the past seasons both played for it
  (`Player.statTeams[season]` holds the club for both), plus this season in part: the weeks played so far over 18,
  when both have played for it this season. A pair counts at most three seasons: gains flatten after that.
- **Who:**
  - **The offensive line:** every pair among its five starters on the depth chart.
  - **The secondary:** every pair among its starting corners and safeties.
  - **The passing game:** the starting quarterback with each of his top three targets (the first two receivers and the
    first tight end). It counts for both the quarterback room and the receivers' room.
- The room's time together is the mean of its pairs. The part is `CHEM.together × clamp(years − typical, −1, 1)`, with
  `typical` the league's mean for that room this week: a unit a full season more together than the league's typical
  one gets the whole part, and a typical unit reads zero.

### 1.3 The edge

- `edge = clamp(mood + together, −CHEM.cap, CHEM.cap)`, then **centred each week**: each room's edge less the league's
  mean for that room that week. The league's totals hold exactly, whatever the league's moods or histories.
- Worked out once a week for every club (`chemistryWeek`, cached by the morale clock) and read by `buildLineup`. Every
  man the lineup sends out from a room (`unitOf(position)` of his own position) gets that room's edge with his other
  knocks. A man filling in from another room plays with his own room's edge.
- It applies to every club alike, from true moods and history. AI front offices don't weigh it (§6).

### 1.4 The word

| Word | When |
|---|---|
| **Clicking** | the edge is +0.15 or better |
| **Out of sync** | −0.15 or worse |
| **Still learning each other** | in between, in a time-together room whose time part is −0.05 or worse |
| **Gelling** | in between, otherwise |

The bands are checked in `npm run morale` (§4.1) and moved there, with the owner's say, if the shares miss.

## 2. Sparks and Anchors

### 2.1 Who

Only the men L1 marks as leaders or voices (`tierOf`; captains included), by how they sound (`soundOf`, unchanged):

| L1's sound (internal) | Plain name | What it does |
|---|---|---|
| `stirs` | **Spark** | His mood spreads, good or bad. |
| `steadies` | **Anchor** | He keeps the room calm. |
| none | (no tag) | A plain voice: his mood counts, quietly. |

### 2.2 The pull

In the weekly mood target, `roomScore` in `morale.ts` gains two terms:

- **The room's voices.** Each voice's mood is read as a pull against the league (`moodPull(level, moraleMean)`, so the
  league can't drift with its voices) and averaged with weights: a Spark 1, an Anchor 0.5, a plain voice 0.5. An
  Anchor in the room halves every Spark's weight there. A man is never pulled by himself. The term is worth at most
  `TONE.voices` = 0.75 in the room score, as much as being a captain.
- **Close friends.** A friend on the club (`Player.ties`) pulls by his own mood the same way, worth at most
  `TONE.friends` = 0.25.
- Both sit inside `roomScore`'s existing ±1.5 clamp, and the level still moves only part of the way to its target each
  week. The voices are read as they stood when the step began (one snapshot in `MoraleContext`), so they can't feed on
  each other within a step. Nothing is drawn; it runs in `moraleWeek` and `moraleStep` like the rest of mood.

### 2.3 Why it's safe

This is the piece L1 first built and then took out because it moved play through the game-day mood edge (four checks
sit near an edge on main). It still moves play, but only through moods: a man's own edge and his room's chemistry,
both measured against the league. Its checks are in §4.1.

## 3. What you see (your club only, in words)

### 3.1 The Locker Room

- **Each room card** gets a chemistry line under its mood: the word and the biggest reason, from what the room shows.
  Examples: "Clicking · three years together", "Gelling", "Still learning each other · two new starters", "Out of
  sync · divided room", "Out of sync · Mitchell's sour", "Gelling · Okafor's holding them together".
- **Spark and Anchor tags** beside the names under "Who they follow". (The player card shows no standing today;
  adding it there is out of scope.)
- A year count is spelled out ("three years together"). The ±0.3 number never shows.

### 3.2 The head coach's words

- His locker report (its four check-ins, `lockerReport.ts`) mentions a room when its chemistry word has changed since
  he last told it, once, like L1's room reads (a clock-stamped, club-named `chem:` key in what the report remembers).
  Examples: "The line's clicking. Three years together shows." "Mitchell's sour, and he's a spark. The D-line's
  feeling it." "The secondary is still learning each other. Two new starters back there."
- L1's writing rules carry over (§6.2 there): no digits, no engine words ("chemistry" among them), a judgment with its
  fact, and only what the engine does. The words live in `roomVoice.ts` beside L1's.

### 3.3 Not shown

Other clubs' chemistry, Sparks or Anchors; the number; anything in the opposition report.

## 4. Balance, checks and data

### 4.1 Checks

- **`npm run morale` gains an L3 part:**
  - Chemistry is centred: the league's mean edge, every room and every week, within ±0.02 (by construction; the check
    guards the cache).
  - **Clicking** and **Out of sync** are each 10–30% of rooms with a read, over the season.
  - Sparks lean the right way: rooms whose Spark reads Poor or worse sit lower than rooms whose Spark reads Good or
    better.
  - Anchors calm: the spread of moods in rooms with an Anchor is narrower than in rooms with only Sparks.
  - The existing band shares, no-drift and club-rooms lines still hold.
- **A unit test** (`chemistry.test.ts`) replays the same games with one room's edge forced to +0.3 and to −0.3, and
  checks it moves that room's own stats the right way: the line (sacks allowed, yards per carry), the secondary (yards
  per pass against), the quarterback and receivers (completion rate).
- **The checks a lineup change calls for** stay green: the sim (60 seasons in CI) and the others the planner picks.
  The pull reshuffles moods and so every game, as captains did in L2; anything near an edge is measured against main
  and brought to the owner, never loosened without his call.

### 4.2 Cost and data

- Nothing stored: no `SAVE_VERSION` bump, no save-size allowance.
- `chemistryWeek` runs once per club a week and is cached; time together reads a handful of starters' `statTeams`.
  The aim is sim speed within about 5% of main.

## 5. Pull requests

1. **The engine:** `chemistry.ts`, the knock in `buildLineup`, the Sparks' and Anchors' pull, `UnitRead.level`, the
   checks and the replay test. A patch bump.
2. **The words and screens:** the Locker Room line and tags, the coach's report lines, with
   screenshots shown to the owner before the PR opens. A patch bump.

## 6. Out of scope

- AI front offices weighing chemistry in trades, free agency or the draft.
- Opponents' chemistry or time together in the opposition report.
- Hooks on specific plays (approach B).
- L4: the room's backing for the staff, the lawyer after a bad loss, players' relationships with the coordinators.

## 7. Files (expected)

| File | What |
|---|---|
| `src/engine/chemistry.ts` (new) | `chemistryWeek`, a room's edge and word, time together |
| `src/engine/chemistry.test.ts` (new) | the parts, the word, centring, the replay test |
| `src/engine/standing.ts` | `UnitRead.level`; Spark and Anchor names for `Sound` |
| `src/engine/morale.ts` | the voices' and friends' pull in `roomScore`; the snapshot in `MoraleContext` |
| `src/engine/match/lineup.ts` | the room's edge in the knocks |
| `scripts/morale.ts` | the §4.1 checks |
| `src/engine/roomVoice.ts`, `roomFacts.ts`, `lockerReport.ts` | PR 2: the coach's lines |
| `src/ui/screens/LockerRoom.tsx` | PR 2: the card line and tags |
| `CLAUDE.md`, `docs/MVP.md`, `src/ui/changelog.ts`, `package.json` | notes, the MVP line, the version |
