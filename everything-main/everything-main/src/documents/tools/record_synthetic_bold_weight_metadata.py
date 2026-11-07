"""Capture native synthesis decisions for original font-weight boundary controls."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
import hashlib,json,argparse
parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);folder=parser.parse_args().directory
source=folder/'control.docx';pdf=folder/'native.pdf';reader=PdfReader(pdf)
cases=json.loads((folder/'cases.json').read_text())
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
for case in cases: assert ('WeightProbe'+str(case['weight'])+'-Regular') in case['pdfFont'], case
fontHashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.glob('*.ttf'))}
(folder/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',fontHashes=fontHashes,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),cases=cases),indent=2)+'\n')
