"""Record native ribbon shading without deriving expected colors from the app."""
from pathlib import Path
import hashlib,json
from pypdf import PdfReader
from pypdf.generic import ContentStream
import pypdfium2 as pdfium
from PIL import Image
root=Path(__file__).resolve().parents[1]/'tests/fixtures/ribbons'
p=PdfReader(root/'colors-native.pdf');assert len(p.pages)==1
paints=[]
for args,op in ContentStream(p.pages[0].get_contents(),p).operations:
 if op in (b'rg',b'g'):paints.append({'operator':op.decode(),'values':[float(x) for x in args]})
f=pdfium.PdfDocument(str(root/'colors-native.pdf'))
f[0].render(scale=4).to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX).save(root/'colors-native.png')
sha=lambda n:hashlib.sha256((root/n).read_bytes()).hexdigest()
result={'referenceVersion':'16.0.20326','sourceSha256':sha('colors.docx'),'pdfSha256':sha('colors-native.pdf'),'pngSha256':sha('colors-native.png'),'colorOperators':paints}
(root/'colors-reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(paints))
