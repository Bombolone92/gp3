"""Measure original table cell fill rectangles in the reference PDF."""
from pathlib import Path
import hashlib,json,sys
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/table-overflow-width'
suffix='-modern' if '--modern' in sys.argv else ''
pdf=PdfReader(folder/f'native{suffix}.pdf');assert len(pdf.pages)==12
cases=[]
for i,page in enumerate(pdf.pages):
    colors={};color=None;rect=None
    for args,op in page.get_contents().operations:
        if op==b'rg':color=tuple(round(float(v)*255) for v in args)
        elif op==b're':rect=[float(v) for v in args]
        elif op in [b'f',b'f*'] and color in [(51,102,153),(204,102,51)] and rect and abs(rect[3]-30)<.1:
            colors[color]=dict(left=rect[0],width=rect[2],top=float(page.mediabox.height)-rect[1]-rect[3])
    assert len(colors)==2,(i,colors)
    cases.append([colors[c] for c in [(51,102,153),(204,102,51)]])
result=dict(sourceSha256=hashlib.sha256((ROOT/f'public/fixtures/table-overflow-width{suffix}.docx').read_bytes()).hexdigest(),pdfSha256=hashlib.sha256((folder/f'native{suffix}.pdf').read_bytes()).hexdigest(),cases=cases)
(folder/f'reference{suffix}.json').write_text(json.dumps(result,indent=2)+'\n')
for i,row in enumerate(cases):print(i+1,row)
