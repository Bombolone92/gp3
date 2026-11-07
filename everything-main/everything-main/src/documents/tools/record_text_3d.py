"""Record native reference text-effect samples, away from glyph antialiasing edges."""
from pathlib import Path
import ctypes
import hashlib
import json
import numpy as np
import pypdfium2 as pdf

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-3d'


def main():
    cases = json.loads((ROOT / 'cases.json').read_text())
    document = pdf.PdfDocument(ROOT / 'native.pdf')
    assert len(document) == len(cases) == 10
    records = []
    grids = []
    for case, page in zip(cases, document):
        pixels = np.asarray(page.render(scale=4).to_pil().convert('RGB'))
        candidates = []
        for y in range(125, 230, 3):
            for x in range(76, 269, 3):
                patch = pixels[y*4-2:y*4+3, x*4-2:x*4+3].astype(int)
                color = patch[2, 2]
                if color[0] > 100 and color[1] < 100 and color[2] < 120 and np.max(np.abs(patch-color)) <= 1:
                    candidates.append({'xPt': x, 'yPt': y, 'rgb': color.tolist()})
        # Spatially separate samples, prioritizing evidence of non-flat shading.
        candidates.sort(key=lambda s: max(abs(c-b) for c,b in zip(s['rgb'], [208,32,48])), reverse=True)
        grids.append({'page': case['page'], 'name': case['name'], 'samples': [
            [s['xPt'], s['yPt'], *s['rgb']]
            for s in sorted(candidates, key=lambda s: (s['yPt'], s['xPt']))
        ]})
        samples = []
        for candidate in candidates:
            if all((candidate['xPt']-s['xPt'])**2+(candidate['yPt']-s['yPt'])**2 >= 64 for s in samples):
                samples.append(candidate)
            if len(samples) == 24:
                break
        assert len(samples) == 24
        text = page.get_textpage()
        content = text.get_text_range()
        start = content.index('Following text')
        x, y = ctypes.c_double(), ctypes.c_double()
        assert pdf.raw.FPDFText_GetCharOrigin(text, start, ctypes.byref(x), ctypes.byref(y))
        records.append({'name': case['name'], 'page': case['page'], 'followingOriginPt': [x.value, page.get_height()-y.value], 'samples': samples})
    digest = lambda name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    result = {'sourceSha256': digest('control.docx'), 'pdfSha256': digest('native.pdf'), 'referenceVersion': '16.0.20326', 'renderScale': 4, 'records': records}
    (ROOT / 'reference.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    # One compact page per line keeps the complete spatial grid reviewable
    # without discarding ordinary face samples in favor of bright highlights.
    (ROOT / 'native-surface-grid.json').write_text('[\n'+',\n'.join(json.dumps(g, separators=(',', ':')) for g in grids)+'\n]\n', encoding='utf-8')
    print(f'Recorded {len(records)} pages and {sum(len(r["samples"]) for r in records)} interior samples.')
    print(f'Recorded {sum(len(g["samples"]) for g in grids)} additional uniform-grid samples.')


if __name__ == '__main__':
    main()
