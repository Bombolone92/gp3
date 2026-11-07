"""Record native marker positions for the independent Selawik face control."""
from pathlib import Path
from pypdf import PdfReader
from hashlib import sha256
import json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/selawik-face'
pictures=[]
for i,page in enumerate(PdfReader(folder/'native.pdf').pages):
 def visit(op,args,cm,tm):
  if op==b'Do':pictures.append(dict(page=i,x=cm[4],width=cm[0]))
 page.extract_text(visitor_operand_before=visit)
assert len(pictures)==8
result=dict(referenceVersion='16.0.20326',sourceSha256=sha256((folder/'control.docx').read_bytes()).hexdigest(),pdfSha256=sha256((folder/'native.pdf').read_bytes()).hexdigest(),pictures=pictures)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
