from pathlib import Path
from pypdf import PdfReader
import json,hashlib,sys
root=Path(__file__).resolve().parents[1]/'tests/fixtures/outline-text-advances'
pdf=Path(sys.argv[1]);rows=[];markers=[]
for i,p in enumerate(PdfReader(pdf).pages):
 h=float(p.mediabox.height);lines=[]
 def v(t,cm,tm,f,s):
  if not t.strip():return
  text=t.rstrip('\n');y=h-tm[5]
  if text.strip()=='END':markers.append({'page':i,'x':tm[4]})
  if lines and abs(lines[-1]['y']-y)<.01:lines[-1]['text']+=text
  else:lines.append({'page':i,'text':text,'x':tm[4],'y':y})
 p.extract_text(visitor_text=v);rows.extend(lines)
assert len(markers)==24
(root/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','sourceSha256':hashlib.sha256((root/'control.docx').read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'rows':rows,'markers':markers},indent=2)+'\n')
