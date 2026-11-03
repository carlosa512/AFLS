# Locker room, part 2: team meetings (L2)

Date: 2026-11-02 · Branch: `claude/bold-fermat-4pxknq` · Second of four parts (L1–L4) from the owner's locker-room
brainstorm. Follows L1 (`2026-11-01-locker-room-voices-design.md`), which gave every club's room a shape: leaders and
voices, rooms and their reads.

## Why

L1 lets you see a room; nothing yet lets anyone do anything about one. L2 adds meetings, but its real goal is the
**coach's arc across the league**: a coach losing his room, a new coach struggling to win one over, a winning coach
sliding into a slump, or pulling out of one. A head coach's **credibility** is the thread, and meetings are where it
shows. It's flavor for the world first, with a small, checked effect on moods and a small push on the hot seat.

## Decisions (agreed in the brainstorm)

1. **The head coach holds meetings; you decide when.** He suggests one and you approve it, change it, or say no. A
   "let the coach handle it" box lets him hold them himself, like mentoring.
2. **Three short choices, not a script:** the approach, what you put behind it, and the timing. Only the options that
   make sense right now are offered, each with the coach's one-line take. The variety comes from combining personality,
   standing, coach style, the situation and history, not from long dialogue trees.
3. **You pick the topic through the approach; the coach's personality sets the tone.** A disciplinarian is blunt, a
   player's coach calmer, so the coach you hire matters.
4. **Meetings buy time; they don't fix the cause.** The effect is a mood jolt that fades. A commitment behind it is
   a promise to the room, and keeping or breaking it decides whether it sticks.
5. **Calendar moments and trouble.** Moments (camp, a new head coach's first week, deadline week, the playoff push, the
   championship game, the season's end) always bring a suggestion; trouble (a room Divided or Down, three losses in a
   row, a feud, a leader benched or traded) brings one too, within cooldowns. On the lower end: about 4 suggestions in a
   calm season, about 8 in a rough one, never more than one a week.
6. **The GM address is break-glass:** unlocked in a crisis, once a season at most, the whole team. Trust in your word
   (the promises you've kept and broken) decides most of it.
7. **AI clubs use the same system** for their coaches and their GMs.
8. **Credibility is public in words** (what the league says about a coach) and feeds **a small push** on the owner's hot
   seat: a capped extra, never the deciding factor.
9. **SNN carries the arcs in its existing weekly coaching roundup,** as a "Locker rooms" section: one letter a week
   worth reading, not a stream of stories.
10. **Every letter is one thread: what's happening, why, and what next.** It is written in the coach's voice,
    references real history, and claims only what the engine does.
11. **Renders before code.** Every letter and screen piece is mocked up and shown to the owner before it's built.

## 1. The meeting

### 1.1 When a meeting is suggested

**Moments** (team-wide; the coach always suggests one, and you can skip it):

| Moment | When | Timing |
| --- | --- | --- |
| Camp opens | the preseason | set by the moment |
| A new head coach's first week | his first regular-season or camp week with the club | set |
| Deadline week | only if the team is in the race (`playoffRace`), or sold at the deadline | Monday |
| The playoff push | the week a playoff spot is clinched, or the regular season's last week while in the race | Monday |
| The championship game | the night before | set |
| The season's end | the re-sign window | set |

**Trouble** (a room or the team):

- a room turns **Divided** or **Down** (L1's read), told to you by the head coach, not only the position coach;
- the team loses **three in a row** (a team meeting);
- a **feud** starts in a room, or a **leader or voice** in it is benched or traded.

**Cooldowns:** a room at most every 4 weeks; the team (trouble) every 6 weeks; moments don't count against either.
At most one suggestion a week. In a calm season about 4 suggestions, in a rough one about 8.

### 1.2 The three choices

**The approach** (two to four, only those that fit; each with the coach's one-line take):

| Approach | Offered when | What it does |
| --- | --- | --- |
| **Let a leader say it** | a leader or voice in that room reads Good or better | the word comes from a peer: lands harder with the room, but only while he's in a good place |
| **I'll say it straight** | always | the coach speaks; how blunt it lands depends on his discipline |
| **Call him out** | a voice who stirs is driving it and reads Poor or worse | a big swing on that man and those around him |
| **Keep it about the losing** | the team is losing and the room is down about it | aims at the result, not anyone's role |
| **The standard** | moments, or nothing specific is wrong | a general "who we are"; the smallest effect, rarely backfires |

**What's behind it** (only the commitments that are possible right now):

| Commitment | Offered when | Kept when | Window |
| --- | --- | --- | --- |
| **His snaps are open** (names him) | a man in the room wants snaps and isn't starting | his role goes up (rotation or starter, `actualRole`) | 3 weeks |
| **The front office is talking to agents** | eligible, upset men want a new deal (L1's `roomReasons`) | you open talks with each of them (`negotiationFor`) | 4 weeks or the deadline |
| **One of them goes** | a feud in the room | one of the two leaves the room (traded, cut, or off the 53) | 4 weeks |
| **We're making a move** | the team is losing, before the deadline | you add a starter by trade or signing | until the deadline |
| **Words only** | always | nothing to keep | |

**The timing** (trouble meetings; moments set their own):

| Timing | Multiplier |
| --- | --- |
| Right after the game | ×1.5 |
| Monday, in film | ×1 |
| Before Wednesday's practice | ×0.6 |

### 1.3 How each man reacts

Each man in the room (or the team) gets a reaction score, from facts the game already has:

- **Fit:** the approach's topic against his own grievance (his morale reasons: snaps, money, the losing, a feud). A
  match counts most; a miss counts little.
- **The speaker against his makeup:** the coach's discipline against his temperament and controversy (a Hothead bristles
  at a blunt coach; a Company Man doesn't); for "let a leader say it", that leader's standing and his mood.
- **Calling out:** the called-out man and his friends react hardest, by temperament and controversy; a Driven type may
  take it as a challenge.
- **What's behind it:** a commitment that matches his grievance lifts the score a lot; any other commitment a little.
- **Timing:** the multiplier on the outcome's size.
- **History:**
  - the coach's credibility (§2.3);
  - "heard it before": the same approach to the same room this season, weaker each time;
  - his own history: benched in the last month, a promise broken to him (`promisesScore`).
- **A ripple:** a leader or voice who buys in raises the odds for the men around him (one nudge within this meeting;
  no mood spreads between players: that stays in L3).
- **Luck:** a seeded draw on the meeting's own stream (`${seed}:meeting:${season}:${clock}:${teamId}:${unit}`).

The score lands him in one of three places: **it lands** (a positive jolt), **a shrug** (nothing), **he bristles** (a
negative jolt). A new jolt kind, `meeting`, uses the existing jolt machinery (`addJolt`, fading by half every two
weeks).

**Sizes** (on the mood level; a step is about two levels):

| | Lands | Bristles |
| --- | --- | --- |
| A coach's meeting, Monday | about +2 | about −2 |
| A calendar moment | ×0.7 | ×0.7 |
| The GM address | ×2 | ×2 |

Timing multiplies on top. A meeting **never fixes the cause**: a man who wants a deal still wants one.

## 2. Follow-through and credibility

### 2.1 Open commitments

A commitment is stored with the meeting (§6) and judged at each morale step until its window closes:

- **Kept:** the men who bought in get a further lift (`kept` jolt), the coach gains credibility, and the men it named
  trust your word more (the existing promise record).
- **Broken:** the men who bought in get a dip larger than the meeting gave (`broken` jolt), the coach loses
  credibility, and the men it named trust your word less.

While it's open, the result letter names it and its window, the weekly staff notes remind you as it comes due, and the
room's card on the Locker Room shows it.

### 2.2 AI clubs' commitments

AI GMs make commitments and keep them by their tendencies, the same way they keep promises to their own players (G4,
`2026-10-30-morale-escalations-design.md` §7): mostly kept, sometimes not.

### 2.3 The head coach's credibility

A hidden number per head coach, read only in words:

| Reads | Means |
| --- | --- |
| **The room believes him** | high |
| (nothing said) | middling |
| **They've heard it before** | slipping |
| **His word has worn thin** | low |

- **Up:** meetings that land, commitments kept, winning streaks.
- **Down:** meetings that backfire, commitments broken, long losing streaks.
- **Drift:** back toward the middle across a season.
- **A new head coach** starts in the middle, with a "new voice" boost on his first one or two meetings.
- **Where it shows:** his own letters (he says when it shifts), your Locker Room, the coach's card (one public line),
  and SNN.

### 2.4 The hot seat

The owner's bag (`ownerBag.ts`) gains a few extra heat marbles on a head coach whose word has worn thin. It's capped
small against his record, so a winning coach who has lost the room is safe, but a losing one who has also lost it is
closer to the door. It's never the sole factor.

## 3. The GM address

- **Unlocks** (once a season at most) after a losing streak of 4 or more, with 3 or more rooms reading Down or
  Divided, or in the week after you fire the head coach or trade a captain or a star.
- **The whole team, you speak.** The approach:
  - **Own it:** you take the blame; lands with loyal men and veterans.
  - **Raise the bar:** a demand; lands with driven men, bristles the volatile.
  - **A fresh start:** only right after a firing or a big trade.
- **Behind it:** "no one's job is safe" (kept if the depth chart changes within 3 weeks), "we're buying" (kept if
  you add a starter by the deadline), or words only. **Timing** is fixed: Monday.
- **What decides it:** mostly each man's trust in your word (`promisesScore`), then his makeup.
- **The stakes:** ×2 both ways; a broken commitment here costs the most trust of anything in the game.
- **The head coach's angle:** a secure coach backs you; one whose word has worn thin may read it as a vote against him
  and lose credibility if it flops.

## 4. AI clubs and the world

- AI head coaches get the same suggestions and pick the approach their style favours, with some variety; AI GMs pick
  commitments and the crisis address by their tendencies.
- Credibility runs for every head coach in the league.
- **Public:** SNN's weekly roundup and the coach's card line. **Private** (the fog of war): another club's room reads,
  its meetings' details and who bristled.

## 5. The letters

Every letter is one thread: **what's happening, why, and what next.** The writing rules are L1's (§6 of its spec):
a judgment comes with the fact behind it, name the man before the room, claim only what the engine does, lines picked by
`say()`. Lines also vary by the coach's style: a disciplinarian is terse, a player's coach warmer.

1. **The coach's suggestion** (one letter, his read, then the choices as cards; each option shows his one-line take):
   - his read: what's wrong, who's driving it, the risk;
   - the approach cards, the commitment chips, the timing chips;
   - **Hold the meeting** / **Not now**.
2. **The result:**
   - **What I told them:** one quoted line, in his tone;
   - **How it went:** who bought in, who shrugged, who bristled, and why;
   - **Where that leaves us:** how long it holds, the open commitment and its window, and a button for the real fix
     (Negotiate, the depth chart).
3. **The weekly staff notes** gain commitments coming due, and his candid line when his credibility shifts.
4. **The locker reports** (season's first and season's end) gain a short paragraph on the year's meetings.
5. **After your GM address,** the reaction comes from a captain: the players' side, in his words.
6. **SNN's weekly coaching roundup** gains a **Locker rooms** section: a sentence per club whose story moved that week
   (a room lost or won back, a new coach struggling, a GM address). Skipped when nothing moved.

## 6. Balance, checks and data

### 6.1 Can't be abused

Cooldowns (§1.1), "heard it before" (§1.3), commitments judged strictly against what happened, moments as fixed points,
and the GM address once a season.

### 6.2 Checks

`npm run morale` gains:

- meetings per club per season: 3–6;
- reactions: lands 35–60%, bristles 10–30% (backfires happen, and stay the minority);
- the league's average mood: no drift (the existing check holds);
- head coaches whose word has worn thin at season's end: 5–20% of the league, and some recover within a season.

`npm run offseason` and `npm run careers`: head-coach changes per year, the carousel and the coaching-tree numbers stay
in their current ranges with the hot-seat push on. Before the PR, the sim, trades and audit run locally at full size;
anything that tips gets investigated, not loosened (L1's lesson: several checks sit on an edge on main).

### 6.3 Data

- `Team.meetings`: per room (and the team) the last meeting's clock, approach and outcome, the season's approaches for
  "heard it before", and open commitments with their windows and who bought in. Plain JSON.
- `Coach.credibility`: a number, hidden.
- `MoraleJolt` gains `meeting`.
- `SAVE_VERSION` bump and a `migrate.ts` step (empty logs, credibility in the middle).

## 7. Renders before code

Before any letter or screen piece is built, its mockup (rendered HTML) is shown to the owner for an OK: the suggestion
letter with its cards, the result letter, the Locker Room's meeting pieces (open commitments on a room's card, the
"request a meeting" control), SNN's Locker rooms section, and the coach card line.

## 8. Pull requests

1. **The engine:** meetings, reactions, commitments, credibility, AI clubs, the checks. No screens.
2. **The letters and screens** (after their renders are approved).
3. **The world:** SNN's section, the coach card line, the hot-seat push, and the offseason and careers checks.

## 9. Files (expected)

| File | Change |
| --- | --- |
| `src/engine/meetings.ts` | new: suggestions, choices, reactions, commitments, credibility, AI |
| `src/engine/meetingVoice.ts` | new: the coach's and captain's words |
| `src/engine/morale.ts` | `meeting` jolt; commitments judged at each step |
| `src/engine/ownerBag.ts` | the capped credibility push |
| `src/engine/staffNotes.ts`, `lockerReport.ts`, `inbox.ts` | the letters and the SNN section |
| `src/ui/screens/LockerRoom.tsx`, `src/ui/mail.tsx`, coach card | the meeting pieces |
| `src/engine/types.ts`, `generate.ts`, `migrate.ts` | data, save version |
| `scripts/morale.ts` | the §6.2 checks |

## 10. Out of scope

- L3: a voice's mood rubbing off on his room, and room chemistry on Sunday.
- L4: the room's backing for the coordinators, and the lawyer's doubt after losses.
- Players-only meetings called by the captains.
- Hold-ins, holdouts and trade requests (G4).
