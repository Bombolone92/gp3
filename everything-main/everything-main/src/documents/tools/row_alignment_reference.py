"""Extract text origins from the independent native row-justification reference."""
from pathlib import Path
from pypdf import PdfReader
import re,json,hashlib
ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'tests/fixtures/table-row-alignment'
r=PdfReader(folder/'native.pdf');result=[]
for page,source in enumerate(r.pages):
 def visit(text,cm,tm,font,size):
  text=text.strip()
  if re.fullmatch(r'T\d+R\d+C\d+',text):result.append(dict(text=text,page=page,x=tm[4],y=float(source.mediabox.height)-tm[5]))
 source.extract_text(visitor_text=visit)
assert len(result)==36
(folder/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','sourceSha256':hashlib.sha256((ROOT/'public/fixtures/table-row-alignment.docx').read_bytes()).hexdigest(),'text':result},indent=2)+'\n',encoding='utf-8')
