from pathlib import Path
import pypdfium2 as pdf
import json,hashlib
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/inactive-simple-position';d=pdf.PdfDocument(folder/'native.pdf');cases=[]
for i,p in enumerate(d):
 p.render(scale=4/3).to_pil().save(folder/f'native-page{i+1}.png')
 images=[]
 for o in p.get_objects(max_depth=12):
  if o.type==pdf.raw.FPDF_PAGEOBJ_IMAGE:
   l,b,r,t=o.get_bounds();images.append([l,p.get_height()-t,r-l,t-b])
 cases.append({'images':images});print(i,images)
ref={'cases':{'modern':cases},'hashes':{name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in ['control.docx','native.pdf']},'referenceVersion':'16.0.20326'}
(folder/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
