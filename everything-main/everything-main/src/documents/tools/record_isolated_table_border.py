"""Read native reference vector ink independently of engine table geometry."""
from pathlib import Path
import ctypes
import hashlib
import json
import pypdfium2 as pdfium

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/isolated-table-border'
source,pdf=folder/'isolated-table-border.docx',folder/'native.pdf'
cases=json.loads((folder/'cases.json').read_text())
document=pdfium.PdfDocument(pdf)
assert len(document)==len(cases)
for index,page in enumerate(document):
    boxes=[]
    for obj in page.get_objects():
        if obj.type!=2:continue
        channels=[ctypes.c_uint() for _ in range(4)]
        if not pdfium.raw.FPDFPageObj_GetFillColor(obj.raw,*[ctypes.byref(c) for c in channels]):continue
        if any(abs(c.value-v)>1 for c,v in zip(channels,[32,170,96,255])):continue
        x0,y0,x1,y1=obj.get_bounds()
        boxes.append([x0,page.get_height()-y1,x1-x0,y1-y0])
    assert len(boxes)>=2
    cases[index]['rectangles']=boxes
    print(index+1,boxes)
result={'referenceVersion':'16.0.20326','units':'points from page top-left',
        'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'cases':cases}
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
