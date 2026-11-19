# Pixelwright test (phase 0 of pixel faces), 2026-11-19

What drawing the face kit by hand in Pixelwright showed, after the Mixels and SpriteCook tests
(`2026-11-18-mixels-test.md`, `2026-11-18-spritecook-test.md`). The studio project is "AFLS player faces". The sprites
are "Base faces" (the five bases, a layer per hair style, the helmet, the facemask) and "Heritage looks" (ten looks).
The parts and the scripts that render them are in `art/pixel-faces/pixelwright/`. `python3 pixelwright/tools/sheets.py`,
run from `art/pixel-faces`, rebuilds the three sheets.

## Pixelwright

- **A pixel-art studio Claude draws in while the owner watches**, through MCP tools: palettes with named ramps, layers,
  frames, text-row pixel writes, shapes, copy across frames, recolor by ramp, an audit for orphan pixels and jaggies.
  No credits. Pro is free during early access, and every export is included.
- **Every pixel is a named palette slot** (`skin.3`, `hair.1`, `shell.2`). Code recolors a part by swapping ramps, so
  SpriteCook's noisy near-duplicate colors can't happen and nothing has to be merged.
- **Rough edges:** long base64 imports fail in transit (a strip of faces failed, so it was written as pixel rows
  instead). The connection dropped several times in a session, and an export returned nothing. Keep the parts in the
  repo, not only in the studio.

## One palette for the five bases (worked)

`tools/palettize.py` maps each snapped Mixels face onto one set of ramps:
- skin in six steps, the face's own base lined up on step 4
- the tee in four
- the eye white and its shade, and one iris color
- brows on the hair ramp, so brows follow the hair color

The faces look as they did. Two ear pixels on face-0 were first read as iris and are fixed.

## Helmet (worked, one size fits all five)

Test a's helmet, mapped onto `shell` and `mask` ramps and split into a Helmet layer and a Facemask layer. The shell is
re-lit from the upper right, like the faces (SpriteCook lit it from the left).

**One helmet fits all five faces, face-3 included.** It is lined up on the midpoint between the two eyes' centers.
The SpriteCook notes said face-3 needed a second size, but that came from lining the faces up by the average of every
eye-white cell. Face-3's far eye shows only two cells, so the average dragged the helmet two pixels the wrong way.
Offsets are in `sheets.py` (`HELMET_AT`).

## Hair (nine styles, a first pass)

Buzz, crew, side part, curly top, high-top fade, afro, cornrows, locs and long flow are drawn on face-0, one layer
each, in the hair ramp:
- Faded sides use the skin a step darker, with a few hair dots.
- Long styles turn the skull's outline under the hair into hair.
- Locs and long hair fall behind the ear and neck.

It is a first pass: the textures are hand-set tiles, and the afro and long flow could use another round by hand. The
styles are drawn for face-0 only. Moving them onto the other faces is the next step (they shift by the eyes like the
helmet, then get touch-ups where the skulls differ).

## Heritage looks (worked)

Nine skin tones and six hair colors as ramps, plus five eye colors. A look is a ramp swap on the face and on the hair
(`tools/looks.py`, the palette in the studio). The dark line work on light skin no longer reads heavy:
- Each tone keeps the drawn ramp's shape.
- Shadows stay warm.
- Creases soften on light tones.

Ten looks from the game's heritage pools are on `heritage-looks.png`.

## What it changes

- **Gear and hair are drawn once, by hand, as layers on one palette.** A player is a base face, a hair layer (or
  helmet and facemask) and his tone, eye and hair ramps. Code stacks the layers and swaps ramps, with no color
  matching.
- **No second helmet size is needed** for the five bases. Line faces up by the midpoint between the eyes.
- **Still open:**
  - The bases are all one kind of face. Real variety between heritages needs new bases with different features
    (nose, lips, eyes, jaw), which a recolor can't give.
  - The bases are still free Mixels exports, so shipped art needs them redrawn or remade on a paid plan.
  - Facemask styles (one bar, the lineman's cage) and facial hair are not drawn yet.
