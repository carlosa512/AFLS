"""Snap an upscaled pixel-art export back to its native grid.

Each cell takes the most common opaque colour in its middle (edges blur in exports), cells mostly
transparent stay transparent (the watermark on the background is faint and drops out here), then
rare colours close to a common one merge into it (export noise).

Mixels' free exports tile a logo over the art. Its strokes are thin and its inside is clear, so
with --mixels the pixels under a stroke are left out of each cell's vote: the logo's shape is cut
from a copy on the empty background and repeated on its lattice (two staggered rows).

usage: python3 snap.py in.png out.png [--mixels]
"""
import sys
from collections import Counter
from PIL import Image

def vote(counts, near=20):
    """The cell's colour: export noise splits one colour into many near ones, so near colours
    vote together and the biggest group's most common colour wins."""
    groups = []  # [centre, weight]
    for c, n in counts.most_common():
        for g in groups:
            if sum((c[i] - g[0][i]) ** 2 for i in range(3)) <= near * near:
                g[1] += n
                break
        else:
            groups.append([c, n])
    return max(groups, key=lambda g: g[1])[0]

def mixels_mask(im):
    """Pixels under the Mixels watermark: the top-left logo's strokes (its faint glow left out) on its
    250px lattice."""
    W, H = im.size
    a = im.getchannel('A').load()
    shape = [(x - 35, y - 163) for y in range(163, 241) for x in range(35, 119) if a[x, y] >= 30]
    under = set()
    for oy, ox0 in ((163, 35), (413, 160)):
        for y0 in range(oy - 500, H, 500):
            for x0 in range(ox0 - 250, W, 250):
                for dx, dy in shape:
                    for ex in (-2, -1, 0, 1, 2):
                        for ey in (-2, -1, 0, 1, 2):
                            under.add((x0 + dx + ex, y0 + dy + ey))
    return under

def snap(src, cell=16, merge=18, alpha_cut=160, mixels=False):
    im = Image.open(src).convert('RGBA')
    W, H = im.size
    under = mixels_mask(im) if mixels else set()
    gw, gh = W // cell, H // cell
    px = im.load()
    inset = max(1, cell // 4)
    grid = [[None] * gw for _ in range(gh)]
    for gy in range(gh):
        for gx in range(gw):
            seen = Counter()
            clean = Counter()
            solid = 0
            total = 0
            for y in range(gy * cell + inset, (gy + 1) * cell - inset):
                for x in range(gx * cell + inset, (gx + 1) * cell - inset):
                    r, g, b, a = px[x, y]
                    total += 1
                    if a >= alpha_cut:
                        solid += 1
                        seen[(r, g, b)] += 1
                        if (x, y) not in under:
                            clean[(r, g, b)] += 1
            if solid * 2 > total:
                # the middle can be all stroke: then read the whole cell's clear pixels
                if sum(clean.values()) < 4:
                    for y in range(gy * cell, (gy + 1) * cell):
                        for x in range(gx * cell, (gx + 1) * cell):
                            r, g, b, a = px[x, y]
                            if a >= alpha_cut and (x, y) not in under:
                                clean[(r, g, b)] += 1
                grid[gy][gx] = vote(clean or seen)
    # merge rare colours into a common near one
    count = Counter(c for row in grid for c in row if c)
    order = [c for c, _ in count.most_common()]
    keep = []
    remap = {}
    for c in order:
        near = [k for k in keep if sum((c[i] - k[i]) ** 2 for i in range(3)) ** 0.5 <= merge]
        if near:
            remap[c] = min(near, key=lambda k: sum((c[i] - k[i]) ** 2 for i in range(3)))
        else:
            keep.append(c)
            remap[c] = c
    out = Image.new('RGBA', (gw, gh), (0, 0, 0, 0))
    for gy in range(gh):
        for gx in range(gw):
            c = grid[gy][gx]
            if c:
                out.putpixel((gx, gy), remap[c] + (255,))
    return out, len(count), len(keep)

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    out, before, after = snap(src, mixels='--mixels' in sys.argv)
    out.save(dst)
    print(f'{dst}: {out.size[0]}x{out.size[1]}, {before} colours -> {after}')
