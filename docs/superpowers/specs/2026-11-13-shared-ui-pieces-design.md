# Four shared screen pieces, and a fuller Locker Room

A design for four small pieces every screen shares (the top of a screen, labels and text sizes, icons, links to another
screen) and for the Locker Room's desktop layout. It comes out of a review of every screen in light and dark, desktop
and phone, at 0.4.42.

## Why

The owner wants every screen to look as finished as the best ones (the game viewer, the stadiums, the helmets, the
player card, the in-season Home), with consistent fonts, views and icons. The review found the foundation already
shared: one set of colour tokens that dark mode follows, one font trio, one `Panel`, one sortable table, one tab style,
and a screen contract in `ui.test.ts`. The drift is in a few places nothing shares yet:

- **The top of a screen.** The Locker Room opens on a 3.25rem "Locker Room" title with "The way our coaches see it."
  under it, the only screen that does. On Stats, Leaders, Awards and Records put a heading above the panels ("2026 league
  leaders") while Player stats, Team stats and Officials put it inside one. Front Office has no title. `docs/UI.md`
  already lists "Heading levels vary between screens" under "Not consistent yet".
- **Text sizes.** There is a scale (`--step--1` to `--step-4`), but `styles.css` has 57 distinct font sizes, most of
  them one-off small ones from 0.62rem to 0.88rem. The uppercase label is written out about ten times in app screens
  with its own size and letter spacing, beside `.eyebrow`, which already exists and is used about 150 times.
- **Icons.** There is no icon set. Screens use characters: ▲ ▼ ▴ ▾ ▸ ▶ ◀ ❚ ✕ ✎ ✓ ‹ › ← ↗ ↘. Each font draws them its own
  way, and iOS can show ▶ as a colour emoji.
- **Links to another screen.** Home alone has three looks for "go there": a plain bold button ("All standings"), a
  bordered button ("GM careers", "Box score") and an underlined link ("See all 7").
- **The Locker Room on desktop feels empty.** It uses the player card's folds (`Section`) instead of panels, so its
  content sits on the page background. Its room cards stretch to the height of the tallest card in their row, so a room
  with nothing to flag (Quarterbacks, in the review save) is a mostly blank box beside the Secondary's long card. The
  captains are three short lines across the whole width.

## Goals

- One way to start a screen, one label style in two sizes, text sizes only from the scale, one icon set, one look for
  a link to another screen.
- Each rule is held by a test in `ui.test.ts`, as names and sorting are today, so it cannot drift back.
- The Locker Room fills a desktop screen with what it already shows, and reads the same on a phone.

## Not in this work

- The phone navigation (a bottom bar, icons in the nav), the offseason Home, the depth of tabs on Trades on a phone,
  Roster's and Cap's team header, corner radius and spacing tokens, the inline `style={{…}}` cleanup. Each is a follow-up.
  The icon set is built so the navigation can add to it.
- The SNN newspaper (`.ed-*`), the game viewer and broadcast (scorebug, timeline, panels, pregame card, moments, both
  fields) and the stadium paint keep their own type. They are the high bar, with a look of their own on purpose.
- The Re-sign tab's "Re-signing opens in the offseason." during the draft (`FrontOffice.tsx:242`) is a separate fix.

## A failure even if it works

- A screen that looks worse in dark mode or on a phone than it does today.
- Any new line of screen text that describes a panel or explains a control (`docs/UI.md`, "Words on a screen").
- A change to the game: nothing in `src/engine/` or the save changes.
- The newspaper or the game viewer restyled.

## Approaches considered

**The top of a screen.**

1. A visible title on every screen. Rejected: the highlighted tab in the top bar already names the screen, so the title
   repeats it, and `docs/UI.md` forbids a line the player wouldn't miss. It also costs height on a phone.
2. **One header bar for a screen's tabs and context, with the screen's name kept for screen readers (chosen).** The
   bar is today's Front Office and Stats bar made shared. The name is one hidden `h1` the app shell writes for every
   screen.
3. Fix the Locker Room and Stats by hand and add no shared piece. Rejected: nothing stops the next screen drifting.

**Icons.**

1. **Our own SVG set in one file (chosen).** About sixteen shapes are needed. No new dependency, it works in the
   single-file build with no network, and it fits the game's hand-drawn helmets, avatars and stadiums.
2. An icon library such as lucide-react. More shapes ready, but a dependency for sixteen, in a generic style.
3. Keep the characters and add the text variation selector. Cheapest, but each font still draws them its own way.

**The Locker Room** (the owner chose A).

- **A. Tighten it.** The same content in panels, three columns of morale on desktop, cards that keep their own height,
  the quiet rooms grouped small.
- B. Add a table of every room at the top (mood, read, chemistry, belief, who wants a deal). Denser, but more to build,
  and it repeats the cards.

## The four pieces

### 1. The top of a screen: one hidden `h1`, and `PageHeader` where a screen has views

- **The screen's name, for screen readers.** `App.tsx` already picks the screen from the route in one place
  (`App.tsx:462–490`). Inside `main`, before the screen, it writes one `<h1 className="visually-hidden">` (the class is
  already in `styles.css`) with the screen's label from the top bar's tabs (`TABS` in `App.tsx`). The box score, the
  replay and the live game get a name of their own, such as "Box score" (the builder's call). This covers every screen
  and every branch (spectator screens, empty and loading states) without each file doing it. `scripts/screens.ts` waits
  on `main h1` for the Locker Room, so the `h1` must sit inside `main`.
- **No visible page title.** The top bar names the screen and panel titles name panels. A title shows only inside a
  panel. New Game keeps its own heading.
- **`PageHeader`, the bar for a screen with views.** A component in `src/ui/components.tsx`:

  ```tsx
  <PageHeader
    tabs={…}   // optional: the screen's route tabs, the caller's own `.seg.office-tabs` element with role="tablist"
    aside={…}  // optional: the view's context line, or a control that applies to the whole view
  />
  ```

  It draws today's `.office-bar` row: tabs on the left, the aside on the right, wrapping on a phone as it does now. It
  replaces the hand-built `<div className="row office-bar" style={{ justifyContent: 'space-between' }}>` in
  `FrontOffice.tsx` and `Stats.tsx`. `tabs` is a node the caller renders, so the tablist keeps its own `aria-label`,
  roles and, on Front Office, its `ref` (`bar`, which brings the active tab into view).
- A screen with no tabs and no view-wide control has no `PageHeader`. It starts with its first panel, as Home, Schedule
  and Standings do today, and as the Locker Room will.
- **Front office:** tabs, and today's season and phase line as the aside.
- **Stats:** tabs, and the season picker as the aside on every tab that has one (Leaders, Player stats, Awards). The
  Leaders and Player stats picker already sits in that bar. The Awards picker's state (`Stats.tsx:309`) moves up into
  `Stats` beside it, so the bar can show it. The headings above the panels go ("2026 league leaders", "2026 awards",
  "Single-season records"): the tab and the picker say it. Records shows "Single season" as its aside, since that is the one thing the tab name doesn't say. A panel
  title on a Stats tab never repeats the season or the tab's name. On Player stats, Team stats and Officials, the
  builder words or drops each panel title to that rule.
- The trade views' own tab bar (`#/office/trades/<view>`) and Medical's "Your department / League injuries" stay where
  they are: views and filters inside a tab, not the top of a screen.
**Test:** no file in `src/ui` renders an `<h1>` except the hidden one in `App.tsx` and New Game's, and no file but
`PageHeader` builds an `office-bar` row.

### 2. Labels and text sizes

- **One more step:** `--step--2: 0.6875rem` (11px), for table headers, pills and the small tags inside a row.
- **One label style, two sizes.** Uppercase, weight 700, muted colour.
  - `.eyebrow` stays exactly as it is today (`--step--1`, letter spacing 0.08em), so its 150 or so uses don't move. It
    is the label above a value and a group title.
  - The small label is `--step--2` with letter spacing 0.06em, which is what `th` has today. It is for `th`,
    `.tag-pill` and in-row tags. Pills keep their own colours.
- **Fold the copies in.** These rules write the label out themselves today and move onto the shared declarations: `th`,
  `.group-row td`, `.unit-bar .label`, `.strip-tag`, `.tag-pill`, `.risk-word`, `.coach-group-title`, `.report-title`,
  `.room-card h4`. The seven local `.x .eyebrow` overrides keep only what isn't size or letter spacing.
- **App screens size text only from the scale.** A literal size moves to the nearest step: up to 0.72rem goes to
  `--step--2`, 0.75–0.88rem to `--step--1`, 0.9–1.05rem to `--step-0`, 1.1–1.2rem to `--step-1`. Where the nearest step
  looks wrong in a screenshot, take the other neighbouring step, never a new literal.
- **Exempt, on purpose,** by selector: the newspaper (`.ed-`), the game viewer and broadcast (`.vb-`, `.vc-`, `.tl-`,
  `.rail-`, `.pg-`, `.mc-`, `.mb-`, `.mp-`, `.bug-`, `.endzone` and the other classes the scorebug, timeline, game
  panels, pregame card, moments and both fields use), and SVG chart text in px (`.chart .axis`, `.dev-chart`). By
  value: any `clamp()` size, and `16px` (it stops iOS zooming into a phone form field).

**Test:** reads `styles.css` and fails on a `font-size` with a literal rem or px value in a rule whose selector is not
exempt, and on `text-transform: uppercase` outside the shared label rules and the exempt selectors. The exempt
selectors are a closed list of prefixes and selectors written in the test, each with a comment saying why. The builder
writes the game viewer's part of it once, from the classes the viewer's files use.

### 3. Icons: `Icon`

A new file, `src/ui/icons.tsx`:

```tsx
<Icon name="close" />                  // decorative: aria-hidden
<Icon name="caret-up" label="Up 3" />  // carries meaning on its own: role="img" with that label
```

- Drawn on a 24×24 grid, sized `1em` so it follows the text, `currentColor`, a 2px stroke with round joins; the carets,
  play and pause are filled.
- **The set:** `close`, `back`, `chevron-left`, `chevron-right`, `chevron-down`, `chevron-up`, `caret-up`, `caret-down`,
  `play`, `pause`, `rewind`, `forward`, `edit`, `check`, `trend-up`, `trend-down`.
- **What replaces what:**

  | Today | Icon | Where |
  | --- | --- | --- |
  | ✕ | `close` | `App.tsx:513`, `components.tsx:562`, `:640` |
  | ← Back | `back` | `BoxScore.tsx:298`, `GameViewer.tsx:379` |
  | ‹ › ◀ | `chevron-left`, `chevron-right` | `strip.tsx:111`, `:114`, `Inbox.tsx:448`, `Schedule.tsx:125`, `:140` |
  | ▾ ▴ ▸ | `chevron-down`, `chevron-up`, `chevron-right` | `components.tsx:837`, `edition.tsx:182`, `:237`, `:417`, `Inbox.tsx:705`, `Coaches.tsx:1394`, `:2370` |
  | ▲ ▼ (sort, change, verdict) | `caret-up`, `caret-down` | `components.tsx:963`, `:993`, `scouting.tsx:536`, `:861`, `Compare.tsx:202`, `Draft.tsx:176`, `:710`, `Inbox.tsx:475`, `:483`, `mail.tsx:3477` |
  | ▶ Watch replay | `play` | `Home.tsx:205`, `BoxScore.tsx:302`, `mail.tsx:1899` |
  | ◀◀ ▶ ❚❚ ▶▶ | `rewind`, `play`, `pause`, `forward` | `GameViewer.tsx:468–474`, `LiveGame.tsx:286` |
  | ✎ | `edit` | `GeneralManagers.tsx:136`, `PlayerCard.tsx:986` |
  | ✓ | `check` | `Inbox.tsx:342`, `PlayerCard.tsx:1151`, `Trades.tsx:207` |
  | ↗ ↘ | `trend-up`, `trend-down` | `scouting.tsx:546` |

- **Drawn by CSS:** the fold marker `.card-section > summary::after` ('▾') and the `content: '✓ '` rule at
  `styles.css` line 3142 draw the same shapes through `mask-image`, so they match the component.
- **Text the engine writes** keeps its characters. Where a screen already reads ▲ or ▼ out of it ("12 ▲1",
  `mail.tsx:3477`), it draws the caret icon instead.
- **An arrow inside text stays text:** "EDGE → DT", "$19.0M → $17.4M", "2026 → Present". It is punctuation and every
  font draws it plainly. The Roster's "(or use ↑/↓)" tooltip says "the arrow keys" instead.
- Icon-only buttons keep their `aria-label`.

**Test:** no `.tsx` file in `src/ui` outside `icons.tsx` holds ▲ ▼ ▴ ▾ ▸ ▶ ◀ ❚ ✕ ✎ ✓ ‹ › ← ↑ ↓ ↗ ↘, save a short
allow-list that says why (the parser that reads the engine's ▲ and ▼).

### 4. Links to another screen: `MoreLink`

A component in `src/ui/components.tsx`:

```tsx
<MoreLink to={{ view: 'standings' }}>All standings</MoreLink>
<MoreLink onClick={() => nav.openGame(game.id)}>Box score</MoreLink>
```

- Looks: no border or background, `--step--1`, weight 700, the ink colour, a `chevron-right` icon after the words, an
  underline on hover, the focus ring every button has, and at least 32px tall (the small button's target).
- It is a `<button>` that calls `nav.go(to)` or `onClick`, like `PlayerLink` and `TeamLink`, not an `<a href>`: every
  link in the game moves through `nav` and its history. It has no disabled state. When the place it goes isn't open, it
  isn't shown.
- **The rule:**
  - A control whose only job is to take you to another screen, or to show more of the same list ("See all 7"), is a
    `MoreLink`.
  - A bordered button does something here: changes the league, opens a dialog or a fold, edits ("Edit", "Shop him").
  - The yellow primary is the one main thing to do in a panel, and may take you somewhere ("Watch replay", "Draft
    room", "Answer offers").
  - Back keeps its own place top left, with the `back` icon.
  - A name in a sentence stays `PlayerLink` or `TeamLink`.
- Applies everywhere the rule fits, not only Home: "All standings", "Medical", "Inbox", "All leaders", "All team stats",
  "All awards", "GM careers", "Box score", "See all 7", "See all in Inbox", "Waiver wire", "See their offer →"
  (`offers.tsx:416`) and the rest the test finds.

**Test:** a `<button className="btn…">` that isn't `btn-primary` and whose `onClick` is a one-expression arrow calling
`nav.go(`, `nav.openGame(` or `nav.watchGame(` fails, and the message points to `MoreLink`. Handlers that do more, or
named functions, are moved by hand in the same sweep: the test catches the common case, and the rule in `docs/UI.md`
covers the rest.

## The Locker Room (option A)

Desktop, about 1150px of content:

```
[ Morale ────────────────────────────────────────────────────────────── ]
[ The room   😐 Okay    ][ Needs a word          ][ Flying                ]
[ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮   ][ K Eli Butler  …      ][ EDGE M. Singleton …   ]
[ On their minds …      ][ CB K. Johnson …      ][ …                     ]
[                       ][ …                    ][ Promises …            ]
[ Disputes (only when there are any) ───────────────────────────────── ]
[ The rooms              ☑ Let the coaches handle the mentoring  [Ask the coach…] ]
[ Captains  OFF OL E. Lawson · DEF S J. White · ST EDGE M. Singleton    ]
[ Secondary  (divided)          ][ Defensive line               ]
[ … its full card               ][ … its full card              ]
[ Offensive line                ][ Specialists                  ]
[ Quarterbacks ][ Running backs ][ Receivers & TEs ][ Linebackers ]   ← quiet rooms, small
```

- No `PageHeader`: the screen starts with the Morale panel, and the app's hidden `h1` names it. The 3.25rem heading and
  "The way our coaches see it." go.
- **Panels, not folds:** Morale, Disputes and The rooms become `Panel`s. Captains joins The rooms. The folds' saved
  open-or-closed state is no longer read (the owner's call is panels, like every other screen).
- **Morale:** three columns on a desktop wide enough for them (The room, with its strip and "On their minds" | Needs a
  word | Flying, with Promises after Flying), two in between, one on a phone in today's order. The builder picks the
  breakpoints from the ones `styles.css` already uses (900px is the morale board's today).
- **The rooms:** the mentoring checkbox and "Ask the coach to talk to the team" go in the panel's `action` slot (they
  wrap under the title on a phone). The meeting banners stay at the top of the panel's body, then the captains row, then
  the cards.
- **Captains row:** an `.eyebrow` "Captains", then the three inline (role label, `PlayerLink` with `pos`, the
  personality pill), wrapping on a phone. Before camp: "Captains are named when camp opens."
- **Cards keep their own height** (no stretching to a neighbour). Big cards sit two across, as today.
- **Quiet rooms go small.** A room is quiet when it isn't in trouble and its card has no "Who they follow", no "Wants a
  new deal" and no friendships or feuds. Each card object in `LockerRoom.tsx` already carries all four: `trouble` (the
  room reads Split, Down or Restless), `follows`, `deal` and `ties`. Quiet cards come after the big ones, in a grid of narrower cards (about 260px,
  so three or four across on desktop). They show what they show today, in less width. Inside each group the order stays
  today's: rooms in trouble first, then the unhappiest, then the coaches' order.
- **No new text.** Every sentence on the screen today stays, except the subtitle.
- The tests that render the Locker Room keep passing: `dispute`, `belief`, `chemistry`, `meetings`, `morale`,
  `character`.

## Docs and version

- `docs/UI.md`: four new sections ("The top of a screen", "Labels and text sizes", "Icons", "Links to another
  screen"), each a few rules with the component to use. "Heading levels vary between screens." leaves "Not consistent
  yet".
- `CLAUDE.md`'s `src/ui/` paragraph names the hidden `h1`, `PageHeader`, `Icon` and `MoreLink` beside `PlayerLink` and
  `TeamLink`.
- Not an MVP item: a patch bump in `package.json` for the work (or one a piece, if it lands in several pull requests),
  each with its `changelog.ts` entry in a player's words, per `docs/VERSIONING.md`.

## Checks

UI only: no sims. `npm run typecheck`, `npx vitest run src/ui/ui.test.ts` and the Locker Room tests, `npm run format`,
then `npm run copy` and a read of the lines touched. Screenshots before and after (`npm run screens`) of the Locker Room,
Stats, Front office and Home, desktop and phone, light and dark, for the owner to compare.

## Left to the builder

- Each icon's exact paths, inside the grid and stroke above.
- The exact size each selector lands on, within the mapping and the screenshots.
- The breakpoints for the Morale columns and the quiet cards' width.
- The `name` for the box score, replay and live game.
- How the tests read the source (the existing ones in `ui.test.ts` read files with regular expressions, and that is
  enough).
- Whether this lands as one pull request or one a piece. If several, the order is: icons, `MoreLink`, labels and
  sizes, `PageHeader`, then the Locker Room, which uses all four.
