import sys, os
sys.path.insert(0, 'pixelwright/tools'); sys.path.insert(0, 'tools')
import hairkit as H, kit, sheets
from PIL import Image, ImageDraw

def hairline(x):
    if x >= 31: return 17
    if x >= 28: return 17 + (31 - x)
    if x >= 25: return 25
    if x >= 20: return 23
    return 31
keep = lambda xy: xy[1] < hairline(xy[0])

def curly():
    cl = [(18, 27, 3.2), (17, 22, 3.8), (21, 29, 2.6), (16, 16, 4.2), (19, 10, 4.2), (24, 6, 4.6), (31, 4.5, 4.6),
          (38, 5.5, 4.4), (44, 9, 4.0), (47, 14, 3.2), (24, 13, 4.6), (31, 11, 5.0), (38, 12, 4.6), (21, 19, 3.8),
          (28, 17, 3.6), (35, 16, 3.4), (42, 15.5, 3.4), (46, 18.5, 2.2), (32, 18.5, 2.2), (38, 18.5, 2.3)]
    return H.finish(H.curls(cl), keep=keep)

def scalp():
    return {xy: 1 for xy in H.FACE if keep(xy)}

def drawn(poly, lines, sheen=None, **kw):
    c = H.mass(poly) | set(xy for xy in H.FACE if keep(xy))
    out = H.shade_mass(c, sheen, **kw)
    H.strands(out, lines)
    return H.finish(out, keep=keep)

def mane():
    poly = [(46, 19), (48, 15), (48, 10), (45, 6), (42, 2), (38, 2), (35, 0), (31, 1), (27, 0), (23, 3), (19, 4), (15, 8),
            (12, 12), (10, 17), (8, 22), (9, 27), (7, 32), (9, 36), (7, 41), (10, 45), (13, 43), (15, 47), (17, 43),
            (20, 46), (22, 41), (23, 36), (25, 31), (26, 26), (27, 22), (29, 20), (32, 17), (36, 19), (38, 16), (42, 19),
            (44, 17), (46, 19)]
    lines = [[(31, 3), (24, 6), (17, 11), (13, 18), (12, 26), (10, 33), (11, 40)],
             [(34, 4), (27, 8), (21, 14), (18, 22), (17, 30), (15, 37), (16, 44)],
             [(35, 6), (29, 11), (25, 18), (23, 26), (22, 34)], [(37, 4), (43, 7), (46, 12)],              [(31, 7), (33, 12), (33, 17)], [(26, 2), (19, 6), (14, 12), (11, 20), (9, 28)], [(33, 6), (37, 10), (41, 15), (43, 18)]]
    return drawn(poly, lines)

def straight():
    poly = [(46, 19), (47, 14), (46, 9), (43, 5), (38, 3), (32, 3), (26, 4), (21, 7), (17, 12), (15, 18), (14, 25), (14, 32),
            (15, 38), (14, 42), (16, 43), (18, 42), (20, 43), (22, 41), (22, 36), (24, 31), (25, 26), (27, 21), (29, 19),
            (32, 16), (35, 15), (39, 16), (43, 18), (46, 20)]
    lines = [[(35, 4), (31, 5), (26, 7)], [(33, 6), (27, 8), (21, 13), (18, 21), (17, 31), (17, 40)],
             [(35, 7), (30, 10), (25, 16), (22, 25), (21, 34)], [(37, 5), (42, 8), (45, 13)], [(36, 7), (40, 11), (43, 16)]]
    return drawn(poly, lines)

def swept():
    poly = [(46, 18), (47, 13), (45, 9), (42, 6), (40, 4), (38, 5), (35, 3), (33, 5), (29, 4), (27, 6), (23, 6), (21, 9),
            (18, 11), (19, 14), (18, 18), (19, 22), (24, 22), (25, 25), (27, 25), (28, 20), (31, 17), (34, 17), (38, 16),
            (42, 16), (46, 18)]
    lines = [[(44, 16), (42, 10), (40, 5)], [(40, 16), (37, 10), (35, 4)], [(36, 17), (33, 10), (29, 5)],
             [(32, 17), (28, 11), (23, 7)], [(28, 19), (24, 14), (19, 12)]]
    return drawn(poly, lines)

def mane2():
    C = H.chain
    cl = []
    # back locks first, falling in waves to the shoulders
    cl += C([(24, 6), (16, 12), (12, 21), (14, 29), (11, 37), (13, 44)], 4.6, 3.0)
    cl += C([(26, 6), (18, 13), (15, 22), (17, 30), (14, 38), (15, 44)], 4.4, 3.0)
    cl += C([(28, 5), (20, 12), (18, 21), (20, 30), (18, 38), (20, 44)], 4.2, 2.8)
    cl += C([(30, 7), (24, 14), (22, 23), (24, 31), (22, 39)], 3.8, 2.6)
    # the crown and the far side, falling behind the face
    cl += C([(32, 3), (25, 4), (18, 8), (14, 14)], 4.6, 3.2)
    cl += C([(35, 3), (41, 5), (46, 10), (48, 17), (48, 24), (47, 30)], 4.2, 2.0)
    cl += C([(33, 5), (29, 9), (26, 15), (25, 21)], 3.6, 2.4)
    # the fringe, parted near the middle and falling either way
    cl += C([(32, 7), (31, 12), (30, 16), (28, 19)], 2.6, 1.3)
    cl += C([(35, 6), (37, 11), (37, 15), (36, 19)], 2.6, 1.3)
    cl += C([(38, 6), (42, 10), (44, 15), (45, 19)], 2.6, 1.3)
    k = lambda xy: keep(xy) or (xy[0] <= 24 and xy[1] <= 42) or (xy[1] <= 20 and xy[0] >= 27)
    cells = H.curls(cl)
    for xy in H.FACE:
        if keep(xy) and xy not in cells:
            cells[xy] = 1  # the scalp under the locks, so no skin shows through the top
    return H.finish(cells, keep=k)

def swept2():
    C = H.chain
    cl = []
    # close at the back, then tufts lying back along the skull, the front row last so it sits on top
    cl += C([(24, 13), (21, 17), (20, 21)], 2.2, 1.4)
    cl += C([(28, 8), (22, 10), (19, 14)], 2.6, 1.6)
    cl += C([(36, 8), (29, 6), (23, 9)], 2.8, 1.4)
    cl += C([(40, 8), (33, 5), (27, 5)], 2.8, 1.4)
    cl += C([(44, 10), (38, 6), (32, 4)], 2.8, 1.4)
    cl += C([(33, 16), (28, 13), (24, 13)], 2.5, 1.4)
    cl += C([(37, 15), (32, 12), (27, 11)], 2.6, 1.4)
    cl += C([(41, 15), (36, 12), (31, 10)], 2.6, 1.4)
    cl += C([(45, 15), (40, 11), (35, 9)], 2.6, 1.4)
    cells = H.curls(cl)
    for xy in H.FACE:
        if keep(xy) and xy not in cells:
            cells[xy] = 1
    return H.finish(cells, keep=keep)

STY = {'mane2': mane2, 'swept2': swept2, 'curly': curly, 'mane': mane, 'straight': straight, 'swept': swept}
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '')
if __name__ == '__main__':
    names = sys.argv[1:] or list(STY)
    sh = Image.new('RGBA', (len(names) * 320, 320), (40, 44, 52, 255))
    for i, n in enumerate(names):
        g = STY[n]()
        g = sheets.recolour(g, None, None, 'brown')
        f = sheets.recolour(kit.face(0), 'light-medium', None, 'brown')
        im = sheets.paint([f, g])
        bg = Image.new('RGBA', (64, 64), (60, 64, 72, 255)); bg.alpha_composite(im)
        sh.paste(bg.resize((320, 320), Image.NEAREST), (i * 320, 0))
    sh.save(D + 'try.png')
