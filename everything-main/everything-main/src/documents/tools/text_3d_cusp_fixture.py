"""Original flat-material acute curve controls; temporary original font only.

Requires the installed reference application and a review server. All glyph outlines are authored
below; font headers use the existing OFL metadata generator. No font is shipped.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from copy import deepcopy
import argparse, ctypes as C, json, subprocess
from lxml import etree as E
from record_text_bevel_geometry import create_controls

repo = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--url', default='http://127.0.0.1:5173/playground.html')
parser.add_argument('--units', type=int, choices=[1000, 2048], default=1000)
parser.add_argument('--tight', action='store_true', help='Short, nearly tangent curve-to-line transition.')
args = parser.parse_args()
out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
prefix = 'Original Tight Cusp Controls' if args.tight else 'Original Cusp Controls'
family = prefix+' '+str(args.units)
outer = [(80, 0, 1), (920, 0, 1), (920, 900, 1), (80, 900, 1)]
# A triangular hole with two quadratic sides at its acute apex. Perturb only
# the lower curve/line join; the polygonal companion distinguishes curve use.
shapes = []
for delta in [-1, 0, 1]:
    hole = [(650, 200, 1), (650, 600, 1), (650, 670, 0),
            (655, 800, 1), (560, 620, 0), (530 + delta, 575, 1), (280, 200, 1)]
    if args.tight:
        hole = [(650, 200, 1), (650, 670, 1), (650, 720, 0),
                (660, 770, 1), (639, 733, 0), (623 + delta, 707, 1), (310, 200, 1)]
    shapes.append([outer, list(reversed(hole))])
shapes.append([outer, [(x, y, 1) for x, y, _ in shapes[1][1]]])
cases = [dict(shape=i, unitsPerEm=args.units, tight=args.tight, joinDelta=[-1, 0, 1, None][i],
              curves=i != 3, bold=bold) for i in range(4) for bold in [False, True]]
with TemporaryDirectory(prefix='original-cusp-controls-') as temporary:
    fonts = Path(temporary)
    create_controls(fonts, shapes + [[outer]] * (62 - len(shapes)), prefix, normalize_metrics=True)
    with ZipFile(repo/'tests/fixtures/text-3d/control.docx') as z:
        parts = {n: z.read(n) for n in z.namelist()}
    w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    q = lambda n: '{'+w+'}'+n
    doc = E.fromstring(parts['word/document.xml']); body = doc.find(q('body'))
    original = list(body); section = deepcopy(original[-1]); body.clear()
    for index, case in enumerate(cases):
        blocks = [deepcopy(x) for x in original[15:18]]
        blocks[0].find('.//'+q('t')).text = 'Original cusp '+str(index+1)
        if index == 0:
            n = blocks[0].find('.//'+q('pageBreakBefore')); n.getparent().remove(n)
        pr = blocks[1].find('.//'+q('rPr'))
        pr.insert(0, E.Element(q('rFonts'), {q('ascii'): family, q('hAnsi'): family}))
        pr.find(q('b')).set(q('val'), '1' if case['bold'] else '0')
        pr.find(q('sz')).set(q('val'), '650')
        for e in pr.iter():
            for key in e.attrib:
                if E.QName(key).localname == 'prstMaterial': e.set(key, 'flat')
        blocks[1].find('.//'+q('t')).text = chr(65+case['shape'])
        body.extend(blocks)
    body.append(section); parts['word/document.xml'] = E.tostring(doc)
    with ZipFile(out/'control.docx', 'w') as z:
        for name, data in parts.items():
            entry = ZipInfo(name, (2026, 9, 28, 12, 0, 0)); entry.compress_type = ZIP_DEFLATED
            z.writestr(entry, data)
    (out/'cases.json').write_text(json.dumps(cases, indent=2)+'\n')
    (out/'outlines.json').write_text(json.dumps(shapes, indent=2)+'\n')
    font = fonts/f'bevel-geometry-probe-{args.units}.ttf'
    gdi = C.WinDLL('gdi32')
    gdi.AddFontResourceExW.argtypes = [C.c_wchar_p, C.c_uint, C.c_void_p]
    gdi.RemoveFontResourceExW.argtypes = gdi.AddFontResourceExW.argtypes
    assert gdi.AddFontResourceExW(str(font), 0, None)
    try:
        subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                        str(repo/'tools/export-reference.ps1'), '-SourceFullPath',
                        str(out/'control.docx'), '-OutputPdf', str(out/'native.pdf')], check=True)
        subprocess.run(['node', str(repo/'tools/capture-text3d-shallow-joins.mjs'),
                        str(out), args.url, family, str(len(cases))], check=True)
    finally:
        assert gdi.RemoveFontResourceExW(str(font), 0, None)
