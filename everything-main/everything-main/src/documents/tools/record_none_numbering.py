"""Bind native markers and positions to the independent numbering fixture."""
from pathlib import Path
import pypdfium2 as p
import hashlib,json,re
root=Path(__file__).resolve().parents[1]/'tests/fixtures/none-numbering'
pdf=p.PdfDocument(str(root/'native.pdf'));rows=[]
for page_index,page in enumerate(pdf):
 tp=page.get_textpage();text=tp.get_text_range()
 for line in text.splitlines():
  match=re.match(r'^(.*?)\s*(C\d\d\b.*)$',line)
  if match:
   label=match[2];at=text.index(label);assert tp.get_text_range(at,1)=='C'
   x0,y0,x1,y1=tp.get_charbox(at)
   rows.append({'marker':match[1].strip(),'label':label,'page':page_index,'bodyBox':{'x':x0,'top':page.get_height()-y1,'bottom':page.get_height()-y0}})
assert len(rows)==58
(root/'reference.json').write_text(json.dumps({'referenceBuild':'16.0.20326','sourceSha256':hashlib.sha256((root/'control.docx').read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256((root/'native.pdf').read_bytes()).hexdigest(),'rows':rows},indent=2)+'\n')
