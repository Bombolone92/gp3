"""Original mixed-width growth controls, contrasting a table preference with a merged-cell preference."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import xml.etree.ElementTree as E
import copy,json
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'tests/fixtures/mixed-growth-preference';out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
with ZipFile(ROOT/'tests/fixtures/mixed-cell-width-content/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(q('body'));template=copy.deepcopy(body.findall(q('tbl'))[1]);section=copy.deepcopy(body.find(q('sectPr')))
for c in list(body):body.remove(c)
cases=[]
for margin in [0,48]:
 for text in ['CCC','CCCCC']:
  for merged in [False,True]:
   if cases:
    p=E.SubElement(body,q('p'));r=E.SubElement(p,q('r'));E.SubElement(r,q('br'),{q('type'):'page'})
   table=copy.deepcopy(template)
   for cell in table.iter(q('tc')):
    pr=cell.find(q('tcPr'));m=pr.find(q('tcMar'))
    if m is None:m=E.SubElement(pr,q('tcMar'))
    for side in ['left','right']:
     v=m.find(q(side))
     if v is None:v=E.SubElement(m,q(side))
     v.set(q('w'),str(margin));v.set(q('type'),'dxa')
   rows=table.findall(q('tr'))
   for row in rows[2:-1]:
    for j,c in enumerate(row.findall(q('tc'))):
     ts=list(c.iter(q('t')))
     assert len(ts)==1
     ts[0].text=['A','B',text,'C'][j]
   footer=rows[-1].find(q('tc'));footer.find(q('tcPr')).find(q('tcW')).set(q('type'),'dxa' if merged else 'auto');footer.find(q('tcPr')).find(q('tcW')).set(q('w'),'6000' if merged else '0')
   body.append(table);cases.append(dict(marginTwips=margin,autoText=[text,'C'],mergedPreference=merged))
body.append(section);parts['word/document.xml']=E.tostring(doc,encoding='utf-8',xml_declaration=True)
with ZipFile(out/'control.docx','w')as z:
 for n,b in parts.items():
  i=ZipInfo(n,(2026,9,28,18,0,0));i.compress_type=ZIP_DEFLATED;i.create_system=0;i.external_attr=0o600<<16;z.writestr(i,b)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
