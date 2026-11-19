# Draft room: the pick rail, your needs and your lineup

Status: design, approved approach B (2026-11-19). Mockups were shot on the real Draft screen with a year-two
mid-draft save (Indianapolis on the clock at No. 35); they lived in the session's scratchpad and are described here.

## Why

While the draft runs, the owner wants to follow every pick at a glance, see what the teams ahead of him want, and
above all see what **his own team** needs, with the lineup behind it, without scrolling away from the board.

What the Draft screen does today (`src/ui/screens/Draft.tsx`):

- One long column: the clock, draft-day offers, the staff's top 5, the big board (32 rows a page), then Your picks
  and Draft history about 3,000 pixels below the clock on desktop and at the very bottom on a phone.
- The clock shows only the last three picks (`ol.draft-ticker`).
- Nothing says what your team needs. The only hint is a head coach's line inside a trade offer.
- Draft history opens on your team across all years and rounds: eight rows in year two, about seven more each season.

## Goals

1. **Pick rail** (wide screens): every pick of this draft, made and to come, in a list that scrolls on its own beside
   the page and stays in view while the page scrolls. It opens on the pick on the clock.
2. **Other teams' needs, kept simple:** a team still to pick shows its top three needs as plain pills, on your pro
   scouts' read. A need is struck through with a ✓ once that team drafts a player there.
3. **Your needs line** in the clock panel: your top five unfilled needs plus every position you've drafted this year,
   each pill with **have/want** counts, colored by tier (big need, need), drafted ones struck through with a ✓.
4. **Your lineup** card in the rail, above the picks: one row per position with the position (colored like its
   need pill), have/want, the weakest starter (with a scheme-fit dot), his grade, and the league's typical starter.
   A line under the title names your schemes. It folds, and the fold is remembered.
5. **Big board:** a "Need" tag beside the position of a prospect at one of your top five unfilled needs, and a
   "Needs only" button that filters the board to those positions.
6. **Draft history:** your team's view opens on the last two drafts, eight rows at a time with "Show N more".
7. **Phone and narrow screens:** the picks become a strip of cards you swipe sideways inside the clock panel, and
   the lineup is a foldable panel under the clock.

## Non-goals

- **AI need logic and AI drafting stay as they are.** The AI already drafts for need (`boardScore` in
  `offseason/draft.ts`: fewer than starters + 1, a weak starter, a full room), but on fixed starter counts (3 WR,
  1 TE) whatever its scheme. Making the AI scheme-aware is a separate change (it moves trades and drafts).
- **Your own players' ratings stay exact** (`docs/GAME_DESIGN.md`: only potential is a guess). The lineup reads them
  through `viewOf` like every screen, so it follows that rule whatever it becomes.
- **No save change.** Everything is worked out from the league as it is.
- **Scheme fit does not change the "want" count.** It shows as the dot only.

## Anti-goals

- **Never leak the truth.** Other teams' needs and the league's typical starter come from your scouts' read
  (`scoutedNeeds`' rules on your view); fit comes from `schemeFitOf` (your view). No `player.ratings`, `playerOvr` or
  exact rival read on a screen.
- **No change to any number the sim reads.** `needsOn` with its defaults must behave exactly as today, so AI needs,
  trades and drafts are untouched.
- **Don't make the phone page longer.** The strip replaces the old three-pick ticker; the lineup is folded by default
  on a phone.

## Decisions the owner made

- Layout **B**: your lineup and the picks both live in the rail; your needs line sits in the clock panel.
- Counts (have/want) on the lineup rows and on the needs pills.
- The lineup compares your starters with **the league's typical starter as your scouts read the league**.
- No "Rookie" tag; a position drafted this year shows the pick (✓) instead.
- Needs on your screen follow **your schemes' starting spots** (12 personnel starts 2 TE and 2 WR).
- Other teams' needs stay simple: plain pills, top three, struck through once filled.

## Approaches considered

1. **Layout.** A: needs and the full lineup inside the clock panel, the rail holding only picks (the lineup is
   650 pixels tall and pushes the board down). B: needs line in the clock panel, a slim lineup table and the picks
   in the rail (both visible while you scroll the board; on a 900-pixel laptop the picks start low, hence the fold).
   **The owner picked B.** A two-line lineup row (grade and fit, then count and typical starter) was tried and
   dropped: 1,100 pixels tall, it pushed the picks off a laptop screen. The one-line table fits.
2. **Needs as the draft opened.** Derive them from the roster without this year's draftees (nothing stored, no save
   change, works for every team) or snapshot each team's needs onto the league when the draft opens (a save change
   and a `SAVE_VERSION` bump). **Derive** (my call): it keeps `League` unchanged and matches how the codebase works
   things out instead of storing them. Its one quirk: a veteran traded away on draft day changes that team's needs
   mid-draft, which is right anyway.
3. **Page width.** Widen only the draft room with `main.wrap:has(.draft-room)` (the game stage does this,
   `styles.css` `main.wrap:has(.game-stage)`), widen every screen, or keep 1,180 pixels and squeeze the board.
   **Widen the draft room only** (my call): at 1,440 pixels the board keeps about 1,050 of its 1,150 pixels and no
   other screen moves.

## The design

### Engine (pure reads, draw nothing)

`src/engine/trade/plans.ts`, two behaviour-neutral changes:

- `needsOn(league, roster, line, ovr, starters = STARTERS)`: an optional starter count per position. Every existing
  caller passes nothing and gets today's result. A position with no starting spots (a 10-personnel offense starts no
  tight end) is skipped: it can't be a need (today `fit[S - 1]` would read `fit[-1]`).
- `scoutedLine(ctx, viewerId, starters = STARTERS)`: export the viewer's median-starter line that `scoutedNeeds`
  already builds (`lineOn(ctx, seen)`, cached in `ctx.viewLines`), and have `scoutedNeeds` use it. With your
  schemes' counts it pools **each team's top S** at a position, so a two-tight-end team's second tight end is measured
  against the league's typical player among teams' top two tight ends, not against their top one (my call: the
  bar must count the same starters the need does, or every TE2 reads as a big need). Cache it per viewer and counts.

New `src/engine/draftNeeds.ts` (read-only, nothing drawn, nothing stored):

- `draftedThisYear(ctx, teamId)`: players on the team now (`rosterOf`) whose `draft.season` is this league year.
  Both "the roster at the open" and "filled" read the team as it is now (my call): a draftee traded away no longer
  fills the team that picked him, and one traded in fills his new team. Rare either way (AI teams never trade a fresh
  first- or second-round pick, `freshPick`).
- `rosterAtOpen(ctx, teamId)`: `rosterOf(ctx, teamId)` (the 53, no practice squad) without this year's draftees.
- `draftNeeds(ctx, viewerId, team, starters?)`: `needsOn` on `rosterAtOpen` with the viewer's line
  (`scoutedLine` with the same counts) and the viewer's read (`ctx.view(viewerId, p).ovr`), each need with `filled`:
  a player drafted this year at that position is on the team. Other teams use the default starters; your own team
  passes your schemes' counts. It also returns `scoutedNeeds`' `littleFilm` for other teams.
- `schemeStarters(league, teamId)`: `spotsFor(teamScheme(league, teamId), pos).length` for each position.
- `lineupRows(ctx, league)` for your team, one row per position:
  - `have`: players at the position in `rosterOf` (today's 53, draftees included);
  - `want`: `ROSTER_TEMPLATE[pos] + schemeStarters[pos] − STARTERS[pos]` (12 personnel: TE 4, WR 5; 10 personnel:
    TE 2, WR 7);
  - `starters`: the depth chart's first `schemeStarters[pos]` ids at the position that are of that position;
  - `weakest`: the starter with the lowest read (`viewOf`), the man the need is about; none when the scheme starts
    nobody there (the row shows a dash);
  - `typical`: `scoutedLine(ctx, userTeamId, schemeStarters)[pos]` (a dash when the scheme starts nobody there);
  - `need`: the matching `draftNeeds` entry or none, and the names of this year's picks at the position.
- **Order and tiers** (my call). Needs are **ordered** by `urgency` as today (it carries each position's weight, so
  a quarterback outranks a punter). The **tier** reads how short the position is, on the same scale for every
  position: `severity = urgency / NEED_WEIGHT[pos]` (a hole is 1; an upgrade is the weakest starter's gap to the
  typical starter over 3 points). **Big need** at severity 0.6 or more (a hole, or the weakest starter about 1.3
  points or more under typical), **need** at 0.3 or more, below that no color. On urgency alone a kicker could never
  be "big" and a tight end barely, whatever the gap. Export `NEED_WEIGHT` (or a `severity(need)` helper) from
  `plans.ts` for this.
- **Next year's holes** (`reason: 'nextYear'`, a starter whose deal ends after this season; `lookAhead` is on in the
  draft) count as needs like any other, ranked by urgency, and their pill is dashed with "next year" after the
  position, as `WantsPills` already shows them (`NEED_PILL`, `tag-early`). Every need `needsOn` returns (urgency over
  0.1: hole, upgrade or next year) is a need; "your top five unfilled needs" are the first five of them that aren't
  filled.

### Screens

New `src/ui/draftRoom.tsx` holds the draft room's pieces; `Draft.tsx` lays them out.

- **Layout.** `Draft.tsx` wraps the current grid in `.draft-room`: the main column and an `aside.draft-rail`
  (sticky, its own scroll) from 1,290 pixels wide, the breakpoint the game stage uses. Below it the rail is hidden
  and its two parts move: the picks into the clock panel as a strip, the lineup into a panel under the clock. The
  rail shows while the draft is on (`clockState` is `preview`, `live` or `done`).
- **Clock panel.** The old three-pick `ol.draft-ticker` goes (the rail and the strip replace it). The needs line
  goes in on `preview` and `live`: an eyebrow "Your needs", then pills `DT 5/5`, `TE 3/4` (have in red when short),
  `OL 9/9 ✓` struck through, then a small key (Big need, Need, Drafted ✓).
- **Lineup card** (`Section id="draft-lineup"`, so its fold is remembered like Draft history's; its `defaultOpen` is
  `false` when `matchMedia('(max-width: 640px)')` matches at mount, so a phone starts folded and a remembered fold
  wins after that, with no change to `Section`): title "Your
  lineup", a `MoreLink` to the depth chart, the scheme line (`offenseLabel` · personnel · `defenseLabel`), then a
  table: Pos (the need pill, plain when there's no need), Have (`have/want`, red when short), Weakest starter (fit
  dot, `PlayerLink`; on a drafted position, the pick instead and no grade), Grade (`Ovr`), Typical. Offense, defense
  and kickers are separated by a gap row. Tooltips: Have "On the roster / what your schemes call for"; Typical "The
  league's typical starter here, as your scouts read the league"; the dot "Good fit", "Average fit", "Poor fit". A
  one-line dot key under the table. No other text.
- **Pick rail** (`PickRail`): title "Picks" and a round select that jumps the list; sticky round headers; every
  pick of `draftOrder(league)`:
  - made: No., `TeamChip`, position, `PlayerLink`, `DraftDayPill` (moved from `Draft.tsx` into `draftRoom.tsx` and
    exported, labels unchanged), "via XXX" when traded;
  - to come: No., `TeamChip`, the team's abbreviation (or "Your pick" / "You're on the clock" / "On the clock"),
    and for other teams their top three `draftNeeds` pills, plain, struck through with ✓ when filled, dashed when
    our scouts barely know the team (`littleFilm`, the board's "dashed is early word");
  - your picks carry a gold edge; the pick on the clock is tinted gold.
  - When the pick on the clock changes, the list scrolls itself so that row sits about a third of the way down,
    by setting the list's `scrollTop` (never `scrollIntoView`, which would move the page).
  - Needs for the 32 teams are worked out on one shared `tradeContext(league)` in a `useMemo` keyed by the season
    and the number of picks made (the league is mutated in place, so its identity can't be the key). Measure the
    render on a mid-draft save (`npm run screens`); if a pick's advance feels slow, move the memo out of render.
- **Pick strip** (`PickStrip`, narrow screens): cards from two picks back to twelve ahead, scrolling sideways, the
  clock's card tinted; made picks show position and name, others their needs (yours "Your pick").
- **Big board.** In the Pos cell, a small "Need" tag (big-need color or need color) for prospects at your top five
  unfilled needs. A "Needs only" toggle beside the Consensus / Your board switch; on, it keeps those positions
  only and sets the position filter back to All.
- **Draft history.** For a single team the default year becomes "Last two drafts" (the two newest years in its list,
  which includes this year's once the first pick is in); "All years" and each year stay in the select. Rows show
  eight at a time with "Show N more", as the board does. The league-wide view keeps today's behaviour (following
  the round on the clock).
- **Styles** in `styles.css` under the draft room section; colors from the theme's tokens (`--loss`, `--win`,
  `--tie`, `--marker`, `--surface-2`), so dark mode follows.
- **Words.** Everything follows `docs/UI.md` ("Words on a screen", names through `PlayerLink`/`TeamChip`, no panel
  descriptions). Run `npm run copy` and read the new lines.

## Tests

- `src/engine/draftNeeds.test.ts`: needs at the draft's open ignore this year's draftees; `filled` turns on when a
  team drafts at the position; a 12-personnel team wants 4 TE and 5 WR and its needs read TE2, not WR3; a
  10-personnel team has no TE need and doesn't throw; `needsOn` and `scoutedNeeds` without `starters` return exactly
  today's result for every team of a league (AI parity); a rival's needs use your read (they differ from its own
  exact `teamNeeds` somewhere in a league); severity puts a hole at 1 for every position.
- UI: the screen contract tests in `ui/ui.test.ts` pass; a render test of the Draft screen mid-draft shows the
  rail with the clock row and made picks, the needs line and the lineup.
- No sims: nothing the sim reads changes. Locally `npm run typecheck`, the touched tests and `npm run format`; CI
  runs whatever checks `trade/plans.ts` calls for.

## Version

Not an MVP item: `package.json` 0.4.53 → 0.4.54 (a PATCH bump) with an entry in `src/ui/changelog.ts`.

## Left to the builder

- Exact widths, the strip's length and the scroll offset of the clock row.
- Whether the lineup panel opens or folds by default on narrow screens wider than a phone (the phone folds).
- The tier thresholds (0.6, 0.3 on severity), if most rows read red in a typical league: tune them so a big need
  stands out.
