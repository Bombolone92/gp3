"""Extract independent inline picture origins from the installed reference PDF."""
from pathlib import Path
from pypdf import PdfReader
from hashlib import sha256
import json
p=Path(__file__).resolve().parents[1]/'tests/fixtures/nested-table-stories'
pictures=[]
pdf=PdfReader(p/'native.pdf')
for i,page in enumerate(pdf.pages):
 def visit(op,args,cm,tm):
  if op==b'Do':pictures.append({'page':i,'x':cm[4],'y':float(page.mediabox.height)-cm[5]-cm[3],'width':cm[0]})
 page.extract_text(visitor_operand_before=visit)
assert len(pictures)==6 and len(pdf.pages)==3
result={'referenceVersion':'16.0.20326','sourceSha256':sha256((p/'control.docx').read_bytes()).hexdigest(),'pdfSha256':sha256((p/'native.pdf').read_bytes()).hexdigest(),'pages':len(pdf.pages),'pictures':pictures}
(p/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print(pictures)
