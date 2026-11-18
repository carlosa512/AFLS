"""Shared helpers: the kit's palette, grids of tokens, rows for pixels_write, a local preview."""
import json, sys, os
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import palettize as P
PAL = dict(P.PAL, outline=['#110c12'], shell=['#18234d', '#213470', '#2d5298', '#4a74c4', '#84b2f0'],
           mask=['#2f3033', '#4d4f53', '#7d8087', '#b5b8be'])
def hx(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def rgb(t):
    n, _, i = t.partition('.')
    return hx(PAL[n][int(i or 0)])
KEY = {'outline': 'o', 'iris': 'i', 'shell.0': '0', 'shell.1': '1', 'shell.2': '2', 'shell.3': '3', 'shell.4': '4',
       'mask.0': 'a', 'mask.1': 'b', 'mask.2': 'c', 'mask.3': 'd', 'skin.0': 'p', 'skin.1': 'q', 'skin.2': 'r',
       'skin.3': 's', 'skin.4': 't', 'skin.5': 'u', 'hair.0': 'h', 'hair.1': 'j', 'hair.2': 'k', 'hair.3': 'l',
       'eye.0': 'e', 'eye.1': 'w', 'tee.0': 'A', 'tee.1': 'B', 'tee.2': 'C', 'tee.3': 'D'}
INV = {v: k for k, v in KEY.items()}
def from_rows(origin, rows):
    g = {}
    for j, r in enumerate(rows):
        r = r.replace('|', '')
        for i, ch in enumerate(r):
            if ch != '.':
                g[(origin[0] + i, origin[1] + j)] = INV[ch]
    return g
def to_rows(g, box=None):
    xs = [x for x, _ in g]; ys = [y for _, y in g]
    x0, y0, x1, y1 = box or (min(xs), min(ys), max(xs), max(ys))
    out = []
    for y in range(y0, y1 + 1):
        r = ''.join(KEY[g[(x, y)]] if (x, y) in g else '.' for x in range(x0, x1 + 1))
        out.append('|'.join(r[i:i + 8] for i in range(0, len(r), 8)))
    return (x0, y0), out
def face(k):
    toks, _, _ = P.remap(k)
    return toks
def render(layers, scale=8, bg=(60, 64, 72)):
    im = Image.new('RGBA', (64, 64), bg + (255,))
    p = im.load()
    for g in layers:
        for (x, y), t in g.items():
            if 0 <= x < 64 and 0 <= y < 64:
                p[x, y] = rgb(t) + (255,)
    return im.resize((64 * scale, 64 * scale), Image.NEAREST)
def save(name, g):
    json.dump({'%d,%d' % xy: t for xy, t in g.items()}, open(os.path.join(os.path.dirname(__file__), name + '.json'), 'w'))
def load(name):
    return {tuple(map(int, k.split(','))): v for k, v in json.load(open(os.path.join(os.path.dirname(__file__), name + '.json'))).items()}
