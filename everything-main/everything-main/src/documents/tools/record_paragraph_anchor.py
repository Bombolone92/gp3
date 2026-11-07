"""Read original reference PDF image matrices, independently of app layout."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/paragraph-anchor-spacing'
source=root/'public/fixtures/paragraph-anchor-spacing.docx';pdf=folder/'native.pdf';bounds=[]
for page in PdfReader(pdf).pages:
 images=[]
 def operand(op,args,cm,tm):
  if op==b'Do':
   assert cm[1]==cm[2]==0
   images.append([cm[4],float(page.mediabox.height)-cm[5]-cm[3],cm[0],cm[3]])
 page.extract_text(visitor_operand_before=operand)
 assert len(images)==1
 bounds.append(images[0])
(folder/'reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),referenceVersion='16.0.20326',bounds=bounds),indent=2)+'\n')
