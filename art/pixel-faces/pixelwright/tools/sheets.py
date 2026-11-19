"""Render the Pixelwright kit's sheets from its parts (the same tokens drawn in the studio, project
"AFLS player faces"): the helmet on all five bases, the nine hair styles on face-0, and the ten heritage looks.

usage: python3 pixelwright/tools/sheets.py   (from art/pixel-faces; writes pixelwright/*.png)"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools'))
from PIL import Image
import kit, looks

PARTS = os.path.join(HERE, '..', 'parts')
OUT = os.path.join(HERE, '..')

def part(name):
    d = json.load(open(os.path.join(PARTS, name + '.json')))
    return {tuple(map(int, k.split(','))): v for k, v in d.items()}

# where the helmet sits on each base: lined up by the middle of the two eyes (not their average, which a
# half-hidden far eye pulls sideways: that made face-3 look like it needed a bigger helmet)
HELMET_AT = {0: (0, 0), 1: (0, 0), 2: (-1, 2), 3: (1, 1), 4: (-1, 0)}
STYLES = ['buzz', 'crew', 'side_part', 'curly_top', 'high_top', 'afro', 'braids', 'locs', 'flow']
# (skin tone, eyes, hair colour, style): None keeps the drawn ramp
LOOKS = [('porcelain', 'blue', 'blond', 'side_part'), ('brown', None, None, 'high_top'),
         ('light-medium', 'brown', 'dark-brown', 'crew'), ('medium', 'brown', None, 'curly_top'),
         ('light', None, None, 'side_part'), ('olive', 'brown', None, 'flow'), ('deep', None, None, 'braids'),
         ('light', 'green', 'red', 'crew'), ('dark', None, None, 'locs'), (None, None, None, 'afro')]

PAL = dict(kit.PAL)
for n, b in looks.TONES.items():
    PAL['skin-' + n] = looks.skin_ramp(b)
for n, c in looks.HAIR.items():
    PAL['hair-' + n] = c
for n, h in looks.IRIS.items():
    PAL['iris-' + n] = [h]

def rgb(t):
    n, _, i = t.rpartition('.') if t.rpartition('.')[2].isdigit() else (t, '', '0')
    return kit.hx(PAL[n][int(i)])

def shift(g, d):
    return {(x + d[0], y + d[1]): t for (x, y), t in g.items()}

def recolour(g, tone, eyes, hair):
    out = {}
    for xy, t in g.items():
        n, _, i = t.partition('.')
        if n == 'skin' and tone and tone != 'medium-brown':
            t = 'skin-%s.%s' % (tone, i)
        elif n == 'hair' and hair and hair != 'black':
            t = 'hair-%s.%s' % (hair, i)
        elif t == 'iris' and eyes:
            t = 'iris-' + eyes
        out[xy] = t
    return out

def paint(layers):
    im = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    p = im.load()
    for g in layers:
        for (x, y), t in g.items():
            if 0 <= x < 64 and 0 <= y < 64:
                p[x, y] = rgb(t) + (255,)
    return im

def sheet(name, frames):
    s = Image.new('RGBA', (64 * len(frames), 64), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.alpha_composite(f, (64 * i, 0))
    s.save(os.path.join(OUT, name + '.png'))
    bg = Image.new('RGBA', s.size, (40, 44, 52, 255)); bg.alpha_composite(s)
    bg.resize((s.width * 4, s.height * 4), Image.NEAREST).save(os.path.join(OUT, name + '-4x.png'))

if __name__ == '__main__':
    helmet, mask = part('helmet-lit'), part('facemask0')
    sheet('helmet-on-all', [paint([kit.face(k), shift(helmet, HELMET_AT[k]), shift(mask, HELMET_AT[k])]) for k in range(5)])
    f0 = kit.face(0)
    sheet('hair-styles', [paint([f0, part('hair-' + s)]) for s in STYLES])
    sheet('heritage-looks', [paint([recolour(f0, *l[:3]), recolour(part('hair-' + l[3]), *l[:3])]) for l in LOOKS])
    print('wrote helmet-on-all, hair-styles, heritage-looks')
