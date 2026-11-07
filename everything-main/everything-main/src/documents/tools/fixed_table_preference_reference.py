"""Measure colored cell rectangles in independently exported reference PDF."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/fixed-table-preference'
pdf=PdfReader(folder/'native.pdf');assert len(pdf.pages)==1
page=pdf.pages[0];color=None;rect=None;cells=[]
for args,op in page.get_contents().operations:
    if op==b'rg':color=tuple(round(float(v)*255) for v in args)
    elif op==b're':rect=[float(v) for v in args]
    elif op in [b'f',b'f*'] and color in [(51,102,153),(204,102,51),(102,153,51)] and rect and abs(rect[3]-24)<.1:
        cells.append(dict(left=rect[0],width=rect[2],top=float(page.mediabox.height)-rect[1]-rect[3],height=rect[3],color=color))
cells.sort(key=lambda c:(c['top'],c['left']))
assert len(cells)==44,len(cells)
result=dict(sourceSha256=hashlib.sha256((root/'public/fixtures/fixed-table-preference.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),cells=cells)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
for cell in cells:print(cell)
