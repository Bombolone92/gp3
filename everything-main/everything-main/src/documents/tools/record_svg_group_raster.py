"""Record native SVG raster groups without consulting the application renderer."""
from pathlib import Path
from hashlib import sha256
import json
from pypdf import PdfReader
from pypdf.generic import ContentStream

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/svg-group-raster'
source = root / 'public/fixtures/svg-group-raster.docx'
reference = folder / 'reference.pdf'
pdf = PdfReader(reference)

def objects(resources):
    result = {}
    for name, ref in resources.get('/XObject', {}).items():
        obj = ref.get_object()
        record = {'type': str(obj['/Subtype'])}
        if obj['/Subtype'] == '/Image':
            record.update(width=int(obj['/Width']), height=int(obj['/Height']),
                          softMask='/SMask' in obj)
        elif obj['/Subtype'] == '/Form':
            record.update(bounds=list(map(float, obj['/BBox'])),
                          matrix=list(map(float, obj.get('/Matrix', [1, 0, 0, 1, 0, 0]))),
                          objects=objects(obj.get('/Resources', {})))
            record['placements'] = [
                {'op': op.decode(), 'args': [str(x) if op == b'Do' else float(x) for x in args]}
                for args, op in ContentStream(obj, pdf).operations if op in [b'cm', b'Do']]
        result[str(name)] = record
    return result

data = {'referenceBuild': '16.0.20326', 'pageCount': len(pdf.pages),
        'hashes': {p.relative_to(root).as_posix(): sha256(p.read_bytes()).hexdigest() for p in [source, reference]},
        'pages': [objects(page['/Resources']) for page in pdf.pages]}
(folder / 'reference.json').write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
