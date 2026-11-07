"""Independent ordinary-outline variations of our original 3D picture fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
import json
from copy import deepcopy

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/picture-3d-outlines'
folder.mkdir(exist_ok=True)
cases = json.loads((root / 'tests/fixtures/picture-3d/cases.json').read_text())
# Absent w distinguishes the default from explicit widths; colors differ
# from the contour except for one common-color case. noFill remains separate.
lines = [
    {'color':'804020'}, {'color':'804020'}, {'color':'804020'},
    {'color':'202060'}, {'color':'804020','widthPt':8},
    {'color':'804020','widthPt':2}, {'color':'804020','widthPt':8},
    {'color':'804020','widthPt':.5}, {'color':'804020','widthPt':8},
    {'noFill':True,'widthPt':8}, {'color':'804020','widthPt':8},
    {'color':'804020','widthPt':8}, {'color':'804020','widthPt':1},
]
assert len(cases) == len(lines) == 13
with ZipFile(root / 'public/fixtures/picture-3d.docx') as z:
    parts = {name:z.read(name) for name in z.namelist()}
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P = '{http://schemas.openxmlformats.org/drawingml/2006/picture}'
doc = E.fromstring(parts['word/document.xml'])
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
body = doc.find(W+'body')
original = list(doc.iter(P+'spPr'))
for source,name,depth in [(10,'front-deep-wide-ellipse',20),(0,'front-flat-wide-rect',0),(7,'right-deep-wide-ellipse',20),(4,'right-deep-round-rect',20)]:
    paragraph = original[source]
    while paragraph.tag != W+'p': paragraph = paragraph.getparent()
    paragraph = deepcopy(paragraph)
    paragraph.find('.//'+A+'sp3d').set('extrusionH',str(depth*12700))
    properties = paragraph.find('.//'+WP+'docPr')
    properties.set('id',str(len(cases)+1)); properties.set('name',name)
    page_break = E.Element(W+'p'); E.SubElement(E.SubElement(page_break,W+'r'),W+'br').set(W+'type','page')
    caption = E.Element(W+'p'); E.SubElement(E.SubElement(caption,W+'r'),W+'t').text = name
    for element in [page_break,caption,paragraph]: body.insert(len(body)-1,element)
    case = cases[source].copy();case[0]=name;case[2]=depth;cases.append(case)
    lines.append({'color':'804020','widthPt':8, **({'algn':'ctr'} if source==0 else {}), **({'round':True} if source==4 else {})})
props = list(doc.iter(P+'spPr'))
assert len(props) == len(lines)
for shape,line in zip(props,lines):
    ln = E.Element(A+'ln')
    if 'widthPt' in line: ln.set('w', str(round(line['widthPt']*12700)))
    if 'algn' in line: ln.set('algn',line['algn'])
    if line.get('noFill'): E.SubElement(ln,A+'noFill')
    else: E.SubElement(E.SubElement(ln,A+'solidFill'),A+'srgbClr',val=line['color'])
    if line.get('round'): E.SubElement(ln,A+'round')
    shape.insert(list(shape).index(shape.find(A+'scene3d')),ln)
parts['word/document.xml'] = E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root / 'public/fixtures/picture-3d-outlines.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
(folder/'lines.json').write_text(json.dumps(lines,indent=2)+'\n',encoding='utf-8')
