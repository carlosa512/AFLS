# Draft Room Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Draft screen gets a pick rail (every pick, made and to come, with rivals' needs), your needs line in
the clock panel, a slim "Your lineup" table, a Need tag and filter on the big board, and a shorter Draft history.

**Architecture:** A pure, read-only engine module (`src/engine/draftNeeds.ts`) works out needs as the draft opened,
what's been filled, and your lineup rows, on your scouts' read and your schemes' starting spots, over two
behaviour-neutral additions to `trade/plans.ts`. A new UI file (`src/ui/draftRoom.tsx`) draws the pieces;
`screens/Draft.tsx` lays them out in a two-column draft room from 1,290 pixels wide.

**Tech Stack:** TypeScript, React 18, Vitest (`renderToStaticMarkup` for UI tests), plain CSS in `src/styles.css`.

**Spec:** `docs/superpowers/specs/2026-11-19-draft-room-rail-design.md` (read it first; this plan argues from it).

## Global Constraints

- Engine code is pure: no DOM, no `Math.random`, draws nothing from any `Rng`, stores nothing on `League`. No
  `SAVE_VERSION` change.
- `needsOn` and `scoutedNeeds` called without the new arguments return exactly what they return today (AI needs,
  trades and drafts unchanged).
- Fog of war: no `p.ratings`, `player.ratings`, `playerOvr`, `.potential` in `src/ui` (`ui.test.ts`, "never reads the
  truth"). Grades on screen go through `Ovr`; rivals' needs and the typical starter through your read (`ctx.view`).
- Names: players through `PlayerLink`, teams through `TeamLink` or `TeamChip`. Going to another screen: `MoreLink`.
- Icons only through `Icon` (`src/ui/icons.tsx`): never type `✓`, `▾`, `▴` or other glyphs in `src/ui` source
  (`ui.test.ts`, "draws icons only through Icon"). The check is `<Icon name="check" />`.
- CSS text sizes only from `var(--step-*)` (or `16px`); uppercase labels only through the `.eyebrow` / `.eyebrow-sm`
  classes, never `text-transform: uppercase` in a new rule (`ui.test.ts`, "sizes app text from the scale").
- Colors from theme tokens (`--loss`, `--win`, `--tie`, `--marker`, `--surface`, `--surface-2`, `--line`, `--muted`,
  `--ink`), so dark mode follows.
- Layout numbers: the rail shows from `min-width: 1290px`, is `340px` wide, and the draft room widens `main.wrap` to
  `1500px` (`main.wrap:has(.draft-room)`), as `main.wrap:has(.game-stage)` does for the game stage.
- Tier thresholds on severity: **big** ≥ 0.6, **need** ≥ 0.3, else **minor** (no color).
- Copy, exactly: "Your needs", "Big need", "Need", "Drafted", "next year", "No pressing needs", "Your lineup",
  "Depth chart", "Pos", "Have", "Weakest starter", "Grade", "Typical", "Good fit", "Average fit", "Poor fit",
  "Picks", "Your pick", "You're on the clock", "On the clock", "Needs only", "Last two drafts", "Show N more".
  Tooltips: Have "On the roster / what your schemes call for"; Typical "The league's typical starter here, as your
  scouts read the league". No paragraph that describes a panel or explains a control (`docs/UI.md`, "Words on a
  screen").
- Locally run only `npm run typecheck`, the touched tests (`npx vitest run <file>`), `npm run format` and
  `npm run copy`. No sims, never `npm run check`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01M3omQtWiATfVPZSGX9u2Ud
  ```

## Review Focus

1. **You're between GM jobs** (`employed(league)` false): no needs line, no lineup, the rail lists picks without
   needs. Pinned in Task 3 (`useDraftRoom` returns null) and Task 4 (`PickRail` with no room).
2. **The draft is done** (`clockState` is `done`): the rail lists every pick, no row is on the clock, the needs line
   is gone, nothing throws. Pinned in Task 4.
3. **Before the first pick** (`preview`): the rail lists the order with needs and nothing made; the needs line
   shows. Pinned in Task 4 and Task 5.
4. **A scheme that starts no tight end** (10 personnel): no TE need, the TE row shows a dash for starter, grade and
   typical, nothing throws. Pinned in Task 2 and Task 3.
5. **A team with no needs left**: the needs line says "No pressing needs" (and still lists drafted positions).
   Pinned in Task 3.

---

### Task 1: Scheme counts, the viewer's line and severity in `trade/plans.ts`

**Files:**

- Modify: `src/engine/trade/plans.ts` (`lineOn` ~180, `needsOn` ~210, `scoutedNeeds` ~244, `NEED_WEIGHT` ~165)
- Modify: `src/engine/trade/context.ts:52` (the `viewLines` cache key)
- Test: `src/engine/trade/needs.test.ts`

**Interfaces:**

- Produces:
  - `needsOn(league: League, roster: readonly Player[], line: Record<Position, number>, ovr: (p: Player) => number, starters: Record<Position, number> = STARTERS): Need[]`
    — a position whose `starters[pos]` is 0 is skipped.
  - `scoutedLine(ctx: TradeContext, viewerId: number, starters: Record<Position, number> = STARTERS): Record<Position, number>`
    — the league's median starter on `viewerId`'s read, pooling each team's top `starters[pos]` at each position;
    cached in `ctx.viewLines`, now `Map<string, Record<Position, number>>` keyed
    `` `${viewerId}:${POSITIONS.map((p) => starters[p]).join(',')}` ``.
  - `littleFilm(ctx: TradeContext, viewerId: number, team: Team): boolean` — today's `scoutedNeeds` film rule,
    extracted.
  - `needSeverity(n: Need): number` — `n.urgency / NEED_WEIGHT[n.position]`, clamped to 0…1 (a hole is 1).
  - `scoutedNeeds` keeps its signature and result, built from `scoutedLine(ctx, viewerId)` and `littleFilm`.

- [ ] **Step 1: Write the failing tests** (append to `needs.test.ts`):

```ts
describe('scheme counts', () => {
  const l = createLeague({ seed: 'needs-scheme' });
  l.phase = 'draft';
  const ctx = tradeContext(l);
  const roster = rosterOf(ctx, l.teams[0].id);
  const tes = roster.filter((p) => p.position === 'TE');
  // Everyone reads 15 but the second tight end, who reads 5; the line is 12 everywhere.
  const ovr = (p: Player) => (p === tes[1] ? 5 : 15);
  const line = Object.fromEntries(POSITIONS.map((p) => [p, 12])) as Record<Position, number>;
  const at = (pos: Position, xs: Need[]) => xs.find((n) => n.position === pos);

  it('measures the S-th starter when a scheme starts more at a position', () => {
    expect(at('TE', needsOn(l, roster, line, ovr))).toBeUndefined();
    expect(at('TE', needsOn(l, roster, line, ovr, { ...STARTERS, TE: 2 }))?.reason).toBe('upgrade');
  });

  it('skips a position the scheme starts nobody at', () => {
    expect(at('TE', needsOn(l, roster, line, ovr, { ...STARTERS, TE: 0 }))).toBeUndefined();
  });

  it("pools each team's top S for the viewer's line; the default is scoutedNeeds' own", () => {
    const v = l.userTeamId;
    expect(scoutedLine(ctx, v)).toEqual(scoutedLine(ctx, v, STARTERS));
    expect(scoutedLine(ctx, v, { ...STARTERS, TE: 2 }).TE).toBeLessThanOrEqual(scoutedLine(ctx, v).TE);
    const seen = (p: Player) => ctx.view(v, p).ovr;
    for (const t of l.teams)
      expect(scoutedNeeds(ctx, v, t).needs).toEqual(needsOn(l, rosterOf(ctx, t.id), scoutedLine(ctx, v), seen));
  });

  it('reads severity on one scale for every position: a hole is 1', () => {
    for (const pos of POSITIONS) {
      const hole = at(pos, needsOn(l, roster.filter((p) => p.position !== pos), line, ovr));
      expect(hole?.reason).toBe('hole');
      expect(needSeverity(hole!)).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run src/engine/trade/needs.test.ts`
Expected: FAIL (`scoutedLine`, `needSeverity` not exported; `needsOn` ignores a fifth argument).

- [ ] **Step 3: Implement** the Interfaces above in `plans.ts`: `lineOn(ctx, ovr, starters = STARTERS)` slices
      each team's top `starters[pos]`; `needsOn` reads `S = starters[pos]` and `continue`s when it is 0; change the
      `viewLines` type in `context.ts` to `Map<string, Record<Position, number>>`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run src/engine/trade/needs.test.ts && npm run typecheck`
Expected: all PASS, including the existing "needsOn with true ratings is teamNeeds" parity test.

- [ ] **Step 5: Commit** `git add src/engine/trade/plans.ts src/engine/trade/context.ts src/engine/trade/needs.test.ts`
      with the message "Needs: scheme starter counts, the viewer's line and severity".

---

### Task 2: `src/engine/draftNeeds.ts`: needs as the draft opened, filled, and your lineup

**Files:**

- Create: `src/engine/draftNeeds.ts`
- Test: `src/engine/draftNeeds.test.ts`

**Interfaces:**

- Consumes: Task 1's `needsOn`, `scoutedLine`, `littleFilm`, `needSeverity`; `rosterOf`, `TradeContext` from
  `trade/context.ts`; `spotsFor`, `TeamScheme` from `schemes.ts`; `ROSTER_TEMPLATE`, `STARTERS` from `positions.ts`.
- Produces:
  ```ts
  export type NeedTier = 'big' | 'need' | 'minor';
  export interface DraftNeed extends Need { filled: boolean; tier: NeedTier }
  export interface TeamDraftNeeds { needs: DraftNeed[]; littleFilm: boolean }
  export interface LineupRow {
    position: Position;
    have: number;            // rosterOf at the position, this year's draftees included
    want: number;            // ROSTER_TEMPLATE[pos] + starters[pos] − STARTERS[pos]
    starters: Player[];      // depth chart's first starters[pos] ids that play the position
    weakest: Player | null;  // lowest ctx.view(viewerId, p).ovr among starters; null when starters[pos] is 0
    typical: number | null;  // scoutedLine(ctx, viewerId, starters)[pos]; null when starters[pos] is 0
    need: DraftNeed | null;
    picks: Player[];         // this year's draftees at the position, on the team now
  }
  export function needTier(n: Need): NeedTier;                       // severity ≥ 0.6 big, ≥ 0.3 need, else minor
  export function schemeStarters(scheme: TeamScheme): Record<Position, number>; // spotsFor(scheme, pos).length
  export function draftedThisYear(ctx: TradeContext, teamId: number): Player[];  // on the team, draft.season === season
  export function rosterAtOpen(ctx: TradeContext, teamId: number): Player[];     // rosterOf minus draftedThisYear
  export function draftNeeds(ctx: TradeContext, viewerId: number, team: Team, starters?: Record<Position, number>): TeamDraftNeeds;
  export function shownNeeds(needs: DraftNeed[], n?: number): DraftNeed[]; // first n (default 5) unfilled, then every filled
  export function lineupRows(ctx: TradeContext, viewerId: number, team: Team, scheme: TeamScheme): LineupRow[]; // POSITIONS order
  ```
  `draftNeeds` = `needsOn(league, rosterAtOpen(ctx, team.id), scoutedLine(ctx, viewerId, starters), (p) => ctx.view(viewerId, p).ovr, starters)`,
  each with `filled` (a `draftedThisYear` player at that position) and `tier`, plus `littleFilm(ctx, viewerId, team)`.

- [ ] **Step 1: Write the failing tests** in `draftNeeds.test.ts`. Setup per test: `createLeague({ seed: 'draft-needs' })`,
      `l.phase = 'draft'`, and to make a draftee mark a roster player before building the context:
      `p.draft = { season: l.season, round: 1, pick: 5, teamId: p.teamId!, rank: 5 }`.

```ts
it('reads needs as the draft opened: this year's draftees are left out', () => {
  // Mark the team's best TE a draftee: rosterAtOpen has no him, rosterOf still does.
  expect(rosterAtOpen(ctx, t.id)).not.toContain(te);
  expect(rosterOf(ctx, t.id)).toContain(te);
});
it('marks a need filled once the team has drafted at the position', () => {
  // Empty the CB room except one draftee CB: the CB need (a hole at the open) has filled === true.
});
it('wants 4 TE and 5 WR in 12 personnel, 2 TE and 7 WR in 10', () => {
  const power = { offense: OFF_SCHEMES.power, front: FRONTS.fourThree, coverage: null };
  const air = { offense: OFF_SCHEMES.airRaid, front: FRONTS.fourThree, coverage: null };
  const row = (s: TeamScheme, pos: Position) => lineupRows(ctx, l.userTeamId, l.teams[l.userTeamId], s).find((r) => r.position === pos)!;
  expect([row(power, 'TE').want, row(power, 'WR').want]).toEqual([4, 5]);
  expect([row(air, 'TE').want, row(air, 'WR').want]).toEqual([2, 7]);
});
it('has no TE need, starter or typical in 10 personnel, and does not throw', () => {
  const te = row(air, 'TE');
  expect([te.need, te.weakest, te.typical, te.starters.length]).toEqual([null, null, null, 0]);
});
it("reads a rival's needs through your scouts", () => {
  // For some team t ≠ yours, draftNeeds(ctx, you, t).needs (positions and urgencies) differs from teamNeeds(ctx, t).
});
it('lists the top five unfilled needs, then every filled one', () => {
  // shownNeeds over 7 unfilled + 1 filled DraftNeeds → 6 items, the last one filled, order kept.
});
it('tiers by severity: a hole is big at every position, K and P included', () => {
  // As in Task 1's severity test: for each pos, the hole from needsOn on the roster without that position.
  expect(needTier(hole)).toBe('big');
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/engine/draftNeeds.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/engine/draftNeeds.ts` per the Interfaces, with a header comment saying what it is
      (the draft room's read of needs; record-keeping nothing, drawing nothing).
- [ ] **Step 4: Run and see them pass.** `npx vitest run src/engine/draftNeeds.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** "Draft needs: as the draft opened, filled, and your lineup".

---

### Task 3: Your needs line and your lineup card (`src/ui/draftRoom.tsx`)

**Files:**

- Create: `src/ui/draftRoom.tsx`
- Modify: `src/ui/screens/Draft.tsx` (move `DraftDayPill` out, ~731, import it back)
- Modify: `src/styles.css` (a "draft room" block after the existing draft room rules ~3897)
- Test: `src/ui/draftRoom.test.tsx`

**Interfaces:**

- Consumes: Task 2's module; `tradeContext` (`trade/context.ts`); `teamScheme` (`coaching.ts`); `employed`
  (`employment.ts`); `schemeFitOf`, `Ovr` (`ui/scouting.tsx`); `offenseLabel`, `defenseLabel`, `PERSONNEL_LABEL`
  (`schemes.ts`); `Section`, `PlayerLink`, `MoreLink` (`components.tsx`); `Icon`.
- Produces:
  ```ts
  export interface DraftRoom {
    mine: DraftNeed[];                       // your needs, your schemes' counts
    rows: LineupRow[];
    scheme: TeamScheme;
    byTeam: Map<number, TeamDraftNeeds>;     // every other team, default counts
  }
  export function useDraftRoom(league: League): DraftRoom | null; // null when !employed(league)
  export function NeedPill(props: { need: DraftNeed; count?: { have: number; want: number }; large?: boolean; plain?: boolean }): JSX.Element;
  export function NeedsLine(props: { room: DraftRoom }): JSX.Element;
  export function LineupCard(props: { league: League; room: DraftRoom; id: string; defaultOpen?: boolean }): JSX.Element;
  export function DraftDayPill(props: { value: 'reach' | 'steal' | null }): JSX.Element | null; // moved, unchanged
  ```
  `useDraftRoom` builds one `tradeContext(league)` in a `useMemo` keyed by
  `` `${league.season}:${league.phase}:${picksMade}` `` (`picksMade` = picks of `draftOrder(league)` with a
  `playerId`), since the league is mutated in place.

- Behaviour:
  - `NeedPill`: class `need-pill` plus `big` / `need` by tier (minor: no tier class; `plain`: no tier class
    whatever the tier, for rivals); filled: the position in `<s>`
    and `<Icon name="check" />`, class `done`; `reason === 'nextYear'`: class `early` (dashed) and " next year" after
    the position; `count`: `<span className="need-count">{have}/{want}</span>`, with class `short` when have < want.
  - `NeedsLine`: `<span className="eyebrow">Your needs</span>`, `shownNeeds(room.mine)` as large pills with counts
    from `room.rows`, then a key (Big need, Need, Drafted with the check icon). No unfilled needs: "No pressing
    needs" before any filled pills.
  - `LineupCard`: `<Panel className="lineup-card"><Section id={id} title="Your lineup" defaultOpen={defaultOpen}>`
    (as Draft history wraps its `Section`), inside it a `MoreLink to={{ view: 'roster' }}`
    "Depth chart", the scheme line (`offenseLabel(scheme.offense.id)` · `PERSONNEL_LABEL[...]` ·
    `defenseLabel(scheme.front.id, scheme.coverage?.id)`), then `table.lineup` in POSITIONS order (fixed order on
    purpose, like the depth chart: no `SortTh`) with a gap row between offense, defense and kickers. Columns: Pos
    (`NeedPill` for big/need/filled, else plain text), Have (`have/want`, `short` class when have < want, the
    tooltip), Weakest starter (a `span.fit-dot fit-{grade}` from `schemeFitOf(league, weakest, scheme)?.grade` with
    the grade's words as its title, then `PlayerLink`; a filled position shows its pick instead and no grade; no
    weakest: "–"), Grade (`<Ovr>`), Typical (`typical.toFixed(1)` or "–", the tooltip). Under it the fit key.
  - CSS: `.need-pill` (`--step--1`; large `--step-0`), tiers on `--loss` (big) and `--surface-2` (need), `.done`
    struck and muted, `.early` dashed outline; `.need-count` (`--font-data`, `--step--2`), `.short` in `--loss`;
    `table.lineup` compact (`--step--1`), `.fit-dot` 7px circle, `--win` Ideal/Good, `--tie` Average, `--loss` Poor.

- [ ] **Step 1: Write the failing tests** in `draftRoom.test.tsx`. Fixture (once per file, like
      `draftGrade.test.ts`' `clockState`): `createLeague({ seed: 'draft-room' })`, `simToEndOfSeason`, `beginOffseason`,
      advance to `draft`, `simDraft(l, new Rng('draft-room'), { stopAtUser: true })`, then `draftForUser(l)` and
      `draftToUserPick(l)` so one of your picks is made; keep it as JSON and parse per test. Render through a tiny
      `function Room({ league, children })` that calls `useDraftRoom` (hooks need a component).

```ts
it('shows your needs with counts, the drafted position struck with a check', () => {
  // html contains 'Your needs', a need-pill with `${have}/${want}` for the first shown need,
  // and for the position you drafted: <s>POS</s> and the check icon's markup.
});
it('says No pressing needs when nothing is left unfilled', () => {
  // NeedsLine with room.mine mapped to filled: true → contains 'No pressing needs'.
});
it('draws the lineup in position order with have/want, your grade and the typical starter', () => {
  // LineupCard html: 'Your lineup', 'Depth chart', the scheme label, rows QB…P in order, each 'have/want',
  // the weakest starter's name, and a Typical number with one decimal.
});
it('shows a dash for a position the scheme starts nobody at', () => {
  // room with scheme = air raid (10 personnel) and rows from lineupRows(ctx, you, team, air): the TE row has '–'.
});
it('gives no room when you are between jobs', () => {
  // league.gms[league.userGmId].teamId = null → useDraftRoom returns null (the Room probe renders nothing).
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/ui/draftRoom.test.tsx` → FAIL (module missing).
- [ ] **Step 3: Implement** `draftRoom.tsx` and the CSS per the Interfaces and Behaviour above; move `DraftDayPill`.
- [ ] **Step 4: Run and see them pass.**
      `npx vitest run src/ui/draftRoom.test.tsx src/ui/ui.test.ts src/ui/draftTrades.test.tsx && npm run typecheck` →
      PASS (the screen contract included).
- [ ] **Step 5: Commit** "Draft room: your needs line and your lineup".

---

### Task 4: The pick rail and the pick strip

**Files:**

- Modify: `src/ui/draftRoom.tsx`
- Modify: `src/styles.css`
- Test: `src/ui/draftRoom.test.tsx`

**Interfaces:**

- Consumes: `DraftRoom`, `NeedPill`, `DraftDayPill` (Task 3); `draftOrder`, `nextPick` (`offseason/draft.ts`);
  `reachOrSteal`; `TeamChip`, `TeamLink`, `PlayerLink`.
- Produces:
  ```ts
  export function PickRail(props: { league: League; room: DraftRoom | null }): JSX.Element;
  export function PickStrip(props: { league: League; room: DraftRoom | null }): JSX.Element;
  ```

- Behaviour:
  - `PickRail`: `<section className="panel pick-rail">` with a head ("Picks" as the panel's `h2`, a
    `select aria-label="Jump to round"` of rounds 1–`ROUNDS`, defaulting to the clock's round), then
    `ol.pick-list` (its own scroll) with a `li.pick-round` per round ("Round N", `.eyebrow-sm`, sticky), and a
    `li.pick-row` per pick of `draftOrder(league)`:
    - made: No. (`.pick-no`), `TeamChip`, position, `PlayerLink`, `DraftDayPill` from
      `reachOrSteal({ pick: pk.overall!, rank: pk.consRank })`, "via ABBR" when `originalTeamId !== ownerId`;
    - to come: No., `TeamChip`, a label ("You're on the clock" / "On the clock" for `nextPick`, "Your pick" for yours,
      else `<TeamLink team={…} />`), and for other teams their first three `room.byTeam` needs as
      `<NeedPill plain />`, dashed (`early`) when that team's `littleFilm`; with no room (between jobs), no pills;
    - `li.is-mine` for yours, `li.is-clock` for `nextPick(league)`.
    - `useRef` on the list and a `useEffect` on the clock pick's id that sets `list.scrollTop` so the clock row sits a
      third of the way down (`row.offsetTop - list.clientHeight / 3`); the round select sets `scrollTop` to that
      round's header. Never `scrollIntoView`.
  - `PickStrip`: `div.pick-strip` scrolling sideways, cards (`.pick-card`, `is-clock`) from two picks before the clock
    to twelve after (the last 14 when done); made: position and `PlayerLink`; yours to come: "Your pick" / "You're on
    the clock"; others: their needs as plain pills.
  - CSS: `.pick-rail` a flex column that fills its parent (`min-height: 0`), `.pick-list` `overflow: auto`,
    `overscroll-behavior: contain`; rows a grid (No., chip, body), `.is-clock` tinted with `--marker` at 24% over
    `--surface` and an inset 3px `--marker` edge, `.is-mine` the edge only; `.pick-round` sticky top on `--surface`;
    `.pick-strip` flex with `overflow-x: auto`, cards 150px.

- [ ] **Step 1: Write the failing tests** (same file, `describe('pick rail')`, same fixture):

```ts
it('lists every pick, the made ones with their player and the clock row marked', () => {
  // html has one li per pick of draftOrder(l) (count `class="pick-row` matches) and exactly one `is-clock`,
  // the made picks' players' names, and 'Round 1' … 'Round 7' headers.
});
it("shows a rival's needs on its picks to come, and none on yours", () => {
  // the first other team's pick after the clock carries its first need's position in a need-pill;
  // your next pick's row says 'Your pick' and has no need-pill.
});
it('marks no clock when the draft is done', () => {
  // draftToEnd on a copy → no `is-clock`, every row has a PlayerLink, renders without throwing.
});
it('lists the order with needs before the first pick', () => {
  // a copy taken before simDraft (preview): no made rows, need pills present.
});
it('lists picks without needs when you are between jobs', () => {
  // <PickRail league={l} room={null} />: every pick-row, no need-pill.
});
it('shows the strip from two picks back', () => {
  // PickStrip html: 14 `pick-card`s, the third is `is-clock`.
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/ui/draftRoom.test.tsx` → FAIL (not exported).
- [ ] **Step 3: Implement** `PickRail`, `PickStrip` and the CSS per Behaviour.
- [ ] **Step 4: Run and see them pass.** `npx vitest run src/ui/draftRoom.test.tsx src/ui/ui.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** "Draft room: the pick rail and the strip".

---

### Task 5: Lay out the draft room in `Draft.tsx`, the board's Need tag, Draft history, and ship 0.4.54

**Files:**

- Modify: `src/ui/screens/Draft.tsx` (`Draft` ~67–280, `DraftHistory` ~372–495, `DraftClock` ~516–640)
- Modify: `src/styles.css` (the room's layout; delete the `.draft-ticker` rules ~3897–3912)
- Modify: `docs/UI.md` (add "the draft room's lineup" to "Fixed order, on purpose")
- Modify: `package.json` (`0.4.53` → `0.4.54`), `src/ui/changelog.ts` (new first entry)
- Test: `src/ui/draftRoom.test.tsx`, `src/ui/draftTrades.test.tsx` (must keep passing)

**Interfaces:**

- Consumes: everything Task 3 and Task 4 produce.

- Behaviour:
  - `Draft`: `const room = useDraftRoom(league)` (always called, top of the component). When `clock.kind !== 'none'`
    the page is `<div className="draft-room"><div className="home-grid">…</div><aside className="draft-rail">…</aside></div>`;
    otherwise today's `home-grid` alone. The rail holds `<LineupCard id="draft-lineup" />` (only with a room) and
    `<PickRail />`. Right after the clock cell, a `home-cell span-12 draft-lineup-narrow` holds
    `<LineupCard id="draft-lineup-narrow" defaultOpen={!matchMedia('(max-width: 640px)').matches} />` (guard
    `typeof matchMedia === 'function'` for the server render in tests: default open).
  - `DraftClock` takes `room`: delete the `recent` ticker block; on `preview` and `live` render `<PickStrip />` and,
    with a room, `<NeedsLine />` above the facts.
  - Big board: `needSet` = positions of `shownNeeds(room.mine)` that aren't filled. In the Pos cell, after the
    position, `<span className={`need-tag ${tier}`}>Need</span>` for big/need tiers in `needSet`. A
    `button.btn.btn-sm` "Needs only" (`aria-pressed`) after the Consensus / Your board seg; on, it filters to
    `needSet` and calls `setPos('ALL')`; picking a position turns it off. Shown only with a room.
  - `DraftHistory`: a single team's default year becomes `'recent'` ("Last two drafts": seasons in
    `years.slice(0, 2)`), listed first in the year select; the Year column shows for `'recent'` as for `'all'`. Rows
    show 8 at a time (`HISTORY_PAGE = 8`) with a "Show N more" button and "x of y" as the board does, reset to 8 when
    a filter changes. The league view keeps following the round.
  - CSS: `.draft-room` one column; `@media (min-width: 1290px)`: `main.wrap:has(.draft-room) { max-width: 1500px }`,
    `.draft-room { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start }`,
    `.draft-rail { position: sticky; top: 12px; height: calc(100vh - 24px); display: flex; flex-direction: column; gap: 20px }`
    (the lineup `flex: none`, the rail's picks panel `flex: 1`), `.pick-strip, .draft-lineup-narrow { display: none }`;
    below 1290px `.draft-rail { display: none }`. `.need-tag` as a small pill on the tier colors.
  - Changelog entry, `date: '2026-11-19'`, title ≤ 40 characters, text ≤ 200, e.g. title "A draft room with your
    needs", text "Every pick now runs down the side of the draft, with what each team still needs. Your needs and
    your lineup sit beside the board, and the board can show only the positions you need."

- [ ] **Step 1: Write the failing tests** (same file, `describe('draft room')`):

```ts
it('lays out the room with the rail, the needs line and no old ticker', () => {
  // renderToStaticMarkup(<Draft league={l} />): contains 'draft-room', 'draft-rail', 'pick-rail', 'Your needs',
  // 'Your lineup' (twice: rail and narrow), and not 'draft-ticker' / 'Latest picks'.
});
it('tags board rows at a position you need', () => {
  // the first board row whose position is in needSet has a need-tag; 'Needs only' is present.
});
it('opens your draft history on the last two drafts', () => {
  // the Draft year select's selected option is 'Last two drafts'.
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/ui/draftRoom.test.tsx` → the new tests FAIL.
- [ ] **Step 3: Implement** the Behaviour above, the `docs/UI.md` line, the version bump and the changelog entry.
- [ ] **Step 4: Verify**
  - `npx vitest run src/ui/draftRoom.test.tsx src/ui/draftTrades.test.tsx src/ui/ui.test.ts src/ui/changelog.test.ts && npm run typecheck`
    → PASS.
  - `npm run format` → no diff left after it runs.
  - `npm run copy` then read the new lines in `.check/copy.txt` against "Words on a screen".
  - Shots: build a mid-draft save (the fixture's steps, written with `JSON.stringify` to the scratchpad), then
    `npm run screens -- --save <save> --out <dir> --routes '#/office/draft'` at the default width and with
    `--width 1600`; look at both and the phone shot: the rail scrolls to the clock, nothing overflows sideways.
- [ ] **Step 5: Commit** "Draft room: the rail beside the board, Need tags, two years of history (0.4.54)" and push
      to `claude/wonderful-lovelace-tqc2x9`.
