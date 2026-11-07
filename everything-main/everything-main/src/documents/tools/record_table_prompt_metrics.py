"""Bind original native label origins to the source and PDF without font reads."""
from pathlib import Path
from pypdf import PdfReader
import json,hashlib
root=Path(__file__).resolve().parents[1]/'tests/fixtures/table-prompt-metrics'
sha=lambda name:hashlib.sha256((root/name).read_bytes()).hexdigest()
metadata=json.loads((root/'native-export.json').read_text(encoding='utf-8-sig'));cases=json.loads((root/'cases.json').read_text());pdf=PdfReader(root/'native.pdf');assert len(pdf.pages)==len(cases)==6
assert metadata['sourceSha256']==sha('control.docx') and metadata['pdfSha256']==sha('native.pdf') and metadata['sourceUnchanged'] and metadata['saved']
for case,page in zip(cases,pdf.pages):
 runs=[]
 def visit(text,cm,tm,font,size):
  if text.strip()!='W:':return
  assert str(font['/BaseFont']).split('+')[-1]=='Arial-BoldMT' and size==18
  assert cm==[1,0,0,1,0,0] and tm[:4]==[1,0,0,1]
  runs.append({'x':tm[4],'y':float(page.mediabox.height)-tm[5],'font':'Arial-BoldMT','size':size})
 page.extract_text(visitor_text=visit);assert len(runs)==1;case['native']=runs[0]
(root/'reference.json').write_text(json.dumps({'hashes':{name:sha(name) for name in ['control.docx','cases.json','native.pdf','native-export.json']},'cases':cases},indent=2)+'\n')
print('Recorded six hash-bound native bold label origins.')
