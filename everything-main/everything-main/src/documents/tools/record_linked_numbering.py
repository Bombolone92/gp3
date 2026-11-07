"""Bind the reference marker text and page image to original linked-numbering controls."""
from pathlib import Path
import pypdfium2 as p
from PIL import Image
import hashlib,json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/linked-numbering'
cases=json.loads((root/'cases.json').read_text())
refs=[]
for name,pdfname in [('control','native'),('no-backlink','no-backlink-native')]:
 pdf=p.PdfDocument(str(root/(pdfname+'.pdf')));assert len(pdf)==1
 text=pdf[0].get_textpage().get_text_range();rows=[]
 for case in cases:
  line=next(line for line in text.splitlines() if line.rstrip().endswith(case['label']))
  rows.append({**case,'marker':line[:line.index(case['label'])].strip()})
 png=root/(pdfname+'.png');pdf[0].render(scale=4).to_pil().convert('RGB').resize((816,1056),Image.Resampling.BOX).save(png)
 sha=lambda n:hashlib.sha256((root/n).read_bytes()).hexdigest()
 refs.append({'name':name,'native':'16.0.20326','sourceSha256':sha(name+'.docx'),'pdfSha256':sha(pdfname+'.pdf'),'pngSha256':sha(pdfname+'.png'),'rows':rows})
(root/'reference.json').write_text(json.dumps(refs,indent=2)+'\n',encoding='utf-8')
