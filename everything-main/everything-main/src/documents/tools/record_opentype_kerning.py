"""Record native reference text positions for the original OpenType kerning controls."""
import hashlib,json
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parents[1]
result={'referenceVersion':'16.0.20326','cases':[]}
for enabled in [0,1]:
 source=ROOT/f'public/fixtures/opentype-kerning-{enabled}.docx'
 pdf=ROOT/f'tests/fixtures/opentype-kerning/native-{enabled}.pdf'
 pages=PdfReader(pdf).pages
 assert len(pages)==1
 spans=[]
 def visit(text,cm,tm,font,size):
  if text.strip():spans.append({'text':text.strip(),'x':tm[4],'y':tm[5],'font':str(font.get('/BaseFont')),'size':size})
 pages[0].extract_text(visitor_text=visit)
 groups={}
 for span in spans:groups.setdefault(span['y'],[]).append(span)
 lines=[{'x':min(s['x'] for s in group),'y':y,'text':''.join(s['text'] for s in group),'font':group[0]['font']} for y,group in sorted(groups.items(),reverse=True)]
 assert len(lines)==32
 result['cases'].append({'enabled':enabled,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'lines':lines})
result['enabledMinusDisabledX']=[round(b['x']-a['x'],6) for a,b in zip(result['cases'][0]['lines'],result['cases'][1]['lines'])]
(ROOT/'tests/fixtures/opentype-kerning/reference.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(result['enabledMinusDisabledX'])
