from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from lxml import etree as E
import json
p=Path(__file__).resolve().parents[1]/'tests/fixtures/plain-text-controls'
n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
cases=json.loads((p/'cases.json').read_text());refs=[]
def text(r):
 return ''.join(e.text or '' if E.QName(e).localname=='t' else '\v' if E.QName(e).localname in ['br','cr'] else '\t' if E.QName(e).localname=='tab' else '' for e in r.iter())
for i,c in enumerate(cases):
 suffix='typed-break-native' if c['name'].endswith('enter') or c['name']=='existing-break' else 'native'
 path=p/(c['name']+'-'+suffix+'.docx')
 if not path.exists():path=p/(c['name']+'-native.docx')
 with ZipFile(path) as z:
  data=z.read('word/document.xml');r=E.fromstring(data)
  paragraphs=r.xpath('w:body/w:p|w:body/w:sdt/w:sdtContent/w:p',namespaces=n)
  para=paragraphs[i]
  controls=para.findall('.//w:sdt',n)
  if para.getparent().tag.endswith('sdtContent'):controls=[para.getparent().getparent()]
  content=controls[0].find('w:sdtContent',n) if controls else para
  runs=[{'text':text(x),'bold':x.find('w:rPr/w:b',n) is not None} for x in content.findall('.//w:r',n)]
  refs.append({'case':c['name'],'controlCount':len(r.findall('.//w:sdt',n)),'paragraphText':text(para),'runs':runs,'controlRetained':bool(controls),'xmlSha256':sha256(data).hexdigest()})
  (p/(c['name']+'-native.xml')).write_bytes(data)
(p/'reference.json').write_text(json.dumps({'referenceVersion':'16.0.20326','sourceSha256':sha256((p/'control.docx').read_bytes()).hexdigest(),'pdfSha256':sha256((p/'native.pdf').read_bytes()).hexdigest(),'cases':refs},indent=2)+'\n')

# Selection-based prompt references preserve separate input properties.
for name in ['temp-prompt', 'persistent-prompt']:
 for phase in ['formatted', 'entered']:
  stem=f'{name}-selection2-{phase}-native'
  with ZipFile(p/(stem+'.docx')) as package:
   (p/(stem+'.xml')).write_bytes(package.read('word/document.xml'))
