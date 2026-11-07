from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import json
from canvas_anchor_position_fixture import make,W,WP
parts=make(15);xml=E.fromstring(parts['word/document.xml'].encode());q=lambda n:'{'+W+'}'+n
body=xml.find(q('body'));anchor=deepcopy(xml.find('.//{'+WP+'}anchor'));section=deepcopy(body.find(q('sectPr')));body.clear()
section.find(q('pgSz')).set(q('w'),'12240');section.find(q('pgSz')).set(q('h'),'15840')
for k in ['top','bottom','left','right']:section.find(q('pgMar')).set(q(k),'1440')
cases=[dict(name='first',base='line'),dict(name='second-manual',base='line',br=True),dict(name='third-wrapped',base='line',wrap=True),dict(name='paragraph-control',base='paragraph',br=True),dict(name='second-plus18',base='line',br=True,offset=18),dict(name='second-minus6',base='line',br=True,offset=-6),dict(name='second-before24',base='line',br=True,before=24),dict(name='second-exact36',base='line',br=True,line=36)]
for i,c in enumerate(cases):
 p=E.SubElement(body,q('p'));pp=E.SubElement(p,q('pPr'))
 if i:E.SubElement(pp,q('pageBreakBefore'))
 E.SubElement(pp,q('spacing'),{q('before'):str(c.get('before',0)*20),q('after'):'0',q('line'):str(c.get('line',18)*20),q('lineRule'):'exact'})
 if c.get('wrap'):E.SubElement(pp,q('ind'),{q('right'):'5760'})
 def text(s):
  r=E.SubElement(p,q('r'));rp=E.SubElement(r,q('rPr'));E.SubElement(rp,q('rFonts'),{q('ascii'):'Arial',q('hAnsi'):'Arial'});E.SubElement(rp,q('sz'),{q('val'):'24'});E.SubElement(r,q('t')).text=s
 text('First line' if not c.get('wrap') else 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen. ')
 if c.get('br'):E.SubElement(E.SubElement(p,q('r')),q('br'));text('Second line')
 a=deepcopy(anchor);a.find('{'+WP+'}docPr').set('id',str(i+1))
 for axis,base,offset in [('H','page',360),('V',c['base'],c.get('offset',0))]:
  pos=a.find('{'+WP+'}position'+axis);pos.clear();pos.set('relativeFrom',base);E.SubElement(pos,'{'+WP+'}posOffset').text=str(offset*12700)
 E.SubElement(E.SubElement(p,q('r')),q('drawing')).append(a)
 text(' Anchor end')
body.append(section);parts['word/document.xml']=E.tostring(xml,xml_declaration=True,encoding='UTF-8',standalone=True)
out=Path(__file__).resolve().parents[1]/'tests/fixtures/line-relative-anchors/control.docx'
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
out.with_suffix('.json').write_text(json.dumps(cases,indent=2));print(out)

