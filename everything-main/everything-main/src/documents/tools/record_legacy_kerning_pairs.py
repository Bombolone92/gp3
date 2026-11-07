"""Bind independently authored pair controls to reference PDF positions."""
from pathlib import Path
from pypdf import PdfReader
import json,hashlib
folder=Path(__file__).resolve().parents[1]/'tests/fixtures/legacy-kerning-pairs'
cases=json.loads((folder/'cases.json').read_text());result=dict(referenceVersion='16.0.20326',controls=[])
for name,enabled,spacing in [('0',0,0),('1',1,0),('0-positive',0,.3),('0-negative',0,-.3)]:
 source=folder/f'control-{name}.docx';pdf=folder/f'native-{name}.pdf';reader=PdfReader(pdf);assert len(reader.pages)==2;lines=[]
 for pi,page in enumerate(reader.pages):
  groups={}
  def visit(text,cm,tm,font,size):
   if text.strip():groups.setdefault(tm[5],[]).append(dict(text=text.strip(),x=tm[4],font=str(font['/BaseFont'])))
  page.extract_text(visitor_text=visit)
  for y,spans in sorted(groups.items(),reverse=True):lines.append(dict(page=pi,y=y,x=min(s['x'] for s in spans),text=''.join(s['text'] for s in spans),font=spans[0]['font']))
 assert len(lines)==len(cases)
 for case,line in zip(cases,lines):assert case['page']==line['page'] and case['text'].replace(' ','')==line['text'].replace(' ','')
 result['controls'].append(dict(name=name,enabled=enabled,characterSpacing=spacing,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),pdfSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),lines=lines))
(folder/'reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
