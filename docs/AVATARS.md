# Player and staff avatars

General managers use the same staff SVG renderer through `GmAvatar` (`ui/gm.tsx`). Their stable
appearance key preserves each person's established head, hair and body type. Every GM wears the suit
outfit, without a coaching headset or staff equipment. Promoted directors retain their silhouette and hair. Current team colours follow
employment; unemployed and retired GMs use the neutral market palette. The portraits are decorative
and always accompany a linked name. GM cards and the directory use the same identity at every size.

> **Status.** Built: `PlayerAvatar` in `src/ui/components.tsx` draws every player from behind in his
> team's jersey (pure SVG, no images, no new dependencies), the colour rules and kits in `src/ui/color.ts`,
> home and away jerseys by the league's rule, and each player's build, head and height (`src/ui/playerLook.ts`,
> [section 2a](#2a-builds-heads-and-height)), and his club's helmet ([section 2d](#2d-helmets)). Tested in `src/ui/avatar.test.tsx`. A roster mod's
> `player.portrait` still replaces the drawing. Staff (coaches, scouts, medical staff) have their own
> avatar facing you, dressed for the job and the week: see [section 8](#8-staff-avatars).

## 1. Why a back view

The jersey number is how fans recognise a player, and with no face there are no faces or skin tones to
generate. It also keeps real-roster mods away from likenesses. The avatar never shows ratings, stars or
OVR: it reads only the jersey number, the surname, the team's colours, and the height, weight and position
the card already shows.

## 2. The figure

A lit vector illustration: flat shapes with soft gradients for light and shadow. Each choice below was
picked from rendered options; don't undo one without a reason.

- **Faces straight away**, square with his torso. A half turn read lopsided; a full profile got lumpy below 48px.
- **Pads are a tall, wide shelf whose edges overhang the arms**, the arms tucked underneath (chosen over
  epaulet caps, a high arch and a hard shell).
- **The neck sinks into the pads**, so the head sits low between the shoulders, as players look in full gear.
- **The head is blocky** (square jaw corners, both ears), sized to balance the pads. A player with a club wears his
  club's helmet over it ([section 2d](#2d-helmets)); the bare head is for free agents, prospects and retired players.

The artwork is plain path strings at the top of `src/ui/playerLook.ts`: tweaking the figure means editing
those, not the logic. Layers, back to front, all clipped to the circle: a spotlight backdrop in the team's
primary, the slate mannequin (`#3E4A59`), the jersey (1px soft outline so a white one stays visible),
shadows and pad gloss, the collar and two sleeve bands, the surname, the number, and a ring in a shade of
the primary with a thin highlight inside it.

## 2a. Builds, heads and height

From 32px each player is drawn to his own body. Nothing is saved: it's a pure function of his weight, height,
position and id. Each choice was picked from rendered options (three rounds of mockups, then a fourth for the arms,
framing and height); don't undo one without a reason.

- **Five builds by real weight**, the same ruler at every position, so a 212 lb corner looks like a safety:
  Lean (under 205: most receivers, corners, kickers), Athletic (205–229: safeties, backs, quarterbacks,
  punters), Solid (230–264: linebackers, tight ends), Big (265–294: edge rushers) and Heavy (295 and up:
  linemen). A build sets the pads' width, the chest, belly and waist, the neck and how high the shoulders
  ride toward it (`BUILDS`). The head stays one size, so the body reads bigger or smaller.
- **Every build has a waist**, so the heaviest still read as men and not walls. The light builds taper only a
  little below the chest: a sharper taper made receivers and corners look pinched.
- **Zoomed out 21%** about the collar (`ZOOM`), so the wide builds show their width inside the ring and the ring
  crops the arm below the elbow, where its shape shows. The number gives up a little size for it, and narrows
  with a narrow back. **Moved up** a little (`DROP`, -4), so the head sits near the top and the pants show at
  the bottom (moved down 6 left too much air over the head; up 8 crowded it).
- **Football pants at the hips.** The jersey runs well past the number before it tucks in, and the waistband
  sits at the hips (`PANTS_TOP`): two tries with the belt just under the number read as high-waisted slacks.
  A thin belt half hidden under the jersey's tuck, the waistband dipping in the middle with its sides lifted
  (`PANTS_DIP`), tight over the seat with a sheen, a seam down the middle and two stripes down each side. Only
  built figures wear them: on the plain figure they'd sit below the ring.
- **Arms are two outlines mixed by build:** a smooth tube and a muscled arm (triceps, a pinch at the elbow,
  the forearm), with the same commands so a build sits anywhere between them (`Build.arm`: lean 25% muscled up to
  heavy 55%; the plain figure 40%). The old single arm bowed out and tapered to a point. Each ends in a wrist and
  a hand at the hip, past the ring's edge: stretched past the ring instead, the forearm ran on with no end.
- **Arms keep their gap to the jersey** and thicken only a little with the build (skinny arms read wrong);
  they hang a touch off the body (`ARM_GAP`, `ARM_SWING`; a wider swing read as bowed out on the big builds).
  Below the chest they follow only 30% of the body's width (`ARM_FOLLOW`): following all of it bowed a heavy
  man's arms out around his belly.
- **Three heads** from behind (today's blocky one, a wide round one and a long one), picked once from his id.
  Outline only, like the staff.
- **Height against his position, on the card only:** an average height for his position is today's spot; a
  tall one is drawn up to 6.5% taller from his feet (2.6% per sd, capped at 2.5 sd), a short one shorter. His
  width moves the other way by about half as much (`1 / sqrt` of the height's scale), because the same weight on a
  shorter frame is stockier: drawn bigger all over, a short receiver looked skinnier than a tall one. From
  the feet, not a slide, so the number never drops out of the ring. The engine judges size the same way
  (inches over his position's median), so a man who stands taller wins the contested balls the picture
  promises.

## 2b. Gear

> **Status.** Built: `gearOf` and the rates in `src/ui/playerGear.ts`, the drawing in `src/ui/gearArt.tsx`. Tested
> in `src/ui/playerGear.test.ts`.

From 32px each player wears his own gear on his arms, picked once from his id and position like his head, so his
look is his for a career. Nothing is saved and nothing reads ratings. Each choice was picked from rendered options
(four rounds); don't undo one without a reason.

- **Pieces:** sleeves (full, three-quarter, half, the forearm only, or a shooter sleeve: from partway down the
  upper arm to the wrist, bare skin above it; common for quarterbacks, receivers and the secondary, on one arm for
  nearly every quarterback and most receivers, on both for about half the corners and safeties), a short solid undershirt sleeve (the
  jersey keeps its stripes), biceps bands (on both arms; a single band goes on the forearm), elbow pads, and a
  black shoulder brace with a strap in the team's colour (bulkier than the arm, a diagonal strap and a D-ring, so it
  doesn't read as a sleeve). Two pieces at most, and bands rarely go over a sleeve (`BANDS_OVER_SLEEVE`): an
  undershirt sleeve with biceps bands, or a single forearm band, is the usual layered look. Colours: black, white or the primary; bands also the secondary.
- **By position** (`GEAR_RATES`): skill players in light sleeves and bands (a sleeve on about 60% of receivers,
  55% of corners, 45% of backs and safeties), 40% of quarterbacks in one (often a shooter sleeve; a single sleeve
  goes on the throwing arm), the trenches in elbow pads (40% of the offensive line and edge rushers, 30% of
  tackles) and now and then a sleeve (a quarter of edge rushers, 15% of tackles, 10% of the offensive line), a
  shoulder brace on about one lineman or edge rusher in twenty, kickers and punters nearly bare. Linemen
  take most of their contact through the elbows, and most NFL arm injuries are theirs
  ([WashU](https://source.washu.edu/2008/08/researchers-track-common-arm-injuries-among-nfl-players/)); skill players
  wear the lighter gear ([Dick's](https://www.dickssportinggoods.com/protips/sports-and-activities/football/choose-football-arm-protection));
  shoulder braces are worn mostly by offensive linemen after an injury
  ([study](https://pmc.ncbi.nlm.nih.gov/articles/PMC5140042/)).
- **Cold games** (`coldGame`): open air at 35°F or colder at kickoff (`COLD_KICKOFF_F`), snow, or heavy rain, and
  about 85% of players pull on full sleeves in the colour they'd pick anyway, half the tackles, never the offensive
  line: a lineman who wears sleeves keeps them, but the line doesn't dress for the cold
  ([SI](https://www.si.com/more-sports/2010/12/08/long-sleeves)). It follows the kit's game, like the hot-day white
  jerseys. Under full sleeves a shoulder brace and bands stay on; the undershirt sleeve and elbow pads come off.
- **The quarterback's padded sleeves** (`padded`, a full sleeve, and `paddedElbow`, a short one around the elbow): a
  honeycomb pad over the point of the elbow, turned 62° toward the outside of the arm (mirrored on the left), so it
  squeezes and wraps the edge as it turns away; a shade of the sleeve's colour. They're two more lengths in a
  quarterback's usual sleeve mix (weights 40 and 20 in `GEAR_RATES.QB`; his 40% chance of a sleeve is unchanged), so
  about one quarterback in eight wears one: on one arm mostly, the left as often as the right, both for about one in
  six (`PADDED_BOTH`). A flavour, not cold-weather gear: in the cold he pulls on plain full sleeves like everyone else.
- **The play-call wristband** (`Gear.wristband`): 60% of quarterbacks (`WRISTBAND_QB`), one wrist, the right for one
  in four (`WRISTBAND_RIGHT`); white, black, the primary or the secondary. A solid band a little above the wrist, so
  more of it stays inside the ring, the play card behind its window turned 75° toward the outside of the wrist, where
  he flips it up to read. Never on an arm in a padded sleeve (it moves to the other wrist, or stays off when both arms
  are padded); outside the two-piece limit; kept on in the cold.
- **Your pick** (the card's pencil): name, number and gear in one editor, a row a piece (helmet, sleeve or undershirt
  sleeve, wristband, band, elbow pads, shoulder brace) with its arm and colour, the card's avatar wearing it as you
  change it.
  Anything goes, whatever his position (cosmetic, like a rename); it's kept on the player (`Player.gear`,
  `editPlayerGear`) and "Back to his own" drops it. A cold game still dresses him as above.

## 2c. Captains and rookies

- **The captain's patch**, close up at the right of his card's header (`captainPatch.tsx`), never on the small
  avatar: a "C" in the team's second colour (white or dark when that doesn't stand off the header), four tiny stars
  under it, one lit for each season in a row he's been a captain (`Player.captainSeasons`, kept when captains are
  named at camp), and the whole patch gold from the fifth (`GOLD_AFTER`). Hover or a screen reader says "Captain · 3
  seasons in a row".
- **Rookies** (a first-year pro, drafted or signed, never a prospect: `isRookie`) get a small red "R" on the line of
  their name (`RookieMark`): in every list that shows the player's picture (`PlayerLink` with an avatar: depth charts,
  the market, rosters), so they stand out at a glance, and beside the name on their card. Never inside a sentence, and
  never on the picture itself.
- **Dropped:** a neck roll (a crescent at the collar at these sizes), a hinged elbow brace (read wrong), a flat
  brace (read as a sleeve). The ring crops above the wrist, so wristbands and gloves wouldn't show; the quarterback's
  play-call band sits a little higher for that reason (section 2b).

## 2d. Helmets

> **Status.** Built: the rules in `src/ui/helmet.ts`, the drawing in `src/ui/helmetArt.tsx` and `src/ui/flags.tsx`,
> each club's design on its seed (`data/teams.ts`, `Team.helmet`). Tested in `src/ui/helmet.test.ts`,
> `src/ui/helmetArt.test.tsx` and `src/ui/avatar.test.tsx`. Spec, with eleven rounds of mockups:
> `docs/superpowers/specs/2026-11-02-helmets-qb-gear-design.md`.

Every player with a club wears its helmet; free agents, draft prospects until they're drafted and retired players
keep the bare head (`wearsHelmet`). Nothing is saved but your pick, and nothing reads ratings. Each choice was picked
from rendered options; don't undo one without a reason.

- **Size and fit:** 85% of the first mockup shell (`HELMET_SCALE`), about 1.16× the bare head's width, scaled about
  the middle of the head. Its lowest point sits a little above the collar (`HELMET_NECK_Y`, 38.8) and rides higher on
  heavier builds (`HELMET_NECK_PER_TRAP`, 0.5 per step of `Build.traps`), so linemen keep some neck. The tallest,
  heaviest players' crowns can tuck under the ring's edge on the card, as in a tight photo crop.
- **Eight shells**, by our own names (never a maker's or a model's), each drawn from a rear photo of a real helmet or
  mixing their parts: Modern, Modern smooth, Plated, Classic, Pod, Pod wide (the lineman's), Ridgeback and Retro.
  The model is the player's, picked once from his id by his position (`HELMET_WEIGHTS`: the wide pod up front and in
  the middle, the older shapes for kickers); the design is the club's. The same helmet home and away.
- **Details** (from 32px): vents and ledges, a plate or bumper (the number moves onto a dark plate), black chin-strap
  clips with a white tip, and the facemask's lower corners, drawn before the neck so only the corners show: one bar
  for skill players and quarterbacks, two for linebackers, edge rushers and tight ends, the full cage for linemen, a
  thin bar for kickers (`maskOf`).
- **Club designs** (`HelmetDesign`): shell colour and finish (gloss, matte, or metallic for the silver and gold
  clubs), stripes, the number on the back or not, bumper and mask colour. A club without one (a mod's) wears its
  primary with a stripe in its secondary (`helmetDesignOf`). Dark shells get a rim of light so they hold their shape
  against dark jerseys (`isDarkShell`).
- **Decals** (from 56px): the US flag on every helmet, as on every NFL helmet; a Pathway player's country stacked
  under it all season (the NFL's Heritage Program; the game knows a country only through the Pathway, and a CFL
  arrival's league isn't where he's from); the green dot, the helmet with the coach's radio, on the starting
  quarterback and the defence's play-caller (the first linebacker, or a safety): `flagsOf`, `greenDotOf`.

## 3. Detail by size

| Size | Shows | Used in |
| --- | --- | --- |
| under 32px | ring, figure, jersey, the club's helmet shell: the same plain figure for everyone | list rows (trades, medical, stats, cap, front office): the name sits beside it |
| 32 to 95px | adds his build, his gear, the helmet's details and number, the sleeve bands and the number; from 56px the helmet's flags and green dot | depth chart (32), player of the game, inbox, negotiation |
| 96px and up | adds the surname and his height | the player card (128; 96 on phones) |

It is decorative (`aria-hidden`): every placement shows the player's name next to it.

## 4. Colours

- **Lettering** is the secondary when it reaches **4.5:1** against the jersey (WCAG's bar for small text:
  at 32–95px the number is small text). Otherwise it is light or dark, whichever reads better; on mid
  grey that pair bottoms out near 4.2:1. Eighteen of the 32 home kits swap.
- **Two-tone trim.** A swapped-out secondary isn't lost: it becomes the number's outline (when it stands
  out from the lettering by 3:1) and the lower sleeve band. Buffalo keeps its red, Miami its orange,
  Kansas City its gold.
- **Font.** The app's display face (`var(--font-display)`, Big Shoulders Display) at weight 900, numerals
  stretched 15% wider. The surname is sized from a measured width per capital (`PLATE_EM`, 0.52) and
  pinned there with `textLength`, so it stays on the jersey even if a wider fallback font stands in.
- **Dark mode.** A 1px edge (`--avatar-edge` in `styles.css`) outlines the circle; without it the 19
  primaries under 2:1 against the dark surface (navies, blacks, browns) sink into it.
- **Pants** are white at home, silver under a jersey too light to stand off white, and the primary under the
  white away jersey, so white never meets white. The wide side stripe is the primary on light pants and white
  on the primary; the thin one is the secondary when it shows against the pants. The belt is a shade of the
  primary.
- **Free agents and prospects** wear the app's grey-green (`#4a554e` / `#9aa59e`).

## 5. Home and away

The league's rule: **the home team picks, and the visitors wear the other jersey**, so colour never
meets colour. Home teams wear their colours and the visitors wear **white**, lettered in their primary
with the secondary as trim.

- **White at home on a hot day.** Open air (outdoors, or a retractable roof left open) at **85°F or
  hotter at kickoff**, the home team takes white and leaves the visitors the dark jerseys in the sun, as
  heat-belt clubs do. It reads the game's own weather (`gameWeather`), so it is a pure function of the
  game like everything else. Over 40 seasons that's about 2% of games (5 a season): Miami about 2.2 home
  games a year, Tampa 1.6, Jacksonville 0.6, nearly all in September, and a hot day somewhere else now
  and then. Never under a dome; night kickoffs run cooler, so mostly day games.
- The kit follows **this week's game** (`wearsWhite`), regular season and playoffs alike. A bye, a team
  that's out, and the whole offseason are home colours. The title game is on a neutral site, so the
  designated home team is in colours.
- A game that's already been played shows the kit worn that day (the player of the game passes `game`).

## 6. Tunables

In `src/ui/playerLook.ts`: `BUILDS` (with each build's `arm` mix), `BUILD_MIN_PX` (32), `HEIGHT_MIN_PX` (96), `ZOOM`
(0.79), `DROP` (-4), `PANTS_TOP` (104), `PANTS_DIP` (4), `GROW_PER_SD` (0.026), `ARM_GAP` (1.3), `ARM_SWING` (2),
`ARM_FOLLOW` (0.3), `PLAIN_ARM` (0.4) and `NAMEPLATE_MAX` (40 viewBox units). In `src/ui/components.tsx` and
`src/ui/color.ts`: `NUMBER_MIN_PX` (32), `NAMEPLATE_MIN_PX` (96), `DECALS_MIN_PX` (56), `PLATE_EM` (re-measure if the display font changes), `MIN_CONTRAST`
(4.5) and `HOT_KICKOFF_F` (85). In `src/ui/helmet.ts`: `HELMET_SCALE` (0.85), `HELMET_NECK_Y` (38.8),
`HELMET_NECK_PER_TRAP` (0.5) and `HELMET_WEIGHTS`. In `src/ui/playerGear.ts`: `PADDED_BOTH` (0.15), `WRISTBAND_QB`
(0.6) and `WRISTBAND_RIGHT` (0.25).

## 7. Not yet

- Alternate and throwback uniforms, colour-on-colour specials, club traditions (a team that always
  wears white at home), and each club's own pants colour (gold, silver…): today's pants follow the rule in section 4.
- Alternate helmets, with alternate jerseys and throwbacks: one per club, worn in its primetime games, fixed when
  the schedule is made so a flex doesn't change it (mocked for six clubs).
- Hair under the helmet (locs, braids, the flow, a ponytail, curls; mocked, held for now).
- A SpeedFlex-style shell (no straight-on rear reference yet); wristbands for defensive play-callers.
- Ring text ("QB · Dallas Stampede"): the card header already shows that line, and curved text is
  unreadable at these sizes. Dropped.
- Validating mod-supplied colours (arrives with league import).

## 8. Staff avatars

> **Status.** Built: `StaffAvatar` in `src/ui/staffAvatar.tsx` (with the drawing, `StaffFigure`, and the
> week's dress code, `staffDay`), the outfit picker `staffLook` in `src/ui/staffLook.ts`. Tested in
> `src/ui/avatar.test.tsx` and `src/engine/women.test.ts`.

The same family as the player avatar (ring, spotlight, lighting, grey mannequin), but **staff face you**:
the props (headset, credential, stethoscope, whistle) read far better from the front, and the facing
direction tells staff from players at a glance in a mixed list. Nothing is saved: a look is a pure
function of the person's id, his chair and the week. It reads no ratings.

### The figure

Each choice was picked from rendered options; don't undo one without a reason.

- **One line for a face:** level brows and a nose, from 32px. Arched brows read as closed eyes, dipped
  ones as angry.
- **Classic head shapes**, picked per person: square, round, oval, heart or oblong for men; round, oval or
  heart for women, a little narrower. Hats, hair and the headset are fitted to each head.
- **Hats sit low**, the brim shading the eyes.
- **Women** have a slimmer neck and an 8% narrower build, and one solid grey hair shape (bun, ponytail,
  bob or long; always long with a blazer, which takes an open collar instead of a tie).
- **The medical cross is white or team-coloured, never red** (the Red Cross emblem is protected).
- **The neck runs on under the clothes**, so no neckline leaves a sliver of backdrop, and it meets the
  neckline's corners without flaring past them, so every collar wraps around it. The polo's collar
  stands behind the neck; its points and the open placket are in front.

### Wardrobe

Each person's outfit is picked from his id (`coaches:12`, `staff:12`, `medics:12`: ids only repeat
across the three records), so it's his for life, and it changes with his chair (a promotion, a new job).

| Chair | Outfits | Gear |
| --- | --- | --- |
| Coaches (head coach, coordinators, position, special teams) | hoodie, quarter-zip, polo with cap, two-tone jacket | headset |
| Strength & conditioning coach | tee, tee with cap, quarter-zip, hoodie | whistle (no headset: he runs warm-ups, not the play sheet) |
| College and pro scouts | polo with cap, quarter-zip, jacket, polo | credential |
| Director of scouting | blazer, always | credential |
| Medical staff (doctor, physios, sports scientist) | polo with chest cross, scrubs, quarter-zip, lab coat | the cross on a polo or jacket, otherwise a stethoscope |

### The day

`staffDay` reads the same inputs as the kit rule (`gameWeather` for this week's game), so a team's whole
staff dresses alike and it's a pure function of the week.

| Day | What changes |
| --- | --- |
| Game week (also byes, a team that's out, the market, domes, closed roofs and mild days) | nothing: his own outfit |
| Cold: open air, `COLD_KICKOFF_F` (40°F) or colder at kickoff | jacket and beanie |
| Hot: open air, `HOT_KICKOFF_F` (85°F) or hotter | polo and visor (the strength coach keeps his tee) |
| Offseason, and the gap after the title game | coaches a quarter-zip, no headset; the strength coach his tee and whistle (it's his busiest stretch); scouts and the Director a blazer; medical staff a lab coat |
| Retired (a coach kept on file for his record) | the offseason look, for good |

Scouts follow game-day weather too, for simplicity.

### Colours

- The ring, spotlight, caps and beanies come from the team's primary.
- Trim (drawstrings, zips, piping, the cross, the whistle's cord) is **ink**: the secondary when it
  reaches 4.5:1 against the clothing, otherwise light or dark (`readableOn`, the player rule).
- The stethoscope turns silver on dark clothes; the Director's tie is in the primary.
- Staff on the market, and retired coaches, wear the app's grey-green.

### Detail by size and placements

| Size | Shows | Used in |
| --- | --- | --- |
| under 32px | ring, mannequin, garment, hats, headset band and cups | list rows (28): each club's staff under Around the league (coaches, scouts, medical), who coaches each room, the staff-deals and hiring mail, the head-coach carousel |
| 32px and up | adds the face line, zips, plackets, drawstrings, lanyard and badge, stethoscope, cross, whistle, mic boom and beanie ribs | staff cards on the Coaches, Scouts and Medical screens, candidates included (56); the staff card header (128; 96 on phones), where it replaces the team chip |

A staff name inside a sentence (a note, a transaction, a fit line) gets no avatar, as with players.
Decorative (`aria-hidden`): every placement shows the name beside it.

### Women on staff

- **The flag lives on the record** (`woman?: true` on scouts and medics), drawn with the name
  (`newIdentity` in `identity.ts`), so a name and a face can never disagree. The avatar only reads it.
  Coaches never roll.
- **The share is by chair** (`WOMEN_SHARE` in `engine/data/heritage.ts`): 7% of scouts, 3% of Directors and
  head doctors, 15% of physiotherapists, 25% of sports scientists, with women's names. See
  [NAMES.md](NAMES.md).
- Old saves: v26 adds the optional field (absent means a man); the v27 names pass rolls it for existing
  scouts and medics as it renames them.

### Tunables

`DETAIL_MIN_PX` (32) and `COLD_KICKOFF_F` (40) in `staffAvatar.tsx`, `HOT_KICKOFF_F` (85) shared with the
kit rule in `components.tsx`, the wardrobes in `staffLook.ts`, `WOMEN_SHARE` in `engine/data/names.ts`.

### Not yet

- Inbox sender avatars for staff (one line each: `fromCard` already names the person).
- Mod-supplied staff portraits, like `player.portrait`.
- Women coaches (their share stays 0).

