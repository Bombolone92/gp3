"""Extract independent reference positions; does not import application layout code."""
from pathlib import Path
from pypdf import PdfReader
import hashlib, json, re
root = Path(__file__).resolve().parents[1]
folder = root/'tests/fixtures/oversized-glyph'
source = root/'public/fixtures/oversized-glyph.docx'
pdf = folder/'native.pdf'
pages = []
clips = []
for page in PdfReader(pdf).pages:
    items = []
    def visit(text, cm, tm, font, size):
        if text.strip():
            items.append(dict(text=text.strip(), x=tm[4], y=float(page.mediabox.height)-tm[5], size=size))
    page.extract_text(visitor_text=visit)
    pages.append(items)
    rectangles = re.findall(r'([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s+W\* n',page.get_contents().get_data().decode('latin1'))
    clips.append([list(map(float,r)) for r in rectangles if abs(float(r[0])-144)<.1])
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',pages=pages,cellClips=clips),indent=2)+'\n')
print(json.dumps(pages,indent=2))
