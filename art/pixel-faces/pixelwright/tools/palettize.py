"""Map the five snapped faces onto one shared palette of named ramps (skin, tee, eye, iris, hair for brows)."""
import sys, os
sys.path.insert(0, 'tools')
from PIL import Image
import mock

def Lab_L(c):
    r, g, b = [v / 255 for v in c]
    lin = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return 116 * Y ** (1 / 3) - 16 if Y > 0.008856 else 903.3 * Y

PAL = {
    'outline': ['#110c12'],
    'skin': ['#4b1f20', '#5e2a26', '#73392b', '#8a4b30', '#a45d38', '#b77350'],
    'tee': ['#a6400f', '#c4510b', '#dd660f', '#f27b1a'],
    'eye': ['#8d8580', '#f6f1e2'],
    'iris': ['#2b1914'],
    'hair': ['#1c1416', '#2c201f', '#43302a', '#5f463b'],
}
def hx(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

def remap(k):
    px = mock.load(f'mixels/face-{k}.png')
    lab = mock.label(px)
    whites = {xy for xy, p in lab.items() if p == 'white'}
    top = min(y for _, y in whites)
    bot = max(y for _, y in whites)
    # the tee: strongly saturated orange, or anything orange below the collar (skin at the jaw is less saturated)
    for (x, y), c in px.items():
        if lab[(x, y)] == 'jersey' and not (mock.sat(c) >= 0.85 or y >= 50):
            lab[(x, y)] = 'skin'
    skin = [xy for xy in px if lab[xy] == 'skin']
    count = {}
    for xy in skin:
        count[px[xy]] = count.get(px[xy], 0) + 1
    base = max(count, key=count.get)
    shift = Lab_L(hx(PAL['skin'][4])) - Lab_L(base)
    ramp = [Lab_L(hx(h)) for h in PAL['skin']]
    out = {}
    for xy, p in lab.items():
        c = px[xy]
        L = Lab_L(c)
        x, y = xy
        if p == 'outline':
            t = 'outline'
        elif p == 'white':
            t = 'eye.1'
        elif p == 'eyeshade':
            t = 'eye.0'
        elif p == 'iris':
            t = 'iris'
        elif p == 'brow':
            t = 'hair.0' if L < 12 else 'hair.1'
        elif p == 'jersey':
            t = 'tee.%d' % min(range(4), key=lambda i: abs(Lab_L(hx(PAL['tee'][i])) - L))
        elif L < 13:
            # very dark marks on the skin: lashes and pupils at the eyes, brows above them, else a crease
            if top - 1 <= y <= bot + 1:
                t = 'iris'
            elif top - 5 <= y < top - 1:
                t = 'hair.0'
            else:
                t = 'skin.0'
        else:
            t = 'skin.%d' % min(range(6), key=lambda i: abs(ramp[i] - (L + shift)))
        out[xy] = t
    return out, [], 0

def colour(t):
    n, _, i = t.partition('.')
    return hx(PAL[n][int(i or 0)])

if __name__ == '__main__':
    sheet = Image.new('RGBA', (320, 64), (0, 0, 0, 0))
    cmp = Image.new('RGBA', (320, 128), (40, 44, 52, 255))
    for j, k in enumerate(range(5)):
        toks, levels, base = remap(k)
        print(k, 'levels', [['%02x%02x%02x' % c for c in cs] for cs in levels], 'base', base)
        q = sheet.load()
        for (x, y), t in toks.items():
            q[j * 64 + x, y] = colour(t) + (255,)
        orig = Image.open(f'mixels/face-{k}.png').convert('RGBA')
        cmp.alpha_composite(orig, (j * 64, 0))
    cmp.alpha_composite(sheet, (0, 64))
    out = sys.argv[1]
    sheet.save(os.path.join(out, 'faces-pal.png'))
    cmp.resize((320 * 4, 128 * 4), Image.NEAREST).save(os.path.join(out, 'faces-cmp.png'))
    print(os.path.getsize(os.path.join(out, 'faces-pal.png')), 'bytes')
