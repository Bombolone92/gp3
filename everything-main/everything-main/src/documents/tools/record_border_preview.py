"""Record native page dimensions and black-text reference for border preview."""
from pathlib import Path
import hashlib,json
import pypdfium2 as pdfium
from PIL import Image
root=Path(__file__).resolve().parents[1]/'tests/fixtures/border-preview'
pdf=pdfium.PdfDocument(str(root/'native.pdf'));assert len(pdf)==2
sha=lambda name:hashlib.sha256((root/name).read_bytes()).hexdigest()
ref={'referenceBuild':'16.0.20326','sourceSha256':sha('control.docx'),'plainSha256':sha('plain.docx'),'pdfSha256':sha('native.pdf'),'pages':[]}
for i,p in enumerate(pdf):
 w,h=round(p.get_width()*4/3),round(p.get_height()*4/3)
 name=f'native-{i+1}.png'
 p.render(scale=4).to_pil().convert('RGB').resize((w,h),Image.Resampling.BOX).save(root/name)
 ref['pages'].append({'width':w,'height':h,'image':name,'sha256':sha(name)})
(root/'reference.json').write_text(json.dumps(ref,indent=2)+'\n',encoding='utf-8')
