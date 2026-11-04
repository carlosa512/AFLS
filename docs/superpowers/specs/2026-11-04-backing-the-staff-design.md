# Locker room, part 4: backing the staff (L4)

Date: 2026-11-04 · Branch: `claude/bold-fermat-4pxknq` · Last of four parts (L1–L4) from the owner's locker-room
brainstorm. Follows L1 (`2026-11-01-locker-room-voices-design.md`: leaders, voices, rooms and their reads), L2
(`2026-11-02-team-meetings-design.md`: meetings and a head coach's credibility) and L3
(`2026-11-03-chemistry-on-sunday-design.md`: a room's mood and time together on Sunday).

## Why

L1's arc ends here: whether the room believes in the coordinators, a Locker-Room Lawyer stirring doubt after losses,
you answering it in a meeting, a room that has lost faith playing worse, and the inbox warning you first.

It also finishes MVP item #11, "Coaches (HC, OC, DC) whose ratings affect results", the last item short of alpha. Today
coaches' ratings drive development and aging, and only the special teams coordinator has a game-day edge
(`specialTeamsEdge`). L4 gives the head coach and both coordinators one, and ties it to whether their rooms believe in
them: a great hire helps only as far as his rooms follow him.

## Decisions (agreed in the brainstorm)

1. **Rating with belief, one system.** A coordinator's quality lifts his side on Sunday, and his rooms' belief in him
   decides how much of it reaches the field. A great coordinator whose rooms have lost faith gets little out of it; a
   room that has lost faith plays worse. This closes MVP #11.
2. **Up to ±0.5 rating points** for a coordinator's rooms (ratings run 1–20): about a man's own mood (`MOOD_EDGE`),
   more than chemistry (±0.3).
3. **The head coach counts on both sides,** up to ±0.25, through his word with the room (L2's credibility).
4. **Doubt comes from losing, louder with a lawyer.** Bad games on his side of the ball and losing streaks wear belief
   down; a Locker-Room Lawyer who's a voice in the room makes a bad game's drop far bigger; winning and meetings that
   land bring it back.
5. **You answer it in a meeting,** through L2's letter and three calls, with two new choices: "Stand behind him" and
   "He's on notice".
6. **Coordinators can be relieved mid-season,** by you and by AI clubs, as NFL clubs do (coaching moves are
   window-only today). The head coach covers his side, or a position coach steps up as interim; the real hire waits
   for the window. AI clubs do it about as often as the NFL's, and SNN reports it.
7. **Belief is stored per room,** on the coordinator, like a head coach's credibility: doubt builds and lingers, so a
   lawyer and a meeting both matter. (Worked out from moods each week, it would only be mood again; as a part of each
   man's mood, it would leak into every morale check.)
8. **You see it, your club only, in words:** a staff note warns first, then the head coach's meeting letter and
   report; a line on the Locker Room cards and on the Coaches screen. Never a number.

## 1. What coaches add on Sunday

A new module, `src/engine/staffEdge.ts`, gives each room of each club its staff edge for a game, in rating points.

### 1.1 Quality

- A coach's quality is `q = clamp((coachValue(c) − TYPICAL) / STAFF.span, −1, 1)`, with `TYPICAL` = 10.5 and
  `STAFF.span` = 3. It is the number his ask, AI hiring and the special teams edge already read (`coachRatings.ts`).
- In four new leagues, head coaches and coordinators average about 10.4 with a sd of 2; the top 5% sit near 13
  (`q` ≈ +0.8) and the bottom 5% near 7 (`q` ≈ −1). An empty chair coaches like a replacement (`VACANT` = 6, `q` = −1).

### 1.2 The edges

- **A coordinator, for each room he runs** (the offensive coordinator: QB, RB, WR, OL; the defensive coordinator: DL,
  LB, DB; `sideOf`): `STAFF.coord × clamp(STAFF.quality × q + STAFF.belief × belief, −1, 1)`, with `STAFF.coord` =
  0.5, `STAFF.quality` = 0.6 and `STAFF.belief` = 0.4. `belief` is that room's belief in him (§2).
- **Who that is:** whoever runs the side (`sideCoach`): the coordinator, or the head coach covering an empty chair,
  read as development already reads him there (his value less `COVER_COST` = 3, never below `VACANT`). An empty chair
  with the cover switched off reads `VACANT` and a belief of 0.
- **The head coach, for every room on offense and defense:** `STAFF.head × clamp(STAFF.quality × q +
  STAFF.belief × credibility, −1, 1)`, with `STAFF.head` = 0.25 and `credibility` his L2 word with the room
  (`credibilityOf`). An empty chair reads `VACANT` and 0.
- **Special teams** keeps `specialTeamsEdge`, unchanged; the head coach's edge doesn't reach the kick units.
- Why the two parts add rather than multiply: a pure product would make a doubted bad coordinator a plus. With the
  parts added inside one cap, a great coordinator his rooms believe in gives +0.5, a great one they doubt about +0.1, a
  typical one they doubt −0.2 and a bad one they doubt −0.5.

### 1.3 Centred, and on the field

- **Centred each week:** each room's staff edge (coordinator plus head coach) less the league's mean for that room
  that week, then held to ±(`STAFF.coord` + `STAFF.head`). The league's totals hold whatever its coaches and beliefs.
- Worked out once a week for every club and cached like chemistry's read (keyed on the week and the morale clock,
  dropped wherever `freshChemistry` drops chemistry's).
- **One knock per room in `buildLineup`,** beside chemistry: every man sent out from a room gets that room's staff
  edge with his other knocks, through `skill()`, with no change to `gameSim.ts`. `SimOptions.staff` overrides it and
  `NO_STAFF` holds it at zero for tests that read something else, as `NO_CHEM` does.
- A man's best or worst case, everything lined up: chemistry 0.3, staff 0.75. That is rare; the sim's win spread is
  the guard (§5).
- AI front offices already hire on `coachValue`. Nothing about their hiring changes.

## 2. Belief

A new module, `src/engine/belief.ts`: each room's belief in its coordinator, how it moves, and its words.

### 2.1 Stored

- `Coach.belief?: Partial<Record<CoachRoom, number>>` on whoever runs a side (`sideCoach`): a coordinator, or a head
  coach covering an empty coordinator chair. Each −1…1, rounded like credibility. Unset reads 0.
- A man taking a side (a coordinator hired, promoted or moved by the carousel, an interim stepping up, a head coach
  starting to cover) starts its rooms at 0 (`startCoordinator`, beside `startHeadCoach`); a head coach's cover ending
  drops his. Replacing a man his rooms have lost clears the doubt.
- At the new league year every room's belief moves halfway back to 0: a new season is a fresh start, not a clean one.

### 2.2 Each week

Run in `playWeek` beside `credibilityWeek`, for every club's coordinators, from the game just played (regular season
and playoffs). Nothing is drawn.

| What | Change to each of his rooms | Starting value |
|---|---|---|
| Drift toward the middle | belief × `BELIEF.drift` | 0.975 |
| A bad game on his side | `BELIEF.badGame` | −0.02 (tuned from −0.06) |
| A good game on his side | `BELIEF.goodGame` (half a bad game's) | +0.01 (tuned from +0.03) |
| Each week of a losing streak of three or more | `BELIEF.loseStreak` | −0.02 (tuned from −0.04) |
| Each week of a winning streak of three or more | `BELIEF.winStreak` | +0.01 (tuned from +0.02) |

- **A bad game:** for the offense, a loss scoring 13 or fewer; for the defense, a loss allowing 30 or more; a loss by
  21 or more is a bad game for both sides.
- **A good game:** for the offense, a win scoring 28 or more; for the defense, a win allowing 14 or fewer.
- Losing hurts more than winning heals, as with credibility.

### 2.3 The lawyer

- A **Locker-Room Lawyer** (`personality.ts`, read from true traits) who is a leader or voice in a room (`tierOf`)
  makes that room's bad-game drop `BELIEF.lawyer` = 3 times as big. If his own mood reads Poor or worse, half again
  (`BELIEF.sour` = 1.5). Streaks and good games are untouched: he stirs doubt after a loss, he doesn't stop a room
  enjoying a win.
- One lawyer counts per room (the loudest, by weight). He is the room's **driver** for the meeting and the words.

### 2.4 Meetings

- Any L2 meeting with a room moves its belief in its coordinator by how it was taken: `BELIEF.lands` = +0.04 times
  the share of the room's weight that took it well, less `BELIEF.bristles` = 0.08 times the share that bristled. A team
  meeting counts for every room, each by how its own men took it. "Stand behind him" (§3) doubles both.
- A kept or broken "He's on notice" moves it too (§3.3).

### 2.5 Words

The same thresholds as credibility:

| Belief | Read | Words |
|---|---|---|
| 0.4 or more | `believes` | "They believe in him" |
| in between | `steady` | nothing said |
| −0.2 or less | `doubts` | "Doubts about his calls" |
| −0.5 or less | `lost` | "He's lost them" |

The starting values above are tuned in `npm run morale` (§5.1) toward 10–25% of rooms reading `doubts` or worse at
some point in a season and `lost` at 8% or fewer, and moved there, with the owner's say, if the shares miss.

## 3. Answering doubt in a meeting

Through L2 (`meetings/`), with no new letter or screen of its own.

### 3.1 The trouble

- A room's belief crossing into `doubts` is trouble (`troubles` in `suggest.ts`): the head coach suggests a meeting
  with that room under L2's cooldowns. `lost` ranks with a room reading Down; `doubts` after Down and before Split.
  A room that stays in doubt was already told; it is trouble again only after it has climbed out and fallen back.
- The room's lawyer, if it has one, is the meeting's driver (`Trouble.driver`), so the letter can name him.
- `Trouble.topic` gains `'coordinator'`.

### 3.2 "Stand behind him" (how to say it)

- A new `Approach`, `'backHim'`, offered only for a coordinator trouble: the head coach tells the room he backs his
  coordinator.
- How each man takes it (`react.ts`'s score) leans on the room's doubt and the man: it fits a fresh doubt (`doubts`)
  under a good coordinator (`q` ≥ 0); it fits worse once he's `lost` them or under a poor one; the lawyer himself is
  more likely to bristle. Its belief effect is doubled (§2.4).
- The approaches that already fit stay on offer: "Say it straight", "Call him out" (the lawyer, when he drives it) and
  a leader saying it when there is one besides the lawyer.

### 3.3 "He's on notice" (what's behind it)

- A new `Backing`, `'notice'`: a promise to the room that things change, with a four-week window. The commitment
  keeps the coordinator it's about (`Commitment.coord`, his coach id).
- **Kept** (`isKept`): the room's belief climbs back out of doubt (`steady` or better), or the man is gone from his
  chair (relieved mid-season, §3.4, or replaced in the window). L2's `settle` then gives the room its kept lift and
  the head coach his word's gain, and the room's belief rises by `BELIEF.kept` = +0.15.
- **Broken:** the window closes with the room still in doubt and the same man in the chair. L2's broken dip and the
  head coach's word's loss, and the room's belief falls by `BELIEF.broken` = −0.15.
- AI clubs choose "Stand behind him" and "He's on notice" by their GM's tendencies (`meetings/ai.ts`). At the
  window's end an unkept notice is settled the way they settle every promise, by their GM's tendencies; when that
  says kept, they keep it for real by relieving the man (§3.5), unless an owner's mandate protects him (then it's
  broken).
- "Nothing, just words" stays on offer. You can still ask for a meeting yourself from the Locker Room.

### 3.4 Relieving a coordinator mid-season

Coaching moves are open only in the re-sign window and free agency today (`staffWindowOpen`). L4 adds one move outside
it, so "He's on notice" can be kept the way NFL clubs keep it.

- **`relieveCoordinator`** (`coaching.ts`): your offensive or defensive coordinator, from camp through the regular
  season (`preseason`, `regular`). Not in the playoffs, and not your head coach (his job is the owner's call,
  `leadership.ts`).
- **The same limits as any dismissal:** an owner's mandate blocks it (`ownerCoachProblem`), and it books his severance
  (`dismiss`, half a year's salary while he's under contract). He goes to the market.
- **Who runs the side for the rest of the season:**
  - **By default, the head coach covers it,** as he already does for an empty chair (`coveringHeadCoach`), at his
    value less `COVER_COST` for that side.
  - **Or you name an interim:** one of your position coaches on that side steps up (`promoteInto`, opened in season for
    this one case; his say, `refusal`, and the rule that he's had a season in a chair still apply). His own room's
    chair stays empty until the window.
  - Whoever takes the side starts its rooms at 0 belief (§2.1).
- **Hires from outside wait for the window,** as today. There you can keep the interim, promote someone or hire.
- The transaction log reads "relieved … of his duties", and the change is a leadership event (§3.5) so SNN reports
  it.

### 3.5 AI clubs relieve coordinators too

NFL clubs let a coordinator go in season about once or twice a year league-wide, nearly always a losing club whose
side of the ball is among the league's worst (the Colts' offensive coordinator in 2022; the Commanders' defensive
coordinator and the Steelers' offensive coordinator in 2023; the Bears' offensive coordinator in 2024). The plan
gathers the recent seasons' list before tuning, and the band in §5.1 is set from it with the owner's say.

- **Weekly, for AI clubs** (`aiRelieve`, run after belief's step), weeks 5 through 14 of the regular season. It uses
  the same move as you do (`relieveCoordinator`), with the same limits.
- **On the table only when all three hold:**
  - the club is losing: five games played or more, and a win share of .400 or worse;
  - his side is among the league's worst this season: the offense's points a game (for the offensive coordinator) or
    the points it allows (for the defensive one) in the league's bottom quarter;
  - his rooms have turned on him: most of them read `doubts` or worse, or a notice about him was broken.
- **Then a draw** on its own stream (`${seed}:relieve:${season}:${week}:${teamId}`), each week it stays on the table:
  `RELIEVE.chance` = 0.08 a week (tuned from 0.15), raised by the GM's win-now and the heat on the head coach (a head coach on
  the hot seat gives up a coordinator before he goes himself, `heatSoFar`), lowered by the GM's loyalty.
- **At most one coordinator a club a season,** and none once the owner has let the head coach go this season (the
  interim makes his own staff).
- **Who takes the side:** the better of the head coach covering (his value less `COVER_COST`) and the best position
  coach on that side who'd take it. Its rooms start at 0 belief.
- **The news:** a new leadership event, `'coordRelieved'` (`LeadershipEvent.kind`), so SNN's in-season roundup
  (`leadershipMail`) carries it with the owners' changes: "PIT relieved offensive coordinator … of his duties." Public
  words only: the record and the side's ranking, never belief.
- The relieved man goes to the market, available to every club in the window.

#### The NFL's list (gathered for the plan, 2015–2024)

In-season coordinator firings where the head coach stayed, from news reports. A lower bound: no source lists them all,
and 2019–2020 found none verified (likely gaps). "≈" marks a date or record from a snippet, not yet checked.

| Season | Club | Role | Coach | When | Record then |
|---|---|---|---|---|---|
| 2015 | Lions | OC | Joe Lombardi | ≈ Nov 2 | ≈ 1–6 |
| 2015 | Dolphins | OC | Bill Lazor | ≈ fall | ≈ |
| 2016 | Bills | OC | Greg Roman | Sep 16 | 0–2 |
| 2016 | Jaguars | OC | Greg Olson | ≈ early Nov | 2–5 |
| 2016 | Ravens | OC | Marc Trestman | in season | ≈ |
| 2017 | Bengals | OC | Ken Zampese | ≈ late Sep | ≈ 0–2 |
| 2018 | Cardinals | OC | Mike McCoy | Oct 19 | ≈ 1–6 |
| 2018 | Buccaneers | DC | Mike Smith | ≈ Oct | ≈ |
| 2018 | Bengals | DC | Teryl Austin | Nov 12 | ≈ 5–4 |
| 2018 | Jaguars | OC | Nathaniel Hackett | Nov 26 | ≈ 3–8 |
| 2018 | Vikings | OC | John DeFilippo | ≈ Dec 10 | ≈ 6–5–1 |
| 2021 | Panthers | OC | Joe Brady | ≈ Nov 29 | ≈ 5–7 |
| 2022 | Colts | OC | Marcus Brady | Nov 1 | 3–4–1 |
| 2023 | Bills | OC | Ken Dorsey | Nov 14 | ≈ 5–5 |
| 2023 | Steelers | OC | Matt Canada | Nov 21 | 6–4 |
| 2023 | Commanders | DC | Jack Del Rio | Nov 24 | ≈ 4–8 |
| 2024 | Raiders | OC | Luke Getsy | ≈ Nov 5 | ≈ 2–7 |
| 2024 | Bears | OC | Shane Waldron | Nov 12 | 4–5 |

Per season 0–5, about 1.8 on average (18 in ten seasons); most are offensive coordinators, and several came at a club
near .500, not only a losing one. The check's band (§5.1) is a mean of 1–3 a season.

## 4. What you see (your club only, in words)

### 4.1 The warning first

- **The weekly staff notes** (`staffNotes.ts`) get a position coach's row when one of his rooms' belief falls past
  `BELIEF.warn` = −0.1 after a bad game: before doubt, and once for each fall (a clock-stamped, club-named `belief:`
  key, like L1's). The row names the lawyer when he did it. Examples: "Mitchell's been in the receivers' ears about the
  play-calling since Sunday." "The D-line's quieter in meetings with Harris. Nothing said yet."
- **At doubt:** the head coach's meeting letter (§3). His locker report (`lockerReport.ts`, its check-ins) tells a
  room's read of its coordinator when it has changed since he last told it, like L1's room reads. Examples: "The
  O-line has doubts about Harris's calls, and Mitchell's not helping." "Harris has lost the secondary."

### 4.2 The screens

- **The Locker Room card** gets a line under chemistry when there's something to say (`believes`, `doubts`, `lost`),
  with the biggest reason when there is one: "Believe in Harris", "Doubts about Harris's calls · Mitchell's stirring
  it", "Harris has lost them". The coordinator's name links to his card.
- **The Coaches screen** (your coordinators only) says how his rooms take him: "The O-line and receivers believe in
  him; the backs have doubts." Nothing when every room is `steady`.
- **"Relieve him"** on the Coaches screen beside each coordinator from camp through the regular season, with the
  choice of who runs the side (the head coach, or a position coach on that side) and the severance shown before you
  confirm, or the reason it can't be done (an owner's mandate).

### 4.3 The words

- L1's writing rules carry over (§6.2 there): no digits, no engine words ("belief" and "chemistry" among them), a
  judgment with its fact, and only what the engine does. The room's words live in `roomVoice.ts` and `roomFacts.ts`;
  the meeting's in `meetings/voice.ts` and `meetings/facts.ts`.

### 4.4 Not shown

Other clubs' belief; any number, a coach's game-day edge included; anything in the opposition report.

## 5. Balance, checks and data

### 5.1 Checks

- **`npm run morale` gains an L4 part:**
  - The staff edge is centred: the league's mean, every room and every week, within ±0.02.
  - Rooms reading `doubts` or worse at some point in a season: 10–25%. `lost`: 8% or fewer.
  - Rooms with a lawyer reach `doubts` more often than rooms without.
  - "He's on notice": kept and broken both happen, and neither is more than four in five.
  - AI clubs relieve coordinators in season at the NFL's rate (a mean of 1–3 a season league-wide, from the list in
    §3.5), every one of them a losing club whose side ranks in the bottom
    quarter, and no club more than once a season.
  - The existing L1–L3 lines still hold.
- **A unit test** (`staffEdge.test.ts`) replays the same games with one side's staff edge forced to +0.5 and to −0.5,
  and checks it moves that side's own stats the right way: the offense's points and yards, the defense's yards
  allowed. Others cover the edge's parts, centring, an empty chair, belief's weekly moves (`belief.test.ts`), the
  lawyer, the new meeting choices, and relieving a coordinator (only in camp and the regular season, blocked by an
  owner's mandate, severance booked, the head coach's cover or the interim taking the side at 0, a notice kept by it),
  and the AI's call (`aiRelieve`: off the table unless all three conditions hold, at most once a season, the better of
  cover and interim, the SNN event).
- **The sim** (60 seasons in CI): win spread and parity hold. Richer clubs hire better coaches, so the staff edge can
  widen the gap between good and bad teams; anything near an edge is measured against main and brought to the owner,
  never loosened without his call.
- **CI's planner** sends `staffEdge.ts` and `belief.ts` to the morale and sim checks; the other checks the planner
  picks for the files touched (`coaching.ts`, `meetings/`, `match/lineup.ts`) stay green.

### 5.2 Cost and data

- `Coach.belief`, `Commitment.coord` and the `'coordRelieved'` event are new: `SAVE_VERSION` 86, with a no-op step
  in `migrate.ts` (unset reads the middle). A few numbers per club.
- The staff edge is cached weekly like chemistry; belief's step reads one game and a room's voices per club. The aim
  is sim speed within about 5% of main.

## 6. Pull request and version

One PR on this branch in two parts, as L3 did: CI is tuned once against the final state. The held 0.3.10 fixes on
this branch ride along.

1. **The engine:** `staffEdge.ts`, `belief.ts`, the knock in `buildLineup`, the meeting choices,
   `relieveCoordinator`, the checks and the replay test. The calibration numbers go to the owner before part 2 starts.
2. **The words and screens:** the staff notes row, the head coach's report lines and meeting words, the Locker Room
   line, the Coaches screen line and "Relieve him", with screenshots shown to the owner before the PR opens.

**Version 0.4.0:** MVP #11 goes to Done, the last item short of alpha (`docs/VERSIONING.md`: the middle number).
`docs/MVP.md`'s #11 line and its score line move (the score line reads 13 Done · 2 Partial today, one behind: it
becomes 15 Done · 0 Partial), with a changelog entry and the CLAUDE.md notes.

## 7. Out of scope

- AI front offices weighing belief or a coach's game-day edge in hiring, firing or trades beyond what `coachValue`
  already drives.
- Relieving your head coach mid-season, or hiring from outside the club before the window.
- Belief in position coaches, the strength coach or the special teams coordinator.
- Other clubs' belief in the opposition report or SNN.
- A lawyer stirring doubt about the head coach himself (his word moves as L2 has it).
- Players' relationships with individual coaches beyond the rooms' belief (rapport in `relationships.ts` is unchanged).

## 8. Files (expected)

| File | What |
|---|---|
| `src/engine/staffEdge.ts` (new) | each room's staff edge: quality, the coordinator's and head coach's parts, centring |
| `src/engine/belief.ts` (new) | `Coach.belief`: its weekly step, the lawyer, meetings' and notices' moves, its words |
| `src/engine/staffEdge.test.ts`, `src/engine/belief.test.ts` (new) | the parts, centring, the replay test, the moves |
| `src/engine/types.ts` | `Coach.belief`, `Commitment.coord`, `'backHim'`, `'notice'`, the `'coordRelieved'` event |
| `src/engine/match/lineup.ts`, `match/gameSim.ts` (`SimOptions.staff`) | the room's staff edge in the knocks |
| `src/engine/league.ts` | belief's weekly step beside `credibilityWeek`, then `aiRelieve` |
| `src/engine/coaching.ts` | `startCoordinator` on taking a side; `relieveCoordinator`, `aiRelieve`; the new year's halving |
| `src/engine/leadership.ts`, `inbox.ts` | the `'coordRelieved'` event logged, and SNN's roundup line |
| `src/engine/meetings/suggest.ts`, `react.ts`, `commitments.ts`, `ai.ts` | the trouble, the two choices, the notice |
| `src/engine/generate.ts`, `migrate.ts` | `SAVE_VERSION` 86 and its step |
| `scripts/morale.ts`, the CI planner | the §5.1 checks; the new modules' triggers |
| `src/engine/staffNotes.ts`, `lockerReport.ts`, `roomVoice.ts`, `roomFacts.ts` | part 2: the warning and the report |
| `src/engine/meetings/voice.ts`, `meetings/facts.ts`, `ui/meetings.tsx` | part 2: the meeting's new words |
| `src/ui/screens/LockerRoom.tsx`, `src/ui/screens/Coaches.tsx` | part 2: the card line, the coordinator line, "Relieve him" |
| `CLAUDE.md`, `docs/MVP.md`, `src/ui/changelog.ts`, `package.json` | notes, #11 and the score line, the version |
