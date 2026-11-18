"""Hair styles for face-0 from hand-set shapes: rows of (left, right) per y, a texture per kind, light from the upper right."""
import sys, os
sys.path.insert(0, 'tools'); sys.path.insert(0, os.path.dirname(__file__))
import kit

F = kit.face(0)
SKIN = {xy for xy, t in F.items() if t != 'outline'}

def front_line(x):
    """The hairline: forehead top, the temple, a sideburn, over the ear, behind it."""
    if x >= 31: return 17
    if x >= 28: return 17 + (31 - x)
    if x >= 25: return 25
    if x >= 20: return 22
    return 30

def scalp():
    return {xy for xy in SKIN if xy[1] < front_line(xy[0]) and F[xy].startswith('skin')}

def shape(rows):
    """{y: (x0, x1)} or {y: [(x0, x1), ...]} -> cells, minus the visible face below the hairline."""
    out = set()
    for y, spans in rows.items():
        if isinstance(spans, tuple):
            spans = [spans]
        for x0, x1 in spans:
            for x in range(x0, x1 + 1):
                out.add((x, y))
    return {xy for xy in out if not (xy in SKIN and xy[1] >= front_line(xy[0]))}

# textures: small irregular tiles, -1 darker, +1 lighter
COIL = ["0+0-0+", "+0-0+0", "0-0+00", "-0+0-+", "0+00-0"]
STRAIGHT = ["00+000+0", "0+000+00", "+000+000", "000+000+"]
VERT = ["0+0-", "0+0-", "+0-0", "+0-0"]
def tex(tile, x, y):
    r = tile[y % len(tile)]
    c = r[x % len(r)]
    return {'+': 1, '-': -1, '0': 0}[c]

def lit(cells, tile, bright=0.0, dark=0.0):
    xs = [x for x, _ in cells]; ys = [y for _, y in cells]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    out = {}
    for (x, y) in cells:
        u = (x - x0) / max(1, x1 - x0); v = 1 - (y - y0) / max(1, y1 - y0)
        l = 0.6 * u + 0.4 * v + bright
        base = 2 if l > 0.78 else 1 if l > 0.36 + dark else 0
        s = base + tex(tile, x, y)
        if base == 2 and tex(tile, x + 1, y + 1) == 1 and (x * 7 + y * 3) % 5 == 0:
            s = 3
        out[(x, y)] = 'hair.%d' % max(0, min(3, s))
    return out

def outline(cells):
    out = {}
    for (x, y) in cells:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in cells and (n not in F or F[n] == 'outline'):
                out[n] = 'outline'
    return out

def stubble(cells, out, tone='hair.1', every=2):
    """A fade: the skin a step darker where the hair is cut close, with a few dots of hair, never a checkerboard."""
    for (x, y) in cells:
        h = (x * 7 + y * 13) % 11
        if h in (0, 4, 7):
            out[(x, y)] = tone
        elif h in (2, 9) or y < front_line(x) - 3:
            out[(x, y)] = 'skin.2' if F[(x, y)] in ('skin.3', 'skin.4', 'skin.5') else 'skin.1'
    return out

def finish(out):
    hair = set(out)
    for xy, t in F.items():
        if t == 'outline' and xy[1] < front_line(xy[0]) - 1 and xy not in out:
            x, y = xy
            outside = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, -1)) if (x + dx, y + dy) not in F]
            if outside and all(n in hair for n in outside):
                out[xy] = 'hair.1'
    out.update(outline(set(out)))
    return out

S = {}
def style(f):
    S[f.__name__] = f; return f

@style
def buzz():
    c = scalp()
    out = {}
    for (x, y) in c:
        edge = y >= front_line(x) - 1
        if edge and (x + y) % 2:
            continue
        t = 1 if x < 34 or y > 13 else 2
        if (x * 3 + y * 2) % 5 == 0:
            t -= 1
        out[(x, y)] = 'hair.%d' % t
    return out

@style
def crew():
    """Short straight hair, a little lift at the front."""
    rows = {8: (29, 39), 9: (26, 42)}
    c = shape(rows) | scalp()
    c |= {(x, 8) for x in range(40, 43)} | {(43, 9), (44, 10), (45, 11), (45, 12)}
    out = lit(c, STRAIGHT)
    for (x, y) in list(out):
        if y >= front_line(x) - 1 and x < 31 and (x + y) % 2:
            del out[(x, y)]
    return finish(out)

@style
def side_part():
    rows = {6: (30, 38), 7: (27, 41), 8: (25, 43), 9: (24, 44), 10: (23, 45), 11: (23, 46), 12: (22, 46),
            13: (21, 46), 14: (21, 46), 15: (20, 46), 16: (20, 46), 17: (36, 46), 18: (40, 46), 19: (43, 46)}
    c = shape(rows) | scalp()
    out = lit(c, STRAIGHT, bright=0.05)
    for y in range(6, 12):
        out[(29, y)] = 'hair.0'
        if (30, y) in out: out[(30, y)] = 'hair.2' if y < 10 else out[(30, y)]
    for (x, y) in [(41, 18), (42, 18), (44, 19), (45, 19), (43, 18)]:
        out[(x, y)] = 'hair.1'
    return finish(out)

@style
def curly_top():
    rows = {3: (29, 37), 4: (26, 40), 5: (24, 42), 6: (23, 44), 7: (22, 45), 8: (22, 46), 9: (22, 46), 10: (23, 46),
            11: (24, 46), 12: (25, 46), 13: (27, 46), 14: (29, 46), 15: (30, 46), 16: (31, 46)}
    top = shape(rows)
    top = {xy for xy in top if not (xy in SKIN and xy[0] < 29 and xy[1] > 11)}
    out = lit(top, COIL, bright=0.05)
    # bumps on the outline of the top, so it reads as curls, not a lid
    for (x, y) in [(28, 3), (38, 3), (25, 4), (41, 4), (22, 6), (45, 6), (21, 8), (47, 9)]:
        out[(x, y)] = 'hair.1'
    sides = {xy for xy in scalp() if xy not in out}
    return finish(stubble(sides, out))

@style
def high_top():
    rows = {0: (28, 40)}
    rows.update({y: (26, 42) for y in range(1, 13)})
    rows.update({13: (27, 42), 14: (28, 42), 15: (29, 43), 16: (30, 44)})
    top = shape(rows)
    out = lit(top, COIL, bright=0.0)
    for y in range(1, 13):
        out[(26, y)] = 'hair.0' if (26, y) in out else None
        out[(42, y)] = 'hair.2' if y < 9 else 'hair.1'
    out = {k: v for k, v in out.items() if v}
    for x in range(28, 41):
        out[(x, 0)] = 'hair.2' if x > 33 else 'hair.1'
    sides = {xy for xy in scalp() if xy not in out}
    return finish(stubble(sides, out))

@style
def afro():
    rows = {0: (29, 36), 1: (25, 40), 2: (22, 43), 3: (20, 45), 4: (19, 46), 5: (18, 47), 6: (17, 48),
            7: (16, 48), 8: (16, 49), 9: (15, 49), 10: (15, 49), 11: (15, 49), 12: (15, 48), 13: (15, 48),
            14: (15, 47), 15: (16, 47), 16: (16, 46), 17: (16, 30), 18: (16, 28), 19: (16, 27), 20: (17, 26),
            21: (17, 26), 22: (17, 25), 23: (17, 19), 24: (18, 19)}
    c = shape(rows)
    c = {xy for xy in c if not (xy in SKIN and xy[1] >= front_line(xy[0]))}
    out = lit(c, COIL, bright=-0.02)
    # a ragged rim: a few cells off the round edge
    for xy in [(28, 0), (37, 0), (24, 1), (41, 1), (19, 3), (46, 3), (50, 10), (14, 10), (14, 13), (48, 15)]:
        out[xy] = 'hair.1'
    for xy in [(29, 0), (36, 0), (15, 9), (49, 9), (16, 7)]:
        out.pop(xy, None)
    return finish(out)

@style
def braids():
    """Cornrows: tight rows from the hairline back over the skull, skin showing between them."""
    c = scalp()
    out = {}
    for (x, y) in c:
        # rows run back and down: lines of constant (x + 2y) bands
        band = (x + 2 * y) % 5
        if band in (0, 1, 2):
            t = 2 if band == 1 and (x > 30 and y < 15) else 1 if band != 0 else 0
            if (y % 2 == 0) and band == 1:
                t = min(3, t + 1)
            out[(x, y)] = 'hair.%d' % t
    return out

@style
def locs():
    crown = shape({8: (28, 40)}) | scalp()
    out = lit(crown, COIL)
    ropes = {}
    starts = [(24, 12), (22, 14), (20, 16), (18, 18), (16, 20), (14, 22), (25, 10)]
    for i, (x0, y0) in enumerate(starts):
        length = 26 + (i % 3) * 4 - i
        for j in range(length):
            y = y0 + j
            x = x0 - j // 7 + (1 if (j // 3 + i) % 2 else 0)
            for w in (0, 1):
                xy = (x + w, y)
                if xy in SKIN and y < front_line(xy[0]):
                    continue
                if xy in SKIN and y >= front_line(xy[0]):
                    continue
                seg = (j + i) % 3
                ropes[xy] = 'hair.%d' % (2 if w == 1 and seg == 0 else 1 if seg != 2 else 0)
    out.update(ropes)
    return finish(out)

@style
def flow():
    rows = {6: (30, 38), 7: (26, 42), 8: (24, 44), 9: (23, 45), 10: (22, 45), 11: (21, 46), 12: (20, 46), 13: (19, 46),
            14: (18, 46), 15: (17, 46), 16: (17, 46)}
    for y in range(17, 41):
        x0 = 17 - (y - 17) // 8
        x1 = 20 if y < 31 else min(24, 20 + (y - 31) // 3)
        if y > 37:
            x0 -= (y - 37)
        rows[y] = (x0, x1)
    c = shape(rows)
    c = {xy for xy in c if not (xy in SKIN and xy[1] >= front_line(xy[0]))}
    out = lit(c, STRAIGHT, bright=0.06)
    for (x, y) in list(out):
        if y > 17:
            out[(x, y)] = 'hair.%d' % (0 if x % 3 == 0 else 2 if (x % 3 == 1 and y < 30) else 1)
    return finish(out)

if __name__ == '__main__':
    from PIL import Image, ImageDraw
    D = sys.argv[1]
    names = list(S)
    cols = 5
    sheet = Image.new('RGBA', (cols * 256, ((len(names) + cols - 1) // cols) * 256))
    for i, n in enumerate(names):
        g = S[n]()
        kit.save('hair-' + n, g)
        im = kit.render([F, g], 4)
        ImageDraw.Draw(im).text((4, 4), n, fill=(255, 255, 255))
        sheet.paste(im, ((i % cols) * 256, (i // cols) * 256))
    sheet.save(D + '/hair.png')
