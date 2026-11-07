"""Record native rotated origins while checking text, font and page identity."""
from pathlib import Path
from pypdf import PdfReader
import json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/cell-text-direction/origin-phase'
cases=json.loads((root/'cases.json').read_text());pdf=PdfReader(root/'native.pdf')
assert len(pdf.pages)==len(cases)==8
for case,page in zip(cases,pdf.pages):
 runs=[]
 def visit(t,c,m,f,s):
  if abs(m[1])<.9:return
  if not t.strip():return
  assert t.strip()=='a'
  assert str(f['/BaseFont']).split('+')[-1]=='ArialMT'
  assert c==[1,0,0,1,0,0] and s==9.96
  runs.append(dict(x=m[4],y=m[5],direction='btLr' if m[1]>0 else 'tbRl',size=s))
 page.extract_text(visitor_text=visit)
 assert [r['direction'] for r in runs]==['btLr']*6+['tbRl']*6
 case['runs']=runs
sha=lambda name:hashlib.sha256((root/name).read_bytes()).hexdigest()
ref=dict(referenceVersion='16.0.20326',hashes={n:sha(n) for n in ['control.docx','native.pdf']},cases=cases)
(root/'reference.json').write_text(json.dumps(ref,indent=2)+'\n')
print('Recorded 96 native rotated origins across eight table offsets')
