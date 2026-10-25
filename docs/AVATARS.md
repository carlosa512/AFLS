# Player and staff avatars

General managers use the same staff SVG renderer through `GmAvatar` (`ui/gm.tsx`). Their stable
appearance key selects one of four executive outfits: blazer, quarter-zip, polo or jacket, without a
coaching headset. Promoted directors retain their silhouette and hair. Current team colours follow
employment; unemployed and retired GMs use the neutral market palette. The portraits are decorative
and always accompany a linked name. GM cards and the directory use the same identity at every size.

> **Status.** Built: `PlayerAvatar` in `src/ui/components.tsx` draws every player from behind in his
> team's jersey (pure SVG, no images, no new dependencies), the colour rules and kits in `src/ui/color.ts`,
> and home and away jerseys by the league's rule. Tested in `src/ui/avatar.test.tsx`. A roster mod's
> `player.portrait` still replaces the drawing. Staff (coaches, scouts, medical staff) have their own
> avatar facing you, dressed for the job and the week: see [section 8](#8-staff-avatars).

## 1. Why a back view

The jersey number is how fans recognise a player, and with no face there are no faces or skin tones to
generate. It also keeps real-roster mods away from likenesses. The avatar never shows ratings, stars or
OVR: it reads only the jersey number, the surname and the team's colours.

## 2. The figure

A lit vector illustration: flat shapes with soft gradients for light and shadow. Each choice below was
picked from rendered options; don't undo one without a reason.

- **Faces straight away**, square with his torso. A half turn read lopsided; a full profile got lumpy below 48px.
- **Pads are a tall, wide shelf whose edges overhang the arms**, the arms tucked underneath (chosen over
  epaulet caps, a high arch and a hard shell).
- **The neck sinks into the pads**, so the head sits low between the shoulders, as players look in full gear.
- **The head is blocky** (square jaw corners, both ears), sized to balance the pads.

The artwork is plain path strings at the top of the component: tweaking the figure means editing those,
not the logic. Layers, back to front, all clipped to the circle: a spotlight backdrop in the team's
primary, the slate mannequin (`#3E4A59`), the jersey (1px soft outline so a white one stays visible),
shadows and pad gloss, the collar and two sleeve bands, the surname, the number, and a ring in a shade of
the primary with a thin highlight inside it.

## 3. Detail by size

| Size | Shows | Used in |
| --- | --- | --- |
| under 32px | ring, figure, jersey | list rows (trades, medical, stats, cap, front office): the name sits beside it |
| 32 to 95px | adds the sleeve bands and the number | depth chart (32), player of the game, inbox, negotiation |
| 96px and up | adds the surname | the player card (128; 96 on phones) |

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

All in `src/ui/components.tsx` and `src/ui/color.ts`: `NUMBER_MIN_PX` (32), `NAMEPLATE_MIN_PX` (96),
`NAMEPLATE_MAX` (40 viewBox units), `PLATE_EM` (re-measure if the display font changes), `MIN_CONTRAST`
(4.5) and `HOT_KICKOFF_F` (85).

## 7. Not yet

- Alternate and throwback uniforms, colour-on-colour specials, and club traditions (a team that always
  wears white at home).
- Gear and builds by position (neck rolls, wider linemen). Several were drawn during design.
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

