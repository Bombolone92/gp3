from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/scaled-picture-shadows';out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';A='http://schemas.openxmlformats.org/drawingml/2006/main';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
def sub(p,ns,name,**attrs):return E.SubElement(p,'{'+ns+'}'+name,attrs)
with ZipFile(root/'tests/fixtures/picture-shadows/source.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find('{'+W+'}body');drawing=deepcopy(doc.findall('.//{'+W+'}drawing')[1]);sect=deepcopy(body.find('{'+W+'}sectPr'))
sect.find('{'+W+'}pgSz').set('{'+W+'}h','8640')
for n in list(body):body.remove(n)
cases=[dict(name='align-'+a,sx=150000,sy=50000,algn=a,blur=0) for a in ['tl','t','tr','l','ctr','r','bl','b','br']]
cases += [dict(name='blur-scale',sx=150000,sy=150000,algn='ctr',blur=6),dict(name='negative-x',sx=-100000,sy=100000,algn='ctr',blur=0),dict(name='negative-y',sx=100000,sy=-100000,algn='ctr',blur=0),dict(name='zero-x',sx=0,sy=100000,algn='ctr',blur=0),dict(name='soft-102-percent',sx=102000,sy=102000,algn='ctr',blur=36)]
for i,c in enumerate(cases):
 p=sub(body,W,'p')
 if i:sub(sub(p,W,'pPr'),W,'pageBreakBefore')
 sub(sub(p,W,'r'),W,'t').text=c['name'];d=deepcopy(drawing);sub(sub(body,W,'p'),W,'r').append(d)
 dp=d.find('.//{'+WP+'}docPr');dp.set('id',str(i+1));dp.set('name',c['name'])
 shape=d.find('.//{'+PIC+'}spPr');effects=shape.find('{'+A+'}effectLst')
 for n in list(effects):effects.remove(n)
 sh=sub(effects,A,'outerShdw',blurRad=str(c['blur']*12700),dist='152400',dir='2700000',sx=str(c['sx']),sy=str(c['sy']),algn=c['algn'],rotWithShape='0')
 sub(sub(sh,A,'srgbClr',val='8040C0'),A,'alpha',val='60000')
body.append(sect);parts['word/document.xml']=E.tostring(doc)
with ZipFile(out/'source.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')

