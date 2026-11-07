"""Record native selected shapes, including whether the geometry has curves."""
from pathlib import Path
import ctypes,hashlib,json
import pypdfium2 as pdfium
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/diagram-layout-selection'
pdf=pdfium.PdfDocument(folder/'native.pdf');pages=[]
colors={(34,136,68),(128,64,192),(204,68,34),(34,85,204),(204,153,0)}
for page in pdf:
    shapes=[]
    for obj in page.get_objects():
        if obj.type!=pdfium.raw.FPDF_PAGEOBJ_PATH:continue
        rgba=[ctypes.c_uint() for _ in range(4)]
        if not pdfium.raw.FPDFPageObj_GetFillColor(obj.raw,*(ctypes.byref(v) for v in rgba)):continue
        color=tuple(v.value for v in rgba)
        if color[:3] not in colors:continue
        types=[pdfium.raw.FPDFPathSegment_GetType(pdfium.raw.FPDFPath_GetPathSegment(obj.raw,i)) for i in range(pdfium.raw.FPDFPath_CountSegments(obj.raw))]
        x0,y0,x1,y1=obj.get_bounds()
        shapes.append({'color':list(color),'x':x0,'y':page.get_height()-y1,'width':x1-x0,'height':y1-y0,'curved':pdfium.raw.FPDF_SEGMENT_BEZIERTO in types})
    pages.append(shapes)
cases=json.loads((folder/'cases.json').read_text(encoding='utf-8'))
assert len(pages)==len(cases)
for case,shapes in zip(cases,pages):print(case['name'],[(s['color'][:3],s['curved'],round(s['x'],3),round(s['width'],3)) for s in shapes])
reference={'referenceVersion':'16.0.20326','pages':pages,'hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [folder/'control.docx',folder/'native.pdf',folder/'cases.json']}}
(folder/'reference.json').write_text(json.dumps(reference,indent=2)+'\n',encoding='utf-8')
