# Morale Core (G1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every rostered player gets a mood (a hybrid of where he stands and recent big moments) that you see as a
coloured smiley in tables and a pill on his card; the player card's header becomes pills only. No effect on play.

**Architecture:** A new pure module `morale.ts` works out five factor scores and a resting level into a target,
moves the stored level part of the way there each week (and at each offseason step), and keeps up to four fading
jolts. Screens read it only through `moraleView` (your players only). A `npm run morale` check plays seasons and
holds the league's moods to ranges. UI: a `MoodFace` SVG and a `MoodPill`, a Mood column on Roster, a Morale section
on the Locker Room screen and in the head coach's locker room report, and the player card cleanup.

**Tech Stack:** TypeScript, React, Vitest; scripts run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-29-morale-core-design.md`

## Global Constraints

- Engine pure: no DOM, no `Math.random`, and morale draws **nothing** from any `Rng` stream (a pure function of the
  league's state and history). Adding it must not change any existing RNG sequence: AI decisions, games and
  development must come out identical (G1 has no effects).
- Scale −10…+10, 0 is Okay; bands and words exactly as the spec's "seven steps" table.
- Hidden traits read only through their accessors (`temperamentOf` from `traits.ts`); agent dials from
  `p.personality` (`greed`, `loyalty`, `winning`, `patience`, all 0–1). Trait z-scores use `TRAIT_MEAN` (10.5) and
  SD 3.5.
- Screens never read `p.morale` directly: only `moraleView(league, p)`, which is `null` for any player not on the
  user's team. No number ever reaches a screen (words, steps, smileys).
- `League` stays plain JSON: `SAVE_VERSION` 66 → 67, an upgrade step that seeds every rostered player at his target.
- Every sentence of new prose through `say` (`voice.ts`); the head coach's lines in `lockerVoice.ts`.
- Checks a session runs: `npm run typecheck`; `npx vitest run --maxWorkers=2 <touched files>` (two workers: the
  container runs out of memory with more); `npm run format` before each commit; `npm run morale` from Task 3 on.
  CI runs the rest (sim, careers, audit…; they must stay green and unchanged since G1 has no effects).
- Ship: `package.json` 0.2.20 → 0.2.21, a `src/ui/changelog.ts` entry, the `morale.ts` line in `CLAUDE.md`'s
  architecture list, and the new check in `CLAUDE.md`'s command list.
- **Review checkpoints:** screenshots via `npm run mail-preview` / `npm run screens` (dark theme, desktop and phone)
  sent to the owner with `SendUserFile` (`status: 'proactive'`); keep going, fold input in when it arrives.

## Review Focus

- A player traded mid-season: his role, team and locker-room factors switch to the new club; his jolts stay (a
  "friend gone" jolt lands on the friend left behind, not on him twice).
- A save loaded from v66 mid-season: every rostered player starts at his target, nobody at 0 by default, no jolts
  invented from history.
- Free agents, retired players and draft prospects: no target beyond "wants a job" for free agents; retired and
  prospects carry no morale at all (and the save doesn't grow by them).
- Performance: `moraleWeek` runs for ~1,700 players every week; market and records must be read once per week, not
  once per player (`leagueMarket`, `computeRecords` cached in the step).
- The Roster screen shown for another club: no Mood column (fog of war).

---

### Task 1: The morale module: factors, target, words, reasons, view

**Files:**
- Create: `src/engine/morale.ts`
- Modify: `src/engine/types.ts` (`Player.morale`, `MoraleJolt`)
- Test: `src/engine/morale.test.ts`

**Interfaces:**
- Produces:
  - `type MoraleJolt = 'benched' | 'snubbed' | 'friendGone' | 'paid' | 'captain' | 'playoffs'`
  - `Player.morale?: { level: number; jolts: { kind: MoraleJolt; size: number; season: number; week: number }[] }`
  - `interface MoraleFactors { contract: number; role: number; team: number; room: number; promises: number; rest: number }`
  - `moraleFactors(league: League, p: Player, ctx?: MoraleContext): MoraleFactors` — `MoraleContext` caches
    `leagueMarket(league)` and `computeRecords(league)` (and last season's) for one pass; built by
    `moraleContext(league)`.
    - **contract** (−4…+2): `ratio = p.contract.apy / marketApy(market, p)`;
      `score = clamp(3 * log2(ratio) * (0.6 + 0.8 * greed), −4, 2)`; negatives ×1.5 in his deal's final year
      (`yearsLeft(c, season) <= 1`); a rookie deal (`c.kind === 'rookie'`) with `experience < 3` scores
      `max(0, score)`. No contract → 0.
    - **role** (−3…+1.5): expected step from his rank by `playerOvr` in his position room on his team (rank <
      `STARTERS[pos]` → 2 starter; rank < `ceil(1.5 × STARTERS[pos])` → 1 rotation; else 0 backup), minus one step
      for `experience === 0` (floor 0); actual step from `seasonRole(league, p, season)` (starter 2, rotation 1,
      backup or null 0), this season once his team has played 3 games, else last season (no record → actual =
      expected). `score = clamp(1.5 * (actual − expected) * (experience >= 6 ? 1.3 : 1), −3, 1.5)`.
    - **team** (−2…+2): his team's win share (`(w + t/2) / games`) this season once 4 games are played, else last
      season's (none → 0.5); `score = clamp((share − 0.5) * 4 * (0.5 + winning), −2, 2)`.
    - **room** (−1.5…+1.5): +0.5 per friend on the same team (max +1), −1 for a feud with a teammate, +0.75 if he's
      one of this season's captains, +0.25 if a teammate's `mentor` is him; clamped.
    - **promises**: 0 (G3 fills it).
    - **rest** (−1.5…+1.5): `1.5 * clamp(0.4 * zTemp + (patience − 0.5) + 0.6 * (loyalty − 0.5), −1, 1)` with
      `zTemp = (temperamentOf(p) − 10.5) / 3.5`.
  - `moraleTarget(f: MoraleFactors): number` — the sum, clamped to −10…+10.
  - `moraleStepOf(level: number): 1 | 2 | 3 | 4 | 5 | 6 | 7` and `MORALE_WORDS: Record<1..7, string>` (Abysmal,
    Very poor, Poor, Okay, Good, Very good, Superb), bands per the spec (≥6, ≥3, ≥1, >−1, >−3, >−6, else).
  - `moraleReasons(league: League, p: Player, f: MoraleFactors): string[]` — up to three plain phrases, biggest
    magnitude first, from factors with |score| ≥ 0.75 and live jolts with |size| ≥ 0.75: contract− "Wants a new
    deal", contract+ "Happy with his deal", role− "Wants more snaps", role+ "Enjoying his role", team− "The losing is
    wearing on him", team+ "Loving the winning", room− "A feud in the room", room+ "Close with his teammates",
    benched "Still stung by the benching", snubbed "Noticed who got paid", friendGone "Misses a friend who left",
    paid "Just got paid", captain "Proud to wear the C", playoffs "Fired up for the playoffs".
  - `moraleView(league: League, p: Player): { step: 1..7; word: string; reasons: string[] } | null` — `null` unless
    `p.teamId === league.userTeamId` and `p.morale` exists.

- [ ] **Step 1: Failing tests** — each factor's direction and caps on a constructed league (`createLeague({ seed:
  'morale' })`): halving a starter's APY lowers contract, more so in his final year; a rookie deal in year 1 never
  goes negative; a starter-rank player with no snaps this season scores role < 0; a winning record raises team, more
  for `winning = 1` than `0`; a feud lowers room, the C raises it; rest is higher for calm/patient/loyal; the target
  is the clamped sum; every band boundary maps to its word; `moraleView` is `null` for another club's player and
  for a player with no `morale`; reasons never contain a digit.
- [ ] **Step 2: Run** — `npx vitest run --maxWorkers=2 src/engine/morale.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.**  **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `Morale: what a player's mood is made of`

---

### Task 2: Moving the mood: the weekly step, jolts, the offseason, the save

**Files:**
- Modify: `src/engine/morale.ts`, `src/engine/league.ts` (`playWeek`, beside `mentoringWeek`),
  `src/engine/offseason/index.ts` (end of `beginOffseason` and of each `advanceOffseason` case), `src/engine/generate.ts`
  (`SAVE_VERSION = 67`; new leagues seed morale at target), `src/engine/migrate.ts`
- Test: `src/engine/morale.test.ts`, `src/engine/migrate.test.ts`

**Interfaces:**
- Produces:
  - `moraleWeek(league: League): void` — for every player on a club's active roster or practice squad: detect new
    jolts (below), decay jolts (×0.5 per two weeks: `size × 0.5^(weeksSince/2)` recomputed from the stored original
    size and date, dropped when |size| < 0.25, keep the four biggest), then
    `level += rate × (target − level)` with `rate = clamp(0.25 − 0.05 × zTemp, 0.15, 0.40)`, then add the sum of
    live jolt sizes on top as `shown = clamp(level + jolts, −10, 10)` — store `level` (the slow part) and keep jolts
    separate; the word and step read `level + live jolts`. Free agents: target −1, no jolts. Retired and prospects:
    `delete p.morale`.
  - `moraleStep(league: League): void` — the same update, called at each offseason calendar step (the week index for
    decay counts offseason steps as one week each).
  - `moraleLevel(league: League, p: Player): number` — `level + live jolts`, clamped; what `moraleStepOf` reads.
  - Jolt detection (each once per cause, keyed by kind + season + week; never fires twice for the same event):
    - **benched** −3: `seasonRole` this season reads backup/rotation after 3 games while last season's read starter,
      or at the new league year his expected step fell from starter.
    - **snubbed** −2 × (0.5 + greed): a feud tie with `why === 'snubbed'` and `since === season` appears (the event
      `relationships.ts` already records).
    - **friendGone** −2: a friend's `left` entry for our team this season with `how !== 'walked'` (same as the locker
      report's friend-gone row).
    - **paid** +3: his contract is new this league year (signed this season) and its APY beats his previous one.
    - **captain** +2: he's in this season's `team.captains`.
    - **playoffs** +2: `playoffRace(league, teamId).spot` turns true this season.
  - Migrate v66 → v67: for every rostered player, `morale = { level: moraleTarget(moraleFactors(...)), jolts: [] }`.

- [ ] **Step 1: Failing tests** — `moraleWeek` twice in a row on the same week changes nothing the second time
  (idempotent per week); a level approaches its target and never leaves −10…+10 over 40 weeks; a benched starter gets
  one benched jolt that halves by two weeks later and is gone by week 12; at most four jolts; a free agent sits at
  −1; a retired player has no `morale`; running a full season with and without `moraleWeek` gives identical game
  results and AI transactions (no RNG touched); a v66 save migrates with every rostered player at his target.
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement.**  **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `Morale: the weekly step, the jolts, the offseason, save v67`

---

### Task 3: The league check (`npm run morale`)

**Files:**
- Create: `scripts/morale.ts`
- Modify: `package.json` (`"morale": "tsx scripts/morale.ts"`), `scripts/check.ts` (a `morale` check, run for changes
  to `src/engine/morale.ts` and `scripts/morale.ts`), `.github/workflows/ci.yml` (its job, matching the others)

**Interfaces:**
- `npm run morale [-- --seasons N] [--seed s]` (default 4 seasons, seed `morale-check`): plays seasons with
  `playWeek` / `beginOffseason` / `advanceOffseason({ autoUser: true })`, samples every rostered player at weeks 9 and
  18, prints one ✓/✗ line per range and exits non-zero on any ✗. Ranges (fixed here; never loosen one to get green —
  if tuning the documented constants in Tasks 1–2 can't meet one, stop and report to the owner):
  - shares of all samples: Okay through Very good ≥ 60%; Poor or worse 10–30%; Abysmal ≤ 3%; Superb ≤ 8%;
  - final-year starters (`experience ≥ 3`) paid under 0.7× market: Poor or worse ≥ 60%;
  - players who get a benched jolt: one week later their level + jolts is ≥ 1.5 below the week before; six weeks
    later within 1.5 of their target;
  - room average (mean level + jolts of a team's roster) for teams at ≥ .650 minus teams at ≤ .350 ≥ 1.0;
  - the league's mean at week 18 within ±1.0 of the first season's, every season; no level outside −10…+10.

- [ ] **Step 1:** write the script; run `npm run morale` → expect some ✗ on first run.
- [ ] **Step 2:** tune only the constants named in Tasks 1–2 (factor multipliers, caps, rate, jolt sizes) until all
  ✓; re-run Task 1–2 tests after each tune. Record each tune and why in the commit message.
- [ ] **Step 3:** `npm run morale` → all ✓; `npm run typecheck`.
- [ ] **Step 4: Commit** — `Morale: a league check that moods look like a real league`

---

### Task 4: Smileys, the Mood column and the Locker Room's Morale section

**Files:**
- Create: `src/ui/morale.tsx`
- Modify: `src/styles.css` (`--mood-1` … `--mood-7` for light and dark, under the same theme selectors as the other
  tokens), `src/ui/screens/Roster.tsx`, `src/ui/screens/LockerRoom.tsx`
- Test: `src/ui/morale.test.tsx`, `src/ui/ui.test.ts` (screen contract)

**Interfaces:**
- Produces:
  - `MoodFace({ step, size = 18, title }: { step: 1..7; size?: number; title?: string })` — inline SVG: a circle in
    `var(--mood-N)`, two eyes, and a mouth whose curve goes from a deep frown (1) through flat (4) to a big grin
    (7); `role="img"` and `aria-label` = the word (plus the reasons when `title` is given).
  - `MoodPill({ view })` — `tag-pill` in the step's colour, the word as text, reasons in its tooltip (`TipPill` if
    that's the existing tooltip pill).
  - Roster (your team only): a **Mood** column after Fitness, `SortTh` key `mood`, sorting by `moraleLevel`, the
    happiest first on the first click; cells show `MoodFace` with the word + reasons as tooltip.
  - Locker Room: a **Morale** `Section` first on the screen: the room's mood (mean of `moraleLevel` across the active
    roster → `MoodFace` + word), then "Unhappy" (step ≤ 3, worst first: face, `PlayerLink`, reasons) and "Happiest"
    (top three, step ≥ 6). Mentoring table rows get a face beside each young player's name.

- [ ] **Step 1: Failing tests** — `MoodFace` renders for every step with its word as `aria-label`; the Roster for your
  team has a Mood header and one face per row, and for another club has none; sorting by mood orders by
  `moraleLevel`; the Locker Room renders the Morale section with the room's word.
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement.**  **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Review checkpoint** — build previews from the owner's save
  (`/root/.claude/uploads/6546d6b1-b35f-5809-ae41-ea9204454acf/24b6fe63-afls-ten-2028-regular.json`; if that path is
  gone in the new session, ask the owner to re-attach it) and screenshot Roster and Locker Room, dark theme,
  desktop and phone (extend `scripts/screens.ts` with `--screens roster,locker` if needed); send them.
- [ ] **Step 6: Commit** — `Morale: smileys on the Roster and the Locker Room`

---

### Task 5: The player card: pills only, and the Morale pill

**Files:**
- Modify: `src/ui/screens/PlayerCard.tsx`, `src/ui/scouting.tsx` (`CharacterFact`, `lockerLine`)
- Test: `src/ui/character.test.tsx` (or a new `src/ui/playerCard.test.tsx`)

**Interfaces:**
- Changes (spec, "The player card cleanup"):
  - **Makeup:** pills only. `lockerLine`'s text goes; its grudge case becomes a warn pill "Holds a grudge" (tooltip:
    the old sentence), its feud case a warn pill "Feud in the room" (tooltip names him), its mentor case is dropped.
  - **Habits:** pills only; the "Has fixed: …" lines move into the Habits over time section (which shows when either
    the timeline or the fixed list is non-empty).
  - **Form:** a `tag-pill tag-bad` with the same text.
  - **Fit:** the grade as a pill (`tag-good` Ideal, `tag-bad` Poor, plain otherwise), the skills in its tooltip.
  - **Morale (new, your players):** a fact "Morale" with `MoodPill`.
  - **Read by:** the `read-by` paragraph (and its sit-down hint) moves inside the Scout's report box as its footer.

- [ ] **Step 1: Failing tests** — rendering the card for one of your players with a mentor shows no "Learning from";
  no "Has fixed:" text in the facts; the Morale pill shows his word; the read-by text sits inside `.report`; a
  rival's player with a grudge shows the "Holds a grudge" pill.
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement.**  **Step 4: Run** → PASS; `npx vitest run --maxWorkers=2 src/ui`.
- [ ] **Step 5: Commit** — `Player card: pills only up top, with his morale`

---

### Task 6: Morale in the head coach's locker room report

**Files:**
- Modify: `src/engine/lockerReport.ts`, `src/engine/lockerVoice.ts`
- Test: `src/engine/lockerReport.test.ts`, `src/engine/lockerVoice.test.ts`

**Interfaces:**
- A **Morale** section in each check-in (after Captains, before Mentoring), only with rows: players at step ≤ 3, worst
  first (cells: name, word; note through a new `MORALE_NOTE` bank keyed on his top reason, e.g. role− "Davis is
  sulking about snaps. I'd talk to him before it spreads.", contract− "He's watching what the market pays. It's on
  his mind.", team− "The losing is getting to him."); then up to two at step 7 (note: "Couldn't be happier.").
  Each row's key `morale:{season}:{checkin}:{playerId}` in `covered`. The verdict bank gains a fact `unhappy: number`
  with one or two lines for `unhappy ≥ 3` ("A few guys are down. I'm on it.").

- [ ] **Step 1: Failing tests** — a check-in with two Poor players lists both, worst first, with a note each; none
  at step ≤ 3 → no section; no text matches `BANNED` or contains a digit.
- [ ] **Step 2: Run** → FAIL.  **Step 3: Implement.**  **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `Locker room report: who's down and who's flying`

---

### Task 7: Wrap-up, review, PR

- [ ] **Step 1:** `npx vitest run --maxWorkers=2 src/ui`, then `src/engine` in two halves; `npm run typecheck`;
  `npm run format:check`; `npm run morale`.
- [ ] **Step 2:** version 0.2.21; changelog "Morale": every player has a mood now, shown as a smiley on the Roster
  and Locker Room and a pill on his card, with the reasons; the player card is cleaner up top. `CLAUDE.md`: the
  `morale.ts` architecture line and the `npm run morale` command line.
- [ ] **Step 3:** final screenshots (Roster, Locker Room, a player card, the locker report's Morale section), desktop
  and phone, sent to the owner.
- [ ] **Step 4:** a fresh whole-branch review (most capable model) with this plan's Review Focus; fix Critical and
  Important findings test-first; ledger the rest.
- [ ] **Step 5:** push, open the PR (template: What changed / Why / `npm run check`), subscribe to it, drive CI green.
