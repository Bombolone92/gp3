from pathlib import Path
from ctypes import c_uint,c_int,byref
import hashlib,json,pypdfium2 as P
root=Path(__file__).resolve().parents[1]/'tests/fixtures/retained-textbox-controls';d=P.PdfDocument(root/'native.pdf');u=P.PdfDocument(root/'unwrapped-native.pdf');pages=[]
for i,page in enumerate(d):
 boxes=[]
 for obj in page.get_objects():
  rgba=[c_uint() for _ in range(4)];fill,stroke=c_int(),c_int()
  if P.raw.FPDFPath_GetDrawMode(obj,byref(fill),byref(stroke)) and fill.value and P.raw.FPDFPageObj_GetFillColor(obj,*[byref(v) for v in rgba]) and [v.value for v in rgba][:3]==[221,238,255]:
   l,b,r,t=obj.get_bounds();boxes.append([l,page.get_height()-t,r-l,t-b])
 assert len(boxes)==1,boxes
 assert page.render(scale=4/3).to_pil().convert('RGB').tobytes()==u[i].render(scale=4/3).to_pil().convert('RGB').tobytes()
 page.render(scale=4/3).to_pil().save(root/f'native-page{i+1}.png');pages.append({'box':boxes[0]})
assert len(pages)==6
ref={'referenceVersion':'16.0.20326','pages':pages,'hashes':{n:hashlib.sha256((root/n).read_bytes()).hexdigest() for n in ['control.docx','native.pdf','unwrapped.docx','unwrapped-native.pdf']}}
(root/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
