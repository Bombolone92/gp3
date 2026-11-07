"""Capture native synthesis decisions for original font-weight boundary controls."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
import hashlib,json
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/synthetic-bold'
source=folder/'weights.docx';pdf=folder/'weights-native.pdf';reader=PdfReader(pdf)
cases=[dict(font=family,weight=weight,bold=bold) for family,weight in [('Segoe UI Semibold',600),('Segoe UI Semilight',350),('Franklin Gothic Medium',400),('Dubai Medium',500)] for bold in [False,True]]
index=0
for page in reader.pages:
 font=None;size=0;mode=0;stack=[]
 for args,op in ContentStream(page.get_contents(),reader).operations:
  if op==b'q':stack.append((font,size,mode))
  elif op==b'Q':font,size,mode=stack.pop()
  elif op==b'Tf':font,size=args
  elif op==b'Tr':mode=args[0]
  elif op in [b'Tj',b'TJ'] and float(size)==24:
   cases[index].update(pdfFont=str(page['/Resources']['/Font'][font].get_object()['/BaseFont']),textRenderingMode=int(mode));index+=1
assert index==len(cases)
(folder/'weights-reference.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cases=cases),indent=2)+'\n')
