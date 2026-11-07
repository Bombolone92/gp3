"""Independent drawing positions with header clearance and page-edge overflow."""
from pathlib import Path
from copy import deepcopy
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from canvas_anchor_position_fixture import make,W,WP,R,CT
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/anchor-page-clearance';out.mkdir(exist_ok=True)
parts=make(15);r=E.fromstring(parts['word/document.xml'].encode());q=lambda n:'{'+W+'}'+n
body=r.find(q('body'));anchor=deepcopy(r.find('.//{'+WP+'}anchor'));section=deepcopy(body.find(q('sectPr')));body.clear()
for k,v in [('top',600),('bottom',600),('header',400),('footer',0)]:section.find(q('pgMar')).set(q(k),str(v))
for name,height in [('short',12),('tall',48)]:
 parts[f'word/header-{name}.xml']=f'<w:hdr xmlns:w="{W}"><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="{height*20}" w:lineRule="exact"/></w:pPr></w:p></w:hdr>'
 parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/header-{name}.xml" ContentType="{CT}header+xml"/></Types>')
 parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="{name}" Type="{R}/header" Target="header-{name}.xml"/></Relationships>')
cases=[]
for header in ['none','short','tall']:
 for base,offset,height in [('margin',100,36),('paragraph',-90,36),('page',-10,36),('paragraph',-90,900),('margin',-90,36)]:
  c=dict(page=len(cases),header=header,base=base,offset=offset,height=height);cases.append(c)
  p=E.SubElement(body,q('p'));pr=E.SubElement(p,q('pPr'));sp=E.SubElement(pr,q('spacing'))
  for k,v in [('before','0'),('after','0'),('line','240'),('lineRule','exact')]:sp.set(q(k),v)
  run=E.SubElement(p,q('r'));rp=E.SubElement(run,q('rPr'));fonts=E.SubElement(rp,q('rFonts'));fonts.set(q('ascii'),'Arial');fonts.set(q('hAnsi'),'Arial');E.SubElement(run,q('t')).text=f'{header} {base} {offset} height {height}'
  a=deepcopy(anchor);a.find('{'+WP+'}docPr').set('id',str(len(cases)));a.find('{'+WP+'}extent').set('cy',str(height*12700));a.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}xfrm/{http://schemas.openxmlformats.org/drawingml/2006/main}ext').set('cy',str(height*12700))
  for axis,value,b in [('H',400,'page'),('V',offset,base)]:
   pos=a.find('{'+WP+'}position'+axis);pos.clear();pos.set('relativeFrom',b);E.SubElement(pos,'{'+WP+'}posOffset').text=str(value*12700)
  E.SubElement(E.SubElement(p,q('r')),q('drawing')).append(a)
  sect=deepcopy(section)
  # The first sections have no header; later sections explicitly select one.
  ref=E.Element(q('headerReference'));ref.set(q('type'),'default');ref.set('{'+R+'}id',header if header!='none' else 'empty');
  if header!='none':sect.insert(0,ref)
  if len(cases)<15:E.SubElement(E.SubElement(body,q('p')),q('pPr')).append(sect)
  else:body.append(sect)
parts['word/header-empty.xml']=f'<w:hdr xmlns:w="{W}"/>'
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace('</Types>',f'<Override PartName="/word/header-empty.xml" ContentType="{CT}header+xml"/></Types>')
parts['word/_rels/document.xml.rels']=parts['word/_rels/document.xml.rels'].replace('</Relationships>',f'<Relationship Id="empty" Type="{R}/header" Target="header-empty.xml"/></Relationships>')
parts['word/document.xml']=E.tostring(r,xml_declaration=True,encoding='utf-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
