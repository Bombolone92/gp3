"""Record paired native reference silhouettes and interior samples without font extraction."""
from pathlib import Path
import ctypes
import hashlib
import json
import numpy as np
import pypdfium2 as pdf

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-3d'


def record(page):
    pixels = np.asarray(page.render(scale=4).to_pil().convert('RGB'))
    ink = (pixels[:, :, 0] > 100) & (pixels[:, :, 1] < 100) & (pixels[:, :, 2] < 120)
    ys, xs = np.where(ink)
    samples = []
    # Half-point spacing includes narrow 24pt strokes; larger text uses 1pt.
    # A uniform 3x3 region
    # excludes blended edges; it does not establish complete raster equality.
    step = 2 if ys.max() - ys.min() < 120 else 4
    for y in range(int(ys.min()) + 2, int(ys.max()) - 1, step):
        for x in range(int(xs.min()) + 2, int(xs.max()) - 1, step):
            color = pixels[y, x].astype(int)
            if ink[y, x] and np.max(np.abs(pixels[y-1:y+2, x-1:x+2].astype(int) - color)) <= 1:
                samples.append([x / 4, y / 4, *color.tolist()])
    text = page.get_textpage()
    index = text.get_text_range().index('Following text')
    x, y = ctypes.c_double(), ctypes.c_double()
    assert pdf.raw.FPDFText_GetCharOrigin(text, index, ctypes.byref(x), ctypes.byref(y))
    return {
        'inkBoundsPt': [float(xs.min()/4), float(ys.min()/4), float(xs.max()/4), float(ys.max()/4)],
        'followingOriginPt': [x.value, page.get_height()-y.value],
        'samples': samples,
    }


def main():
    cases = json.loads((ROOT / 'font-sizes-cases.json').read_text())
    plain = pdf.PdfDocument(ROOT / 'font-sizes-plain-native.pdf')
    effect = pdf.PdfDocument(ROOT / 'font-sizes-native.pdf')
    assert len(cases) == len(plain) == len(effect) == 8
    records = []
    for case, normal, shaded in zip(cases, plain, effect):
        pair = {**case, 'plain': record(normal), 'effect': record(shaded)}
        assert pair['plain']['samples'] and pair['effect']['samples']
        records.append(pair)
    files = ['font-sizes.docx', 'font-sizes-plain.docx', 'font-sizes-native.pdf', 'font-sizes-plain-native.pdf']
    output = {
        'referenceVersion': '16.0.20326', 'renderScale': 4,
        'hashes': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
        'records': records,
    }
    (ROOT / 'font-sizes-reference.json').write_text(json.dumps(output, separators=(',', ':'))+'\n', encoding='utf-8')
    print('Recorded eight paired pages:', sum(len(r[k]['samples']) for r in records for k in ['plain', 'effect']), 'samples.')


if __name__ == '__main__':
    main()
