from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from io import BytesIO
from lxml import etree as E
from PIL import Image
import numpy as np,json
import argparse
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=root/'tests/fixtures/picture-3d-uv-mapping')
folder=parser.parse_args().output
folder.mkdir(parents=True,exist_ok=True)
with ZipFile(root/'tests/fixtures/picture-3d-circle-outlines/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','pic':'http://schemas.openxmlformats.org/drawingml/2006/picture'};W,A,WP,P=[f'{{{ns[n]}}}' for n in ('w','a','wp','pic')]
doc=E.fromstring(parts['word/document.xml']);body=doc.find(W+'body');sect=deepcopy(body.find(W+'sectPr'));base=next(deepcopy(p) for p in body if p.find('.//'+WP+'docPr') is not None)
for p in list(body):body.remove(p)
y,x=np.indices((512,512));colors=np.stack([64+np.rint(128*(x%32)/31),64+np.rint(128*(y%32)/31),np.full((512,512),128)],axis=2).astype('uint8');stream=BytesIO();Image.fromarray(colors).save(stream,format='PNG');parts['word/media/gray.png']=stream.getvalue()
cases=[]
for name,innerW,innerH,camera,geom,depth,contour in [('equal',178,178,'perspectiveRight','ellipse',20,4.5),('larger-inner',178.3,178.3,'perspectiveRight','ellipse',20,4.5),('smaller-inner',177.7,177.7,'perspectiveRight','ellipse',20,4.5),('opposed-inner',178.3,177.7,'perspectiveRight','ellipse',20,4.5),('front',178,178,'orthographicFront','rect',0,0)]:
 if cases:E.SubElement(E.SubElement(E.SubElement(body,W+'p'),W+'r'),W+'br').set(W+'type','page')
 caption=E.SubElement(E.SubElement(body,W+'p'),W+'r');rp=E.SubElement(caption,W+'rPr');E.SubElement(rp,W+'rFonts').attrib.update({W+'ascii':'Arial',W+'hAnsi':'Arial'});E.SubElement(rp,W+'sz').set(W+'val','20');E.SubElement(caption,W+'t').text=name
 p=deepcopy(base);shape=p.find('.//'+P+'spPr');inner=shape.find(A+'xfrm/'+A+'ext');inner.attrib.update({'cx':str(round(innerW*12700)),'cy':str(round(innerH*12700))});p.find('.//'+WP+'extent').attrib.update({'cx':str(178*12700),'cy':str(178*12700)});shape.find(A+'prstGeom').set('prst',geom);shape.find(A+'scene3d/'+A+'camera').set('prst',camera);solid=shape.find(A+'sp3d');solid.set('extrusionH',str(depth*12700));solid.set('contourW',str(round(contour*12700)));line=shape.find(A+'ln')
 if line is not None:shape.remove(line)
 p.find('.//'+WP+'docPr').attrib.update({'id':str(len(cases)+1),'name':name});body.append(p);cases.append({'name':name,'innerWidthPt':innerW,'innerHeightPt':innerH,'outerWidthPt':178,'outerHeightPt':178,'camera':camera,'geometry':geom,'depthPt':depth,'contourPt':contour})
body.append(sect);parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(folder/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')

# Independently retain the identical source bitmap in a plain 2D calibration.
plain = deepcopy(p)
sp = plain.find('.//' + P + 'spPr')
sp.find(A + 'prstGeom').set('prst', 'rect')
sp.remove(sp.find(A + 'scene3d'))
sp.remove(sp.find(A + 'sp3d'))
line = sp.find(A + 'ln')
if line is not None: sp.remove(line)
for element in list(body): body.remove(element)
caption = E.SubElement(E.SubElement(body, W + 'p'), W + 'r')
rp = E.SubElement(caption, W + 'rPr')
E.SubElement(rp, W + 'rFonts').attrib.update({W + 'ascii':'Arial', W + 'hAnsi':'Arial'})
E.SubElement(rp, W + 'sz').set(W + 'val','20')
E.SubElement(caption, W + 't').text = 'Plain texture calibration'
body.append(plain); body.append(deepcopy(sect))
parts['word/document.xml'] = E.tostring(doc, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(folder / 'plain.docx', 'w', ZIP_DEFLATED) as archive:
    for name, data in parts.items(): archive.writestr(name, data)

# Opposite camera: same authored bitmap and first projected shape.
with ZipFile(folder / 'control.docx') as archive:
    left_parts = {name: archive.read(name) for name in archive.namelist()}
left_doc = E.fromstring(left_parts['word/document.xml'])
left_body = left_doc.find(W + 'body')
left_section = deepcopy(left_body.find(W + 'sectPr'))
left = next(deepcopy(element) for element in left_body
            if element.find('.//' + WP + 'docPr') is not None)
left.find('.//' + A + 'camera').set('prst', 'perspectiveLeft')
left.find('.//' + WP + 'docPr').set('name', 'left')
for element in list(left_body): left_body.remove(element)
caption = E.SubElement(E.SubElement(left_body, W + 'p'), W + 'r')
rp = E.SubElement(caption, W + 'rPr')
E.SubElement(rp, W + 'rFonts').attrib.update({W + 'ascii':'Arial', W + 'hAnsi':'Arial'})
E.SubElement(rp, W + 'sz').set(W + 'val','20')
E.SubElement(caption, W + 't').text = 'Left texture calibration'
left_body.append(left); left_body.append(left_section)
left_parts['word/document.xml'] = E.tostring(left_doc, xml_declaration=True,
                                           encoding='UTF-8', standalone=True)
with ZipFile(folder / 'left.docx', 'w', ZIP_DEFLATED) as archive:
    for name, data in left_parts.items(): archive.writestr(name, data)
