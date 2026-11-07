"""Extract independent native text origins, sizes and shape bounds."""
from pathlib import Path
from ctypes import c_uint, c_int, byref
import hashlib
import json
import pypdfium2 as pdf
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/shape-text-transform'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
refs = {}
for name in ['noAutofit', 'spAutoFit']:
    source, native = ROOT/(name+'.docx'), ROOT/(name+'-native.pdf')
    doc, reader = pdf.PdfDocument(native), PdfReader(native)
    assert len(doc) == 16
    pages = []
    for i, page in enumerate(doc):
        boxes, runs = [], []
        for obj in page.get_objects():
            r,g,b,a = c_uint(),c_uint(),c_uint(),c_uint()
            fill,stroke = c_int(),c_int()
            if pdf.raw.FPDFPath_GetDrawMode(obj,byref(fill),byref(stroke)) and fill.value and pdf.raw.FPDFPageObj_GetFillColor(obj,byref(r),byref(g),byref(b),byref(a)) and (r.value,g.value,b.value)==(221,238,255):
                x,y,right,top = obj.get_bounds()
                boxes.append(dict(x=x,y=page.get_height()-top,width=right-x,height=top-y))
        def visit(text, cm, tm, font, size):
            if not text.strip() or text.startswith('Case'): return
            runs.append(dict(text=text,x=tm[4]*cm[0]+tm[5]*cm[2]+cm[4],
                y=page.get_height()-(tm[4]*cm[1]+tm[5]*cm[3]+cm[5]),
                fontSize=size,scaleX=tm[0]*cm[0],scaleY=tm[3]*cm[3]))
        reader.pages[i].extract_text(visitor_text=visit)
        assert len(boxes)==1 and len(runs) in [4,5]
        raster = page.render(scale=2).to_pil().convert('RGB')
        box = boxes[0]
        crop = raster.crop((round(box['x']*2),round(box['y']*2),round((box['x']+box['width'])*2),round((box['y']+box['height'])*2)))
        pages.append(dict(box=box,runs=runs,shapeRgbSha256=hashlib.sha256(crop.tobytes()).hexdigest()))
    # Group coordinates must not double the physical font size or script shift.
    for i in range(8):
        # The reference export emits grouped width-scaled glyphs as non-text PDF artwork.
        # Their visual evidence remains in the PDF and the pinned RGB crop.
        grouped = {r['text']:r for r in pages[i+8]['runs']}
        for a in pages[i]['runs']:
            if a['text'] not in grouped:
                assert i in [6,7] and a['text']=='Test'
                continue
            b = grouped[a['text']]
            for key in ['x','y','fontSize','scaleX','scaleY']: assert abs(a[key]-b[key])<.02
    refs[name]=dict(sourceSha256=sha(source),pdfSha256=sha(native),pages=pages)
(ROOT/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',variants=refs),indent=2)+'\n')
print('Verified and extracted 32 native text-transform control pages')
