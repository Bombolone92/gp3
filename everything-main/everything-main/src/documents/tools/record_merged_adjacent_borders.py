"""Record native results for the original adjacent-border controls without copying font assets."""
from pathlib import Path
from pypdf import PdfReader
import argparse,json,hashlib
p=argparse.ArgumentParser();p.add_argument('pdf',type=Path);args=p.parse_args()
r=Path(__file__).resolve().parents[1]/'tests/fixtures/merged-adjacent-borders';out=[]
for index,page in enumerate(PdfReader(args.pdf).pages):
 h=float(page.mediabox.height)
 def visit(text,cm,tm,font,size):
  if text.strip():out.append({'page':index,'text':text.strip(),'x':tm[4],'y':h-tm[5]})
 page.extract_text(visitor_text=visit)
assert len(out)==80
(r/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','sourceSha256':hashlib.sha256((r/'control.docx').read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(args.pdf.read_bytes()).hexdigest(),'rows':out},indent=2)+'\n')
