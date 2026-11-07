"""Sample original reference PDF form in isolation; never modify the native capture."""
from pathlib import Path
from io import BytesIO
from hashlib import sha256
import json
import pypdfium2 as pdf
from pypdf import PdfReader,PdfWriter
from PIL import Image
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
root=Path(__file__).resolve().parents[1]/'tests/fixtures/svg-backdrop-compositing'
reader=PdfReader(root/'native.pdf')
form=next(iter(reader.pages[0]['/Resources']['/XObject'].values())).get_object()
bbox=list(map(float,form['/BBox']));m=list(map(float,form.get('/Matrix',[1,0,0,1,0,0])))
assert bbox[:2]==[0,0] and m[1]==0 and m[2]==0 and m[4]==0 and m[5]==0
# Normalize only the captured form's placement, retaining all its native
# operators, colors, alpha states and nested resources without reconstruction.
w=PdfWriter();page=w.add_blank_page(width=600,height=450)
page[NameObject('/Resources')]=DictionaryObject({NameObject('/XObject'):DictionaryObject({NameObject('/Native'):w._add_object(form.clone(w))})})
stream=DecodedStreamObject();stream.set_data(f'q {600/(bbox[2]*m[0])} 0 0 {450/(bbox[3]*m[3])} 0 0 cm /Native Do Q'.encode());page[NameObject('/Contents')]=w._add_object(stream)
b=BytesIO();w.write(b)
with pdf.PdfDocument(b.getvalue()) as doc:
 image=doc[0].render(scale=2).to_pil().convert('RGB')
 samples=[]
 for case in json.loads((root/'cases.json').read_text()):
  x,y=case['column']*300+150,case['row']*100+50
  color=image.getpixel((x,y));assert all(image.getpixel((x+dx,y+dy))==color for dx,dy in [(-5,0),(5,0),(0,-5),(0,5)])
  samples.append(list(color))
gdi=Image.open(root/'gdi.png').convert('RGB')
gdi_colors=[list(gdi.getpixel((c['column']*300+150,c['row']*100+50))) for c in json.loads((root/'cases.json').read_text())]
record={'sourceSha256':sha256((root/'control.docx').read_bytes()).hexdigest(),'casesSha256':sha256((root/'cases.json').read_bytes()).hexdigest(),'pdfSha256':sha256((root/'native.pdf').read_bytes()).hexdigest(),'referenceBuild':'16.0.20326','formBounds':bbox,'formMatrix':m,'pdfiumColors':samples,'colors':gdi_colors,'nativeSha256':sha256((root/'native.emf').read_bytes()).hexdigest(),'captureSha256':sha256((root/'capture.emf').read_bytes()).hexdigest(),'gdiSha256':sha256((root/'gdi.png').read_bytes()).hexdigest()}
(root/'native-colors.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
print('Recorded',len(samples),'PDFium and GDI+ samples')
