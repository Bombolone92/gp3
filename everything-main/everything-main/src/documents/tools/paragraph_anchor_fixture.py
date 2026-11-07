"""Original paragraph-relative drawing controls for before/after spacing."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_anchor_position_fixture import make, W, WP
import json
ROOT=Path(__file__).resolve().parents[1]
parts=make(15); root=E.fromstring(parts['word/document.xml'].encode()); tag=lambda n:'{'+W+'}'+n
body=root.find(tag('body')); anchor=deepcopy(root.find('.//{'+WP+'}anchor')); section=deepcopy(body.find(tag('sectPr'))); body.clear()
section.find(tag('pgSz')).set(tag('w'),'12240');section.find(tag('pgSz')).set(tag('h'),'15840')
for k in ['top','bottom','left','right']:section.find(tag('pgMar')).set(tag(k),'1440')
cases=[dict(id='top-zero',before=0),dict(id='top-twelve',before=12),dict(id='top-thirtysix',before=36),
       dict(id='middle-twelve',before=12,after=0),dict(id='middle-after24-before12',before=12,after=24),
       dict(id='middle-after6-before24',before=24,after=6),dict(id='empty-twelve',before=12,empty=True),
       dict(id='contextual',before=12,after=24,contextual=True),dict(id='positive-offset',before=12,offset=18),
       dict(id='negative-offset',before=12,offset=-18),dict(id='top-border',before=12,border=True),
       dict(id='middle-border',before=24,after=6,border=True)]
def paragraph(before=0,after=0,text=None,contextual=False):
 p=E.SubElement(body,tag('p'));pp=E.SubElement(p,tag('pPr'));sp=E.SubElement(pp,tag('spacing'))
 for k,v in dict(before=before*20,after=after*20,line=240,lineRule='exact').items():sp.set(tag(k),str(v))
 if contextual:E.SubElement(pp,tag('contextualSpacing'))
 if text is not None:
  run=E.SubElement(p,tag('r'));E.SubElement(run,tag('t')).text=text
 return p
for i,c in enumerate(cases):
 if 'after' in c:paragraph(after=c['after'],text='Preceding paragraph',contextual=c.get('contextual',False))
 p=paragraph(before=c['before'],text=None if c.get('empty') else c['id'],contextual=c.get('contextual',False))
 if c.get('border'):
  b=E.Element(tag('pBdr'));edge=E.SubElement(b,tag('top'))
  for k,v in dict(val='single',sz='16',space='3',color='000000').items():edge.set(tag(k),v)
  p.find(tag('pPr')).insert(0,b)
 a=deepcopy(anchor);a.find('{'+WP+'}docPr').set('id',str(i+1))
 for axis,base,offset in [('H','page',360),('V','paragraph',c.get('offset',0))]:
  n=a.find('{'+WP+'}position'+axis);n.clear();n.set('relativeFrom',base);E.SubElement(n,'{'+WP+'}posOffset').text=str(offset*12700)
 E.SubElement(E.SubElement(p,tag('r')),tag('drawing')).append(a)
 if i<len(cases)-1:paragraph().find(tag('pPr')).append(deepcopy(section))
body.append(section);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(ROOT/'public/fixtures/paragraph-anchor-spacing.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
folder=ROOT/'tests/fixtures/paragraph-anchor-spacing';folder.mkdir(parents=True,exist_ok=True)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
