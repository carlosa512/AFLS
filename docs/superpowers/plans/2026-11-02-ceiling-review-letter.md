# Ceiling Review Letter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-player "has hit a wall / is outplaying his grades" letters with one scouting director's
letter when our season ends, worded by the player's year.

**Architecture:** One function in `src/engine/inbox.ts` (`ceilingReviewMail`) replaces `ceilingMail` in the same
`deliverMail` slot. It reads each young player's settled shift through our scouts' view (as `ceilingMail` does now),
sorts players into three `MailSection` tables, and writes the body through `say` (`voice.ts`). No change to
`League`'s shape, no UI change: digests already render `sections`.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-ceiling-review-letter-design.md`

## Global Constraints

- Id `ceilingReview:${season}`; `mailSubject` reads it as `{ kind: 'ceilingReview', season }`. The old `ceiling`
  kind stays in `mailSubject` for old saves.
- From `director(league)`, category `staff`, subject exactly `How the young players' year went`.
- Stamp `phase: league.phase, week: league.week` (never a hard-coded 0).
- The move is our read, never the true shift: `perceive(league, team.id, p).potMid` minus the same for
  `{ ...p, potential: p.potential - shift }`. Ahead `>= 1`, behind `<= -1`.
- Sections in order, each only with rows: `Ahead of our grades`, `Who we thought he was`, `Behind our grades`.
  Columns exactly `['Player', 'Pos', 'Age', 'Came in', 'Our read']`.
- "Came in": `` `${d.season} R${d.round}, No. ${d.pick}` `` when `p.draft`, else `Undrafted`.
- "Our read" lines, copied exactly (year = `settleYear(p)`: 0 rookie, 1 second, 2 third):

  | Year | Ahead | Who we thought | Behind |
  | --- | --- | --- | --- |
  | 0 | `Playing above his draft grade.` | `Right on his draft grade.` | `Behind where we had him coming out. Still early.` |
  | 1 | `More upside than we gave him credit for.` | (not listed) | `Hasn't taken the second-year step.` |
  | 2 | `Still climbing past our projection.` | (not listed) | `Close to his ceiling: what you see is about what you get.` |

- Commits end with the session's attribution lines. Never put a model name in a commit or file.
- `npm run format` before committing; no sims (the sim never reads the inbox).

## Review Focus

1. **A team that missed the playoffs:** its young players settle at the end of week 18; the letter should file in
   the first playoff `deliverMail` (no unplayed game of ours). Pinned by Task 1's "missed the playoffs" test.
2. **The champion:** our season ends with the final, phase `complete`; the letter must still file. Pinned by
   Task 1's "complete" test.
3. **Nothing to say:** no mover and no rookie settled: no letter (not an empty one). Pinned by Task 1's "quiet
   season" test.
4. **A save that already has old one-offs this season** (the owner's playtest save): no second telling. Pinned by
   Task 1's "old saves" test.
5. **A retired or departed player** with a shift: not listed (`teamPlayers`, `!p.retired`). Covered by building
   from `teamPlayers`; the "other club" assertion in test 1 pins the departed case.

---

### Task 1: `ceilingReviewMail` replaces `ceilingMail`

**Files:**
- Modify: `src/engine/inbox.ts` (the `mailSubject` union near line 739 and its `case 'ceiling'` near line 870;
  `ceilingMail` at ~2528–2566; the `deliverMail` call at ~2925)
- Test: `src/engine/inbox.test.ts` (replace the `describe('ceiling mail', …)` block at ~1519–1556)

**Interfaces:**
- Consumes: `settleYear(p)` from `./development`; `perceive` (already imported); `director`, `Draft` from
  `./senders`; `say`, `recentBodies`, `type Line` from `./voice`; the local `small` and `teamPlayers`.
- Produces: `function ceilingReviewMail(league: League, have: Set<string>): Draft[]` (module-local);
  `MailSubject` member `{ kind: 'ceilingReview'; season: number }`.

- [ ] **Step 1: Write the failing tests** (replace the old block; keep its `setup` shape)

Setup helper: `createLeague({ seed: 'ceiling-mail' })`, `phase = 'playoffs'`, and our season over by dropping our
games: `league.games = league.games.filter((g) => g.homeId !== user && g.awayId !== user)`. Pick our young players
by `experience` (0, 1, 2) with `p.age <= 23 && p.potential - playerOvr(p) >= 4`, and one of another club's. Give
shifts via `p.ceilingShifts = { [league.season]: shift }`. `review = () => league.inbox!.filter((m) =>
m.id === \`ceilingReview:${league.season}\`)`; `section = (m, title) => m.sections?.find((s) => s.title === title)`.

```ts
it('one letter from the director for several movers, none for another club', () => {
  // rookie +3, second-year -3, other club's player -3
  deliverMail(league);
  const [m] = review();
  expect(review()).toHaveLength(1);
  expect(m.from).toMatch(/Director of scouting|Scouting department/);
  expect(m.subject).toBe("How the young players' year went");
  expect(section(m, 'Ahead of our grades')!.rows.map((r) => r.playerId)).toEqual([rookie.id]);
  expect(section(m, 'Behind our grades')!.rows.map((r) => r.playerId)).toEqual([second.id]);
  expect(m.sections!.flatMap((s) => s.rows).some((r) => r.playerId === theirs.id)).toBe(false);
  expect(section(m, 'Ahead of our grades')!.columns).toEqual(['Player', 'Pos', 'Age', 'Came in', 'Our read']);
  expect(league.inbox!.some((x) => x.id.startsWith(`ceiling:${league.season}:`))).toBe(false);
});

it('files once', () => { deliverMail(league); deliverMail(league); expect(review()).toHaveLength(1); });

it('waits while we are still playing', () => {
  league.games.push({ ...anyGame, season: league.season, homeId: user, result: undefined });
  deliverMail(league);
  expect(review()).toHaveLength(0);
});

it('files for the champion once the season is complete', () => {
  league.phase = 'complete'; deliverMail(league); expect(review()).toHaveLength(1);
});

it('a rookie behind reads early, never final', () => {
  // rookie -3
  const row = section(m, 'Behind our grades')!.rows.find((r) => r.playerId === rookie.id)!;
  expect(row.cells.at(-1)).toBe('Behind where we had him coming out. Still early.');
  expect(m.sections!.flatMap((s) => s.rows).filter((r) => r.playerId === rookie.id)
    .some((r) => r.cells.join(' ').includes('what you see is about what you get'))).toBe(false);
});

it('a third-year behind reads close to his ceiling', () => {
  // third-year -3
  expect(rowFor(third).cells.at(-1)).toBe('Close to his ceiling: what you see is about what you get.');
});

it('who we thought: a rookie who held is listed, a second-year who held is not', () => {
  // rookie 0.2, second-year 0.2
  expect(section(m, 'Who we thought he was')!.rows.map((r) => r.playerId)).toEqual([rookie.id]);
  expect(m.sections!.flatMap((s) => s.rows).some((r) => r.playerId === second.id)).toBe(false);
  expect(rowFor(rookie).cells.at(-1)).toBe('Right on his draft grade.');
});

it('a quiet season files nothing', () => {
  // second-year 0.2 only, no rookie shifted
  deliverMail(league); expect(review()).toHaveLength(0);
});

it('carries the real week', () => { league.week = 20; deliverMail(league); expect(review()[0].week).toBe(20); });

it('came in: a draft line or undrafted', () => {
  rookie.draft = { season: league.season, round: 1, pick: 12, teamId: user };
  expect(rowFor(rookie).cells[3]).toBe(`${league.season} R1, No. 12`);
  // a player with no draft line
  expect(rowFor(undrafted).cells[3]).toBe('Undrafted');
});

it('old saves: an old one-off this season means no review', () => {
  league.inbox = [{ ...someMessage, id: `ceiling:${league.season}:${rookie.id}` }];
  deliverMail(league);
  expect(review()).toHaveLength(0);
});

it('mailSubject reads it back', () => {
  expect(mailSubject(review()[0])).toEqual({ kind: 'ceilingReview', season: league.season });
});
```

A rookie needs `settleYear(p) === 0` (experience 0, age < 26). If the seed has no suitable player at a year, set
`p.experience` on a young player of ours directly. For "missed the playoffs" (Review Focus 1), the default setup is
that case: phase `playoffs` with none of our games left; the first test covers it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/engine/inbox.test.ts -t "ceiling"`
Expected: FAIL (no `ceilingReview:` letter; old per-player letters filed instead)

- [ ] **Step 3: Implement `ceilingReviewMail(league: League, have: Set<string>): Draft[]` in `src/engine/inbox.ts`**

Replace `ceilingMail` (and its doc comment) with it; change the `deliverMail` line to call it (keep the
`playoffs || complete` guard). Order of work:

1. Return `[]` when `have.has(id)`, when our season isn't over (phase `complete`, or `playoffs` with no
   `league.games` entry of this season, without `result`, where we are home or away), or when
   `league.inbox` has any id starting `` `ceiling:${season}:` ``.
2. For `teamPlayers(league, team.id)`, not retired, with `p.ceilingShifts?.[season]` defined and
   `settleYear(p) !== null`: compute `moved` as in Global Constraints and bucket ahead / held-rookie / behind.
   Skip held non-rookies.
3. Return `[]` when all three buckets are empty.
4. Sort each bucket: year ascending, then `|moved|` descending, then id.
5. Rows: `{ playerId, cells: [fullName(p), p.position, String(p.age), cameIn(p), READ[verdict][year]] }`.
6. Body: an `OPENER` bank (`Line<{ ahead: number; behind: number; held: number; rookieBehind: boolean }>[]`)
   through `say(OPENER, facts, { key: id, slot: 'opener', recent: recentBodies(league, sender.from) })`, then the
   second sentence: `The rest of this year's class is about who we thought.` when `held > 0`, else
   `It's early for the rookies: their ceilings have two more seasons to settle.` when a rookie is behind, else
   none. Opener lines (numbers through `small`):
   - ahead and behind: `With the season done, ${small(ahead)} of our young players ${look} better than we graded them and ${small(behind)} ${are} behind where we had them.`
   - only behind: `With the season done, ${small(behind)} of our young players ${are} behind where we had them.`
   - only ahead: `With the season done, ${small(ahead)} of our young players ${look} better than we graded them.`
   - neither: `With the season done, the young players are tracking where we had them.`
   Verbs agree with their own count: `look` is `looks` when ahead is 1, `are` is `is` when behind is 1 ("one of
   our young players looks…"). Add one alternate wording for each of the first three cases so `say` can rotate
   (e.g. "Now the season's over, …").
7. Draft: `{ id, season, phase: league.phase, week: league.week, ...director(league), category: 'staff', subject,
   body, sections, covered: movers.map((p) => \`ceiling:${season}:${p.id}\`), actions: [{ kind: 'team', teamId:
   team.id }] }`.

Add `| { kind: 'ceilingReview'; season: number }` to the `mailSubject` union and
`case 'ceilingReview': return { kind: 'ceilingReview', season };` beside `case 'ceiling'`. Import `settleYear` from
`./development` if not already imported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/engine/inbox.test.ts`
Expected: PASS, whole file (other mail tests unaffected)

- [ ] **Step 5: Typecheck and the mail view's tests**

Run: `npm run typecheck && npx vitest run src/ui/mail.test.tsx src/ui/ui.test.ts`
Expected: no errors; PASS. If `ui/mail.tsx` switches exhaustively on `mailSubject` kinds and the typecheck flags
`ceilingReview`, give it no card (fall through like other table-only digests).

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/engine/inbox.ts src/engine/inbox.test.ts
git commit -m "Young players' review: one director's letter at season's end replaces the per-player ceiling mail"
```

### Task 2: Version, look at it, push

**Files:**
- Modify: `package.json` (`"version": "0.2.45"` → `"0.2.46"`)

**Interfaces:**
- Consumes: Task 1's letter.

- [ ] **Step 1: Bump the version** to `0.2.46` (a fix, `docs/VERSIONING.md`). `docs/MVP.md` unchanged.

- [ ] **Step 2: See the letter once**

Load the owner's save (`/root/.claude/uploads/be014b8d-70c8-56f4-af50-0f1e37844d66/3a567059-afls-ten-2026-playoffs.json`)
in a scratch script, `migrateLeague`, strip its `ceiling:2026:*` messages, run `deliverMail`, and print the new
letter's subject, body and section rows. Expected: one letter, three ahead (Marshall, Stevenson, Patterson), ten
behind, the rookies who held under "Who we thought he was", no rookie with the "Close to his ceiling" line, week
20.

- [ ] **Step 3: Commit and push**

```bash
npm run format
git add package.json
git commit -m "0.2.46"
git push -u origin claude/sleepy-davinci-iuemp8
```

Then open the PR only when the owner asks, and read CI on it.
