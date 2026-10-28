# UI audit (step 1: findings only, nothing changed)

Taken Oct 28 2026 from the live site (https://afls-red.vercel.app, main at **v0.2.13**), so the draft-day branch
(0.2.14) isn't in these shots. The career is Indianapolis, week 11 of 2026, 7-2, with the week 10 game played.
Desktop is 1280×900. The remote browser can't go below 1024 px wide, so there are **no phone-width shots**. Phone
checks still need a real device or local Playwright, which the proxy blocks here.

Scope, per the owner: screens untouched since launch. The **Draft** tab is out (being worked on). Roster, Coaches,
Scouts and Medical are fine: quick notes only. **Reference screens** (the look the rest should match): Home, Inbox,
Trades, and the player card.

Each issue is tagged **V** visual, **C** consistency, **R** readability or **B** rules and behaviour.

## The five things that matter most

1. **B: rate leaders aren't qualified.** Passer rating has T. Scott #1 at 137.1 on 17 attempts in 1 game, and
   L. Hall #4 on 54 attempts. The Player stats tab says "qualified first", and Records counts the unfinished
   season too. This is already a follow-up in `docs/MVP.md` ("Rate-stat qualification"). It's a display rule,
   not the engine, but it touches shared stats code. Owner's call.
2. **V: tables overflow at 1280.** Standings divisions scroll sideways and hide Div and Strk. The roster's
   "2026 stats" column is clipped mid-text. Cap fits but is tight.
3. **C: older screens don't follow `docs/UI.md`.** Plain-text team names where `TeamLink` tiles belong
   (Player stats). Two sort arrows at once (Cap). "Ability" vs "OVR" headers. A second style of OVR estimate
   (red dashed, FA). Records written "7–2" vs "7-2".
4. **R: labels that repeat their header or don't explain themselves.** "Week 18 · time TBD". "thru 2027" under
   a Thru header. "ask $X × 5". LC/FC on Awards. "Sacks" with no side on Team stats. Disabled buttons with no
   reason why (Restructure, Release).
5. **V: page jumps about 7 px sideways** between pages with and without a scrollbar (Playoffs, Compare, Waivers).
   One CSS line fixes it (`scrollbar-gutter: stable`).

## Screen by screen

### New game · `newgame-desktop.png`
Matches the reference look. No issues worth a change.

### Home · `home-desktop.png` (reference)
The look to match: cards, headers, team tiles. Fine.

### Inbox · `inbox-desktop.png`, `inbox-empty-desktop.png` (reference)
Fine. The empty state reads well.

### Live game · `live-game-desktop.png`
- **C** The nav highlights Home while you watch a game.
- **R** Play-by-play names have no space ("L.Patterson"), while every table uses "L. Patterson".
- **R** "+1 yds": the unit should be "yd" for one yard.
- **R** "Ball on midfield" should read "Ball at midfield".

### Box score · `boxscore-desktop.png`
- **C** The line score's team cell shows the abbreviation twice (tile "KC" plus text "KC").
- **R** Play-by-play names have no space ("T.Greene"), same as the live game.
- **R** A missing space: "2nd & 17PENALTY".
- **R** Alt text "Ball on the own 32" ("on their own 32").
- **R** The Officials table lists every foul kind, mostly 0/0 rows. Show the ones called, with the rest folded away.
- **V** The weather line ("Roof closed") floats alone between the banner and the cards.

### Standings · `standings-desktop.png`
- **V** Each division table overflows at 1280 with a sideways scrollbar, hiding Div and Strk.
- **V** Four divisions in a 3-column grid leave the fourth orphaned on its own row.
- **R** No seed, clinched or eliminated marks, while Playoffs has them.

### Schedule · `schedule-desktop.png`
- **R** "Week 18 · time TBD" repeats the week that heads the row.
- **R** Result shows "–" or "Next" while Score is blank. One column could say both.
- **C** Bold "Light weather" with its own capitalisation. The Weather column mixes "Roof closed" alone with full
  readings.
- **C** The Score header is in the mono font, unlike the other headers.

### Stats: Leaders · `stats-leaders-desktop.png`
- **B** No qualifier for rate stats (see the top five).
- **V** Small player icons. The owner wants bigger ones.

### Stats: Players · `stats-players-desktop.png`
- **C** Team is plain text, not a `TeamLink` tile (UI.md).
- **V** Small player icons.

### Stats: Teams · `stats-teams-desktop.png`
- **C** No season picker, while the other stats tabs have one.
- **R** "Sacks" doesn't say whether made or allowed.

### Stats: Records · `stats-records-desktop.png`
- **B** Counts the season still being played. The leaders' qualifier applies here too.
- **R** No team column, so you can't tell who set a record.
- **C** The intro text sits outside a card, unlike other tabs.

### Stats: Awards · `stats-awards-desktop.png`
- **R** LC and FC aren't explained (the two conferences).
- **R** "0 sacks" shown as an award line.
- **V** Month and week tables' columns don't line up with each other.
- **C** Its own season dropdown, separate from the other tabs'.

### Stats: Officials · `stats-officials-desktop.png`
Fine. **R** Rank direction isn't obvious (is #1 the busiest crew or the quietest?).

### Playoffs · `playoffs-picture-desktop.png`
Fine. **V** The Seed header sits far from the team it numbers. **R** There's no "in the hunt" list for teams just
outside.

### Compare · `compare-empty-desktop.png`
- **R** The empty state is a dead end: no hint how to add players (you start from a player card's Compare).
  It isn't in the nav either.

### Front office: Waivers · `office-waivers-desktop.png`
- **C** The route works but isn't a tab, and the page says "not active in this career yet". Hide it or link it.

### Front office: Re-sign · `office-resign-desktop.png`
- **R** "thru 2027" and "ask $X × 5" repeat their headers. The "× 5" unit (years) isn't said.
- **C** OVR is a decimal chip here, while other office tabs use a range.

### Front office: Free agents · `office-fa-desktop.png`
- **C** A different OVR estimate style (red dashed) from the rest of the game.
- **R** The "For you" column is all "–" at this point in the season, which makes it look broken.
- **R** Ask has no "$" or unit prefix, unlike Re-sign.

### Front office: GMs · `office-gms-desktop.png`
- **R** "Your appointment" and "Your GM career" say the same thing twice.
- **V** Stat tiles are uneven widths.
- **C** Records use "7–2" (en dash), while the header and standings use "7-2".

### Front office: Coaches · `office-coaches-desktop.png` (quick note)
Fine. **V** In "Who coaches your players", the coach column shifts left and right row to row.

### Roster · `roster-desktop.png` (quick note)
Fine overall.
- **V** "2026 stats" is clipped mid-text at 1280.
- **V** The OVR and Age headers sit lower than the rest.
- **B** In "Play at…", QB2 L. Hall shows "small knock" at every position, K and P included, while QB1 and QB3
  show "big knock". It may be on purpose (he has played other spots?), but it reads wrong.

### Scouts, Medical (quick note)
Not shot. Fine per the owner.

### Cap · `cap-desktop.png`
- **C** The header says "Ability" here, "OVR" everywhere else.
- **C** Two sort arrows show at once.
- **R** Restructure is disabled on every row with no reason given. Release is disabled for K and P with no reason.
- **V** A tooltip showed without a hover on load.

### Player card · `player-card-desktop.png` (reference)
Good, and its big portrait is the size to aim for in tables.
- **R** Stats write yards as "2030", while the roster writes "2,030".
- **V** The injury table's When column is right-aligned in mono, unlike the rest.

### Version history · `version-history-desktop.png`
Fine.

## Proposed order for step 2 (waiting on the owner)

1. Shared fixes that touch every screen: scrollbar gutter, the name spacing in play-by-play, number formatting
   (commas, yd/yds, en dash vs hyphen), one OVR style, bigger player icons in tables.
2. Overflow: Standings layout (2×2 grid, no sideways scroll) and the roster stats column.
3. Labels: Schedule, Re-sign, FA, Cap, Awards, Team stats, box score.
4. UI.md gaps: `TeamLink` on Player stats, one sort arrow on Cap, the season picker on Team stats.
5. Ask first: rate-stat qualification (shared stats code), Records' current season, the "Play at" knock wording.

No engine, AI, trade or rating changes in any of this.
