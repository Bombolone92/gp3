"""Record the native synthetic-bold decision from independent reference PDF operators."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
import hashlib,json
ROOT=Path(__file__).resolve().parents[1];folder=ROOT/'tests/fixtures/synthetic-bold';source=ROOT/'public/fixtures/synthetic-bold.docx';pdf=folder/'native.pdf';cases=json.loads((folder/'cases.json').read_text());reader=PdfReader(pdf);index=0
for pageIndex,page in enumerate(reader.pages):
 font=None;size=0;mode=0;width=1;stack=[]
 for args,op in ContentStream(page.get_contents(),reader).operations:
  if op==b'q':stack.append((font,size,mode,width))
  elif op==b'Q':font,size,mode,width=stack.pop()
  elif op==b'Tf':font,size=args
  elif op==b'Tr':mode=args[0]
  elif op==b'w':width=args[0]
  elif op in [b'Tj',b'TJ'] and float(size)==24:
   cases[index].update(page=pageIndex,pdfFont=str(page['/Resources']['/Font'][font].get_object()['/BaseFont']),textRenderingMode=int(mode),strokeWidth=float(width) if mode==2 else 0)
   index+=1
assert index==len(cases)
result=dict(referenceVersion='16.0.20326',sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cases=cases)
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n')
print([(c['id'],c['pdfFont'],c['textRenderingMode'],c['strokeWidth']) for c in cases])
