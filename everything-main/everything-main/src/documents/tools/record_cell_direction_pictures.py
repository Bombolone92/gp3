"""Record native picture/link bounds separately from rotated text matrices."""
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
import hashlib, json

folder = Path(__file__).resolve().parents[1]/'tests/fixtures/cell-text-direction'
cases = []
for name in ['links', 'links-inline', 'links-center', 'links-bottom', 'links-tall']:
    path = folder/(name+'-native.pdf')
    reader = PdfReader(path); native = pdfium.PdfDocument(path)
    if len(reader.pages) != 1: raise ValueError('Expected one control page')
    page = reader.pages[0]; height = float(page.mediabox.height)
    pictures = []
    for obj in native[0].get_objects():
        if obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE:
            left, bottom, right, top = obj.get_bounds()
            pictures.append(dict(x=left, y=height-top, width=right-left, height=top-bottom))
    links = []
    for entry in page.get('/Annots', []):
        annotation = entry.get_object(); target = annotation.get('/A', {}).get('/URI')
        if not target: continue
        left, bottom, right, top = map(float, annotation['/Rect'])
        links.append(dict(target=str(target), x=left, y=height-top, width=right-left, height=top-bottom))
    cases.append(dict(name=name, pictures=sorted(pictures, key=lambda p:p['x']), links=links,
        hashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [folder/(name+'.docx'), path]}))
    native.close()
(folder/'pictures-reference.json').write_text(json.dumps(dict(units='points, top-left page coordinates', cases=cases), indent=2)+'\n')
