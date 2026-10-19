# Player avatars

> **Status.** Built: `PlayerAvatar` in `src/ui/components.tsx` draws every player from behind in his
> team's jersey (pure SVG, no images, no new dependencies), with the colour rules and kit in
> `src/ui/color.ts`. Tested in `src/ui/avatar.test.tsx`. A roster mod's
> `player.portrait` still replaces the drawing.

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

## 5. Tunables

All in `src/ui/components.tsx` and `src/ui/color.ts`: `NUMBER_MIN_PX` (32), `NAMEPLATE_MIN_PX` (96),
`NAMEPLATE_MAX` (40 viewBox units), `PLATE_EM` (re-measure if the display font changes), and `MIN_CONTRAST`
(4.5).

## 6. Not yet

- Away (white) jerseys, alternate and throwback uniforms.
- Gear and builds by position (neck rolls, wider linemen). Several were drawn during design.
- Ring text ("QB · Dallas Stampede"): the card header already shows that line, and curved text is
  unreadable at these sizes. Dropped.
- Validating mod-supplied colours (arrives with league import).
