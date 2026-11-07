"""Original relative-sized line controls derived from our flat-line fixture."""
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
from pathlib import Path
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'tests/fixtures/flat-lines/flat-lines.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);ns=dict(r.nsmap);W=ns['w'];WP=ns['wp'];A=ns['a'];R='http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing';MC='http://schemas.openxmlformats.org/markup-compatibility/2006'
ns.update(wp14=R,mc=MC);out=E.Element(r.tag,nsmap=ns);out.set('{'+MC+'}Ignorable','wp14');body=E.SubElement(out,'{'+W+'}body');old=r.find('{'+W+'}body');ps=old.findall('{'+W+'}p')
cases=[(0,'width','page',50000),(1,'height','margin',25000),(2,'width','margin',50000),(3,'height','page',30000),(4,'width','page',50000),(5,'height','margin',25000),(0,'height','page',25000),(1,'width','page',25000),(0,'both','margin',25000),(1,'both','margin',25000)]
for i,(idx,axis,base,pct) in enumerate(cases):
 p=deepcopy(ps[idx*2]);pr=p.find('{'+W+'}pPr');br=pr.find('{'+W+'}pageBreakBefore')
 if i and br is None:pr.insert(0,E.Element('{'+W+'}pageBreakBefore'))
 if not i and br is not None:pr.remove(br)
 p.find('.//{'+W+'}t').text=f'Case {i+1}: {axis} {base} {pct}'
 anchor=p.find('.//{'+WP+'}anchor');anchor.find('{'+WP+'}docPr').set('id',str(i+1))
 for k in ['width','height'] if axis=='both' else [axis]:
  s=E.SubElement(anchor,'{'+R+'}sizeRel'+('H' if k=='width' else 'V'),relativeFrom=base);E.SubElement(s,'{'+R+'}pct'+('Width' if k=='width' else 'Height')).text=str(pct)
 body.append(p);body.append(deepcopy(ps[idx*2+1]))
body.append(deepcopy(old.find('{'+W+'}sectPr')));parts['word/document.xml']=E.tostring(out)
folder=root/'tests/fixtures/relative-flat-lines';folder.mkdir(exist_ok=True)
with ZipFile(folder/'flat-lines.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)

