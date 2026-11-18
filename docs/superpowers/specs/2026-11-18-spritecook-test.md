# SpriteCook test (phase 0 of pixel faces), 2026-11-18

What SpriteCook showed when asked to change the Mixels faces, and what it changes in
`2026-11-18-pixel-faces-design.md` (not in this repo yet). Every result sits next to its source on
`.check/spritecook.html` (`python3 art/pixel-faces/tools/compare.py` rebuilds it). Files are in
`art/pixel-faces/`, SpriteCook's asset ids in `spritecook/spritecook-assets.json`.

## SpriteCook

- **The free plan has 40 credits every 30 days**, no rollover. Free generations go to a public gallery; uploads
  stay private. Commercial use is allowed on Free and results carry no watermark. Starter is $12 a month for 1,000
  credits.
- **A generation costs 2 to 21 credits** at 1K: GPT-Image-2 at low quality 2, Nano Banana 2 Lite 8, Nano Banana 2.1
  (the default, used for every test) 12, GPT 2.5 8 plus 8 for each reference image. The three tests spent 36.
- **Edits work on Free** through the tools (`edit_asset_id`), though the pricing page lists "Edit with Agent" as
  paid only.
- **Output is true 64×64 pixel art** when asked for 64×64 with smart crop off (smart crop trims to the content and
  would break the framing): every pixel solid or clear. The colors are noisy: about 590 near-duplicates of 26 to 44
  real colors, so results need a merge step.
- **Uploads keep the native grid:** a 64×64 PNG uploaded as pixel art stays a 64×64 asset.

## Cleaning the Mixels exports

The free exports tile a logo over the art on a 250px lattice in two staggered rows: thin strokes, a clear inside, a
faint glow. `tools/snap.py --mixels` shrinks the 1024px export back to its 64×64 grid, leaves the strokes' pixels out
of each cell's vote and lets near colors vote as one (export noise splits a color into many). The five bases come
out clean with 15 to 23 colors. face-4 is mirrored to face right.

## Edits (worked)

- **a. Helmet on face-0.** A plain blue shell, a grey two-bar facemask. It kept him: of the 235 skin cells still
  visible, 19 changed, at the edge of the helmet where it casts shade. The neck, tee and shoulders line up (10 cells
  of outline differ, at the chin strap). One blue with a highlight, so code can recolor it per club.
- **b. Jersey over shoulder pads on face-0.** The head is untouched (1 of 625 cells changed). The pads rise to the
  jaw and hide most of the neck, as players look in pads; the jersey is the tee's orange.
- **a and b stack.** Test a's helmet (the cells it changed) laid over test b in code gives the helmet-on, pads-on
  look with no more credits, because both edits kept the frame.
- **One helmet fits most heads.** Moved onto the other four faces so the eyes line up (0 to 2 pixels), it fits
  faces 1, 2 and 4. It misses face-3, the widest head: his skull pokes out at the back (35 cells) and the shell's
  edge cuts his near eye.

## Edit with a style reference (failed)

- **c. The same helmet on face-3**, by edit with test a as the style reference: it redrew test a (174 cells differ
  from it), with face-0's face and tee. The reference wins over the image being edited, as Mixels' Reference copied
  its source. Edit with words only, and match the design in code.

## What it changes

- **Helmets and shoulder pads come from SpriteCook edits, not code.** They read as real gear at 64×64, which code
  shapes would struggle to match. Hair and facial hair stay in code (the claude.ai test already showed twelve
  people from one base).
- **A helmet is a part, like the hair:** generated once, then moved onto each face by its eyes and recolored per
  club. Wide heads need a second size, either a words-only edit of a wide face (12 credits) or the shell widened in
  code by repeating its middle columns. Stripes, the number and the other facemasks (one bar, the lineman's cage, the
  kicker's thin bar) are lines on the shell, drawn in code.
- **The converter gains two steps:** snap a Mixels export to its grid (watermark strokes left out), and merge
  SpriteCook's near colors before recoloring.
- **Never pass a style or context reference of the same subject with an edit.**
- **Shipped art needs paid plans on both tools:** the bases are free Mixels exports (watermarked). SpriteCook's
  Starter covers about 80 edits a month at this model.

## Not tried

- New bald faces from SpriteCook with the five as style references (dropped for the helmet test). Test c suggests a
  strong reference gets copied, so new faces may come back as one of the five.
- Test b's pads under the other faces' heads, in code: the bodies differ a little (neck width, shoulder line).
- Hair by edit: dropped, code hair works and fits every face.
