# Helmets, helmet decals and the quarterback's gear

Date: 2026-11-02 · Branch: `claude/gallant-johnson-gqsz8w`

Mockups: eleven rounds, drawn by the real avatar code (`PlayerAvatar`'s figure, builds, kits and sizes) with the new
pieces on top. The last two versions are the reference: the 32-club board (version 10) and the gear editor (version 11)
of the private artifact `https://claude.ai/artifact/USBYRuMphWq9aXHwtaqofQ`. The mockup source, with every path and
number below, is kept beside this spec: `2026-11-02-helmets-qb-gear-mockup.tsx` (not built; see its header).

## Why

The avatar (`docs/AVATARS.md`) draws every player from behind with a bare grey head. A helmet in the club's design is
the most recognisable thing about a player from behind, and the quarterback's padded sleeve and play-call wristband
are the most recognisable pieces of his kit. This adds both, plus the decals real helmets carry, with nothing read from
ratings and nothing that changes play.

## Decisions (agreed in the mockups)

1. **The helmet replaces the bare head** on every player with a club, at every size. Players without one keep
   today's bare head: free agents, draft prospects until they're drafted, and retired players
   (`wearsHelmet(player, team)`: a team, not retired, not a prospect).
2. **The model is the player's, the design is the club's.** Each player wears one of eight shells, picked once from his
   id and position like his sleeves; the club's colours, stripes, number, bumper and mask go on whatever he wears. The
   same helmet home and away, on hot days and in cold games.
3. **Our own names only.** The shells were drawn from rear product photos of real helmets (Riddell Axiom, Schutt F7 and
   Vengeance, Vicis Zero2 and Zero2 Trench). No maker or model name appears in the game, code identifiers included.
4. **Decals:** the US flag on every helmet; a Pathway player's country stacked under it (never for a CFL arrival); the
   green dot on the quarterback and the defence's play-caller.
5. **Quarterbacks:** a padded sleeve (two kinds), mostly on one arm (either one) and sometimes both, and a play-call
   wristband on one wrist, picked from his id like the rest of his gear.
6. **The gear editor** (the card's pencil) gains a Helmet row, two padded sleeve kinds and a Wristband row.
7. **Held for later:** alternate helmets (they come with alternate jerseys and throwbacks), hair under the helmet, a
   SpeedFlex-style shell (no straight-on rear photo was found).

## The helmet

### Size and fit

- **Size:** 85% of the round-2 shell (`HELMET_SCALE = 0.85`), scaled about the middle of the head (50, 26) in the
  figure's 100-unit box. About 1.16× the bare head's width.
- **Fit:** the back's lowest point sits at `38.8 − 0.5 × max(0, build.traps)` in the figure's units (`HELMET_NECK_Y`,
  `HELMET_NECK_PER_TRAP`). Heavier builds carry their pads higher, so their helmet rides a little higher and a lineman
  keeps some neck. The plain figure (under 32px) uses 38.8.
- The helmet scales with the figure (zoom, height, girth), like the head it replaces. The tallest, heaviest players'
  crowns can tuck a unit or so under the ring's edge on the card, as a tall man's would in a tight photo crop (checked by
  eye on the card).

### The eight shells

Each is drawn in the same box (`MODELS`), so size and fit hold for all of them. Keys are what the code stores; names are
what the editor shows.

| Key | Name | From behind | Number goes |
| --- | --- | --- | --- |
| `modern` | Modern | Taller than wide, chevron vent slits, a ledge with two vent pockets, a bumper plate | Lower back |
| `modernSmooth` | Modern, smooth | The same, ledge and pockets only | Lower back |
| `plated` | Plated | Round dome, three pairs of vertical slots, a dark plate across the lower back | On the plate |
| `classic` | Classic | Round, two holes on the centreline, a ledge across the back, a dark bumper | On the bumper |
| `pod` | Pod | Smooth and tall, soft seams, dot vents low on each side, a dark trapezoid plate | On the plate |
| `podWide` | Pod, wide | The lineman's version: wider (×1.06) and squarer | On the plate |
| `ridgeback` | Ridgeback | Ours: the Modern shape with a raised spine instead of slits | Lower back |
| `retro` | Retro | Ours: the Classic shape with Modern's upper slits and a bumper plate | Lower back |

**Picking his shell** (`helmetModelOf`, from his id like `ownGear`), weighted by position so certain shells belong to
certain jobs: the wide pod up front, the older shapes for kickers. Starting weights (`HELMET_WEIGHTS`, an AFLS estimate,
tuned by eye on a league's rosters):

| Positions | Modern | Modern smooth | Plated | Classic | Pod | Pod wide | Ridgeback | Retro |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QB | 35 | 20 | 15 | – | 20 | – | 10 | – |
| RB, WR, CB, S | 25 | 15 | 15 | – | 20 | – | 15 | 10 |
| LB, EDGE, TE | 25 | 5 | 20 | 10 | 15 | 15 | 10 | – |
| OL, DT | 20 | 10 | 20 | 15 | – | 35 | – | – |
| K, P | 10 | 20 | – | 30 | 15 | – | – | 25 |

### Details on every shell

- **Chin-strap clips:** a small black clip with a white tip at two heights on each side, just past the shell's edge.
- **The facemask's lower corners:** from behind only the corners show, a bar dropping from under the shell and turning
  in toward the chin. Drawn before the neck, so the neck hides the rest. By position:

  | Positions | Mask |
  | --- | --- |
  | QB | One bar |
  | RB, WR, CB, S | One bar, slightly lighter |
  | LB, EDGE, TE | Two bars (a middle cage) |
  | OL, DT | Two bars and a connector (the full cage) |
  | K, P | One thin bar |

- **Dark shells** (contrast against black under 2.4) get a soft rim of light around the edge, a brighter gloss and a
  faint edge on their vents, so they hold their shape against dark jerseys and backdrops.
- **Finishes:** gloss, matte, or metallic (vertical banding) for the silver, gold and pewter shells.

### Each club's design

A `helmet` entry per club on `TeamSeed` (`data/teams.ts`), copied to `Team.helmet` when a league is built:

```ts
interface HelmetDesign {
  shell: string;            // #RRGGBB
  finish: 'gloss' | 'matte' | 'metal';
  stripe: 'none' | 'single' | 'double' | 'triple';
  stripeA?: string;         // the stripe; a triple's middle
  stripeB?: string;         // a triple's edges
  number?: { ink: string; trim: string };  // absent: no number on the back
  bumper: string;
  mask: string;             // the facemask's colour
}
```

A team without one (a mod's) falls back to a rule: its primary as a gloss shell, a single stripe in its secondary (or
light or dark when the secondary doesn't stand off the shell), no number, the secondary as bumper, a grey mask. Masks:
grey `#9AA3AD`, black `#1A1D22`, white `#F2F4F6`.

| Club | Shell | Finish | Stripe | Number | Bumper | Mask |
| --- | --- | --- | --- | --- | --- | --- |
| Buffalo | white | gloss | triple `#c60c30` / `#00338d` | `#00338d` on white | `#00338d` | grey |
| Miami | white | gloss | triple `#008e97` / `#fc4c02` | `#008e97` on white | `#008e97` | `#008e97` |
| New England | `#a9b2ba` | metal | triple `#002244` / `#c60c30` | `#002244` on white | `#002244` | grey |
| New York (Knights) | `#125740` | gloss | double white | white on `#0b3a2a` | white | white |
| Baltimore | `#241773` | gloss | triple `#c9a227` / white | white on `#241773` | `#c9a227` | black |
| Cincinnati | `#fb4f14` | gloss | triple black / white | black on white | black | black |
| Cleveland | `#ff3c00` | gloss | triple `#311d00` / white | none | `#311d00` | grey |
| Pittsburgh | `#101820` | gloss | single `#ffb612` | `#ffb612` on black | `#ffb612` | black |
| Houston | `#03202f` | gloss | triple `#a71930` / white | white on `#a71930` | `#a71930` | grey |
| Indianapolis | white | gloss | double `#002c5f` | `#002c5f` on white | `#002c5f` | grey |
| Jacksonville | `#006778` | gloss | triple `#d7a22a` / white | `#d7a22a` on `#003b45` | `#d7a22a` | black |
| Tennessee | `#0c2340` | gloss | triple `#4b92db` / white | white on `#4b92db` | `#4b92db` | grey |
| Denver | `#002244` | gloss | triple `#fb4f14` / white | `#fb4f14` on white | `#fb4f14` | black |
| Kansas City | `#e31837` | gloss | triple `#ffb81c` / white | white on `#7a0d1d` | `#f2f4f6` | white |
| Las Vegas | `#a9b2ba` | metal | single black | black on white | black | black |
| Los Angeles (Condors) | `#0080c6` | gloss | triple `#ffc20e` / white | `#ffc20e` on `#00476f` | `#ffc20e` | `#ffc20e` |
| Dallas | `#a9b2ba` | metal | triple `#003594` / white | `#003594` on white | `#003594` | `#003594` |
| New York (Empire) | `#0b2265` | gloss | triple `#a71930` / white | white on `#a71930` | `#a71930` | grey |
| Philadelphia | `#004c54` | gloss | triple `#c4ccd0` / white | `#e8ecee` on `#001f22` | `#c4ccd0` | black |
| Washington | `#5a1414` | gloss | triple `#ffb612` / white | `#ffb612` on `#2d0a0a` | `#ffb612` | `#ffb612` |
| Chicago | `#0b162a` | gloss | triple `#c83803` / white | white on `#c83803` | `#c83803` | grey |
| Detroit | `#b0b7bc` | metal | triple `#0076b6` / white | `#0076b6` on white | `#0076b6` | `#0076b6` |
| Green Bay | `#ffb612` | gloss | triple `#203731` / white | none | `#203731` | `#203731` |
| Minnesota | `#4f2683` | gloss | triple `#ffc62f` / white | `#ffc62f` on `#2a1146` | `#ffc62f` | black |
| Atlanta | `#141619` | gloss | triple `#a71930` / white | `#a71930` on white | `#a71930` | black |
| Carolina | `#a9b2ba` | metal | triple `#0085ca` / `#101820` | `#101820` on white | `#0085ca` | black |
| New Orleans | `#d3bc8d` | metal | triple `#101820` / white | `#101820` on white | `#101820` | black |
| Tampa Bay | `#6e6a63` | metal | triple `#d50a0a` / white | `#d50a0a` on white | `#d50a0a` | `#34302b` |
| Arizona | white | gloss | triple `#97233f` / black | `#97233f` on white | `#97233f` | black |
| Los Angeles (Stars) | `#003594` | gloss | triple `#ffd100` / white | `#ffd100` on `#001a4d` | `#ffd100` | `#ffd100` |
| San Francisco | `#b3995d` | metal | triple `#aa0000` / white | `#aa0000` on white | `#aa0000` | `#aa0000` |
| Seattle | `#002244` | gloss | triple `#69be28` / `#a5acaf` | white on `#69be28` | `#69be28` | grey |

("White" shells are `#F2F4F6`. "A on B" is the number's ink and its outline.) That ink is for a number on the shell;
on a shell whose number sits on a dark plate or bumper (Plated, Classic, Pod), it's white, outlined in the stripe
colour.

## Decals

### Flags

- **The US flag on every helmet**, as on every NFL helmet, on the lower back left of the number (above the plate on the
  plated and pod shells). 3.4 × 2.25 units, drawn simply (five stripes and the canton).
- **A second flag for Pathway players**, stacked under the US flag, all season (the NFL shows it for a couple of
  weeks; here it's the only place a Pathway player's country shows on the field). In the NFL's Heritage Program a player may add the
  flag of a country he, a parent or a grandparent was born in, or he lived in for two years
  ([NFL Football Operations](https://operations.nfl.com/updates/the-players/the-nfl-celebrates-international-diversity-with-nfl-heritage-program),
  [CBS](https://www.cbssports.com/nfl/news/kyler-murray-tua-tagovailoa-among-nfl-players-who-will-wear-international-flags-starting-in-week-4)).
  The game knows a player's country only through `Player.origin` of kind `pathway`, so those players get it. A CFL
  arrival does not: that's the league he came through, not where he's from. College players get the US flag only.
- **The 15 Pathway countries**, each drawn to read at a few pixels (`FLAGS`, keyed by the origin's name): Germany,
  United Kingdom, Australia, Nigeria, Mexico, France, Austria, Italy, Brazil, Japan, Ghana, New Zealand, Canada, Ireland,
  Sweden. A test fails if a Pathway origin has no flag.

### The green dot

The helmet with the coach's radio, one per side: the club's **starting quarterback** (`starters(league, team, 'QB')[0]`)
and the **defence's play-caller**, the first linebacker starter (the MLB or MIKE spot in every scheme), or the first
safety when a club has no linebacker starter. It follows the depth chart, so it moves when a starter changes. Depth
charts are public, so it reveals nothing hidden. A green disc with a thin dark edge, low in the middle of the shell: above
the number where the number is on the shell, just above the plate where a plate fills the bottom (`DECALS` gives each
shell's spot).

## The quarterback's gear

### Padded sleeves

Two new `SleeveLength` values, drawn on the arm as a cylinder so a pad turned toward the outside squeezes there:

- `padded`: a full sleeve with a honeycomb pad over the point of the elbow, turned 62° toward the outside of the arm
  (the right arm's outside is its right edge, the left arm's its left: the pad mirrors).
- `paddedElbow`: a short padded sleeve from mid upper arm to mid forearm, the same pad.

The pad is a shade of the sleeve: black → `#3a4048`, white → `#c9d0d7`, a team colour → 30% darker; every arm the sleeve
covers gets one. Quarterbacks only by default (anyone through the editor), in the same four colours as today's sleeves.
Mostly on one arm, the left as likely as the right; both arms for about one in six (`PADDED_BOTH = 0.15`).

**Rates: the normal mix.** A quarterback's chance of a sleeve stays today's (40%, `GEAR_RATES.QB.sleeve`); the padded
kinds join his sleeve lengths as two more options, weights `padded` 40 and `paddedElbow` 20 beside today's (full 35,
half 25, three-quarter 25, forearm 15, shooter 45). About three in ten of his sleeves come out padded, about one
quarterback in eight. The padded sleeve is a flavour option, not cold-weather gear: in a cold game a quarterback
dresses like everyone else (today's rule in `gearOf`: plain full sleeves on both arms, in the colour he'd pick anyway),
so the padded sleeve comes off with whatever sleeve he wore.

### The play-call wristband

A new `Gear.wristband?: { side: 'left' | 'right'; color: GearColor }`, always on one wrist: mostly the non-throwing
one (the left), the right for one in four for flavour (`WRISTBAND_RIGHT = 0.25`). 60% of quarterbacks wear one
(`WRISTBAND_QB = 0.6`, between the 55 and 60% asked for); colours white 40, black 30, team colour 15, second colour 15.
On the right wrist it's drawn the same way, mirrored.
A solid band from 92 to 104.6 on the arm (a little above the wrist, so more of it stays inside the ring), the play card
behind a clear window turned 75° toward the outside of the wrist, where he flips it up to read. At 128px it shows as a
light strip on the outside of his wrist; it stays on in cold games. No other position wears one by default.

## The gear editor

On the player card's pencil (`GearEditor` in `PlayerCard.tsx`):

- **Helmet** (new, first row): the eight shells by name. Stored as `Gear.helmet?: HelmetModel`; absent means the game's
  pick.
- **Sleeve** gains "Padded" and "Padded elbow", with the usual Arm list (both arms, left, right).
- **Wristband** (new): None, Left wrist, Right wrist, and a colour.
- "Back to his own" drops every pick, helmet included. Anything goes whatever his position, as today.

## Data, saves and code

- **Saves:** `SAVE_VERSION` 74 → 75. `Gear` gains `helmet` and `wristband`, `SleeveLength` two values (all optional or
  additive, nothing to rewrite). `Team.helmet` is filled from the seeds by `abbrev` for the 32 default clubs; any other
  team keeps none and uses the fallback rule.
- **New `src/ui/helmet.ts`:** the shells' data (`MODELS`), the fit numbers, `wearsHelmet`, `helmetModelOf` and
  `HELMET_WEIGHTS`, `maskOf` by position, `helmetDesignOf(team)` (the club's design or the fallback), and the decal
  rules (`flagsOf(player)`, `greenDotOf`).
- **New `src/ui/helmetArt.tsx`:** the drawing, as `gearArt.tsx` draws gear: `HelmetLayer` (shell, stripes, details,
  plate or bumper, number, decals) and `MaskLayer` (drawn before the neck). `src/ui/flags.tsx` for the flags.
- **`playerGear.ts` and `gearArt.tsx`:** the padded sleeves and the wristband and their rates (the cold-game rule is
  unchanged: plain full sleeves, the wristband kept).
- **`PlayerAvatar` (`components.tsx`):** the mask before the neck, the helmet in place of the ears and head. A roster
  mod's `player.portrait` still replaces the whole drawing; staff avatars are untouched.
- **Detail by size:** the shell, stripes and bumper at every size (the helmet becomes a team-coloured cap in lists);
  vents, clips, mask corners and the number from 32px, as with gear; flags and the green dot from 56px.
- **Nothing in `src/engine/` changes** except the types, the seeds and the save step. Nothing reads ratings.

## Tests

- `helmet.test.ts`: every default club has a design; its stripes, number and bumper stand off the shell (contrast
  floors); every Pathway origin has a flag and CFL and college origins get the US flag only; one green dot per side per
  club, on the starting QB and the first LB (or S); the mask by position; each position group's picks stay in its
  weights over a large sample (no wide pod outside the trenches and the middle, none for kickers); a picked
  `Gear.helmet` wins.
- `playerGear.test.ts`: padded sleeves only on quarterbacks by default, on one arm for about 85% (left and right about
  even) and both arms for the rest; quarterbacks'
  sleeve rate unchanged (40%) and about three in ten of their sleeves padded; the wristband on 60% of quarterbacks, one
  wrist, the left for about three in four and the right for the rest; in a cold game the padded sleeve gives way
  to plain full sleeves on both arms and the wristband stays on.
- `avatar.test.tsx`: the helmet renders at every size with no `NaN` in its paths; decals absent under 56px; free agents,
  prospects and retired players keep the bare head.
- `ui.test.ts`: the screen contract still holds (nothing new reads `player.ratings`).

## Docs and version

- `docs/AVATARS.md`: the head becomes the helmet (section 2), a new helmet section with the shells, fit, details,
  designs and decals, the padded sleeves and wristband in 2b, the detail-by-size table, tunables, and "Not yet"
  (alternates, hair, a SpeedFlex-style shell).
- No MVP item: a PATCH bump with a changelog entry in a player's words.

## Later

- **Alternate helmets and jerseys** (their own pass, with throwbacks): one alternate per club, worn in its primetime
  games (Thursday, Sunday and Monday nights), fixed when the schedule is made so a flex in or out doesn't change it, with
  the home and away rule as today. Mocked for six clubs in version 8 of the mockups.
- Hair under the helmet (locs, braids, the flow, a ponytail, curls; mocked in rounds 1–2, dropped for now).
- Wristbands for defensive play-callers; a SpeedFlex-style shell once a rear reference turns up.

## Settled in review

1. **The second flag shows all season**, not only in the Heritage weeks.
2. **No club, no helmet:** free agents, draft prospects until they're drafted, and retired players keep the bare head.
3. **Rates:** helmet models weighted by position; the padded sleeves are options inside a quarterback's normal sleeve
   mix (no boost), mostly on one arm (either, as likely) and sometimes both; the wristband on 60% of quarterbacks, one
   wrist, the left for most and the right for one in four.
