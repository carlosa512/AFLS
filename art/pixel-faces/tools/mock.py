"""Mixed players from the five Mixels bases, drawn in code: skin, eyes, hair, build, height, club colours.

Each player is a base face (snapped, mixels/face-N.png) with:
  - skin, brows and eyes recoloured to his look (heritage picks the look's odds),
  - simple hair over the head's own geometry (bald, buzz, short, full) when the helmet is off,
  - test b's jersey and pads (the cells that edit changed), moved so the eyes line up, in his club's jersey colour,
  - test a's helmet (the cells that edit changed), moved the same way, recoloured to his club's shell, stripe and mask,
  - shoulders widened by his build (the game's five, by weight) and the figure raised or lowered by his height
    against his position (as the card does today).

face-3 is left out: test a's helmet doesn't fit his wide head (docs/superpowers/specs/2026-11-18-spritecook-test.md).

usage: python3 tools/mock.py [seed]   (from art/pixel-faces; writes ../../.check/pixel-faces-mock.html and mock/players.png)
"""
import base64, colorsys, html, io, math, os, random, re, sys
from collections import Counter
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
N = 64
BASES = [0, 1, 2, 4]

# ---------------------------------------------------------------- colours

def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

def lum(c):
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]

def clamp(v):
    return max(0, min(255, int(round(v))))

def sat(c):
    mx, mn = max(c[:3]), min(c[:3])
    return 0 if mx == 0 else (mx - mn) / mx

def mix(a, b, t):
    return tuple(clamp(a[i] + (b[i] - a[i]) * t) for i in range(3))

def shade_to(c, base, target, gloss=1.0):
    """Move a shade of `base` onto `target`, keeping how much lighter or darker it was. Darker shades scale the
    target's lightness down, lighter ones move it toward white, so white and black targets keep their shading."""
    lc, lb = lum(c) / 255, max(lum(base) / 255, 0.01)
    h, l, s = colorsys.rgb_to_hls(*(v / 255 for v in target))
    if lc <= lb:
        nl = l * (lc / lb)
        if l < 0.2:  # a black target still shows its folds
            nl = l - (lb - lc) * 0.35
    else:
        nl = l + (1 - l) * ((lc - lb) / (1 - lb)) * gloss
        if l > 0.85:
            nl = min(1.0, nl)
    nl = max(0.02, min(0.98, nl))
    r, g, b = colorsys.hls_to_rgb(h, nl, s)
    return (clamp(r * 255), clamp(g * 255), clamp(b * 255))

def skin_to(c, base, tone):
    """A skin shade onto a new tone: its lightness against the face's main skin, with darker shades kept warm."""
    k = lum(c) / max(lum(base), 1)
    return (clamp(tone[0] * k ** 0.88), clamp(tone[1] * k ** 1.0), clamp(tone[2] * k ** 1.15))

# ---------------------------------------------------------------- the look

SKIN = {  # the main skin shade of each tone
    'porcelain': (240, 204, 182), 'light': (228, 178, 145), 'light-medium': (210, 156, 116),
    'olive': (190, 140, 96), 'medium': (180, 122, 84), 'medium-brown': (152, 92, 56),
    'brown': (124, 74, 46), 'dark': (98, 58, 38), 'deep': (76, 45, 32),
}
EYES = {
    'dark brown': (52, 32, 24), 'brown': (92, 58, 34), 'hazel': (118, 92, 50), 'green': (78, 118, 74),
    'blue': (70, 112, 170), 'grey': (116, 126, 138),
}
HAIR = {
    'black': (30, 26, 28), 'dark brown': (62, 42, 32), 'brown': (104, 72, 46), 'light brown': (146, 108, 70),
    'blond': (214, 178, 112), 'red': (164, 84, 44),
}
# heritage -> odds (the game's eight heritage pools, data/heritage.ts); wide on purpose
LOOK = {
    'white': {
        'skin': {'porcelain': 3, 'light': 4, 'light-medium': 2, 'olive': 1},
        'eyes': {'blue': 3, 'green': 1.2, 'hazel': 1.5, 'grey': 0.5, 'brown': 2.5, 'dark brown': 1},
        'hair': {'blond': 2, 'light brown': 2.5, 'brown': 3, 'dark brown': 1.5, 'red': 0.7, 'black': 0.3},
        'style': {'bald': 1, 'buzz': 2.5, 'short': 5, 'full': 1.5}, 'curl': 0.1},
    'black': {
        'skin': {'light-medium': 0.5, 'medium': 1.5, 'medium-brown': 3, 'brown': 3, 'dark': 1.5, 'deep': 0.6},
        'eyes': {'dark brown': 6, 'brown': 3, 'hazel': 0.3},
        'hair': {'black': 9, 'dark brown': 1},
        'style': {'bald': 1.5, 'buzz': 3.5, 'short': 2, 'full': 3}, 'curl': 1},
    'hispanic': {
        'skin': {'light': 2, 'light-medium': 3.5, 'olive': 3, 'medium': 1.5},
        'eyes': {'dark brown': 4, 'brown': 4, 'hazel': 1.2, 'green': 0.4},
        'hair': {'black': 5, 'dark brown': 4, 'brown': 1},
        'style': {'bald': 0.5, 'buzz': 3, 'short': 5, 'full': 1.5}, 'curl': 0.3},
    'pacific': {
        'skin': {'medium': 3, 'olive': 2, 'medium-brown': 4, 'brown': 1},
        'eyes': {'dark brown': 7, 'brown': 3},
        'hair': {'black': 8.5, 'dark brown': 1.5},
        'style': {'bald': 1, 'buzz': 2, 'short': 3, 'full': 4}, 'curl': 0.7},
    'asian': {
        'skin': {'light': 4, 'light-medium': 4, 'olive': 2},
        'eyes': {'dark brown': 8, 'brown': 2},
        'hair': {'black': 9, 'dark brown': 1},
        'style': {'bald': 0.3, 'buzz': 2, 'short': 6, 'full': 1.5}, 'curl': 0},
    'native': {
        'skin': {'light-medium': 3, 'medium': 4, 'medium-brown': 3},
        'eyes': {'dark brown': 7, 'brown': 3},
        'hair': {'black': 8, 'dark brown': 2},
        'style': {'bald': 0.5, 'buzz': 2, 'short': 4, 'full': 3}, 'curl': 0},
    'african': {
        'skin': {'medium-brown': 2, 'brown': 3.5, 'dark': 3, 'deep': 1.5},
        'eyes': {'dark brown': 8, 'brown': 2},
        'hair': {'black': 9.5, 'dark brown': 0.5},
        'style': {'bald': 2, 'buzz': 4, 'short': 1.5, 'full': 2.5}, 'curl': 1},
    'international': {
        'skin': {'porcelain': 2, 'light': 4, 'light-medium': 3, 'medium': 1, 'brown': 1},
        'eyes': {'blue': 2.5, 'green': 1, 'hazel': 1.5, 'grey': 0.7, 'brown': 3, 'dark brown': 1.5},
        'hair': {'blond': 2, 'light brown': 2.5, 'brown': 3, 'dark brown': 2, 'red': 0.8, 'black': 0.7},
        'style': {'bald': 1, 'buzz': 2.5, 'short': 5, 'full': 1.5}, 'curl': 0.1},
}
HERITAGE_NAME = {'white': 'White', 'black': 'Black', 'hispanic': 'Hispanic', 'pacific': 'Pacific Islander',
                 'asian': 'Asian', 'native': 'Native American', 'african': 'African', 'international': 'International'}

# the game's tables, copied from src/engine/data/heritage.ts (PLAYER_MIX) and src/engine/size.ts (SIZE)
POOLS = ['white', 'black', 'hispanic', 'pacific', 'asian', 'native', 'african', 'international']
PLAYER_MIX = {
    'QB': (54, 37, 3, 2, 1, 1, 1, 1), 'RB': (15, 74, 3, 1, 0.3, 0.3, 4, 3), 'WR': (16, 70, 3, 1, 0.3, 0.3, 6, 4),
    'TE': (47, 39, 3, 3, 0.3, 1, 4, 3), 'OL': (38, 43, 3, 7, 0.3, 1, 5, 3), 'DT': (20, 56, 3, 8, 0.3, 0.5, 10, 3),
    'EDGE': (22, 60, 2, 3, 0.3, 0.3, 10, 3), 'LB': (26, 57, 4, 4, 0.3, 1, 6, 2), 'CB': (4, 86, 1, 1, 0.3, 0.3, 6, 2),
    'S': (14, 74, 2, 2, 0.3, 0.3, 5, 3), 'K': (80, 3, 5, 1, 3, 0.3, 0.3, 8), 'P': (68, 2, 2, 2, 1, 0.3, 0.3, 25),
}
SIZE = {  # height (in), weight (lb): mean, sd; r their correlation
    'QB': ((74.7, 1.8), (221, 10), 0.62), 'RB': ((71.0, 1.9), (217, 18), 0.65), 'WR': ((72.5, 2.4), (199, 15), 0.74),
    'TE': ((76.6, 1.3), (250, 10), 0.38), 'OL': ((76.9, 1.5), (314, 14), 0.31), 'DT': ((75.3, 1.5), (309, 18), 0.01),
    'EDGE': ((75.4, 1.6), (259, 22), 0.5), 'LB': ((73.5, 1.3), (234, 9), 0.1), 'CB': ((71.8, 1.6), (193, 9), 0.47),
    'S': ((72.1, 1.5), (204, 8), 0.44), 'K': ((72.0, 2.1), (195, 16), 0.53), 'P': ((74.2, 2.0), (211, 17), 0.48),
}
# a roster's share of each position (a 53 by the usual counts)
ROSTER = {'QB': 3, 'RB': 4, 'WR': 6, 'TE': 3, 'OL': 9, 'DT': 5, 'EDGE': 5, 'LB': 5, 'CB': 6, 'S': 4, 'K': 1, 'P': 1}
BUILDS = [('Lean', 205, -1), ('Athletic', 230, 0), ('Solid', 265, 1), ('Big', 295, 2), ('Heavy', 10 ** 9, 3)]

def pick(rng, odds):
    keys = list(odds)
    return rng.choices(keys, weights=[odds[k] for k in keys])[0]

def build_of(weight):
    return next((name, extra) for name, under, extra in BUILDS if weight < under)

def roll_player(rng, club):
    pos = pick(rng, ROSTER)
    heritage = rng.choices(POOLS, weights=PLAYER_MIX[pos])[0]
    look = LOOK[heritage]
    (hm, hs), (wm, ws), r = SIZE[pos]
    z1, z2 = rng.gauss(0, 1), rng.gauss(0, 1)
    zh, zw = z1, r * z1 + math.sqrt(1 - r * r) * z2
    height, weight = round(hm + hs * zh), round(wm + ws * zw)
    hair = pick(rng, look['hair'])
    style = pick(rng, look['style'])
    return {
        'pos': pos, 'heritage': heritage, 'skin': pick(rng, look['skin']), 'eyes': pick(rng, look['eyes']),
        'hair': hair, 'style': style, 'curly': rng.random() < look['curl'], 'base': rng.choice(BASES),
        'height': height, 'weight': weight, 'zh': (height - hm) / hs, 'club': club,
    }

# ---------------------------------------------------------------- clubs, read from the game's seed file

def clubs():
    src = open(os.path.join(REPO, 'src/engine/data/teams.ts')).read()
    consts = dict(re.findall(r"const (\w+) = '(#[0-9a-fA-F]{6})';", src))
    out = []
    for city, name, abbrev, c1, c2, args in re.findall(
            r"city: '([^']+)',\s*name: '([^']+)',\s*abbrev: '(\w+)',\s*colors: \['(#\w+)', '(#\w+)'\].*?"
            r"helmet: helmet\((.*?)\),\n", src, re.S):
        toks = re.findall(r"\[[^\]]*\]|'[^']*'|\w+", args)
        val = lambda t: (consts[t] if t in consts else None if t in ('undefined', 'null') else t.strip("'"))
        shell, finish, stripe, sa, sb, _num, bumper, mask = [val(t) if not t.startswith('[') else t for t in toks]
        out.append({'city': city, 'name': name, 'abbrev': abbrev, 'primary': c1, 'secondary': c2, 'shell': shell,
                    'finish': finish, 'stripe': stripe, 'stripeA': sa, 'stripeB': sb, 'bumper': bumper, 'mask': mask})
    return out

# ---------------------------------------------------------------- reading a face

def load(path):
    im = Image.open(os.path.join(HERE, path)).convert('RGBA')
    p = im.load()
    return {(x, y): p[x, y][:3] for y in range(N) for x in range(N) if p[x, y][3] > 127}

def eye_cells(px):
    return [xy for xy, c in px.items() if min(c) > 185]

def eye_centre(px):
    pts = eye_cells(px)
    return sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts)

def label(px):
    """Each cell's part: outline, white (of the eye), iris, brow, eyeshade, jersey or skin."""
    whites = set(eye_cells(px))
    top = min(y for _, y in whites)
    lab = {}
    for (x, y), c in px.items():
        if (x, y) in whites:
            lab[(x, y)] = 'white'
        elif max(c) < 12:
            lab[(x, y)] = 'outline'
        elif c[0] > 100 and (sat(c) >= 0.8 or (y >= 40 and sat(c) >= 0.75)):
            lab[(x, y)] = 'jersey'
        elif lum(c) < 40 and any((x + dx, y + dy) in whites for dx in (-1, 0, 1, 2) for dy in (-1, 0, 1)) \
                and top - 1 <= y <= top + 3:
            lab[(x, y)] = 'iris'
        elif lum(c) < 55 and top - 5 <= y <= top - 1 and x > min(x2 for x2, _ in whites) - 4:
            lab[(x, y)] = 'brow'
        elif sat(c) < 0.25 and top - 2 <= y <= top + 2:
            lab[(x, y)] = 'eyeshade'
        else:
            lab[(x, y)] = 'skin'
    return lab

def main_skin(px, lab):
    return Counter(px[xy] for xy in px if lab[xy] == 'skin').most_common(1)[0][0]

def layer_of(edited, source, below):
    """The cells an edit changed (above row `below`): its new part, as {cell: colour}."""
    out = {}
    for y in range(below):
        for x in range(N):
            a, b = source.get((x, y)), edited.get((x, y))
            if b is None:
                continue
            if a is None or sum((a[i] - b[i]) ** 2 for i in range(3)) > 900:
                out[(x, y)] = b
    return out

# ---------------------------------------------------------------- hair

def head_geometry(px, lab):
    whites = eye_cells(px)
    eye_top = min(y for _, y in whites)
    eye_left = min(x for x, _ in whites)
    brow_top = min([y for xy, y in [(xy, xy[1]) for xy in px if lab[xy] == 'brow']] or [eye_top - 3])
    rows = {}
    for (x, y) in px:
        rows.setdefault(y, []).append(x)
    left = {y: min(xs) for y, xs in rows.items()}
    head_top = min(y for (x, y) in px)
    # the ear: the rows around the eyes where the left edge juts out past the skull above
    skull = left.get(brow_top - 3, left[head_top + 6])
    ear_rows = [y for y in range(brow_top - 2, eye_top + 8) if y in left and left[y] < skull - 1]
    ear_top = min(ear_rows) if ear_rows else eye_top
    ear_right = (max(left[y] for y in ear_rows) + 4) if ear_rows else skull + 3
    return {'eye_top': eye_top, 'eye_left': eye_left, 'brow_top': brow_top, 'head_top': head_top,
            'ear_top': ear_top, 'ear_right': ear_right, 'skull_left': skull}

def hairline(g, x):
    front_y = g['brow_top'] - 4
    front_x = g['eye_left'] - 3
    back_y = g['ear_top'] + 1
    if x >= front_x:
        return front_y
    if x <= g['ear_right']:
        return back_y
    t = (x - g['ear_right']) / max(1, front_x - g['ear_right'])
    return round(back_y + (front_y - back_y) * t)

def hair_shade(col, k):
    """A hair colour lit like the skin under it (k: that skin's lightness against the face's main skin)."""
    k = max(0.45, min(1.35, k))
    if k >= 1:
        return mix(col, (255, 245, 225), (k - 1) * 0.55)
    return tuple(clamp(col[i] * (0.35 + 0.65 * k)) for i in range(3))

def draw_hair(px, lab, g, style, col, curly, base_skin, rng):
    if style == 'bald':
        return
    scalp = [xy for xy in px if lab[xy] == 'skin' and xy[1] < hairline(g, xy[0])]
    if style == 'buzz':
        for (x, y) in scalp:
            t = 0.55 if (x + y) % 2 else 0.38
            if y >= hairline(g, x) - 1:
                t *= 0.7
            px[(x, y)] = mix(px[(x, y)], hair_shade(col, lum(px[(x, y)]) / lum(base_skin)), t)
        return
    hair = set(scalp)
    if style == 'full':
        # volume: grow two rows out of the top and back of the skull, then a new outline around it
        grow = 2
        for _ in range(grow):
            edge = set()
            for (x, y) in hair | {xy for xy in px if lab[xy] == 'outline' and xy[1] < g['ear_top']}:
                for dx, dy in ((0, -1), (-1, 0), (1, 0), (-1, -1), (1, -1)):
                    n = (x + dx, y + dy)
                    if n not in px and n[1] < g['brow_top'] - 1 and n[0] < g['eye_left'] + 9:
                        edge.add(n)
            for n in edge:
                px[n] = col
                lab[n] = 'skin'
            hair |= edge
        # the old outline on top and back is inside the hair now
        for xy in [xy for xy in px if lab[xy] == 'outline' and xy[1] < hairline(g, xy[0])]:
            if any((xy[0] + dx, xy[1] + dy) in hair for dx, dy in ((0, -1), (-1, 0))):
                hair.add(xy)
        for (x, y) in list(hair):
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                n = (x + dx, y + dy)
                if n not in px:
                    px[n] = (0, 0, 0)
                    lab[n] = 'outline'
    top = min(y for _, y in hair)
    bottom = max(y for _, y in hair)
    xs = [x for x, _ in hair]
    x0, x1 = min(xs), max(xs)
    for (x, y) in hair:
        # light from the upper right, as the faces are lit; the back of the head in shade
        k = 1.0 + 0.25 * ((x - x0) / max(1, x1 - x0) - 0.5) - 0.3 * ((y - top) / max(1, bottom - top) - 0.4)
        c = hair_shade(col, k)
        if curly and (x * 3 + y * 5) % 4 == 0:
            c = hair_shade(col, k * 0.7)
        elif not curly and style == 'full' and (x + 2 * y) % 5 == 0:
            c = hair_shade(col, k * 1.15)
        if y >= hairline(g, x) - 1 and (x, y) in scalp and style == 'short':
            c = mix(c, px[(x, y)], 0.25)
        px[(x, y)] = c
        lab[(x, y)] = 'hair'

# ---------------------------------------------------------------- helmet stripes

def stripe_cells(shell, kind):
    """The cells of a centre stripe on the shell: its middle line, a great circle seen in three-quarter view, as
    offsets across it. One cell for a single, two lines for a double, a centre and two edges for a triple."""
    xs = [x for x, _ in shell]
    ys = [y for _, y in shell]
    cx, top = (min(xs) + max(xs)) / 2, min(ys)
    r = (max(xs) - min(xs)) / 2
    cy = top + r
    psi = math.radians(38)
    centre = {}
    for i in range(-30, 101):
        t = math.radians(i * 0.8)
        x = cx + r * 0.92 * math.sin(psi) * math.sin(t) + 1
        y = cy - r * 0.97 * math.cos(t)
        centre[(round(x), round(y))] = True
    out = {}
    for (x, y) in centre:
        if kind == 'single':
            parts = {0: 'A'}
        elif kind == 'double':
            parts = {-1: 'A', 1: 'A'}
        else:
            parts = {0: 'A', -1: 'B', 1: 'B'}
        for dx, part in parts.items():
            if (x + dx, y) in shell and (x + dx, y) not in out:
                out[(x + dx, y)] = part
    return out

# ---------------------------------------------------------------- one player

class Parts:
    def __init__(self):
        self.faces = {k: load(f'mixels/face-{k}.png') for k in BASES}
        f0 = load('mixels/face-0.png')
        self.helmet = layer_of(load('spritecook/a-helmet-face-0.png'), f0, 46)
        # the body: what the edit changed from the jaw down, and everything below the chin (cells the edit left as
        # they were, like a fold of the old tee, would otherwise let the base's own tee or neck show through)
        b = load('spritecook/b-jersey-pads-face-0.png')
        lab0 = label(f0)
        self.pads = {xy: c for xy, c in layer_of(b, f0, N).items() if xy[1] >= 33}
        self.pads.update({xy: c for xy, c in b.items() if xy[1] >= 44 or (xy[1] >= 33 and lab0.get(xy) == 'jersey')})
        self.e0 = eye_centre(f0)
        self.skin0 = main_skin(f0, label(f0))
        shell = Counter(c for c in self.helmet.values() if c[2] > c[0] + 30).most_common(1)[0][0]
        grey = Counter(c for c in self.helmet.values() if sat(c) < 0.2 and 40 < lum(c) < 170).most_common(1)[0][0]
        jersey = Counter(c for c in self.pads.values() if sat(c) >= 0.8).most_common(1)[0][0]
        self.base = {'shell': shell, 'mask': grey, 'jersey': jersey}

def compose(parts, p, helmet_on, rng):
    k = p['base']
    px = dict(parts.faces[k])
    lab = label(px)
    skin_base = main_skin(px, lab)
    tone = SKIN[p['skin']]
    hair_col = HAIR[p['hair']]
    ex, ey = eye_centre(px)
    dx, dy = round(ex - parts.e0[0]), round(ey - parts.e0[1])
    g = head_geometry(px, lab)
    # recolour the face first (hair and the borrowed layers read the new skin)
    for xy, part in list(lab.items()):
        c = px[xy]
        if part == 'skin':
            px[xy] = skin_to(c, skin_base, tone)
        elif part == 'brow':
            px[xy] = hair_shade(hair_col, 0.55) if p['hair'] not in ('black',) else c
        elif part == 'iris':
            px[xy] = EYES[p['eyes']]
    # the iris's top row sits under the lid
    irises = [xy for xy in px if lab[xy] == 'iris']
    if irises:
        itop = min(y for _, y in irises)
        for xy in irises:
            if xy[1] == itop:
                px[xy] = tuple(clamp(v * 0.6) for v in px[xy])
    if not helmet_on:
        draw_hair(px, lab, g, p['style'], hair_col, p['curly'], tone, rng)
    club = p['club']
    jersey = hexrgb(club['primary'])
    for (x, y), c in parts.pads.items():
        xy = (x + dx, y + dy)
        if c[0] > 100 and sat(c) >= 0.75:
            px[xy] = shade_to(c, parts.base['jersey'], jersey)
        elif max(c) < 12:
            px[xy] = c
        else:
            px[xy] = skin_to(c, parts.skin0, tone)
        lab[xy] = 'body'
    for xy, part in lab.items():  # the base's own tee where the pads don't cover it
        if part == 'jersey':
            px[xy] = shade_to(px[xy], parts.base['jersey'], jersey)
    if helmet_on:
        shell_col, mask_col = hexrgb(club['shell']), hexrgb(club['mask'])
        gloss = {'gloss': 1.0, 'metal': 1.15, 'matte': 0.45}[club['finish']]
        shell = {}
        for (x, y), c in parts.helmet.items():
            xy = (x + dx, y + dy)
            if c[2] > c[0] + 30:
                px[xy] = shade_to(c, parts.base['shell'], shell_col, gloss)
                shell[xy] = c
            elif sat(c) < 0.2 and 40 < lum(c) < 170:
                px[xy] = shade_to(c, parts.base['mask'], mask_col)
            elif max(c) < 30:
                px[xy] = c
            else:
                px[xy] = skin_to(c, parts.skin0, tone)
        if club['stripe'] != 'none':
            for xy, part in stripe_cells(shell, club['stripe']).items():
                col = hexrgb(club['stripeA'] if part == 'A' else club['stripeB'])
                px[xy] = shade_to(shell[xy], parts.base['shell'], col, gloss)
    # build: shoulders wider or narrower by a column or more each side
    extra = build_of(p['weight'])[1]
    if extra:
        px = widen(px, 12 + dx, 55 + dx, extra)
    # height: a tall man stands higher in the frame, a short one lower (a pixel a standard deviation, up to 3)
    shift = -max(-3, min(3, round(p['zh'])))
    img = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    q = img.load()
    for (x, y), c in px.items():
        if 0 <= x < N and 0 <= y + shift < N:
            q[x, y + shift] = c + (255,)
    return img

def widen(px, xl, xr, n):
    """Columns left of xl move left by n and right of xr move right (repeating the edge column); n < 0 narrows."""
    out = {}
    for (x, y), c in px.items():
        if x <= xl:
            out[(x - n, y)] = c
            if n > 0 and x == xl:
                for i in range(1, n + 1):
                    out[(x - n + i, y)] = c
        elif x >= xr:
            out[(x + n, y)] = c
            if n > 0 and x == xr:
                for i in range(1, n + 1):
                    out[(x + n - i, y)] = c
        else:
            out[(x, y)] = c
    return out

# ---------------------------------------------------------------- the page

def uri(img):
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def ring(img, px, club):
    prim = hexrgb(club['primary'])
    fill = mix(prim, (205, 210, 216), 0.6)
    return (f'<div class="ring" style="width:{px}px;height:{px}px;border-color:{club["primary"]};'
            f'background:rgb{fill}"><img src="{uri(img)}" width="{px}" height="{px}" alt=""></div>')

def feet(h):
    return f"{h // 12}'{h % 12}\""

def page(players, seed):
    cards = []
    small = []
    for p, on, off in players:
        c = p['club']
        build = build_of(p['weight'])[0]
        cards.append(
            f'<article><div class="pair">{ring(on, 128, c)}{ring(off, 128, c)}</div>'
            f'<h2>{html.escape(p["pos"])} · {html.escape(c["city"])} {html.escape(c["name"])}</h2>'
            f'<p>{feet(p["height"])}, {p["weight"]} lb · {build}</p>'
            f'<p class="dim">{HERITAGE_NAME[p["heritage"]]} · {p["skin"]} skin · {p["eyes"]} eyes · '
            f'{p["hair"]} hair, {p["style"]}{" (curly)" if p["curly"] and p["style"] in ("short", "full") else ""}'
            f' · face-{p["base"]}</p></article>')
        small.append(ring(on, 32, c) + ring(off, 32, c))
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel players</title>
<style>
:root {{ --bg:#16191f; --fg:#e8e6e1; --dim:#9aa3ad; --line:#2b3039; }}
body {{ margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui,sans-serif; }}
h1 {{ font-size:20px; margin:0 0 4px; }}
.lead, .dim {{ color:var(--dim); }} .lead {{ font-size:13px; max-width:760px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:20px 16px; margin-top:20px; }}
article {{ border-top:1px solid var(--line); padding-top:12px; }}
article h2 {{ font-size:14px; margin:8px 0 0; }} article p {{ margin:0; font-size:13px; }} article .dim {{ font-size:12px; }}
.pair {{ display:flex; gap:12px; }}
.ring {{ border-radius:50%; overflow:hidden; border:3px solid; flex:none; }}
.ring img {{ image-rendering:pixelated; display:block; }}
.strip {{ display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }} .strip .ring {{ border-width:2px; }}
h3 {{ font-size:15px; margin:28px 0 0; }}
</style></head><body><h1>Pixel players</h1>
<p class="lead">Four Mixels bald bases, drawn into players in code: skin, eyes, brows and simple hair by heritage,
shoulders by build (the game's five, by weight), the figure raised or lowered by height against his position, and
test a's helmet and test b's jersey and pads in each club's colours. Helmet on, then off. Seed {seed}.</p>
<div class="grid">{"".join(cards)}</div>
<h3>At list size (32)</h3><div class="strip">{"".join(small)}</div>
</body></html>'''

def main():
    seed = sys.argv[1] if len(sys.argv) > 1 else 'afls'
    rng = random.Random(seed)
    parts = Parts()
    teams = clubs()
    rng.shuffle(teams)
    players = []
    for club in teams[:24]:
        p = roll_player(rng, club)
        players.append((p, compose(parts, p, True, rng), compose(parts, p, False, rng)))
    out = os.path.join(REPO, '.check', 'pixel-faces-mock.html')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w').write(page(players, seed))
    sheet = Image.new('RGBA', (len(players) * 68, 2 * 68), (0, 0, 0, 0))
    for i, (_, on, off) in enumerate(players):
        sheet.alpha_composite(on, (i * 68, 0))
        sheet.alpha_composite(off, (i * 68, 68))
    os.makedirs(os.path.join(HERE, 'mock'), exist_ok=True)
    sheet.save(os.path.join(HERE, 'mock', 'players.png'))
    print(out, len(teams), 'clubs read')

if __name__ == '__main__':
    main()
