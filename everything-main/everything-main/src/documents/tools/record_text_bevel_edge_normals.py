"""Measure synthetic-bold expansion at collinear original glyph points.

Uses the existing original-font generator and private Windows GDI registration.
No installed font outlines are read or exported. Only the 1000-UPEM results
are used: scaling these integer coordinates to 2048 introduces noncollinearity.
Usage: python tools/record_text_bevel_edge_normals.py OUTPUT.json
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import math
import platform
import sys
from record_text_bevel_geometry import create_controls, record

vectors = [(238, 400), (32, 50), (30, 50), (31, 49), (426, 669)]
shapes = [
    [[(50, 0, 1), (50 + dx, dy, 1), (50 + 2 * dx, 2 * dy, 1),
      (350 + 2 * dx, 2 * dy, 1), (350, 0, 1)]]
    for dx, dy in vectors
]
with TemporaryDirectory(prefix='text-bevel-edge-normals-') as temporary:
    directory = Path(temporary)
    create_controls(directory, shapes)
    references = record(directory)[:5]

for reference, (dx, dy) in zip(references, vectors):
    reference['name'] = f'collinear midpoint, edge {dx},{dy}'
    point = reference['input'][0][-2]
    expected = reference['expected'][0][-2]
    assert point == dict(x=50 + dx, y=-dy, onCurve=True)
    # Existing expansion separates em contraction, translation and the normal.
    observed = [(expected['x'] - point['x'] * .981) / 10 - 1,
                (expected['y'] - point['y'] * .981) / 9.5 + 1]
    exact = [-dy / math.hypot(dx, dy), -dx / math.hypot(dx, dy)]
    reference['inferredNormal'] = observed
    reference['exactUnitNormal'] = exact
    reference['maximumComponentDifference'] = max(abs(a - b) for a, b in zip(observed, exact))

result = dict(api='GetGlyphOutlineW(GGO_NATIVE | GGO_UNHINTED)',
              windowsVersion=platform.version(), records=references,
              limitation='Inferred under the existing contraction/translation model. '
              'GDI coordinates are diagnostic evidence, not an independent native raster gate.')
Path(sys.argv[1]).write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps([{key: item[key] for key in ['name', 'inferredNormal', 'exactUnitNormal',
                                           'maximumComponentDifference']}
                  for item in references], indent=2))
