"""Extract the native reference's actual shape and body bounds, independently of the renderer."""
from pathlib import Path
from ctypes import c_uint, byref
import hashlib
import json
import pypdfium2 as pdf
from pypdf import PdfReader

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/shape-autofit'
sha = lambda data: hashlib.sha256(data).hexdigest()
records = {}
for name in [m+s for s in ['', '-mode15'] for m in ['noAutofit', 'omitted', 'spAutoFit']]:
    source, native = root/(name+'.docx'), root/(name+'-native.pdf')
    doc, text = pdf.PdfDocument(native), PdfReader(native)
    pages = []
    for index, page in enumerate(doc):
        boxes = []
        for obj in page.get_objects():
            r,g,b,a = c_uint(),c_uint(),c_uint(),c_uint()
            if pdf.raw.FPDFPageObj_GetFillColor(obj,byref(r),byref(g),byref(b),byref(a)) and (r.value,g.value,b.value)==(221,238,255):
                x,y,right,top = obj.get_bounds()
                boxes.append(dict(x=x,y=page.get_height()-top,width=right-x,height=top-y))
        baselines = {}
        def visit(t,c,m,f,s):
            if t.strip() in ['Before', 'After']:
                baselines[t.strip()] = page.get_height()-(m[4]*c[1]+m[5]*c[3]+c[5])
        text.pages[index].extract_text(visitor_text=visit)
        assert len(boxes)==1, (name,index,boxes)
        pages.append(dict(box=boxes[0],baselines=baselines,
                          rasterSha256=sha(page.render(scale=2).to_pil().convert('RGB').tobytes())))
    records[name] = dict(sourceSha256=sha(source.read_bytes()),pdfSha256=sha(native.read_bytes()),pages=pages)
for suffix in ['', '-mode15']:
    assert len(records['spAutoFit'+suffix]['pages'])==12
    for i, page in enumerate(records['spAutoFit'+suffix]['pages']):
        assert abs(page['box']['height']-75)<.1, (i,page)
        no = records['noAutofit'+suffix]['pages'][i]
        assert no['rasterSha256']==records['omitted'+suffix]['pages'][i]['rasterSha256']
        # The body after the inline drawing follows the fitted frame; scaling only
        # the bitmap or unclipping text cannot reproduce this displacement.
        assert abs((page['baselines']['After']-no['baselines']['After'])-(75-no['box']['height']))<.1
(root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',scale=2,variants=records),indent=2)+'\n')
print('PASS 72 native pages: autofit is 75pt; body displacement follows fitted height; omission equals noAutofit')
