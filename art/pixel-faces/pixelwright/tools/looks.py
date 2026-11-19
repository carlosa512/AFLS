"""Skin tones, hair colours and eye colours as ramps on the kit's steps, so a player's look is a ramp swap.

Each skin tone keeps the drawing ramp's shape (six steps, base at step 4) but lighter tones get softer creases, so
a light face doesn't read as heavily lined (the mock-up's problem with the dark line work of the bases)."""
import colorsys, json, sys

def hx(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def hexs(c): return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)

# the base (step 4) of each tone; medium-brown is the faces as drawn
TONES = {
    'porcelain': '#efcab0', 'light': '#e2b08e', 'light-medium': '#cf9a70', 'olive': '#bc8c5e', 'medium': '#b37a52',
    'medium-brown': '#a45d38', 'brown': '#8a5236', 'dark': '#6a3f2c', 'deep': '#4f2f23',
}
DRAWN = ['#4b1f20', '#5e2a26', '#73392b', '#8a4b30', '#a45d38', '#b77350']

def lum(c): return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]

def skin_ramp(base):
    """Six steps around a base, shaped like the drawn ramp: each step is the base scaled by the drawn step's lightness
    against the drawn base (red falling slowest, blue fastest, so shadows stay warm), creases softened on light tones."""
    b = hx(base)
    soft = min(1.0, max(0.0, (lum(b) - 110) / 100))  # 0 for dark tones, 1 for the lightest
    out = []
    for i, d in enumerate(DRAWN):
        k = lum(hx(d)) / lum(hx(DRAWN[4]))
        if i < 4:
            k = k + (1 - k) * 0.3 * soft
            out.append(hexs((b[0] * k ** 0.85, b[1] * k ** 1.0, b[2] * k ** 1.2)))
        elif i == 4:
            out.append(base)
        else:
            out.append(hexs([v + (255 - v) * 0.18 for v in b]))
    return out

HAIR = {
    'black': ['#1c1416', '#2c201f', '#43302a', '#5f463b'],
    'dark-brown': ['#24160f', '#3a2418', '#553624', '#734c33'],
    'brown': ['#38220f', '#56361b', '#77502b', '#9a6c3f'],
    'light-brown': ['#4f3418', '#755028', '#9c713e', '#c09359'],
    'blond': ['#6e4b1e', '#a07a36', '#cda558', '#ecd08c'],
    'red': ['#4e1d0e', '#7a3216', '#a6501f', '#cc7336'],
}
IRIS = {'brown': '#5a3820', 'hazel': '#76603a', 'green': '#4e7a4a', 'blue': '#4670aa', 'grey': '#76808c'}

if __name__ == '__main__':
    ramps = [{'name': 'skin-' + n, 'colors': skin_ramp(b)} for n, b in TONES.items() if n != 'medium-brown']
    ramps += [{'name': 'hair-' + n, 'colors': c} for n, c in HAIR.items() if n != 'black']
    adds = [{'hex': h, 'token': 'iris-' + n} for n, h in IRIS.items()]
    print(json.dumps({'ramps': ramps, 'add': adds}))
