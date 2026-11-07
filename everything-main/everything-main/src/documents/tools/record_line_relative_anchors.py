"""Record image bounds from the independently exported native reference PDF."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdf

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/line-relative-anchors'
doc=pdf.PdfDocument(folder/'native.pdf')
bounds=[]
for page in doc:
    images=[]
    for obj in page.get_objects(max_depth=12):
        if obj.type==pdf.raw.FPDF_PAGEOBJ_IMAGE:
            left,bottom,right,top=obj.get_bounds()
            images.append([left,page.get_height()-top,right-left,top-bottom])
    assert len(images)==1,images
    bounds.append(images[0])
    page.close()
assert len(bounds)==8
result={'referenceVersion':'16.0.20326',
        'sourceSha256':hashlib.sha256((folder/'control.docx').read_bytes()).hexdigest(),
        'pdfSha256':hashlib.sha256((folder/'native.pdf').read_bytes()).hexdigest(),
        'bounds':bounds}
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
