from pathlib import Path
import hashlib, json
import pypdfium2 as pdfium
repo = Path(__file__).resolve().parents[1]
root = repo/'tests/fixtures/page-field-caps'
records = []
for fmt in ['lowerRoman', 'upperRoman', 'lowerLetter']:
    name = f'page-field-caps-{fmt}'
    source = repo/'public/fixtures'/f'{name}.docx'
    pdf = root/f'{name}-native.pdf'
    doc = pdfium.PdfDocument(pdf)
    pages = []
    for page in doc:
        text = page.get_textpage()
        lines = [line.strip() for line in text.get_text_range().splitlines() if line.strip().startswith('C')]
        pages.append(lines)
    assert len(pages) == 2 and all(len(lines) == 5 for lines in pages)
    records.append({'fixture': name, 'format': fmt, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'pages': pages})
(root/'reference.json').write_text(json.dumps(records, indent=2)+'\n')
print('Recorded three reference controls, six pages, thirty header rows')
