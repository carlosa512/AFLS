# Mixels test (phase 0 of pixel faces), 2026-11-18

What the owner's first Mixels generations showed, and what it changes in `2026-11-18-pixel-faces-design.md`.

## Mixels

- **Smallest size is 64×64** (the generator offers 64×64 and 128×128 only). The face grid is 64, not 32. The card
  draws at 128 (2×). Phones draw the card at 96, which is 1.5×, so the phone card moves to 64 or 128.
- **Reference copies, it doesn't edit.** "Same character… add a hairstyle" regenerated the same bald person (new shirt
  color) and ignored the hair. Two tokens were spent learning this. It did hold the exact framing and head.
- **The free plan has 3 tokens, no refresh.** Free exports are watermarked (a tiled logo) and generations are public.
  Shipped art needs a paid plan.
- **Quality at 64×64 is good:** clean outline, readable eyes, nose and mouth, the retro look the owner wants. The
  bald bases are three-quarter views facing right (one of five came out facing left: mirror it).

## Code-drawn hair and beards over the Mixels face (worked)

A throwaway script took the bald base, shrank the upscaled 1024px export back to its 64×64 grid (the most common
color per cell, then near colors merged), set aside the watermark-tinted cells for the test, and:

- **Recolored** skin (each source shade scaled per channel against the base skin, so shadows keep their warmth), the
  jersey (scaled by brightness, so white and black jerseys work) and, for light hair, the brows.
- **Drew hairstyles** from the head's own geometry (a hairline by column, ellipses for volume, a fresh outline where
  hair leaves the old silhouette): bald, buzz (hair shadow blended into the skin), short, high-top fade (shaved sides
  blended), afro (with texture), straight crop with fringe, and long hair behind the ear (reads as locs on dark hair,
  as long straight hair on light).
- **Drew facial hair:** stubble (a blend), mustache, goatee, full beard.
- **Mirrored** some players.

Twelve mixed players from the one base looked like twelve different people. The owner's verdict: "not too shabby".

## What it changes

- **Approach 1 (parts kit) becomes:** Mixels makes **bald faces only**. Hair and facial hair are drawn in code as
  parts that follow each face's head outline, recolored like the rest. The converter needs no part-cutting step.
- Every new face needs its head geometry (hairline, jaw, beard region, ear) either read automatically from its outline
  and features or tuned by hand, before the hair parts fit it.
- Skin recoloring keeps all of a face's shades (six on the first face) instead of three brightness slots.
- Helmets and shoulder pads were planned in code too. A tool that can edit an existing image (SpriteCook) might do
  them instead: that's the next test.
