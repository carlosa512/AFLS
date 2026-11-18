"""The SpriteCook test's comparison page: each result next to its source, at the card's sizes.

usage: python3 tools/compare.py   (from art/pixel-faces; writes ../../.check/spritecook.html)
"""
import base64, html, io, os
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, '..', '..', '.check', 'spritecook.html')

# (title, what was asked, source file, result file, verdict lines)
TESTS = [
    ('a. Helmet by edit', 'Edit face-0: put on a plain blue helmet with a grey two-bar facemask, change nothing else.',
     'mixels/face-0.png', 'spritecook/a-helmet-face-0.png', [
         'Pass: the edit kept him. Of the 235 skin cells still visible, 19 changed, at the edge of the helmet, where it casts shade.',
         'Pass: framing. The neck, tee and shoulders line up (10 of 1,280 cells differ in outline, at the chin strap).',
         'Pass: true 64x64 pixel art, no half-transparent pixels.',
         'Fix in code: the colors are noisy (593 near-duplicates of 44 real ones). Merging near colors cleans it.',
         'The helmet is one blue with a highlight, so code can recolor it per club.',
         'Cost: 12 credits (Nano Banana 2.1).',
     ]),
]
VERDICTS = {}

def uri(img):
    buf = io.BytesIO(); img.save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def diff(src, res):
    """Changed cells in magenta over the source in grey."""
    a, b = src.convert('RGBA'), res.convert('RGBA')
    out = Image.new('RGBA', a.size, (0, 0, 0, 0))
    pa, pb, po = a.load(), b.load(), out.load()
    for y in range(a.size[1]):
        for x in range(a.size[0]):
            s, r = pa[x, y], pb[x, y] if x < b.size[0] and y < b.size[1] else (0, 0, 0, 0)
            if (s[3] > 127) != (r[3] > 127) or (s[3] > 127 and sum((s[i] - r[i]) ** 2 for i in range(3)) > 900):
                po[x, y] = (255, 0, 200, 255)
            elif s[3] > 127:
                l = int(0.3 * s[0] + 0.59 * s[1] + 0.11 * s[2]) // 2
                po[x, y] = (l, l, l, 255)
    return out

def tile(img, scale, label):
    return (f'<figure><img src="{uri(img)}" width="{img.size[0] * scale}" height="{img.size[1] * scale}">'
            f'<figcaption>{html.escape(label)}</figcaption></figure>')

def card(img, px, label):
    return (f'<figure><div class="ring" style="width:{px}px;height:{px}px"><img src="{uri(img)}" '
            f'width="{px}" height="{px}"></div><figcaption>{html.escape(label)}</figcaption></figure>')

def section(title, ask, src_path, res_path, notes):
    src = Image.open(os.path.join(HERE, src_path))
    res = Image.open(os.path.join(HERE, res_path))
    row = [tile(src, 5, f'source · {os.path.basename(src_path)}'), tile(res, 5, f'result · {os.path.basename(res_path)}')]
    if src.size == res.size and 'face' in os.path.basename(src_path) and not res_path.startswith('spritecook/c-'):
        row.append(tile(diff(src, res), 5, 'changed cells (magenta)'))
    sizes = [card(res, 128, 'card 128'), card(res, 64, 'phone 64'), card(res, 32, 'list 32')]
    li = ''.join(f'<li>{html.escape(n)}</li>' for n in notes)
    return (f'<section><h2>{html.escape(title)}</h2><p class="ask">{html.escape(ask)}</p>'
            f'<div class="row">{"".join(row)}</div><div class="row small">{"".join(sizes)}</div>'
            f'<ul>{li}</ul></section>')

def page(tests):
    body = ''.join(section(*t) for t in tests)
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SpriteCook test</title>
<style>
:root {{ --bg:#16191f; --fg:#e8e6e1; --dim:#9aa3ad; --ring:#ff5a1f; --line:#2b3039; }}
body {{ margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,sans-serif; }}
h1 {{ font-size:20px; margin:0 0 4px; }} h2 {{ font-size:17px; margin:0 0 4px; }}
section {{ border-top:1px solid var(--line); padding:20px 0; max-width:1100px; }}
.ask, figcaption, .lead {{ color:var(--dim); font-size:13px; }}
.row {{ display:flex; flex-wrap:wrap; gap:16px; align-items:flex-end; margin:12px 0; }}
img {{ image-rendering:pixelated; display:block; background:#252a33; }}
.ring {{ border-radius:50%; overflow:hidden; background:#fca98a; outline:3px solid var(--ring); }}
.ring img {{ background:none; }}
figure {{ margin:0; }} ul {{ margin:8px 0 0; padding-left:20px; }}
</style></head><body><h1>SpriteCook test</h1>
<p class="lead">Each result next to its source, at 5× and at the card's sizes. Nearest-neighbor scaling, no smoothing.</p>
{body}</body></html>'''

if __name__ == '__main__':
    tests = [(t, a, s, r, VERDICTS.get(r, n)) for t, a, s, r, n in TESTS]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w').write(page(tests))
    print(os.path.normpath(OUT))
