"""Bind the independent eight-font controls to installed reference PDF positions."""
import hashlib,json
from pathlib import Path
from pypdf import PdfReader

folder=Path(__file__).resolve().parents[1]/'tests/fixtures/opentype-kerning'
cases=json.loads((folder/'legacy-cases.json').read_text())
result={'referenceVersion':'16.0.20326','cases':[]}
for enabled in [0,1]:
 source=folder/f'legacy-{enabled}.docx';pdf=folder/f'legacy-{enabled}-native.pdf'
 pages=PdfReader(pdf).pages;assert len(pages)==1
 groups={}
 def visit(text,cm,tm,font,size):
  if text.strip():groups.setdefault(tm[5],[]).append({'text':text.strip(),'x':tm[4],'font':str(font.get('/BaseFont'))})
 pages[0].extract_text(visitor_text=visit)
 lines=[{'x':min(s['x'] for s in group),'y':y,'text':''.join(s['text'] for s in group),'font':group[0]['font']} for y,group in sorted(groups.items(),reverse=True)]
 assert len(lines)==len(cases)
 for case,line in zip(cases,lines):assert case['text'].replace(' ','')==line['text'].replace(' ','')
 result['cases'].append({'enabled':enabled,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'lines':lines})
result['enabledMinusDisabledX']=[round(b['x']-a['x'],6) for a,b in zip(result['cases'][0]['lines'],result['cases'][1]['lines'])]
(folder/'legacy-reference.json').write_text(json.dumps(result,indent=2)+'\n')
spacing=[]
for name,value in [('positive',.3),('negative',-.3)]:
 source=folder/f'legacy-spacing-{name}.docx';pdf=folder/f'legacy-spacing-{name}-native.pdf';groups={}
 def visit_spaced(text,cm,tm,font,size):
  # The reference export writes the hyphens with dummy (0,0) origins in these spaced exports.
  # Retain extracted text, and do not use those positions as line origins.
  if text.strip() and tm[5]>0:groups.setdefault(round(tm[5],2),[]).append({'text':text.strip(),'x':tm[4]})
 pages=PdfReader(pdf).pages;assert len(pages)==1;pages[0].extract_text(visitor_text=visit_spaced)
 lines=[{'x':min(s['x'] for s in group),'y':y,'extractedText':''.join(s['text'] for s in group),'text':cases[i]['text']} for i,(y,group) in enumerate(sorted(groups.items(),reverse=True))]
 assert len(lines)==48
 for line in lines:assert ''.join(c for c in line['text'] if c not in ' -')==''.join(c for c in line['extractedText'] if c not in ' -')
 spacing.append({'name':name,'characterSpacing':value,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'lines':lines})
(folder/'spacing-reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','cases':spacing},indent=2)+'\n')
