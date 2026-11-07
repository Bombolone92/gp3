"""Record numeric image-placement references from the independent reference control.

Reads PDF content operators and font names, never embedded font programs.
"""
import argparse, hashlib, json
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('pdf', type=Path)
parser.add_argument('observation', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
record = json.loads(args.observation.read_text(encoding='utf-8-sig'))
assert hashlib.sha256(args.source.read_bytes()).hexdigest() == record['sourceSha256']
assert all(record[key] for key in ['sourceUnchanged', 'savedBefore', 'savedAfter'])
reader = PdfReader(args.pdf)
assert len(reader.pages) == 1
page = reader.pages[0]
markers, matrix = [], None
for operands, operator in ContentStream(page.get_contents(), reader).operations:
    if operator == b'cm':
        matrix = list(map(float, operands))
    elif operator == b'Do':
        image = page['/Resources']['/XObject'][operands[0]].get_object()
        assert image['/Subtype'] == '/Image' and matrix is not None
        width, b, c, height, x, y = matrix
        assert b == c == 0 and abs(width - 1.5) < .001 and abs(height - 7.5) < .001
        markers.append(dict(index=len(markers)+1, xPt=x, widthPt=width, heightPt=height))
        matrix = None
assert len(markers) == 4
record['screenMarkers'] = record['markers']
record['markers'] = markers
record['pdfSha256'] = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
record['method'] += ' Print marker positions read from fresh native PDF image placement matrices; rounded screen observations retained separately. No embedded font programs read.'
args.output.write_text(json.dumps(record, indent=2)+'\n', encoding='utf8')
