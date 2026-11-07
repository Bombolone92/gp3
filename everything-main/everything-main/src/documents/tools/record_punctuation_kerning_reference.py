"""Record original reference exports; no renderer output supplies the expectations."""
from pathlib import Path
import hashlib, json
import pypdfium2 as pdfium

repo = Path(__file__).resolve().parents[1]
root = repo/'tests/fixtures/punctuation-kerning'
records = []
for family in ['', 'asian-']:
    geometries = []
    for flag in ['on', 'off', 'omitted']:
        name = f'punctuation-kerning-{family}{flag}'
        source = repo/'public/fixtures'/f'{name}.docx'
        pdf = root/f'{name}-native.pdf'
        doc = pdfium.PdfDocument(pdf)
        chars, lines = [], []
        for page in doc:
            text = page.get_textpage()
            row = []
            for i in range(text.count_chars()):
                c, box = text.get_text_range(i, 1), list(text.get_charbox(i))
                chars.append([c, box])
                if c in '\r\n':
                    if row: lines.append({'text': ''.join(v[0] for v in row), 'terminalX': row[-1][1][0]}); row = []
                else: row.append([c, box])
            if row: lines.append({'text': ''.join(v[0] for v in row), 'terminalX': row[-1][1][0]})
        geometries.append(chars)
        records.append({'fixture': name, 'docxSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'pdfSha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'pages': len(doc), 'lines': lines})
    assert geometries[0] == geometries[1] == geometries[2], f'{family} flag changes reference geometry'
latin = records[0]['lines']
for enabled, disabled in [(0,48),(2,49),(3,50),(8,51)]:
    assert latin[disabled]['terminalX'] - latin[enabled]['terminalX'] > 1, 'Control must demonstrate active kerning'
(root/'reference.json').write_text(json.dumps({'referenceVersion': '16.0.20326', 'cases': records}, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
print('Reference controls: flag-independent geometry; active Latin and punctuation pairs verified')
