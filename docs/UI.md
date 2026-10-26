# Screens: the rules every screen follows

These are the parts a screen reuses and the rules that keep the game consistent from one screen to the next.
The "screen contract" tests in `src/ui/ui.test.ts` enforce most of them: a new screen that breaks a rule fails
`npm test`. Fix the screen; only widen a test's allow-list with a comment saying why.

## Names always link

A player's or a team's name always opens his card or the team's page, and looks the same everywhere.

- **Players:** `PlayerLink` (`components.tsx`). Pass `avatar` (a size: 26 in tables, 28–32 for bigger rows) in
  tables and lists, and no avatar in a sentence. `short` gives "J. Smith" for tight cells (box scores, trade
  assets). `surname` gives "Smith" where the picture or sentence already says who. `pos` prefixes the position,
  only where the table has no Pos column.
- **Teams:** `TeamLink`. `chip` puts the colour chip before the name in tables and lists, never in a sentence.
  `full` gives "Dallas Stampede" instead of "Stampede". `sub` puts a record or note under the name, outside the
  link.
- **GMs:** `GmLink` (`ui/gm.tsx`) opens the same GM card from the directory, team, cap, trade and home
  screens. `avatar` adds the person's stable SVG portrait. The Front Office's GMs tab is `#/office/gms`.
- **Not links, on purpose:** the player card's own header, the "signed" toast, a name inside a checkbox label
  (a link there steals the click), and a page's own heading (it doesn't link to itself).

## One team dropdown

`TeamPicker` is the only team dropdown. `allowLeague` puts "League" first, and `exclude` leaves clubs out (the
trade table hides yours). Your club is marked "(you)". It goes in the panel's `action` slot, top right.

## Tables

- **Sorting:** every table of comparable rows sorts with `useSort`, `sortRows` and `SortTh`. A list with no
  header (trade assets, your block) uses `SortSeg` with the same state. A click sorts by the column's natural
  order, and a second click flips it.
- **Fixed order, on purpose:** box scores, the Schedule, Compare, and the depth chart's default view. Their
  order is the game's or yours.
- **Column names:** `Player`, `Pos`, `Age`, `OVR`, `Stars`, `Cap hit`, `Thru`. A screen's own columns keep
  their own names (`Your grade`, `Ceiling`, `Ask`, `Market`).
- **Your row:** `tr.is-user`, and nothing else. (`.is-user-text` bolds your team's name inside a sentence; it
  is not a row mark.)

## Views inside a screen

- **Tabs** that change what the screen is about are routes, so Back and links work: the Front Office's tabs
  (`#/office/<tab>`), the trade views (`#/office/trades/<view>`), the Stats tabs.
- **Filters** inside a view (Stats' "Whole league / Your roster") are a `seg` button group, not a `<select>`.

## Fog of war

A screen shows what your club knows, nothing more (CLAUDE.md, "True vs. perceived").

- **Show:** `viewOf`, `Ovr`, `RangeValue`, `Stars` and `KnowledgeMeter` for players; `TeamUnit` over
  `perceivedTeamRatings` for a club's strength; an injury's `estimate`; `characterNotes`, `careerOutlook` and
  `quirkNotes` in words.
- **Never show:** `player.ratings`, `playerOvr`, `player.potential`, `teamRatings`, `weeksRemaining`, or a
  hidden trait as a number.
- **Exceptions:** `ui/scouting.tsx` reads true ratings for an exact view of your own player (his rating
  changes). New Game shows each club's true overall, by the owner's call: before you take a job you have no
  scouts, and the overall is how you pick a project.

## Not consistent yet

- Intro paragraphs and heading levels vary between screens.
- New Game shows no record for each club (a new league has no history).
- League history sorts by season and your record, not by champion; the coaches' grades table has no Grade sort
  (it follows Rank).
