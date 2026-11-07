"""Record green table-border centerlines from independent reference PDF controls."""
from pathlib import Path
import ctypes as c,hashlib,json
import pypdfium2 as p
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/header-clearance'
result=[]
for pdf in sorted(folder.glob('*.pdf')):
    doc=p.PdfDocument(pdf);page=doc[len(doc)-1];edges=[]
    for i in range(p.raw.FPDFPage_CountObjects(page)):
        obj=p.raw.FPDFPage_GetObject(page,i)
        if p.raw.FPDFPageObj_GetType(obj)!=p.raw.FPDF_PAGEOBJ_PATH:continue
        mode,stroke=c.c_int(),c.c_int();p.raw.FPDFPath_GetDrawMode(obj,c.byref(mode),c.byref(stroke))
        color=[c.c_uint() for _ in range(4)];p.raw.FPDFPageObj_GetFillColor(obj,*[c.byref(v) for v in color])
        if not mode.value or [v.value for v in color]!=[0,170,0,255]:continue
        bounds=[c.c_float() for _ in range(4)];p.raw.FPDFPageObj_GetBounds(obj,*[c.byref(v) for v in bounds]);left,bottom,right,top=[v.value for v in bounds]
        if right-left>100 and top-bottom<2:edges.append(page.get_height()-(top+bottom)/2)
    assert len(edges)==2,(pdf,edges)
    source=pdf.with_suffix('.docx')
    result.append(dict(name=pdf.stem,pages=len(doc),tableTop=min(edges),tableBottom=max(edges),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest()))
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
