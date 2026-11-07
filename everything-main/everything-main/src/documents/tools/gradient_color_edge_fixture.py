"""Original stop-position and alpha controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1];out=repo/'tests/fixtures/gradient-color-edges';out.mkdir(exist_ok=True)
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
cases=[dict(name='full',pos=[0,100000]),dict(name='inset',pos=[25000,75000]),dict(name='left',pos=[0,75000]),dict(name='right',pos=[25000,100000]),dict(name='reverse',pos=[100000,0]),dict(name='same-zero',pos=[0,0]),dict(name='same-middle',pos=[50000,50000]),dict(name='same-end',pos=[100000,100000]),dict(name='half-alpha',pos=[0,100000],alpha=[50000,50000]),dict(name='fade-in',pos=[0,100000],alpha=[0,100000]),dict(name='fade-out',pos=[0,100000],alpha=[100000,0]),dict(name='unequal-alpha',pos=[0,100000],alpha=[25000,75000])]
with ZipFile(repo/'tests/fixtures/gradient-colors/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
d=E.fromstring(parts['word/document.xml'])
for g,c in zip(d.findall('.//a:gradFill',ns),cases):
 lst=g.find('a:gsLst',ns);lst.clear()
 for i,col in enumerate(['FF1571','FDC082']):
  stop=E.SubElement(lst,'{'+ns['a']+'}gs',pos=str(c['pos'][i]));color=E.SubElement(stop,'{'+ns['a']+'}srgbClr',val=col)
  if 'alpha' in c:E.SubElement(color,'{'+ns['a']+'}alpha',val=str(c['alpha'][i]))
parts['word/document.xml']=E.tostring(d,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases),encoding='utf-8')
