"""Pin independent native reference line-allocation measurements."""
from pathlib import Path
from pypdf import PdfReader
import hashlib,json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/script-line-boxes'
source=root/'script-line-boxes.docx';native=root/'script-line-boxes-native.pdf'
pages=[]
for p in PdfReader(native).pages:
 values={}
 def visit(t,c,m,f,s):
  t=t.strip()
  if t in ['Before','After','Start','Start Test end']:
   values['Start' if t.startswith('Start') else t]=float(p.mediabox.height)-(m[4]*c[1]+m[5]*c[3]+c[5])
 p.extract_text(visitor_text=visit);pages.append(values)
assert len(pages)==30
for start in [0,10,20]:
 for i in [1,2,4,6,7]:assert abs(pages[start+i]['After']-pages[start]['After'])<.02
 for i in [8,9]:assert abs(pages[start+i]['After']-pages[start]['After']-7)<.12
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(root/'reference.json').write_text(json.dumps(dict(referenceVersion='16.0.20326',sourceSha256=sha(source),pdfSha256=sha(native),pages=pages),indent=2)+'\n')
print('Verified 30 native script line-allocation controls')
