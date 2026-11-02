# Alternate and classic uniforms

Date: 2026-11-02 · Branch: `claude/gallant-johnson-gqsz8w`

Mockups: seven rounds on the real avatar (helmets included), in the private artifact
`https://claude.ai/artifact/QY6m8TReQEakXzyMgKuoZ5`: the 32-club board is version 3 (designs) with the eight clubs as
set in versions 5 and 6, the number fonts in version 6, the N1 size in version 7. Builds on the helmets
(`2026-11-02-helmets-qb-gear-design.md`).

## Why

Every club wears the same two kits all season. Real clubs wear an alternate under the lights and a classic for a game or
two, and those games look like events. This adds both, chosen by the schedule, plus a number font and an outline per
club for more character. Cosmetic: nothing reads it but the avatar.

## Decisions (agreed in the brainstorm)

1. **Three sets beyond home and away:** a **colour rush** for every club, a **blackout** for eight, and a **classic** for
   every club, each with its own look; hand-made per club (data), with a rule built from its colours for a mod's club.
2. **When they're worn, mirroring the NFL** ([2025 policy](https://news.sportslogos.net/2025/03/31/nfl-revises-alternate-throwback-uniform-policy-to-allow-for-additional-use-combinations/football/)):
   at most **four special games** a club a season; up to **two primetime** home games in an alternate, **Thursday
   first**; **one or two classic** home games, division rivals first; **home team only** (the visitors wear the usual
   opposite); at most **three helmet designs** a season (usual, black, classic), and a special helmet only with its
   uniform ([NFL](https://www.nfl.com/news/nfl-approves-alternate-helmets-beginning-in-2022)).
3. **Fixed when the schedule is made:** a flex into or out of primetime never changes a game's uniform.
4. **Every number gets an outline** (all kits), and some clubs get their own number font.
5. **Our own designs:** colours borrowed from each market's club, never a real throwback's look.

## The sets

Names: black `#1b1d22`, white `#F2F4F6`, cream `#EDE6D6`. A "kit" is the jersey, number ink and outline, sleeve
stripes, pants and pants stripe; the helmet is the club's usual one unless the set names its own.

### Colour rush (every club)

One colour head to toe: jersey and pants in the primary, numbers in the secondary (made readable), a **wide white sleeve
band edged in the number's colour** and a white pants stripe; the usual helmet. Exceptions, as set in review:

| Club | Colour rush |
| --- | --- |
| Chicago | Orange `#c83803` head to toe, black numbers |
| Las Vegas | Whiteout: white jersey and pants, black numbers outlined in silver `#a5acaf` |
| Pittsburgh | Whiteout: black `#101820` numbers outlined in gold `#ffb612`, gold band |
| New Orleans | Whiteout: gold `#d3bc8d` numbers outlined in black |
| Carolina | Whiteout: black numbers outlined in blue `#0085ca`, blue band |
| Arizona | Whiteout: cardinal `#97233f` numbers outlined in black |
| Houston | Red `#a71930` head to toe, white numbers and accents |
| Atlanta | Red `#a71930` head to toe, black numbers |

### Blackout (Pittsburgh, Chicago, Las Vegas, New Orleans, Houston, Atlanta, Carolina, Arizona)

Black jersey, pants and helmet; numbers, both sleeve stripes and the pants stripe in the club's trim colour; a black
gloss helmet with a triple stripe (trim colour edged in white) and the number in the trim colour. Trim: the second
colour where the primary is black or near-black (contrast against black under 1.4: Pittsburgh gold, Chicago orange, Las
Vegas silver, New Orleans gold, Houston red), the primary otherwise (Atlanta red, Carolina blue). Arizona's numbers are
cardinal `#97233f` outlined in white.

### Classic (every club)

The primary jersey with white numbers in **Bitter** (800), **three thin sleeve stripes** (number colour, second colour,
number colour), cream pants with a primary stripe, and the **club's own helmet in matte**. Exceptions:

- **A classic helmet colour of its own** (matte, triple stripe A/B, number ink/outline, bumper, mask):
  Seattle silver `#a5acaf` (navy, green; navy on white; navy; navy), Denver orange `#fb4f14` (navy, white; navy on
  white; navy; grey), Tennessee light blue `#4b92db` (navy, white; navy on white; navy; grey), Philadelphia kelly green
  `#1f7a3a` (silver `#c4ccd0`, white; white on `#0f3d1d`; silver; grey), Atlanta red `#a71930` (black, white; white on
  black; black; grey), Buffalo red `#c60c30` (navy, white; white on navy; navy; grey); white shells for New England
  (red, navy), the NY Knights (green, green), the LA Condors (blue, gold), Dallas (blue, blue) and Tampa Bay (red,
  pewter `#34302b`), each with the number in its first stripe colour on white, that colour as bumper, a grey mask.
- **A classic jersey colour:** Tennessee `#4b92db`, Philadelphia `#1f7a3a`.

## Numbers

- **Outline on every kit** (home, away, every set): the club's second colour, 2.4 wide, where it stands off both the
  jersey and the number (contrast ≥ 1.5 against each); otherwise a 2.0 edge in dark `#0F172A` or light `#F8FAFC`,
  whichever stands off the number more. A set that names its outline keeps it.
- **Fonts** (the number and the nameplate; a club's sets use its font, the classic always Bitter):

  | Font | Width | Size | Clubs |
  | --- | --- | --- | --- |
  | Today's (Big Shoulders Display 900) | ×1.15 | 100% | everyone else |
  | Anton | ×1.25 | 91% | Minnesota, Tennessee, LA Stars, Jacksonville, NY Knights |
  | Archivo Black | ×0.85 | 100% | NY Empire, Indianapolis, New England, Baltimore, Cleveland |
  | Russo One | ×0.85 | 100% | Seattle |
  | Bitter 800 (classics) | ×0.95 | 100% | every club's classic |

  The four new faces load from Google Fonts with the app's others (`index.html`), with a real fallback stack.

## When each is worn

Assigned when the season's schedule is made (`generateSchedule`, after `assignKickoffs`), stored on the game as
`Game.uniform?: 'rush' | 'blackout' | 'classic'` (the home team's set), never changed by a flex:

1. **Alternates.** A club's home games in weeks 1–17 whose scheduled slot is primetime (`isPrimeTime`), Thursday games
   first, then by week: the first two get an alternate. A blackout club wears its colour rush in the first and its
   blackout in the second; the others wear the colour rush in both. Week 18's slots are set after week 17, so week 18
   never gets one.
2. **Classics.** One or two (half the clubs each, drawn on the season's stream) of the club's other home games in weeks
   1–17, division games first, then a seeded draw; never two classic weeks in a row.
3. **The cap:** alternates ≤ 2 and classics ≤ 2 keeps every club at four or fewer.
4. **Playoffs:** none.

**The kit for a game** (`uniformFor(league, team, game)`, which calls `kitFor` for the plain kits): the home team wears its game's set when it
has one, which takes precedence over the hot-day white rule; otherwise today's rule. The visitors wear white, unless
the home team is in white or a whiteout, when they wear their colours. A bye, a club that's out and the offseason are
home colours, as today. The game screens show the kit worn that day (they already pass `game`).

## Data, saves and code

- **`src/engine/data/uniforms.ts`:** every club's sets written out (colour rush, blackout where it has one, classic),
  its number font and the classic helmets, keyed by abbreviation; `TeamSeed` gains nothing, the file is read by
  abbreviation like the seeds. A club without an entry (a mod's) gets sets built by the rules above from its colours.
- **Types:** `UniformSet` (jersey, pants, ink, outline colour and width, sleeve style `'two' | 'three' | 'wide'`, accent,
  pants stripe, optional helmet), `NumberFont`, `Team.uniforms?` (copied from the data when a league is built, like
  `Team.helmet`), `Game.uniform?`.
- **Saves:** `SAVE_VERSION` 75 → 76: each club gets its uniforms from the data by abbreviation; the current season's
  games get their `uniform` from the same assignment (played ones too, so past box scores show what was worn).
- **`src/engine/season/uniforms.ts`:** `assignUniforms(league, games, season)`, pure and seeded, called by the schedule.
- **`src/ui/uniform.ts`:** `uniformFor`, the outline rule, the fallback sets. `PlayerAvatar` draws the set's sleeve
  style, pants, number font, size and outline, and the set's helmet in place of the club's.
- **`src/ui/color.ts`:** `kitFor` stays for the plain home and away kits and gains the outline.
- Nothing in the sim reads any of it.

## Tests

- `uniforms.test.ts` (engine): every club gets at most two alternates and two classics, never more than four; alternates
  only in primetime home games of weeks 1–17, Thursday first; blackout clubs' second alternate is the blackout; classics
  favour division games and never fall in back-to-back weeks; no special in the playoffs; a flex leaves `uniform` alone;
  the same seed gives the same assignment.
- `uniform.test.ts` (UI): the home team in its set, the visitors opposite (in colours against a whiteout); the special
  set beats the hot-day white; every club's data entry is complete and every number reads (contrast of the ink or its
  outline against the jersey ≥ 3); a mod's club gets a fallback set; the outline rule.
- `avatar.test.tsx`: each set renders at every size with no `NaN`; the set's helmet replaces the club's.
- Migrate: a v75 save gets the clubs' uniforms and the season's assignments.

## Docs and version

`docs/AVATARS.md`: section 5 (home and away) gains the sets and the schedule rule; section 4 the outline and fonts;
section 7 drops alternates and throwbacks. A PATCH bump and changelog entry in a player's words.

## Later

- Showing the uniform on the schedule screen ("Classic game", "Colour rush") and in the game preview.
- Visitors in specials (the NFL's contrast rule), alternates in the playoffs, choosing your club's special games.
- Each club's own pants colour (gold, silver) on the home kit.
