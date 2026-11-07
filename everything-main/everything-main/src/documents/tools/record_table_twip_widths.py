"""Record native reference widths and PDF text for original table rounding controls."""
from pathlib import Path
import hashlib
import json
import pypdfium2 as pdf

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/table-twip-widths'
for stem, pdf_name, width_name, reference_name in [('control','native.pdf','native-widths.json','reference.json'),('percentages','percentages-native.pdf','percentages-widths.json','percentages-reference.json')]:
    widths = json.loads((folder / width_name).read_text(encoding='utf-8-sig'))
    document = pdf.PdfDocument(folder / pdf_name)
    assert len(widths) == len(document)
    cases = []
    for index, native in enumerate(widths):
        left = 36
        cells = []
        text = document[index].get_textpage()
        for cell in native:
            width = round(cell['widthTwips'])
            # All controls start the table after a 12pt label at y=36pt.
            # The independently labelled Tail paragraph is outside the cells.
            content = text.get_text_bounded(left+.005, 720, left+width/20-.005, 744).replace('Tail', '')
            lines = [line.strip() for line in content.splitlines() if line.strip()]
            assert lines, (stem, index, left)
            cells.append(dict(widthTwips=width, lines=lines))
            left += width / 20
        cases.append(dict(page=index, cells=cells))
    sha = lambda name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
    (folder / reference_name).write_text(json.dumps(dict(sourceSha256=sha(stem+'.docx'), pdfSha256=sha(pdf_name), referenceVersion='16.0.20326', cases=cases), indent=2)+'\n')
