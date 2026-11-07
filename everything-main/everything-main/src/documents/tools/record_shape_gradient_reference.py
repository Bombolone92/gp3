"""Extract the reference's axial shading coordinates without using the app renderer."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/shape-gradients'
cases = json.loads((ROOT / 'cases.json').read_text())
page = PdfReader(ROOT / 'native.pdf').pages[0]
patterns = list(page['/Resources']['/Pattern'].values())
assert len(patterns) == len(cases)
results = []
for case, pattern in zip(cases, patterns):
    shading = pattern.get_object()['/Shading']
    assert shading['/ShadingType'] == 2
    function = shading['/Function']
    # The reference emits a mirrored preceding tile. The authored red-green-blue tile
    # occupies the second half of the axial shading's parameter interval.
    assert list(function['/Bounds']) == [.25, .5, .75]
    assert list(function['/Encode']) == [1, 0] * 4
    colors = [list(f.get_object()['/C1']) for f in function['/Functions']]
    assert colors == [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 1, 0]]
    x0, y0, x1, y1 = map(float, shading['/Coords'])
    height = float(page.mediabox.height)
    start = [(x0+x1)/2-case['x'], height-(y0+y1)/2-case['y']]
    end = [x1-case['x'], height-y1-case['y']]
    results.append(dict(name=case['name'], start=start, end=end))
reference = dict(referenceVersion='16.0.20326',
                 sourceSha256=sha256((ROOT / 'control.docx').read_bytes()).hexdigest(),
                 pdfSha256=sha256((ROOT / 'native.pdf').read_bytes()).hexdigest(), cases=results)
(ROOT / 'reference.json').write_text(json.dumps(reference, indent=2)+'\n')
