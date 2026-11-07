"""Record native tile sizes and colors from independent native reference PDFs."""
from pathlib import Path
import hashlib,json,math
import pypdfium2 as pdf
from pypdf import PdfReader
from PIL import Image
root=Path(__file__).resolve().parents[1]/'tests/fixtures/page-picture-background'
result=[]
for case in json.loads((root/'cases.json').read_text()):
 name=case['name'];path=root/(name+'-native.pdf');reader=PdfReader(path)
 patterns=reader.pages[0]['/Resources']['/Pattern'];assert len(patterns)==1
 pattern=next(iter(patterns.values())).get_object();matrix=pattern['/Matrix']
 width=float(pattern['/XStep'])*float(matrix[0])*4/3
 height=float(pattern['/YStep'])*float(matrix[3])*4/3
 document=pdf.PdfDocument(str(path));assert len(document)==2;samples=[]
 for page_index,page in enumerate(document):
  im=page.render(scale=4).to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX)
  for tile_x,tile_y in [(0,0),(2,2),(5,10)]:
   for index in range(12):
    x=math.floor(width*(tile_x+(index%6+.5)/6));y=math.floor(height*(tile_y+(index//6+.5)/2))
    # Native text occupies the middle of the page; these samples stay outside it.
    if y>=95 and y<=140 and x>=115:continue
    samples.append(dict(page=page_index,x=x,y=y,rgb=list(im.getpixel((x,y)))))
 result.append(dict(name=name,referenceBuild='16.0.20326',sourceSha256=hashlib.sha256((root/(name+'.docx')).read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(path.read_bytes()).hexdigest(),width=width,height=height,samples=samples))
(root/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
