"""Read completed native reference PDF colors independently of the renderer."""
from pathlib import Path
from hashlib import sha256
import json
import pypdfium2 as pdf
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]/'tests/fixtures/picture-3d-textures'
cases=json.loads((root/'cases.json').read_text())
reader=PdfReader(root/'native.pdf');doc=pdf.PdfDocument(root/'native.pdf')
assert len(reader.pages)==len(cases)==len(doc)
for i,case in enumerate(cases):
 assert case['name'] in reader.pages[i].extract_text()
 case['pdfImageFilters']=[str(obj.get_object().get('/Filter')) for obj in reader.pages[i]['/Resources'].get('/XObject',{}).values() if obj.get_object().get('/Subtype')=='/Image']
 image=doc[i].render(scale=4).to_pil().convert('RGB')
 case['samples']=[]
 for u in [.2,.3,.4,.5,.6,.7,.8]:
  for v in [.2,.3,.4,.5,.6,.7,.8]:
   x=case['xPt']+case['widthPt']*u;y=case['yPt']+case['heightPt']*v
   case['samples'].append({'xPt':x,'yPt':y,'rgb':list(image.getpixel((round(x*4),round(y*4))))})
data={'referenceVersion':'16.0.20326','sourceSha256':sha256((root/'control.docx').read_bytes()).hexdigest(),
      'pdfSha256':sha256((root/'native.pdf').read_bytes()).hexdigest(),'nativeRasterScale':4,'cases':cases}
(root/'reference.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
