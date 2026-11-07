"""Extract the picture-row height from the existing independent reference PDF."""
from pathlib import Path
import hashlib,json
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/hidden-cell-mark'
reference=json.loads((folder/'native-spacing.json').read_text())
for path,key in [(ROOT/'public/fixtures/hidden-cell-mark.docx','sourceSha256'),(folder/'native-spacing.pdf','pdfSha256')]:
    assert hashlib.sha256(path.read_bytes()).hexdigest()==reference[key]
page=PdfReader(folder/'native-spacing.pdf').pages[0]
# The reference PDF has repeated rectangular clipping paths for cells. Deduplicate the
# 144pt-wide first-column rectangles, ordered from page top to bottom.
rectangles=sorted({tuple(float(v) for v in args) for args,op in page.get_contents().operations
                   if op==b're' and abs(float(args[0])-72)<.1 and abs(float(args[2])-144)<.1},key=lambda r:-(r[1]+r[3]))
assert len(rectangles)==9 # the final first-column cell spans two rows
reference['pictureRowHeight']=rectangles[6][3]
(folder/'native-spacing.json').write_text(json.dumps(reference,indent=2)+'\n')
