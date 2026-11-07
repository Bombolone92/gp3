"""Original grayscale OPC/XML controls using the project's own RGBA swatches."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
ROOT=Path(__file__).resolve().parents[1];A='http://schemas.openxmlformats.org/drawingml/2006/main';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(ROOT/'public/fixtures/picture-duotone.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find('{'+W+'}body');heading=deepcopy(body[0]);label=deepcopy(body[1]);picture=deepcopy(body[2]);section=deepcopy(body[-1]);body.clear();heading.find('.//{'+W+'}t').text='Grayscale controls';body.append(heading)
bw='<a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone>';red='<a:duotone><a:srgbClr val="CC2244"/><a:srgbClr val="FFFFFF"/></a:duotone>';gray='<a:grayscl/>';alpha='<a:alphaModFix amt="50000"/>'
cases=[('', 'Original'),(gray,'Grayscale'),(gray+red,'Gray then red'),(red+gray,'Red then gray'),(gray+alpha,'Gray then alpha'),(alpha+gray,'Alpha then gray'),(gray+gray,'Repeated gray'),(bw,'Black white duotone')]
for i,(effect,name) in enumerate(cases):
 l=deepcopy(label);l.find('.//{'+W+'}t').text=f'G{i:02} {name}';body.append(l);p=deepcopy(picture);blip=p.find('.//{'+A+'}blip')
 for c in list(blip):blip.remove(c)
 for c in E.fromstring(f'<effects xmlns:a="{A}">{effect}</effects>'):blip.append(c)
 for n in p.iter():
  if E.QName(n).localname in ['docPr','cNvPr']:n.set('id',str(i+1));n.set('name',f'G{i:02}')
 body.append(p)
body.append(section);parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(ROOT/'public/fixtures/picture-grayscale.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
folder=ROOT/'tests/fixtures/picture-grayscale';folder.mkdir(exist_ok=True)
colors=json.loads((ROOT/'tests/fixtures/picture-duotone/cases.json').read_text())['colors']
(folder/'cases.json').write_text(json.dumps(dict(colors=colors,cases=[dict(id=f'G{i:02}',label=name,effect=effect) for i,(effect,name) in enumerate(cases)]),indent=2)+'\n')
