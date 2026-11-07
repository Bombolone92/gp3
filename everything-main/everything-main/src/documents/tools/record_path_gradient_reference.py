"""Record native reference circular shading geometry; no app renderer is imported."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader
ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/path-gradients'
cases = json.loads((ROOT / 'cases.json').read_text())
reader = PdfReader(ROOT / 'native.pdf')
assert len(reader.pages) == 2
patterns = [list(p['/Resources']['/Pattern'].values()) for p in reader.pages]
assert sum(map(len,patterns)) == len(cases)
results = []
for i, case in enumerate(cases):
    page = reader.pages[case['page']]
    value = patterns[case['page']][i % 12]
    pattern = value.get_object()
    shading = pattern['/Shading']
    assert shading['/ShadingType'] == 3
    assert list(shading['/Coords']) == [0, 0, 0, 0, 0, 1]
    matrix = list(map(float, pattern['/Matrix']))
    assert matrix[1:3] == [0, 0] and matrix[0] == matrix[3]
    function = shading['/Function'].get_object()
    functions = [dict(f.get_object()) for f in function.get('/Functions',[])]
    results.append(dict(name=case['name'],
        center=[matrix[4]-case['x'], float(page.mediabox.height)-matrix[5]-case['y']],
        radius=matrix[0], samples=list(function.get_data()) if function['/FunctionType'] == 0 else None, bounds=list(map(float,function.get('/Bounds',[]))),
        encode=list(map(float,function['/Encode'])),
        functions=[dict(c0=list(map(float,f['/C0'])),c1=list(map(float,f['/C1'])), exponent=float(f['/N'])) for f in functions]))
import pypdfium2 as pdfium
pdf = pdfium.PdfDocument(ROOT/'native.pdf')
rasters = [p.render(scale=4).to_pil().convert('RGB') for p in pdf]
for case, result in zip(cases,results):
    result['pixels'] = []
    for x in [.2,.5,.8]:
        for y in [.2,.5,.8]:
            px=int((case['x']+case['width']*x)*4)
            py=int((case['y']+case['height']*y)*4)
            result['pixels'].append(dict(x=px,y=py,rgb=list(rasters[case['page']].getpixel((px,py)))))
reference = dict(referenceVersion='16.0.20326',
    sourceSha256=sha256((ROOT/'control.docx').read_bytes()).hexdigest(),
    pdfSha256=sha256((ROOT/'native.pdf').read_bytes()).hexdigest(),
    casesSha256=sha256((ROOT/'cases.json').read_bytes()).hexdigest(), cases=results)
(ROOT/'reference.json').write_text(json.dumps(reference,indent=2)+'\n')
