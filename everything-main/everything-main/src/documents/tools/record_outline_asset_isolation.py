"""Measure isolated stroke experiments against the existing native observations."""
from pathlib import Path
from hashlib import sha256
from PIL import Image
import numpy as np
import json
import math
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
holdouts, curves = map(Path, sys.argv[1:3])
report = dict(baseline=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(),
              scope='Diagnostic JPEG-reference error, not exact antialiasing or opacity conformance.',
              comparisons=[], captures=[], retainedRegions=0, improvedRegions=0)
digest = lambda p: sha256(p.read_bytes()).hexdigest()
pixels = lambda p: np.asarray(Image.open(p).convert('RGB'), dtype=float)
for group, directory in [('outline-stroke-holdouts', holdouts), ('outline-curve-display', curves)]:
    fixtures = root / 'tests/fixtures' / group
    reference = json.loads((fixtures / 'reference.json').read_text())
    captures = json.loads((directory / 'results.json').read_text())
    assert all(not c['errors'] and not c['readOnly'] and c['pages'] == 1 for c in captures)
    for c in captures:
        png = directory / f"{c['name']}-{c['mode']}-{round(c['zoom']*100)}.png"
        report['captures'].append(dict(group=group, **c, pngSha256=digest(png)))
    for observation in reference['observations']:
        name, zoom = observation['fixture'], observation['zoom']
        assert digest(fixtures / observation['crop']) == observation['cropSha256']
        source = reference['sources'][name]
        assert digest(fixtures / (name + '.docx')) == source.get('sha256', source.get('fixtureSha256'))
        native = pixels(fixtures / observation['crop'])
        baseline = pixels(directory / f'{name}-baseline-{zoom}.png')
        candidate = pixels(directory / f'{name}-isolated-{zoom}.png')
        if 'regions' in observation:
            regions = observation['regions']
        else:
            cases = json.loads((fixtures / ('cases.json' if name == 'control' else 'phase-boundaries-cases.json')).read_text())
            scale = zoom / 100
            regions = [[math.floor(c['xEmu']/9525*scale)-3, math.floor(c['yEmu']/9525*scale)-3,
                        round(64*scale)+7, round(40*scale)+7] for c in cases]
        results = []
        for index, (x, y, w, h) in enumerate(regions):
            region = np.s_[y:y+h, x:x+w, :]
            assert native[region].shape == candidate[region].shape == (h, w, 3)
            old = float(np.abs(baseline[region]-native[region]).mean())
            new = float(np.abs(candidate[region]-native[region]).mean())
            changed = int(np.any(baseline[region] != candidate[region], axis=2).sum())
            retained = name == 'rotation-alpha' or (name in ['dash-compound', 'alpha-only'] and index >= 4)
            if retained:
                assert changed == 0, (name, zoom, index+1, changed)
                report['retainedRegions'] += 1
            else:
                assert new < old, (name, zoom, index+1, old, new)
                report['improvedRegions'] += 1
            results.append(dict(id=index+1, baselineMAE=old, candidateMAE=new, changedPixels=changed, retained=retained))
        report['comparisons'].append(dict(group=group, fixture=name, zoom=zoom, regions=results))
assert len(report['captures']) == 24
assert report['retainedRegions'] == 32 and report['improvedRegions'] == 80
report['plannerPixelChanges'] = []
for zoom in [100, 200]:
    a = pixels(holdouts / f'corpus-baseline-{zoom}.png')
    b = pixels(holdouts / f'corpus-isolated-{zoom}.png')
    changed = np.any(a != b, axis=2)
    y, x = np.where(changed)
    scale = zoom // 100
    report['plannerPixelChanges'].append(dict(zoom=zoom, changedPixels=int(changed.sum()),
        changedBounds=[int(x.min()), int(y.min()), int(x.max()), int(y.max())],
        tableInteriorRegionCssPixels=[5,220,805,770],
        tableInteriorChangedPixels=int(changed[220*scale:990*scale,5*scale:810*scale].sum()),
        belowHeadingChangedPixels=int(changed[220*scale:].sum())))
destination = root / 'tests/fixtures/measurements/outline-asset-isolation.json'
destination.write_text(json.dumps(report, indent=2)+'\n')
print('24 error-free captures; 32 retained regions unchanged; all 80 eligible regions improve against native JPEG observations.')
