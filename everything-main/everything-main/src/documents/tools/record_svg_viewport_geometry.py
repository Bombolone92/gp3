"""Extract reference PDF geometry directly; no app output is used as a reference."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader
from pypdf.generic import ContentStream
import pypdfium2

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/svg-viewport-geometry'

def record():
    result = []
    for case in json.loads((OUT / 'cases.json').read_text()):
        name = case['name']; source = OUT / f'{name}.docx'; capture = OUT / f'{name}-native.pdf'
        pdf = PdfReader(capture); forms = []
        for key, value in pdf.pages[0]['/Resources']['/XObject'].items():
            form = value.get_object()
            if form.get('/Subtype') != '/Form': continue
            rectangles = [list(map(float, operands)) for operands, op in ContentStream(form, pdf).operations if op == b're']
            forms.append(dict(name=str(key), bounds=list(map(float, form['/BBox'])),
                              matrix=list(map(float, form['/Matrix'])), rectangles=rectangles))
        raster = pypdfium2.PdfDocument(capture)[0].render(scale=4/3).to_pil().convert('RGB')
        pixels = list(raster.getdata())
        painted = {}
        for color in [(64,128,192), (208,128,64)]:
            bands = []
            for y in range(raster.height):
                xs = [x for x, value in enumerate(pixels[y*raster.width:(y+1)*raster.width]) if value == color]
                if not xs: continue
                if bands and y == bands[-1][3] + 1:
                    bands[-1] = [min(bands[-1][0],min(xs)), bands[-1][1], max(bands[-1][2],max(xs)), y]
                else: bands.append([min(xs),y,max(xs),y])
            assert len(bands) == 4, (name, color, bands)
            painted[''.join(f'{c:02x}' for c in color)] = bands
        result.append(dict(**case, referenceVersion='16.0.20326', pages=len(pdf.pages), inkBounds=painted,
                           sourceSha256=sha256(source.read_bytes()).hexdigest(),
                           pdfSha256=sha256(capture.read_bytes()).hexdigest(), forms=forms))
        print(name, [(f['bounds'], f['rectangles'][:2]) for f in forms])
    (OUT / 'reference.json').write_text(json.dumps(result, indent=2) + '\n')

if __name__ == '__main__':
    record()
