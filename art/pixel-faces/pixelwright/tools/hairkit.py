"""Hair drawn as clumps and locks, the way pixel portraits do it (the owner's references: big curls, a wavy mane,
long straight hair with a part, short swept-back hair). A curl is a disc lit on its upper-right edge with a dark
crescent where it tucks under the next; a lock is a tapered strand lit on the side facing the light, dark on the
other, ending in a point. Clumps and locks are placed by hand per style; this only shades them.

Light comes from the upper right, as on the faces. Tokens: hair.0 (darkest) .. hair.3 (lit), outline."""
import math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools'))
import kit

F = kit.face(0)
FACE = {xy for xy, t in F.items() if t != 'outline'}
LX, LY = 0.6, -0.8  # toward the light

def curls(clumps):
    """clumps: (cx, cy, r) back to front. Each later clump covers earlier ones. Clumps at the back and underneath
    sit a step darker and keep no highlight, so the mass is lit as one form."""
    out, depth = {}, {}
    xs = [c[0] for c in clumps]; ys = [c[1] for c in clumps]
    bx0, bx1, by0, by1 = min(xs), max(xs), min(ys), max(ys)
    for i, (cx, cy, r) in enumerate(clumps):
        g = 0.55 * (cx - bx0) / max(1, bx1 - bx0) + 0.45 * (1 - (cy - by0) / max(1, by1 - by0))
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            for x in range(int(cx - r - 1), int(cx + r + 2)):
                dx, dy = x - cx, y - cy
                d = math.hypot(dx, dy) / r
                if d > 1.0:
                    continue
                lit = (dx * LX + dy * LY) / r  # -1 (shadow side) .. 1 (lit side)
                if d > 0.78 and lit < 0.1:
                    t = 0  # the crevice where the curl tucks under
                elif lit > 0.45 and d > 0.35:
                    t = 3
                elif lit > -0.15:
                    t = 2
                else:
                    t = 1
                if g < 0.3 and t > 0:
                    t -= 1
                elif g < 0.55 and t == 3:
                    t = 2
                out[(x, y)] = t
                depth[(x, y)] = i
    return out

def lock(points, width, out, lit_side=None):
    """A strand along points (x, y), `width` at the root tapering to a 1-px tip; lit on the side facing the light."""
    n = len(points)
    for k in range(n - 1):
        (x0, y0), (x1, y1) = points[k], points[k + 1]
        steps = max(abs(x1 - x0), abs(y1 - y0)) * 3 + 1
        for s in range(int(steps) + 1):
            u = s / steps
            x, y = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
            prog = (k + u) / (n - 1)
            w = max(1.0, width * (1 - prog ** 1.6))
            tx, ty = x1 - x0, y1 - y0
            ln = math.hypot(tx, ty) or 1
            nx, ny = -ty / ln, tx / ln  # normal
            if nx * LX + ny * LY < 0:
                nx, ny = -nx, -ny  # normal points toward the light
            half = w / 2
            for j in range(-int(half * 2) - 1, int(half * 2) + 2):
                off = j / 2
                if abs(off) > half:
                    continue
                px, py = round(x + nx * off), round(y + ny * off)
                side = off / max(half, 0.5)  # -1 dark side .. 1 lit side
                t = 3 if side > 0.55 and w > 1.5 else 2 if side > -0.1 else 1 if side > -0.7 else 0
                if prog > 0.85:
                    t = min(t, 1)
                cur = out.get((px, py))
                out[(px, py)] = t if cur is None else max(cur, t) if abs(off) < half - 0.5 else t
    return out

def finish(cells, drop_face=True, keep=None):
    """Tokens plus an outline around the hair where it meets nothing or the face's own outline."""
    g = {}
    for xy, t in cells.items():
        if drop_face and xy in FACE and not (keep and keep(xy)):
            continue
        g[xy] = 'hair.%d' % t
    for (x, y) in list(g):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in g and (n not in F or F[n] == 'outline'):
                g[n] = 'outline'
    # a face outline cell inside the hair is hair, not a line through it
    for xy in list(g):
        if g[xy] == 'outline' and xy in F and all((xy[0] + a, xy[1] + b) in g and g[(xy[0] + a, xy[1] + b)] != 'outline'
                                                 for a, b in ((0, -1), (-1, 0))):
            g[xy] = 'hair.0'
    return g

def mass(poly):
    """The cells inside a hand-drawn silhouette (points in order, around the hair)."""
    from PIL import Image, ImageDraw
    im = Image.new('1', (64, 64), 0)
    ImageDraw.Draw(im).polygon([(x, y) for x, y in poly], fill=1, outline=1)
    p = im.load()
    return {(x, y) for y in range(64) for x in range(64) if p[x, y]}

def shade_mass(cells, sheen=None, dark_back=0.12, lit_front=0.58):
    """Base light over the whole mass: the back and underside in shadow, the top-front lit. sheen(x, y) -> True marks
    the band where the crown catches the light."""
    xs = [x for x, _ in cells]; ys = [y for _, y in cells]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    out = {}
    for (x, y) in cells:
        u = (x - x0) / max(1, x1 - x0); v = 1 - (y - y0) / max(1, y1 - y0)
        l = 0.5 * u + 0.5 * v
        t = 2 if l > lit_front else 1 if l > dark_back else 0
        if sheen and sheen(x, y) and t >= 1 and u > 0.3 and (x + 2 * y) % 4 != 0:
            t = 3 if t == 2 else 2
        out[(x, y)] = t
    return out

def strands(out, lines, lit_edge=True, lit_until=0.65):
    """Dark parting lines between clumps, each with a lit edge on its light side for the first part of its length."""
    for pts in lines:
        cells = []
        for k in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[k], pts[k + 1]
            n = max(abs(x1 - x0), abs(y1 - y0))
            for s in range(n + 1):
                cells.append((round(x0 + (x1 - x0) * s / n), round(y0 + (y1 - y0) * s / n)))
        seen = []
        for c in cells:
            if c not in seen:
                seen.append(c)
        for i, (x, y) in enumerate(seen):
            if (x, y) not in out:
                continue
            out[(x, y)] = 0
            prog = i / max(1, len(seen) - 1)
            if lit_edge and prog < lit_until:
                for dx, dy in ((1, 0), (0, -1)):
                    n = (x + dx, y + dy)
                    if n in out and out[n] != 0 and n not in seen:
                        out[n] = 3 if prog < 0.35 else max(out[n], 2)
                        n2 = (n[0] + dx, n[1] + dy)
                        if prog < 0.35 and n2 in out and out[n2] != 0 and n2 not in seen:
                            out[n2] = max(out[n2], 2)
                        break
    return out

def chain(path, r0, r1, step=1.6):
    """A lock as a chain of curl clumps along a path, from r0 at the root to r1 at the tip: wavy or tufted hair with
    the same lit-clump texture as the curls."""
    pts = []
    for k in range(len(path) - 1):
        (x0, y0), (x1, y1) = path[k], path[k + 1]
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        for s in range(n):
            pts.append((x0 + (x1 - x0) * s / n, y0 + (y1 - y0) * s / n))
    pts.append(path[-1])
    out = []
    for i, (x, y) in enumerate(pts):
        u = i / max(1, len(pts) - 1)
        out.append((x, y, r0 + (r1 - r0) * u))
    return out
