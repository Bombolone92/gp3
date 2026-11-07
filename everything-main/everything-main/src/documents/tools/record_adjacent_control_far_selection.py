"""Bind the independently authored source and completed native reference results."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from lxml import etree
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/adjacent-control-selection'
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
cases=[]
for direction in ['right','left']:
    result='native-far-'+direction+'.docx'
    with ZipFile(root/result) as z:body=etree.fromstring(z.read('word/document.xml')).find('w:body',ns)
    controls=[{'text':''.join(s.xpath('.//w:t/text()',namespaces=ns)), 'placeholder':bool(s.find('w:sdtPr/w:showingPlcHdr',ns) is not None)} for s in body.findall('.//w:sdt',ns)]
    cases.append({'name':direction,'source':'control.docx','sourceSha256':sha256((root/'control.docx').read_bytes()).hexdigest(),
                  'result':result,'resultSha256':sha256((root/result).read_bytes()).hexdigest(),
                  'setup':['Home' if direction=='right' else 'End']+['Arrow'+direction.title()]*4,
                  'keys':['Shift+Arrow'+direction.title()]*5+['x'],
                  'selection':[3,5] if direction=='right' else [3,1],
                  'text':''.join(body.xpath('.//w:t/text()',namespaces=ns)),'controls':controls})
assert [(c['text'],c['controls']) for c in cases]==[('ABCxD',[{'text':'BCx','placeholder':False}]),('AxEFD',[{'text':'EF','placeholder':False}])]
(root/'far-boundary-reference.json').write_text(json.dumps({'date':'2026-10-01','referenceBuild':'16.0.20326','zoomPercent':100,'cases':cases},indent=2)+'\n',encoding='utf-8')
