"""Measure independently captured phase holdouts and source-order controls."""
from pathlib import Path
from PIL import Image
import hashlib, json, sys
import numpy as np

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/border-phase'
work = Path(sys.argv[1])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
original = json.loads((folder / 'reference.json').read_text())
for name in ['holdout', 'reordered']:
    source = folder / f'{name}.docx'
    assert source.read_bytes() == (work / f'border-phase-{name}-native.docx').read_bytes()
    cases_path = folder / f'{name}-cases.json'
    cases = json.loads(cases_path.read_text())
    observations = []
    for base in original['observations']:
        zoom, origin, size = base['zoom'], base['origin'], base['size']
        capture = work / f'border-phase-{name}-native-{zoom}.jpg'
        image = Image.open(capture)
        assert image.format == 'JPEG' and image.size == (1280, 752)
        crop = image.crop((*origin, origin[0]+size[0], origin[1]+size[1]))
        crop_path = folder / f'native-{name}-{zoom}.png'
        crop.save(crop_path)
        native = np.array(crop.convert('RGB'))
        app = np.array(Image.open(work / f'border-phase-{name}-baseline/app-{zoom}.png').convert('RGB'))
        comparisons = []
        for case, region, control in zip(cases, base['regions'], base['comparisons']):
            x, y, w, h = region
            def bounds(a):
                pixels = a[y:y+h, x:x+w]
                assert pixels.shape[:2] == (h, w)
                assert np.max(pixels.max(axis=2).astype(int)-pixels.min(axis=2)) <= 2
                yy, xx = np.where(pixels.max(axis=2) < original['threshold'])
                assert len(xx) > 0
                return [int(xx.min()+x), int(yy.min()+y), int(xx.max()+x+1), int(yy.max()+y+1)]
            n, b = bounds(native), bounds(app)
            comparisons.append(dict(id=case['id'], native=n, baseline=b, equal=n==b,
                                    originalNative=control['native']))
        observations.append(dict(zoom=zoom, origin=origin, size=size, crop=crop_path.name,
                                 cropSha256=sha(crop_path), captureSha256=sha(capture),
                                 regions=base['regions'], comparisons=comparisons))
    ref = dict(sourceSha256=sha(source), casesSha256=sha(cases_path),
               threshold=original['threshold'], observations=observations)
    (folder / f'native-{name}-reference.json').write_text(json.dumps(ref, indent=2)+'\n')
    print(name, 'viewer mismatches:', sum(not c['equal'] for o in observations for c in o['comparisons']),
          '; native bounds different from original:', sum(c['native'] != c['originalNative'] for o in observations for c in o['comparisons']))
