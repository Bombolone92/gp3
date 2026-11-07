"""Original translucent groups using the independently authored nested controls."""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import json,sys
import canvas_svg_fixture as fixture
root=Path(__file__).resolve().parents[1]
ns='{http://www.w3.org/2000/svg}'
ET.register_namespace('',ns[1:-1])
with ZipFile(root/'public/fixtures/svg-mask-nested-intermediate.docx') as package:
 svg=ET.fromstring(package.read('word/media/vector.svg'))
for child in list(svg):
 if child.tag==ns+'defs':svg.remove(child)
 else:
  child.attrib.pop('filter',None)
  child.set('opacity','0.8')
chains='--chains' in sys.argv
name='svg-group-composition'+('-chains' if chains else '')
cases=json.loads((root/'tests/fixtures/svg-mask-nested/cases.json').read_text())
cases=[dict(kind='g',opacity=.8,children=[c]) for c in cases]
if chains:
 for child in list(svg):svg.remove(child)
 cases=[]
 for i,alphas in enumerate([[.5,.75],[.8,.5,.75],[.5,.8,.75],[.5,.5],[.999,.5],[.125,.75,.5,.8]]):
  parent=svg
  for alpha in alphas:parent=ET.SubElement(parent,ns+'g',{'opacity':str(alpha)})
  for color,alpha,y in [('#2060C0',1,11.4),('#FF0000',.5,31.4)]:
   ET.SubElement(parent,ns+'rect',{'x':str(3.35+i*20),'y':str(y),'width':'13','height':'36','fill':color,'fill-opacity':str(alpha)})
  cases.append(dict(opacityChain=alphas))
fixture.SOURCE=root/'public/fixtures'/(name+'.docx')
fixture.SVG=ET.tostring(svg,encoding='utf-8')
fixture.generate()
folder=root/'tests/fixtures'/name
folder.mkdir(exist_ok=True)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
