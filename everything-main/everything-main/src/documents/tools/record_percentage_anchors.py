"""Record image frames from our independently authored reference control exports."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdfium

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/percentage-anchors'
records = []
for name in ('body', 'cell'):
    source = folder / f'{name}.docx'
    pdf = folder / f'{name}-native.pdf'
    pages = []
    with pdfium.PdfDocument(str(pdf)) as document:
        for page in document:
            images = [obj for obj in page.get_objects() if obj.type == 3]
            assert len(images) == 1, (name, len(pages), len(images))
            left, bottom, right, top = images[0].get_bounds()
            pages.append({'x': left, 'y': page.get_height() - top,
                          'width': right-left, 'height': top-bottom})
            page.close()
    records.append({'name': name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                    'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'pages': pages})
(folder / 'reference.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')

stories = []
for name in ('columns', 'header', 'header-exact'):
    source, pdf = folder / f'{name}.docx', folder / f'{name}-native.pdf'
    with pdfium.PdfDocument(str(pdf)) as document:
        assert len(document) == 1
        page = document[0]
        frames = []
        for obj in page.get_objects():
            if obj.type != 3: continue
            left, bottom, right, top = obj.get_bounds()
            frames.append({'x': left, 'y': page.get_height()-top, 'width': right-left, 'height': top-bottom})
        page.close()
    stories.append({'name': name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                    'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'frames': frames})
(folder / 'story-reference.json').write_text(json.dumps(stories, indent=2) + '\n', encoding='utf-8')
