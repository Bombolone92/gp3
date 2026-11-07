"""Original page-edge table controls with fixed, automatic and nested widths."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1];W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
with ZipFile(ROOT/'public/fixtures/table-overflow-width-modern.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(q('body'));pbase=deepcopy(body.find(q('p')));tbase=deepcopy(body.find(q('tbl')));sect=deepcopy(body.find(q('sectPr')));body.clear()
cases=[('left edge','left',-1450,7200,'fixed'),('right edge','left',5000,7200,'fixed'),('center oversized','center',0,14400,'fixed'),('right oversized','right',0,14400,'fixed'),('fully left','left',-15000,7200,'fixed'),('fully right','left',15000,7200,'fixed'),('autofit oversized','left',-1450,14400,'autofit'),('nested oversized','left',-1450,14400,'fixed')]
cases.append(('nested positive indent','left',720,14400,'fixed'))
for i,(label,align,indent,width,layout) in enumerate(cases):
 p=deepcopy(pbase);p.find('.//'+q('t')).text='Page-edge tables: '+label
 if i:E.SubElement(p.find(q('pPr')),q('pageBreakBefore'))
 # Keep schema order: pageBreakBefore precedes spacing.
 pr=p.find(q('pPr'));br=pr.find(q('pageBreakBefore'))
 if br is not None:pr.remove(br);pr.insert(0,br)
 body.append(p);t=deepcopy(tbase);pr=t.find(q('tblPr'));pr.find(q('tblW')).set(q('w'),str(width));pr.find(q('jc')).set(q('val'),align);pr.find(q('tblInd')).set(q('w'),str(indent));pr.find(q('tblLayout')).set(q('type'),layout)
 for col in t.find(q('tblGrid')):col.set(q('w'),str(width//2))
 for cell in t.findall('.//'+q('tc')):cell.find(q('tcPr')).find(q('tcW')).set(q('w'),str(width//2))
 if i>=7:
  outer=deepcopy(tbase);outer.find(q('tblPr')).find(q('tblW')).set(q('w'),'7200');outer.find(q('tblPr')).find(q('tblLayout')).set(q('type'),'fixed');outer.find(q('tblGrid'))[0].set(q('w'),'3600');outer.find(q('tblGrid'))[1].set(q('w'),'3600')
  for c in outer.findall('.//'+q('tc')):c.find(q('tcPr')).find(q('tcW')).set(q('w'),'3600');c.find(q('tcPr')).find(q('shd')).set(q('fill'),'FFFFFF')
  c=outer.find('.//'+q('tc'));c.insert(1,t);body.append(outer)
 else:body.append(t)
body.append(deepcopy(pbase));body[-1].find('.//'+q('t')).text='End of controls';body.append(sect)
parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(ROOT/'public/fixtures/table-page-edge.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(ROOT/'tests/fixtures/table-page-edge').mkdir(exist_ok=True)
# The same authored layout also exercises legacy compatibility mode.
legacy=E.fromstring(parts['word/settings.xml']);legacy.find('.//'+q('compatSetting')).set(q('val'),'12')
parts['word/settings.xml']=E.tostring(legacy,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(ROOT/'public/fixtures/table-page-edge-legacy.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
