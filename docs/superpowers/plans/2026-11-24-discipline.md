# Discipline and Players Off the Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player's character costs games (ejections, league suspensions, team-rules trouble you answer), players
exist off the field in SNN with their own voices, and the good side is told as stories only.

**Architecture:** In-game ejections on their own seeded stream inside `match/gameSim.ts`, removing a man the way an
in-game injury does. One new engine module, `src/engine/conduct.ts`, owns off-field trouble (a pure weekly roll like
weather, from `hashUnits`), the league's review and the suspension ladder, your answers and the AI's, and suspensions
counting down by team games. Mail and SNN read what happened and word it; nothing in the sim reads the stories.

**Tech Stack:** TypeScript, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-11-23-discipline-design.md` (read its "Settled after the builder check" section:
it binds). Mockups: https://claude.ai/artifact/QkHe1QKRWamLZtWdg2wFCA

## Global Constraints

- Engine pure and seeded; no `Math.random`. Ejections draw only from `new Rng(`${seed}:eject`)` in the game (the
  pattern of `${seed}:injury`, `${seed}:flags`); off-field and good-side rolls are `hashUnits(`${league.seed}:…`)`
  keys: pure, nothing stored until something happens. No other stream's draws change.
- `League` plain JSON. Save version 104 (`SAVE_VERSION` in `generate.ts`, a step in `migrate.ts`).
- New `Player` fields (`discipline`, `suspension`) are NOT added to `RETIRED_KEEP` (`roster.ts:184`): retirement drops
  them.
- Fog of war: discipline facts are public; character stays words. A quote or letter never names a trait, a
  personality label or a hidden number.
- Words: letters to `docs/NEWS.md` "Words in a letter" (`letterRules`, a new wording file goes in `LETTER_FILES`);
  SNN stories to `storyRules` (`ruleBreaks`); screens to `docs/UI.md` "Words on a screen". American football English:
  team, never club; players, never men; no semicolons, no colon or dash inside a sentence. Tone stops at a fight and a
  missed curfew: no crimes, no drugs, nothing darker.
- Ladder: league suspensions in the last two league years only: first 1 game, second 2, then up to 4, never longer.
  Fines, team fines and games you sat him never count.
- A suspended player stays on the 53, unavailable (like a short injury), keeps his pay; it counts down one per game
  his team plays (a bye doesn't count). Discipline-sitting and suspension are not a benching.
- AI front offices change nothing about who they sign or keep.
- Lines near their edge on main: meetings a club a season ~5.5 (fails 6), Tight rooms ~0.35 (warns), win spread and
  margin spread near their edges. Measure meetings and rooms as soon as jolts land (Task 4).
- Make all engine changes first (Tasks 2–4, 6–7); fix tests the reshuffle moves once, in Task 9, by finding their scene.
- Version 0.5.0 (the 0.5 milestone finishes, `docs/VERSIONING.md`), changelog entry, `docs/MVP.md` Suspensions to
  Done, `CLAUDE.md` architecture line, `docs/GAME_DESIGN.md` 0.5 section.
- `npm run format` before each commit; commits end with the session's attribution lines.

## Review Focus

1. **A suspended or discipline-sat starter at kickoff**: he is skipped by every lineup path (`isAvailable`, and the
   separate checks in `match/lineup.ts` ~111, 203, 214), the benching chain asks him nothing, and when he is back the
   coach's "Put him back" reminder appears (`clearedNotStarting`). Test in Task 2.
2. **An ejection on the last play of a half, or of a kicker or quarterback**: the lineup rebuild handles every
   position the way an injury does, and an ejected kicker's kicks go to the emergency kicker as an injured one's do.
   Test in Task 3.
3. **A bye week and the playoffs**: a suspension counts team games only, carries from the regular season into the
   playoffs and from an offseason ruling into week 1, and never into a second league year beyond what is left. Tests in
   Task 2.
4. **A row you never answer, or answer after a trade**: settled as Let it go after the wait; an answer for a player no
   longer on your team does nothing. Test in Task 5.
5. **A first-offense star**: no path gives a first league suspension more than one game, whatever happened. Test in
   Task 4.

---

### Task 1: The NFL's numbers

**Files:** Create `docs/research/discipline.md`.

- [ ] **Step 1:** From public sources (the NFL's football-operations discipline summaries, reputable trackers;
  cite each), record per season for the last several seasons: ejections, on-field suspensions (count, length),
  conduct suspensions that fit our tone (fights; skip anything darker), and the share of first offenses that are fines
  only. Note what is unknown.
- [ ] **Step 2:** End with the targets this plan tunes to, as usual and normal bands in the shape of
  `scripts/band.ts` (owner: aim for the average): ejections a league season, league suspensions a season, the share
  of one-game suspensions. Where a number can't be found, keep the spec's guess and say so.
- [ ] **Step 3: Commit** "Research: the NFL's discipline counts".

### Task 2: The data, suspensions served, and who can play

**Files:**
- Modify: `src/engine/types.ts` (`Player.discipline?`, `Player.suspension?`, `GameResult.ejections?`,
  `Team.conduct?: { pending?: …; byCoach?: true }`, `MoraleJolt` kinds `'fined' | 'suspended' | 'satDown'` with
  `JOLT_WORDS` in `morale.ts:437`), `src/engine/roster.ts` (`isAvailable` ~262: `&& !suspended(p)`),
  `src/engine/match/lineup.ts` (~111, 203, 214: the same), `src/ui/pregame.ts` (`outFor` ~26: "suspended", "sat by the
  team"), `src/engine/generate.ts` (`SAVE_VERSION` 104), `src/engine/migrate.ts` (v104 step, nothing to convert)
- Create: `src/engine/conduct.ts` (this task: the types' helpers and the countdown only), `src/engine/conduct.test.ts`

**Interfaces:**
- Produces:
  - `type ConductKind = 'curfew' | 'meeting' | 'late' | 'teamEvent' | 'spat' | 'practiceScuffle' | 'fight' | 'ejected' | 'dangerousFouls'`
  - `interface ConductEntry { season: number; week: number; kind: ConductKind; outcome: 'fine' | 'sat' | 'letGo' | 'leagueFine' | 'suspended'; games?: number; public?: true }`
  - `Player.discipline?: { entries: ConductEntry[]; lean?: { by: number; until: number } }` (`lean.by` multiplies his
    trouble odds; `until` is a step clock).
  - `Player.suspension?: { games: number; by: 'league' | 'team'; reason: ConductKind }`
  - `suspended(p: Player): boolean`, `serveGames(league: League, teamIds: number[]): void` (after a week's games: each
    listed team's suspended players count one down, clearing at 0).
- [ ] **Step 1: Failing tests:** a suspended player is not available and is skipped by `buildLineup`; `outFor` lists him
  as suspended; `serveGames` counts down only for teams that played (a bye team's suspension holds); an offseason
  ruling (`games` set in the offseason) still has its games at week 1; `benchKickoff` asks a suspended holder nothing
  and `clearedNotStarting` reminds you once he is back; a v103 save migrates to 104; retiring drops both fields.
- [ ] **Step 2:** Run `npx vitest run src/engine/conduct.test.ts` — fails.
- [ ] **Step 3:** Implement; call `serveGames` in `playWeek` (`league.ts` ~198) right after `injuryWeek`, with the
  teams that played this week.
- [ ] **Step 4:** `npx vitest run src/engine/conduct.test.ts src/engine/benching.test.ts src/ui`; `npm run typecheck`.
- [ ] **Step 5: Commit** "Discipline: suspensions served game by game, the suspended skipped like the injured".

### Task 3: Ejections in the game

Only the NFL's reasons (spec, "On the field: ejections"): a fight, a second unsportsmanlike conduct foul in one game
(automatic), and a very rare flagrant hit.

**Files:** Modify `src/engine/match/gameSim.ts` (or a small `match/ejection.ts` beside it); Test
`src/engine/match/ejection.engine.test.ts`.

**Interfaces:**
- Consumes: `GameResult.ejections` (Task 2).
- Produces: `EJECT: { on: boolean; fight: number; fightBack: number; flagrant: Partial<Record<Foul, number>> }`;
  `GameResult.ejections: { playerId: number; teamId: number; quarter: number; clock: number; why: 'fight' |
  'twoUnsportsmanlike' | 'flagrant' }[]`.
- [ ] **Step 1: Failing tests:** with `EJECT.on = false` every play of a seeded game is identical to main's (the new
  stream changes nothing else); a man charged a second accepted unsportsmanlike conduct foul in one game is ejected on
  that play with no extra draw; with `EJECT.fight` forced to 1 after a whistle-ending contact play, the man is charged
  unsportsmanlike conduct and ejected, and with `fightBack` forced to 1 the other man too; with `flagrant` forced to 1
  for unnecessary roughness the first such accepted foul ejects him; an ejected man takes no later snap, the play's
  and the foul's yards are unchanged, an ejected kicker's kicks go to the cover the injury path picks, and
  `GameResult.ejections` holds each with its `why`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3: Implement:** `this.ejectRng = new Rng(`${seed}:eject`)` beside `injuryRng`/`flagRng` (~1106). In
  `flag()` (~5268) on an accepted foul: a second unsportsmanlike conduct for the same man in the game ejects him
  (count per man in the game); a personal foul may be flagrant (`EJECT.flagrant[foul]` × his sportsmanship lean from
  `roughness`). After the whistle (where the celebration foul is rolled, ~5072), a fight: odds from the play and the
  men in it × temperament lean (`temperamentOf`); it is charged as unsportsmanlike conduct (offsetting if both swing)
  and ejects. Factor the removal out of `injuryStoppage` (~1430–1470: `this.out.add`, `snapshot = null`, the lineup
  rebuild, `syncKnocks`, `fields`, `fieldRecord.changes`, `qbLeans`) into one helper both call; add `ejections` to the
  result (~5396) like `injuries`. Starting odds: about nine ejections a league season, most fights, flagrant a handful
  (Task 1's numbers); Task 8 tunes.
- [ ] **Step 4:** The tests; `npm run sim -- 10` once (personal fouls a game and every line inside its band).
- [ ] **Step 5: Commit** "Ejections: fights, a second unsportsmanlike and the rare flagrant hit".

### Task 4: Trouble, the league's review and your answers (engine)

**Files:** Modify `src/engine/conduct.ts`, `src/engine/league.ts` (`playWeek`), `src/engine/offseason/index.ts`
(the `moraleStep` sites ~297, ~505), `src/engine/benching.ts` (`couldPlay` ~69 already reads `isAvailable`; confirm a
team-sat man is not a benching), `src/engine/meetings/index.ts` pattern for the setting. Test
`src/engine/conduct.test.ts`.

**Interfaces:**
- Consumes: Task 2's types, `GameResult.ejections`, personal fouls by player (`playerStats[id].penalties` and the
  game's penalty log by kind), `moodLean`, `hashUnits` (`rng.ts:37`), `temperamentOf`/`workEthicOf`, `trueCharacter`
  (`personality.ts:182`), `traitOf(hc, 'discipline')` and `traitLean` (`coachTraits.ts:17, 31`), `addJolt`
  (`morale.ts:721`), `waitFor` (`playerTalks.ts:38`).
- Produces:
  - `TROUBLE` (odds by kind and character, mood and losing tilts, answer leans), `REVIEW` (`fouls: 3, span: 4` to
    start, fine and suspension rules), `LADDER = [1, 2, 4]`.
  - `troubleWeek(league: League, step: 'week' | 'offseason'): void` — every rostered player's pure roll
    (`hashUnits(`${league.seed}:${season}:${clock}:trouble:${p.id}`)`); a man suspended, holding out or in, not
    reporting (`disputeRead.ts`) or already in trouble this step draws none. Team-rules trouble on your team becomes
    `Team.conduct.pending`; on an AI team, or yours with `byCoach`, it is answered at once by the head coach's
    discipline lean. A fight away from the stadium goes to the review.
  - `reviewWeek(league: League, results: GameResult[]): void` — ejections, dangerous-foul patterns and off-field fights
    → `leagueFine` or a suspension on the ladder; jolts by size.
  - `answerConduct(league: League, playerId: number, answer: 'fine' | 'sat' | 'letGo'): void` — does nothing for a
    player no longer on your team or with no pending row; `sat` sets `suspension { games: 1, by: 'team' }`; sets the
    lean; adds the jolt.
  - `settleConduct(league)` — a row past `waitFor` becomes `letGo`.
  - `setConductByCoach(league: League, on: boolean): void`.
  - `publicConduct(league, season)` — what SNN may read (ejections, rulings, public kinds, a team sitting a man).
- [ ] **Step 1: Failing tests (built scenes, found not pinned):** a bottom-temperament player draws trouble far more
  often over a season than a median one, and a median one almost never; the same seed and week give the same roll;
  a man holding out draws none; first league suspension is one game whatever the offence and the ladder climbs only on
  suspensions; an ejection's first offence is a fine, a second in the league year a suspension; `answerConduct` for a
  traded player does nothing; an unanswered row settles as Let it go after `waitFor`; `byCoach` answers at once; AI
  strict and lenient coaches answer differently over many cases; `letGo` raises his odds for the lean window and
  `sat` lowers them most.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3: Implement**; in `playWeek` call `reviewWeek` then `troubleWeek(league, 'week')` after `injuryWeek` and
  `serveGames`, before `moraleWeek` (`league.ts` ~198–218); `troubleWeek(league, 'offseason')` at the offseason
  `moraleStep` sites; `settleConduct` in the morale step's tail beside `talkStep` (`morale.ts` ~703).
- [ ] **Step 4:** The tests; then measure early: `npm run morale` once (meetings a club a season, Tight rooms, rooms
  in doubt must stay inside; if meetings or rooms move toward an edge, shrink the jolts before going on).
- [ ] **Step 5: Commit** "Discipline: trouble by character, the league's review, the ladder, your answers".

### Task 5: The letters and the screens

**Files:**
- Create: `src/engine/conductVoice.ts` (the head coach's row and notes, the league office's letter; in
  `LETTER_FILES`), `src/engine/conductMail.ts` (the league office's letter about your player: fine or suspension).
- Modify: `src/engine/coachWeek.ts` (a tier-1 'asks' item per pending row, `row.conduct = { playerId, clock }`,
  ~225–345 pattern; a note row when the head coach handled it; the league's ruling as a note), `src/engine/types.ts`
  (`MailSection` row `conduct?`), `src/ui/mail.tsx` (`LetterSection` ~3701: `ConductChoices` with **Fine him**, **Sit
  him a game**, **Let it go** calling `answerConduct`, pattern of the talk buttons ~750), `src/engine/inbox.ts`
  (`deliverMail`: `conductMail`), the roster status pill and player card (where injury status shows today:
  "Suspended · N games", "Sat by the team · 1 game"; a "Discipline" list on the card, words only), `src/ui/meetings.tsx`
  (~64: the "Let the head coach handle discipline" checkbox beside the meetings one).
- Test: `src/engine/conductMail.test.ts`, `src/engine/coachWeek.test.ts` additions, `letterRules.test.ts`,
  `src/ui/ui.test.ts`.
- [ ] **Step 1: Failing tests:** a pending row appears in the next coach letter with three answers, stays until
  answered, counts toward `MAX_ROWS`, and is gone once answered or settled; with `byCoach` a note row only; the league
  office letter files once per ruling for your player; every line passes `letterRules`; the pill and the card's
  discipline list render for a suspended player; the checkbox toggles `setConductByCoach`.
- [ ] **Step 2:** Run — fail. **Step 3: Implement** (match the mockups' words and layout).
- [ ] **Step 4:** The tests, `npm run typecheck`, `npm run letters` and `npm run copy`: read the new lines.
- [ ] **Step 5: Commit** "Discipline on your desk: the coach's row, the league's letter, the roster and the card".

### Task 6: SNN stories — trouble and the good side

**Files:**
- Create: `src/engine/snnConductVoice.ts` (the stories), `src/engine/snnConduct.test.ts`.
- Modify: `src/engine/snnWeek.ts` (candidates from `publicConduct` and good-side rolls; good-side and team-rules items
  tier 5 so they never lead, `cutEdition` ~495), `src/engine/snnDays.ts` (a suspension handed down in the offseason as
  a big-day candidate).

**Interfaces:**
- Produces: `goodSideWeek(league, clock)` (pure, `hashUnits`, high leadership, loyalty, work ethic and temperament:
  about two a week league-wide); the stories' kinds and the facts each reads.
- [ ] **Step 1: Failing tests:** an ejection, a suspension, a fine and a public spat become candidates; a team sitting
  a man is reported as "for a violation of team rules"; a good-side story is a tile and never the lead; `ruleBreaks`
  is empty for every built story.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3: Implement** to the spec's "Depth and quality of the words": whole hand-written lines with fact slots
  only, several lines per story kind and angle, the most specific that fits (the `say`/`pick` pattern), no sentence
  twice a league year. The mockups' stories are the tone.
- [ ] **Step 4:** The tests; `npm run editions` (weekly) and `npm run editions -- --days` over two offseasons: read every
  discipline and good-side story in `.check/editions.md` and `.check/day-editions.md`; fix what reads badly.
- [ ] **Step 5: Commit** "SNN: players in trouble and players doing good".

### Task 7: Players in their own words

**Files:**
- Create: `src/engine/playerQuote.ts` (quote lines by personality and moment), `src/engine/playerQuote.test.ts`,
  `scripts/quotes.ts` (`npm run quotes`, a preview: every line each personality can say at each moment, to
  `.check/quotes.md`).
- Modify: `src/engine/snnVoice.ts` (a story about one player may quote him instead of the head coach:
  `EditionStory.quote` already allows `playerId`, precedent `speakStory` ~1789), `src/engine/snnDayVoice.ts`
  (`Parts.quote` in `assemble` ~122; a quote in the draft pick's story ~155 and a signing's ~789),
  `src/engine/snnConductVoice.ts` (quotes in trouble and good-side stories), `docs/NEWS.md` (the quote rule: the head
  coach or the player the story is about, one a story), `package.json` (`"quotes"`).

**Interfaces:**
- Produces: `type QuoteMoment = 'drafted' | 'signed' | 'bigWin' | 'badLoss' | 'trouble' | 'suspended' | 'back' |
  'goodSide'`; `playerQuote(league: League, p: Player, moment: QuoteMoment, facts: QuoteFacts): string | null`,
  reading `personalityOf(trueCharacter(p))`; a plain voice for a personality without lines for a moment.
- [ ] **Step 1: Failing tests:** every personality has several lines for every moment or falls back to the plain voice,
  never to an empty quote; for the same moment a Hothead's line differs from a Company Man's; no quote names a trait
  or label (a word list); a ten-season league's printed quotes: no line more than a few times (start at 3), and the
  share of distinct lines above a floor (start at 0.8); every line passes the letter and story word rules.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3: Implement**: whole hand-written lines, slots for facts only; the most specific line that fits wins; no
  sentence twice a league year. Aim for depth: at least four lines a personality a moment where the moment is common
  (drafted, signed, trouble), two where rare.
- [ ] **Step 4:** The tests; `npm run quotes` and `npm run editions -- --days`; read the whole preview.
- [ ] **Step 5: Read-aloud review:** a fresh reviewer (no code) reads `.check/quotes.md`, `.check/editions.md` and
  `.check/day-editions.md` and lists every line that reads stiff, odd, unlike a person or repeated; fix them all, run
  the preview again.
- [ ] **Step 6: Commit** "Players in their own words: quotes by personality on draft day, in free agency, after games and
  in trouble".

### Task 8: Tune it and the conduct check

**Files:** Create `scripts/conduct.ts`; modify `package.json` (`"conduct": "tsx scripts/conduct.ts"`), `scripts/check.ts`
(`CHECKS.conduct` ~46–214 and a `RULES` entry for `conduct.ts`, `match/gameSim.ts`, `scripts/conduct*.ts`),
`src/engine/conduct.ts` and the `EJECT` odds.

- [ ] **Step 1:** `scripts/conduct.ts` plays a few leagues (child processes like `morale`) for several seasons and
  judges, with `scripts/band.ts`, the spec's table: ejections a season (and flagrant ones: fail above 8), league
  suspensions a season (and one-game share), the bottom fifth's share of trouble (fail under half), any first suspension over one game (fail), and prints
  trouble by personality, AI coaches' answers and the ladder.
- [ ] **Step 2:** Tune `EJECT`, `TROUBLE` and `REVIEW` to Task 1's targets with a fast probe (two leagues), at most
  three rounds; if it won't settle, stop and report the numbers.
- [ ] **Step 3:** Judge once each, one at a time: `npm run conduct`, `npm run sim -- 10`, `npm run morale`. All exit 0.
- [ ] **Step 4: Commit** "Discipline tuned to the NFL's counts, and the conduct check".

### Task 9: Moved tests, docs and the version

**Files:** whatever seeded tests moved; `docs/MVP.md` (Suspensions → Done, the 0.5 milestone line), `docs/GAME_DESIGN.md`
(0.5 section), `CLAUDE.md` (an architecture line for `conduct.ts`, its check in Commands), `package.json` 0.5.0,
`src/ui/changelog.ts` (title ≤ 40, text ≤ 200), the spec's data section if names changed.

- [ ] **Step 1:** Run the engine and UI suites once; re-aim each moved test to find its scene (never swap a seed to a
  lucky one, never move a bound); re-pin a golden only with a note on why.
- [ ] **Step 2:** Docs, version, changelog; `npx vitest run src/ui/changelog`; `npm run format`.
- [ ] **Step 3: Commit** "0.5.0: discipline and players off the field".
