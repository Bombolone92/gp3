"""Original asymmetric shape-flip reference probe, derived from our curve fixture."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1]
A='{http://schemas.openxmlformats.org/drawingml/2006/main}';S='{http://schemas.microsoft.com/office/word/2010/wordprocessingShape}';W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(root/'public/fixtures/bezier-paths.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);r.find('.//'+W+'t').text='Shape flip geometry'
flags=[{},dict(flipH='1'),dict(flipV='true'),dict(flipH='true',flipV='1'),dict(flipH='true',flipV='false'),dict(flipH='1',flipV='1')]
for i,s in enumerate(r.iter(S+'wsp')):
 pr=s.find(S+'spPr');xf=pr.find(A+'xfrm');xf.attrib.update(flags[i]);path=pr.find('.//'+A+'path');path.clear();path.set('w','100');path.set('h','100')
 for tag,coords in [('moveTo',[-20,20]),('lnTo',[80,10]),('quadBezTo',[130,20,75,90]),('lnTo',[10,75])]:
  op=E.SubElement(path,A+tag)
  for j in range(0,len(coords),2):E.SubElement(op,A+'pt',x=str(coords[j]),y=str(coords[j+1]))
 E.SubElement(path,A+'close');pr.find(A+'ln').set('w','6350')
 tx=E.Element(S+'txbx');content=E.SubElement(tx,W+'txbxContent');p=E.SubElement(content,W+'p');run=E.SubElement(p,W+'r');rp=E.SubElement(run,W+'rPr');E.SubElement(rp,W+'sz',attrib={W+'val':'20'});E.SubElement(rp,W+'color',attrib={W+'val':'123456'});E.SubElement(run,W+'t').text='Abc'
 s.insert(list(s).index(s.find(S+'bodyPr')),tx)
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'public/fixtures/shape-flips.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)

folder=root/'tests/fixtures/shape-flips';folder.mkdir(exist_ok=True)
cases=json.loads((root/'tests/fixtures/bezier-paths/cases.json').read_text())
for case,name in zip(cases,['unflipped','horizontal','vertical','both','horizontal-lexical','nested-both']):case['name']=name
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
