# UI consistency across screens — design

Date: 2026-10-22. Status: done. PR 1 carlosa512/AFLS#73, PR 2 #74, PR 3 #75, PR 4 writes the rules in `docs/UI.md`.

## Goal

A player's or a team's name does the same thing everywhere it appears: it opens his card or the team's
page, and it looks the same. Every list sorts the same way, marks your row the same way, and lets you
switch team or league with the same control. The draft and trade screens use the widgets the rest of the
game uses. No screen shows a number the user's scouts could not know.

## What is wrong today

Audited on `main` at 0.1.4, 21 screens in `src/ui/screens/` plus the shared panels in `src/ui/`.

- **Player names** are linked almost everywhere but written five ways: `PlayerLink` in `Stats.tsx`
  (avatar, full or short name), `PlayerCell` and `PlayerName` private to `FrontOffice.tsx`, and
  hand-rolled `linklike` buttons in `Medical.tsx`, `Finances.tsx`, `Trades.tsx`, `offers.tsx`,
  `Coaches.tsx` and `BoxScore.tsx`. Some show the avatar, some the position prefix, some an initial.
- **Team names** are dead text in the Schedule's score lines (`TeamLabel` without `onClick`), the
  salary-cap header (`Finances.tsx`) and the trade-partner header (`Trades.tsx`). Standings, Playoffs
  and Home link them. The team dropdown is hand-rolled in Finances, the draft history and the trade
  table instead of using `TeamPicker`; the draft history and the trade table drop the user's own team.
- **Sorting** uses the shared `useSort`/`SortTh` on Roster, Stats, TeamStats, Front Office, Medical
  and Officials. Standings, Schedule, Playoffs, Finances, Coaches, Staff, BoxScore, Compare and the
  league grades table are static. The draft board names its columns differently from Roster and Stats.
- **Your row** is marked `is-user` in most tables and `me` in the league grades and coaches tables,
  with a third `is-user-text` variant in Standings.
- **Scope** (which team, or the league) is a `TeamPicker` on Roster, Coaches, Staff and Medical;
  "all teams / mine" on Stats; absent on Finances' league table, TeamStats and the trade board.
- **Views** inside a screen: the Front Office uses routed tabs (`#/office/<tab>`, back button and
  deep links work); the trade screen uses five segmented buttons held in component state.
- **Fog of war.** Player rows go through the user's scouts (`viewOf`, `Ovr`, `RangeValue`) and are
  safe. Team strength is not: `teamRatings` in `engine/roster.ts` averages true starter ratings, and the
  Roster header shows it for any club, the Home matchup bars show it for the opponent, and New Game shows
  it for every team.

## Design

Four pull requests, each one finishable in a sitting and independently shippable. The order matters
only for 1 → 2 (2 uses the components 1 adds).

### PR 1 — One name, one link

Two shared components in `src/ui/components.tsx` replace every hand-rolled version.

```tsx
<PlayerLink league={league} player={p} avatar? short? pos? />
<TeamLink league={league} team={t} chip? sub? />
```

- `PlayerLink` always calls `nav.openPlayer`. It renders the avatar when `avatar` is set (tables), not
  in sentences. `short` gives "J. Smith" for tight cells (box scores, trade assets). `pos` prefixes the
  position only where the table has no position column. A retired or departed player whose record is
  gone renders plain text with a `title` saying why, so a link never does nothing.
- `TeamLink` always calls `nav.openTeam`; `chip` shows the colour chip, `sub` the record or a note
  underneath. `TeamLabel` keeps its layout but is only ever rendered through `TeamLink`; a non-clickable
  `TeamLabel` is a lint failure (see PR 4).
- `TeamPicker` is the only team dropdown. It gains `allowLeague` (adds a "League" option, used by the
  draft history and the trade table) and `exclude` (the trade table hides your own club, since you
  cannot trade with yourself). Every hand-rolled `<select>` of teams goes.
- Both components live in `components.tsx`; `PlayerLink` moves there from `Stats.tsx`, which re-exports
  nothing. Call sites: Stats, FrontOffice (both private copies), Medical, Finances, Trades, offers,
  Coaches, BoxScore, Compare, Schedule, Home, Playoffs, mail cards, widgets.

Testing: a unit test renders each component and asserts the click reaches the nav; a grep test
(`src/ui/ui.test.ts`) fails on `{p.firstName} {p.lastName}` outside the two components and
`PlayerCard.tsx`'s own header, and on `<TeamLabel` outside `TeamLink`.

### PR 2 — Draft and trades on the house widgets

- The trade screen's five views (`offers`, `table`, `block`, `market`, `history`) become routed tabs:
  `{ view: 'trades'; tab?: TradeTab }` in `routes.ts`, `#/trades/<tab>`, the same `seg` control the
  Front Office draws. The hand-off from a counter or "Ask their price" navigates to the table tab.
- Draft board, free agents, extension candidates, trade table assets and the offers list use
  `SortTh`/`useSort` with the roster's column vocabulary: `Player`, `Pos`, `Age`, `OVR`, `Contract`,
  `Cap hit`, `Thru`. Screen-specific columns keep their names (`Your grade`, `Ceiling`, `Ask`).
- One row class. `tr.is-user` is the mark; `tr.me` and `is-user-text` are removed from `styles.css`
  and the two tables that use them.
- Static tables that are lists of comparable rows get sorting: Standings (record, points for and
  against), Playoffs history (season, champion), Finances' league cap table, Coaches and Staff league
  tables, the league grades table. Box scores, Schedule and Compare stay fixed: their order is the
  game's or the user's.
- Scope control is in the panel's `action` slot on every screen that has one, so it sits in the same
  place everywhere. Stats keeps "all / mine" (a 32-team picker there would hide the point of the screen)
  but renders it as the same `seg` control.

Testing: the routes test covers the new tab route round-trip; the existing screen tests run; a grep
test fails on `className="me"` and on a `<table>` whose header has no `SortTh` in the screens listed
above.

### PR 3 — Team strength through your scouts

- `engine/scouting.ts` gains `perceivedTeamRatings(league, viewerTeamId, team)`: the same averages as
  `teamRatings`, taken over the viewer's `perceive` of each starter (`viewCache` for loops). It returns
  each unit as `{ value, lo, hi, exact }`, the range being the spread of the starters' perceived ranges;
  the user's own team is exact. `teamRatings` stays for the engine (AI scheduling, the sim's own needs)
  and is never imported by `src/ui/`.
- Roster header, Home matchup bars and New Game read the perceived version. A range renders through
  `RangeValue`; New Game, where no scouting exists yet, shows the league's public reputation instead
  (last season's record and playoff finish from `league.history`, no unit numbers at all), the way a new GM would know a club.
- Where the user's scouts barely know a team (`knowledge` under the same floor the opposition report
  uses in `inbox.ts`), the unit shows as a range with a "Little film" note rather than a number.

Testing: a unit test that the user's own team is exact and equals `teamRatings`; that a team of
unscouted players gives a range containing the true value; the fog grep test (PR 4) gains
`teamRatings` as a banned import in `src/ui/`.

### PR 4 — Write the rules down

- `docs/UI.md`: the screen contract in one page. Names always link; which link component and when the
  avatar, position or short form is used; the sort header and column vocabulary; `is-user`; where the
  scope control lives; routed tabs for views inside a screen; the fog-of-war list of what a screen may
  render (`viewOf`, `Ovr`, `RangeValue`, `perceivedTeamRatings`, `injury.estimate`) and may not
  (`player.ratings`, `playerOvr`, `player.potential`, `teamRatings`, `weeksRemaining`, trait values).
- `CLAUDE.md` points to it from the `src/ui/` line.
- `src/ui/ui.test.ts` holds the grep tests from PRs 1–3 in one place, so a new screen that breaks a rule
  fails `npm test`.
- `docs/MVP.md`: this work hooks into item 14 (UI works on desktop and mobile); add a line under it and
  bump the patch version once per PR per `docs/VERSIONING.md`.

## Out of scope

- Visual redesign (palette, type, spacing). This is about behaviour and shared parts; the look stays.
- Prose and headings. Intro paragraphs and the h2/h3 ladder are uneven too, but the owner did not ask
  for them here; note them for a later pass.
- Mail cards beyond swapping in the link components.
