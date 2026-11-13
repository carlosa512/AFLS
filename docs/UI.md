# Screens: the rules every screen follows

These are the parts a screen reuses and the rules that keep the game consistent from one screen to the next.
The "screen contract" tests in `src/ui/ui.test.ts` enforce most of them: a new screen that breaks a rule fails
`npm test`. Fix the screen; only widen a test's allow-list with a comment saying why.

## Names always link

A player's or a team's name always opens his card or the team's page, and looks the same everywhere.

- **Players:** `PlayerLink` (`components.tsx`). Pass `avatar` (a size: 32, the smallest that shows his number; never less) in
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

## The top of a screen

- **No visible page title.** The top bar's highlighted tab names the screen, and panel titles name panels. The app
  shell writes each screen's name once, as a hidden `h1` for screen readers (`SCREEN_NAMES` in `ui/screenNames.ts`).
  New Game keeps its own heading.
- **A screen with views opens with `PageHeader`** (`components.tsx`): its route tabs on the left, the view's context
  line or view-wide control (a season picker, "2026 · Regular season") on the right. Front office and Stats use it. A
  screen with no tabs starts with its first panel.
- A panel title never repeats the tab or the season the bar already shows.

## Labels and text sizes

- **Sizes come from the scale only:** `--step--2` (11px, table headers, pills, tags in a row) up to `--step-4`. A
  hand-written size in app screens fails the screen contract. The SNN newspaper, the game viewer and SVG chart text
  keep their own type, on purpose.
- **One label style, two sizes.** `.eyebrow` (`--step--1`) is the label above a value or a group, and `.eyebrow-sm`
  (`--step--2`) is the small one. `th`, `.tag-pill` and the other small labels share their rule in `styles.css`. A new
  all-caps label joins one of the two rules instead of writing its own.

## Icons

- **Every icon is `Icon`** (`ui/icons.tsx`): one set drawn on a 24 grid, sized by the text around it, in its colour.
  Never a character like ▶ ▲ ✕ ✎ ✓, which each font (and iOS's emoji) draws its own way. An arrow inside text ("EDGE
  → DT") is punctuation and stays text.
- A button holding only an icon carries an `aria-label`.
- A new shape is drawn in `icons.tsx`, in the same stroke and grid.

## Links to another screen

- **Going somewhere else is a `MoreLink`** (`components.tsx`): words and a chevron, no border ("All standings ›",
  "See all 5 ›").
- **A bordered button does something here:** changes the league, opens a dialog or a fold, edits.
- **The yellow primary is the one main thing to do where it sits** ("Watch replay", "Answer offers"), and it may go
  somewhere. In a letter's row of links, the first is the primary and the rest are `MoreLink`s.
- A name in a sentence stays `PlayerLink` or `TeamLink`. `PlayerLink`'s `sub` puts a second line under a name in a list
  (his team, a stat line), so it never wraps under his picture.

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
  `quirkNotes` in words; a coach's reputation (`coachCharacter`), public, in words.
- **Origins** are public (like an injury) and show only through `OriginTag` (`ui/origin.tsx`): on the player card
  and the draft board's School column, not on rosters, free agency or stats tables. Pathway and CFL players get
  their own pills.
- **Never show:** `player.ratings`, `playerOvr`, `player.potential`, `teamRatings`, `weeksRemaining`, or a
  hidden trait as a number.
- **Exceptions:** `ui/scouting.tsx` reads true ratings for an exact view of your own player (his rating
  changes). New Game shows each club's true overall, by the owner's call: before you take a job you have no
  scouts, and the overall is how you pick a project.

## Words on a screen

A screen is for a player who is deciding something. A line of text stays only if the player would miss it: it
tells them something they can't see on the screen and need for the decision in front of them. Everything else
goes. This covers screen text (headings, hints, empty states, tooltips, dialogs) wherever it is written,
`src/engine` included: scout report sentences, scheme, rating and habit descriptions, and the reason a move is
blocked. Letters are a person's voice and follow the prose rules in CLAUDE.md.

`npm run copy` lists every sentence the screens can show in `.check/copy.txt`. Read that list after changing
screen text: a line that sounds odd on its own is odd on the screen.

**What a screen never says**

- **What the panel is.** No paragraph under a heading that describes the panel or lists what is in it. If the
  heading and the table don't say it, fix the heading. ("The people building the league. Open a name for
  appointments, results and scouting history." under *General managers*.)
- **How to use a control.** No "Tap a room for detail", "Click a column to sort", "Tick players on both
  sides". A thing that can be tapped looks like it (a chevron on a row that opens, a dotted line under a
  rating that explains itself). If it doesn't, fix the control, not the text.
- **How the sim works inside.** No formula, threshold or tuning number ("A scout gets +3 on their own group and
  −3 on others", "a physiotherapy above 9 starts to shorten it"). Say the result, in the row it belongs to
  ("Layoffs 12% shorter").
- **Why it was built this way, or what the AI does.** ("…as every AI staff does", "Teams want a small win in
  their own eyes".) That is a note to the developer; it belongs in a code comment or a doc.
- **The save or the software.** ("Personnel transactions are not active in this career yet", "Earlier results
  are not attributed to this appointment".) Say what the player can or can't do, in the game's words.

**Where a rule of the game goes**

The player does need the rules (waivers, June 1, the tag). Put each one where it decides something, when it
applies:

- on the dialog that confirms the move ("He goes on waivers with his existing contract…"),
- beside a button that is off, as the reason it is off ("Coaching moves open in the re-sign window"),
- in a tooltip on the number it explains,
- or in a closed fold ("How this works") when a screen's rules need a paragraph.

Never as a standing paragraph under the heading, shown on every visit.

**How a line is written**

- Short first. A label or a few words do where the screen gives the context ("Home game.", "No offers.",
  "$1.2M over budget.").
- Short is not shorthand. A line has to be clear to someone reading it for the first time, with no
  abbreviation or dropped words to decode. ("Value: vs consensus." became "Value compares your pick with his
  consensus rank."; "Dress 47 (48 with eight OL)." became "Dress 47 players, or 48 with eight offensive
  linemen.")
- When a line needs a sentence, write a plain one with a verb, the way you would say it to someone across a
  desk. If it needs three, it is a fold.
- No colon or semicolon joining two thoughts. Write two sentences, or cut one. ("It goes past your coaching
  budget: the owner decides." became "$1.2M over budget.") A label before a colon is fine ("Deal up: he leaves
  when free agency opens.").
- No pair with the verb dropped from the second half ("a round later is a steal, a round earlier a reach",
  "Short and solid is a ready player, long and fading a project").
- No line written to sound good. ("The player doesn't care; future you might.", "Some throw flags all day,
  some let the linemen hold.", "your inbox tells the story".)
- An empty state is one line: what is missing and when it appears. ("Team stats appear once the first week is
  played.")

## Not consistent yet

- New Game shows no record for each club (a new league has no history).
- League history sorts by season and your record, not by champion; the coaches' grades table has no Grade sort
  (it follows Rank).
