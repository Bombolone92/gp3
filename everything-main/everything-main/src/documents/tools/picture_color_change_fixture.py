"""Original color-change XML controls and RGBA swatches; no corpus media."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from PIL import Image
from io import BytesIO
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/picture-color-change';OUT.mkdir(exist_ok=True)
A='http://schemas.openxmlformats.org/drawingml/2006/main';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
with ZipFile(ROOT/'public/fixtures/picture-duotone.docx') as z:parts={n:z.read(n) for n in z.namelist()}
colors=[(255,255,255,255),(254,254,254,255),(253,253,253,255),(250,250,250,255),(255,255,254,255),(0,0,0,255),(255,0,0,255),(0,255,0,255),(0,0,255,255),(200,40,80,255),(200,40,80,128),(200,40,80,64),(200,40,80,0),(17,119,221,255),(255,255,255,128),(255,255,255,64)]
colors += [(255,255,255,254),(255,255,255,253),(200,40,80,254),(200,40,80,253),(199,39,79,255),(201,41,81,255),(198,38,78,255),(200,40,82,255),(200,39,80,255),(200,41,80,255),(200,41,81,255),(200,40,81,255),(255,253,255,255),(254,255,255,255),(254,0,0,255),(253,0,0,255)]
im=Image.new('RGBA',(len(colors)*8,16));im.putdata([c for y in range(16) for c in colors for x in range(8)]);buf=BytesIO();im.save(buf,format='PNG');parts['word/media/duotone.png']=buf.getvalue()
def change(source='FFFFFF',target='FFFFFF',alpha=0,use=None):
 attr='' if use is None else f' useA="{use}"'
 return f'<a:clrChange{attr}><a:clrFrom><a:srgbClr val="{source}"/></a:clrFrom><a:clrTo><a:srgbClr val="{target}"><a:alpha val="{alpha}"/></a:srgbClr></a:clrTo></a:clrChange>'
gray='<a:grayscl/>';mod='<a:alphaModFix amt="50000"/>'
cases=[('', 'Original'),(change(),'White transparent default'),(change(use='0'),'White transparent useA false'),(change(use='1'),'White transparent useA true'),(change('C82850','1177DD',100000),'Color replace'),(change('C82850','1177DD',50000),'Color replace half alpha'),(change('C82850','1177DD',50000,'0'),'Half alpha useA false'),(change()+gray,'Change then gray'),(gray+change(),'Gray then change'),(mod+change('C82850','1177DD',50000),'Alpha then change'),(change('C82850','1177DD',50000)+mod,'Change then alpha')]
cases += [(change('FF0000','0000FF',100000)+gray,'Red to blue then gray'),(gray+change('FF0000','0000FF',100000),'Gray then red to blue'),(change('C82850','1177DD',100000).replace('<a:srgbClr val="C82850"/>','<a:srgbClr val="C82850"><a:alpha val="50000"/></a:srgbClr>'),'Partial source alpha'),(change('C82850','1177DD',100000,'0').replace('<a:srgbClr val="C82850"/>','<a:srgbClr val="C82850"><a:alpha val="50000"/></a:srgbClr>'),'Partial source alpha useA false')]
cases += [(change('FF0000','0000FF',100000)+change('0000FF','00FF00',100000),'Red blue green chain'),(change('0000FF','00FF00',100000)+change('FF0000','0000FF',100000),'Reverse chain'),('<a:lum bright="-50000"/>'+change('FF0000','0000FF',100000),'Lum then change'),(change('FF0000','0000FF',100000)+'<a:lum bright="-50000"/>','Change then lum')]
duo='<a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone>'
cases += [(duo+change('FF0000','0000FF',100000),'Duotone then change'),(change('FF0000','0000FF',100000)+duo,'Change then duotone')]
cases += [(change('C82850','1177DD',100000).replace('<a:srgbClr val="C82850"/>','<a:srgbClr val="C82850"><a:alpha val="0"/></a:srgbClr>'),'Transparent source colored key'),(change('000000','1177DD',100000).replace('<a:srgbClr val="000000"/>','<a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr>'),'Transparent source black key')]
r=E.fromstring(parts['word/document.xml']);body=r.find('{'+W+'}body');heading=deepcopy(body[0]);label=deepcopy(body[1]);picture=deepcopy(body[2]);section=deepcopy(body[-1]);body.clear();heading.find('.//{'+W+'}t').text='Color change controls';body.append(heading)
for i,(effect,name) in enumerate(cases):
 l=deepcopy(label);l.find('.//{'+W+'}t').text=f'C{i:02} {name}';body.append(l);p=deepcopy(picture);blip=p.find('.//{'+A+'}blip')
 p.find('{'+W+'}pPr').insert(0,E.Element('{'+W+'}shd',{'{'+W+'}val':'clear','{'+W+'}fill':'6699AA'}))
 for c in list(blip):blip.remove(c)
 for c in E.fromstring(f'<effects xmlns:a="{A}">{effect}</effects>'):blip.append(c)
 for n in p.iter():
  if E.QName(n).localname in ['docPr','cNvPr']:n.set('id',str(i+1));n.set('name',f'C{i:02}')
 body.append(p)
body.append(section);parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(OUT/'cases.json').write_text(json.dumps(dict(colors=colors,cases=[dict(id=f'C{i:02}',label=name,effect=effect) for i,(effect,name) in enumerate(cases)]),indent=2)+'\n')

