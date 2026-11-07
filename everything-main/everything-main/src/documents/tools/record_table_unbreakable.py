"""Record the reference's original AutoFit control borders from native PDF paths."""
from pathlib import Path
import ctypes as c,hashlib,json
import pypdfium2 as p
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/table-unbreakable';result=[]
for pdf in sorted(folder.glob('*.pdf')):
    doc=p.PdfDocument(pdf);assert len(doc)==1;page=doc[0];rects=[]
    for i in range(p.raw.FPDFPage_CountObjects(page)):
        obj=p.raw.FPDFPage_GetObject(page,i)
        if p.raw.FPDFPageObj_GetType(obj)!=p.raw.FPDF_PAGEOBJ_PATH:continue
        mode,stroke=c.c_int(),c.c_int();p.raw.FPDFPath_GetDrawMode(obj,c.byref(mode),c.byref(stroke))
        values=[c.c_uint() for _ in range(4)];p.raw.FPDFPageObj_GetFillColor(obj,*[c.byref(v) for v in values])
        if not mode.value or [v.value for v in values]!=[0,170,0,255]:continue
        b=[c.c_float() for _ in range(4)];assert p.raw.FPDFPageObj_GetBounds(obj,*[c.byref(v) for v in b]);rects.append([v.value for v in b])
    sides=[b for b in rects if b[2]-b[0]<2 and b[3]-b[1]>20];assert len(sides)==2
    centers=sorted((b[0]+b[2])/2 for b in sides)
    source=root/f'public/fixtures/{pdf.stem}.docx'
    result.append(dict(name=pdf.stem,left=centers[0],width=centers[1]-centers[0],sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest()))
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
