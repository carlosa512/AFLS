# Discipline and players off the field — design

0.5's third piece (`docs/MVP.md`, "The offseason comes alive": Suspensions). Agreed with the owner 2026-11-23. 0.5.0
lands with it.

## What it is for

A player's character should cost you: a hothead misses games because of who he is. To make that real, players exist
off the field too, mostly through the trouble they get into, and SNN gives them a voice of their own. Low stakes,
never a griefing mechanic: nothing comes out of nowhere, most suspensions are a game, and a long one needs a pattern.

## Goals

- **Character costs games.** Low temperament and poor sportsmanship lead to ejections and league suspensions; low
  work ethic and high controversy to team-rules trouble you answer for.
- **You see it coming.** The scouts' character words already show a hothead (`characterNotes`, `personalityRead`).
  Signing one is a choice; mentors calming his temperament (`mentoring.ts`) is the long answer.
- **Your call on your own players.** Team-rules trouble reaches you as a row in the head coach's weekly letter with
  three answers: fine him, sit him a game, let it go. Or the head coach handles discipline for you.
- **Players talk.** SNN quotes players, rookies included, in a voice drawn from their personality. Over a season the
  press shows what a man is like.
- **The good side as stories.** Consummate Pros, Company Men, Born Leaders and the like get the opposite stories:
  community work, a family moment, a teammate everyone wants. Stories only, written as carefully as the SNN rework.

## Non-goals

- The good side changing anything in the sim (no award, no morale lift, no owner patience).
- Money: a suspended player keeps his pay, and a fine is a word in a story, not a cap or salary entry.
- AI front offices changing who they sign or keep because of discipline (they already read character through
  `characterRead`; nothing new).
- Appeals, the NFL's personal-conduct process, the commissioner's exempt list.
- A reserve/suspended list off the 53: a suspended player stays on the roster, unavailable, like a short injury.

## Anti-goals (a failure even if it works)

- Your star suspended for weeks with no warning. A first league suspension is one game; longer bans only for a
  pattern (see the ladder).
- Anything darker than a fight or a missed curfew: no crimes, no arrests, no drugs, no domestic matters. The tone is a
  sports page, not a police blotter.
- A wall of trouble: most players never get in any; an ordinary player almost never does.
- Moving play: personal-foul rates, scoring and every judged line of `npm run sim` stay where they are.
- A letter or story that names a trait, a number from a hidden scale, or a personality label.

## Constraints

- The engine stays pure and seeded (`CLAUDE.md`). Ejections draw from their own stream, so every other roll in every
  game is untouched (the pattern the spatial field uses). Off-field trouble is a pure function of the league's seed,
  the week (or offseason step), the player and what is known about him, like weather: nothing stored until it happens.
- `League` stays plain JSON; a save upgrade (`SAVE_VERSION`, `migrate.ts`).
- Fog of war: screens show discipline facts (an ejection, a suspension, a fine, your own answer) to everyone, as the
  NFL makes them public; the character behind them stays words.
- Every letter line to `docs/NEWS.md` "Words in a letter" and `letterRules`; every SNN story to `storyRules` and "SNN
  on the big days"/the weekly edition's rules. A new file that words either goes in `LETTER_FILES` or is checked by
  `storyRules` tests.
- The lines near their edge on main (CLAUDE.md lessons): meetings a club a season ~5.5 (fails at 6), Tight rooms 0.35
  (warns), win and margin spread near their edges. Discipline moves moods, so meetings and rooms are measured early.

## Approaches

Three ways were weighed; the stories and quotes are the same in each (mail-side, nothing in the sim reads them).

- **A. A trouble marble bag per player** (like quirks and GM habits): trouble brews over weeks, mood and losing add
  marbles, mentors take them out; ejections live in games. Most alive, but the most state and tuning, and a third bag
  system to balance.
- **B. A weekly pure roll, like weather, no ejections**: off-field trouble from seed, week and character, tilted by
  mood and losing; on-field trouble only by the league's review of a player's personal fouls after the game. Cheapest,
  the match engine untouched, but a hothead never loses it on screen.
- **C. B plus in-game ejections (chosen)**: a hothead's bad personal foul can get him thrown out in the game, told in
  the play-by-play, his backup in as for an injury, and it counts toward a suspension. Ejections on their own random
  stream. A small match-engine change, so the sim checks run.

The owner chose C: seeing him thrown out is when a hothead costs you, and the rest stays as cheap as B. The mood and
losing tilts give most of A's slow build for much less.

## How it works

### On the field: ejections

- After a personal foul is charged (`personalFouls` in `match/gameSim.ts`, the fouls with `personal: true` in
  `penalties.ts`), the man may be ejected: odds from how bad the foul is (unsportsmanlike conduct and unnecessary
  roughness highest), his temperament and sportsmanship (`temperamentOf`, `roughness`), drawn from the game's own
  ejection stream (`${seed}:${season}:${gameId}:ej` or the codebase's equivalent naming).
- A fight: rarely, an unsportsmanlike foul after the whistle by a low-temperament man is a fight and ejects him
  outright (and may eject the man he fought, if that man's temper is short too).
- Ejected: a play-log line ("…is ejected."), he is removed and the lineup rebuilt exactly as for an in-game injury
  (`this.out`, `buildLineup`), and the result keeps it (`GameResult.ejections: { playerId, teamId, quarter, clock,
  foul }[]`). The play's yardage and the foul itself are unchanged: ejection adds no yards.

### Off the field: trouble

Each week in season and each offseason step, every rostered player may get into trouble, as a pure function of the
seed, the season, the week or step, his id and his character, tilted by his mood (`moodLean`) and his team's losing.
Kinds, by what drives them (character keys, so a mix of traits mixes the kinds):

| Kind | Driven by | Whose call |
|---|---|---|
| Missed a meeting, late to practice, out past curfew | low work ethic | yours (team rules) |
| Skipped a team event, a public spat with a teammate or coach | high controversy | yours (team rules) |
| A scuffle at practice | low temperament | yours (team rules) |
| A fight away from the stadium | very low temperament | the league's |

The tone stops at a fight and a missed curfew (anti-goals). A player already in trouble this week, suspended,
holding out or not reporting draws none.

### The league's review

At each week's end (and at each offseason step for off-field trouble) the league reviews:

- **An ejection** → a fine; a fight or a second ejection inside the league year → a suspension.
- **A pattern of dangerous fouls** (roughing the passer, unnecessary roughness, face mask) by one man, `REVIEW.fouls`
  of them within `REVIEW.span` games → a fine, then a suspension.
- **A fight away from the stadium** → a suspension.

The ladder (a man's league suspensions in the last two league years, `Player.discipline`): first, one game; second,
two; third and after, up to four. Nothing longer. A suspension handed down in the offseason is served from week 1.

### Your call on team-rules trouble

- A row in the head coach's weekly letter (`coachWeek.ts`) for each team-rules incident on your team, introduced in a
  sentence, with three answers: **Fine him**, **Sit him a game**, **Let it go**.
- What the answer does:
  - **Fine him**: a small mood dip (`morale.ts` jolt), and his chance of trouble the next few weeks drops a little.
  - **Sit him a game**: unavailable for the next game, a bigger mood dip, his chance of trouble drops the most.
  - **Let it go**: no dip, but his chance of more trouble the next few weeks rises.
- An unanswered row is settled as **Let it go** after the usual wait (`waitFor` pattern in `playerTalks.ts`).
- **The head coach can handle discipline for you**, a setting beside the one for team meetings
  (`setMeetingsByCoach`): he answers by his own discipline trait (`traitOf(hc, 'discipline')`).
- AI teams answer at once, by their head coach's discipline trait.
- Sitting a man for discipline, and a suspension, are **not a benching**: no "where do I stand" question, no job lost
  (`benching.ts` treats him like an injured man), and when he is back the coach's existing reminder applies
  (`clearedNotStarting`, "Put him back").

### Serving a suspension

- `Player.suspension?: { games: number; reason: … }`: unavailable while `games > 0` (`isAvailable`), counting down
  one for each of his team's games (a bye doesn't count). Stays on the 53.
- Public: the roster and the player card show "Suspended, 1 game" like an injury; the next-game card's "out" list
  includes him.
- A mood jolt when it is handed down (bigger the longer it is).

### SNN: players in trouble and players doing good

- **Weekly edition** (`snnWeek.ts`): an ejection, a suspension, a fine and (for any team) team-rules trouble that went
  public (a public spat, a skipped team event) are candidates; a good-side story (community work, a family moment, a
  teammate everyone wants) is a low-tier tile, never the lead. One story a team, as now.
- **Big-day editions** (`snnDays.ts`): a suspension handed down in the offseason; the good side in quiet moments.
- Good-side stories come from the same kind of pure roll, driven by high leadership, loyalty, work ethic and
  temperament, about a couple a week league-wide.
- Words in a new voice file (`snnConductVoice.ts` or within `snnVoice.ts`/`snnDayVoice.ts`), to `storyRules`.

### Players talk

- A story may now quote **the player it is about** instead of the head coach: still one quote a story at most
  (`docs/NEWS.md`'s rule extended).
- His voice comes from his personality (`personalityOf` on his true character: a person shows himself in what he
  says): a Hothead snaps back, a Company Man credits the team, a Diva talks about himself and his deal, a Consummate
  Pro says little and means it, a Jittery rookie is nervous, a Born Leader speaks for the room. A quote never names a
  trait, a label or a number.
- Where players speak: draft day (the pick, rookies included), a free-agency signing, after a big game, in trouble, in
  a good-side story.
- No sentence twice a league year (`pick`/`say` patterns), and `npm run editions` (`--days`, weekly) is the preview
  for reading them.

## Numbers and tolerance (settled with the owner)

Aim for the NFL's average, not hyper-realism. The first plan task looks up the NFL's counts (ejections a season,
on-field and conduct suspensions a season, how long) into `docs/research/discipline.md`; until then the targets are
guesses:

| Line | Target | Judged |
|---|---|---|
| Ejections a league season | about one every two weeks (~9) | warn outside the usual band, fail outside the normal band |
| League suspensions a season | a handful (~4–8), most one game | as above |
| Team-rules trouble on a team a season | most seasons with a Hothead or a Coaster on the roster, almost never without one | reported |
| Share of trouble from the bottom fifth of temperament/work ethic | most of it | fail if under half |
| First league suspension longer than one game | never | fail |
| Personal fouls a game, points, every `sim` line | unchanged | the existing `sim` checks |
| Meetings a club a season, Tight rooms, rooms in doubt | measured early, must stay inside | the existing `morale` checks |

Tuning: a fast probe (two leagues, a few seasons) to steer, the new check to judge, at most three probe rounds; if
it won't settle, stop and bring the numbers to the owner. Bands are the owner's and never move to get green.

## Data (save upgrade)

- `Player.discipline?: { season: number; week: number; kind: …; outcome: … }[]` — his record, kept short (the last
  two league years), for the ladder and the stories.
- `Player.suspension?: { games: number; reason: … }`.
- `GameResult.ejections?`.
- A pending team-rules row for your team (where the coach's letter reads asks today, e.g. `Team.discipline.pending`),
  and `Team.disciplineByCoach?: boolean`.
- A "trouble odds" lean from your last answer, kept with the record (`Player.discipline` carries it).

## Checks and previews

- A new `npm run conduct` check (its own script, added to `scripts/check.ts` and CI for the files it covers): plays a
  few leagues and judges the table above; prints trouble by personality, answers by AI coaches, the ladder.
- `npm run sim` must stay green (ejections draw on their own stream; backups play a few minutes more).
- `npm run morale` must stay green (mood jolts, meetings).
- `npm run editions` (weekly and `--days`) for reading the words; `npm run letters` for the coach's rows.

## Settled after the builder check

The builder's questions, answered from the conversation and the code; each marked **(call)** is a call made in
writing this up, for the owner to check.

- **Ejections and play.** The foul itself, its yards and the rest of the drive are unchanged; the ejected man's
  backup plays the rest of the game. About nine a season over 272 games barely moves anything; every `sim` line must
  stay inside its band, as for any change (not literally unchanged). **(call)**
- **Character counts twice, on purpose.** The foul rolls already read a man's temperament (`discipline` in
  `match/lineup.ts`) and sportsmanship (`roughness`); the ejection odds read them again, so a hothead fouls more and,
  when he does, is thrown out more. That is the point.
- **The ladder counts league suspensions only**, never fines, team fines or games you sat him. `REVIEW.fouls` and
  `REVIEW.span` start as guesses (three dangerous fouls within four games) and are tuned with the rest. **(call)**
- **Volume is a league year's**: in-season weeks and the offseason together. The offseason gets a fixed number of
  trouble rolls (one at each of its main steps), each scaled so the year lands on target. **(call)**
- **Public or private.** A public spat and a skipped team event are public by nature: SNN may report them for any team.
  A missed meeting, curfew or a practice scuffle stays inside the team, unless the team sits him, which is reported as
  sat "for a violation of team rules", as NFL teams announce it. AI teams get no letter; what is public reaches SNN.
  When your head coach handles discipline, his answer is a note row in his letter, with no question. **(call)**
- **In the coach's letter** a team-rules row is an ask (the tier of player talks): it needs your answer, so it always
  stays, counts toward `MAX_ROWS`, and waits through `LETTER_GAP` like any ask. A man holding in, holding out, not
  reporting, suspended or already in trouble this week draws none; an injured man can still miss a meeting. An open
  benching question or talk doesn't stop it, and both rows may stand in one letter. **(call)**
- **Mood jolts**: a league fine is a small one (like your fine), a suspension a larger one by its length, your three
  answers as above. All measured early against meetings and rooms. **(call)**
- **Sitting him a game** is your answer, kept in his record but not on the ladder; he simply doesn't play that game
  (no stats, no snaps), and it is not a benching.
- **The record** keeps each incident (kind, week, outcome) and the lean from your last answer (how much likelier or
  less likely more trouble is, and until when). It is dropped when he retires (`RETIRED_KEEP` keeps the career only).
  **(call)**
- **Quotes read the man's true personality, for every team.** The press shows what a man is like over a season, so it
  doubles as a little scouting; the owner heard this in the playback. A quote never names a trait or a label.
- **Good-side stories** are an average of about two a week league-wide, not a cap; an edition still runs one story a
  team and keeps them to tiles.

## Left to the builder

The exact odds (fitted by the tuning step), the stream's name, where each piece of state lives if a better home
exists, the voice file layout, and the wording of every line (to the house rules).
