"""Measure the two captured live reference views; not a general screenshot renderer."""
import hashlib
import json
from zipfile import ZipFile
import numpy as np
from PIL import Image
from rotated_live_fixture import build, FOLDER
from record_rotated_spacing_phase import validate_wrapper
from record_rotated_phase_metafiles import baseline_records
from inspect_emf_text_records import inspect


def glyphs(path):
    with Image.open(path) as image:
        if image.size != (946, 536):
            raise ValueError('Changed captured window dimensions')
        pixels = np.asarray(image.convert('RGB')).astype(float)
    # Both views have the complete six-glyph row here. Black-glyph threshold
    # excludes the blue border and red spelling marks. Full RGB ink weights
    # below retain antialiasing within each isolated glyph's small crop.
    mask = np.max(pixels[325:410, 200:800], axis=2) < 100
    columns = np.flatnonzero(mask.any(axis=0))
    groups = np.split(columns, np.flatnonzero(np.diff(columns) > 1) + 1)
    if len(groups) != 6 or any(len(g) == 0 for g in groups):
        raise ValueError('Expected six isolated glyph components')
    results = []
    for group in groups:
        ys, xs = np.where(mask[:, group[0]:group[-1]+1])
        box = [int(group[0]+xs.min()+200), int(ys.min()+325),
               int(group[0]+xs.max()+200), int(ys.max()+325)]
        x0, y0, x1, y1 = box
        crop = pixels[y0-2:y1+5, x0-2:x1+6]
        ink = 1-crop.mean(axis=2)/255
        yy, xx = np.indices(ink.shape)
        mass = ink.sum()
        results.append(dict(bounds=box, inkMass=round(float(mass), 6),
                            centroidX=round(float((xx*ink).sum()/mass+x0-2), 6),
                            centroidY=round(float((yy*ink).sum()/mass+y0-2), 6)))
    return results


def record():
    with ZipFile(FOLDER / 'control.docx') as z:
        if {n: z.read(n) for n in z.namelist()} != build():
            raise ValueError('Source differs from original construction')
    capture = json.loads((FOLDER/'capture.json').read_text(encoding='utf-8-sig'))
    if capture != dict(referenceBuild='16.0.20326', tables=2, readOnly=True):
        raise ValueError('Changed export provenance')
    names = ['control.docx', 'capture.json']
    screens, native = [], []
    for index in range(2):
        screenshot = f'native-{index}-500.png'
        emf = f'native-table-{index+1}.emf'
        names.extend([screenshot, emf])
        screens.append(glyphs(FOLDER/screenshot))
        data = (FOLDER/emf).read_bytes()
        validate_wrapper(data)
        scale, rows = baseline_records(data, directions=('tbRl',)*6)
        labels = [r for r in inspect(data, include_italic=True) if r['text'] == 'a']
        if scale != .12 or any(r['font']['italic'] or r['options'] != 4 or r['scale'] != [4.235294342041016, 4.2272725105285645] for r in labels):
            raise ValueError('Changed native text state')
        native.append(rows)
    # Screen components sort left to right; source/native records run right to
    # left in tbRl. Reverse once before pairing the measurements.
    screens = [list(reversed(s)) for s in screens]
    return dict(referenceBuild=capture['referenceBuild'], zoomPercent=500,
                hashes={n: hashlib.sha256((FOLDER/n).read_bytes()).hexdigest() for n in names},
                screens=screens, native=native,
                screenCentroidDeltasPx=[round(b['centroidX']-a['centroidX'], 6) for a,b in zip(*screens)],
                nativeBaselineDeltasPt=[round((b['logicalX']-a['logicalX'])*.12, 6) for a,b in zip(*native)])


if __name__ == '__main__':
    result = record()
    (FOLDER/'comparison.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result[k] for k in ['screenCentroidDeltasPx', 'nativeBaselineDeltasPt']}))
