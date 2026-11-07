"""Original AutoFit controls for paragraph-relative unwrapped pictures."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
from canvas_group_fixture import tag,add,NS
import json
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/cell-anchor-autofit';OUT.mkdir(exist_ok=True)
with ZipFile(ROOT/'tests/fixtures/mixed-cell-anchors/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml']);body=r.find(tag('w:body'));base=body.findall(tag('w:tbl'))[2];sect=deepcopy(body.find(tag('w:sectPr')));nodes=[];cases=[]
styles=E.fromstring(parts['word/styles.xml']);rp=styles.find('w:docDefaults/w:rPrDefault/w:rPr',NS);rp.insert(0,E.Element(tag('w:rFonts'),{tag('w:'+k):'Arial' for k in ['ascii','hAnsi','eastAsia','cs']}));parts['word/styles.xml']=E.tostring(styles)
for width in [36,72,90]:
 for offset in [-6,0,6]:
  i=len(cases);tbl=deepcopy(base);heading=deepcopy(base.getprevious())
  for br in heading.findall('.//'+tag('w:pageBreakBefore')):br.getparent().remove(br)
  if i:heading.find(tag('w:pPr')).insert(0,E.Element(tag('w:pageBreakBefore')))
  heading.find('.//'+tag('w:t')).text=f'Cell anchor AutoFit width={width} x={offset}'
  pr=tbl.find(tag('w:tblPr'));pr.find(tag('w:tblW')).set(tag('w:w'),'2880');pr.find(tag('w:tblLayout')).set(tag('w:type'),'autofit')
  for c in tbl.find(tag('w:tblGrid')):c.set(tag('w:w'),'1440')
  for c in tbl.findall('.//'+tag('w:tcW')):c.set(tag('w:w'),'1440')
  for side in ['left','right']:pr.find('w:tblCellMar/w:'+side,NS).set(tag('w:w'),'120')
  a=tbl.find('.//'+tag('wp:anchor'));a.find(tag('wp:docPr')).set('id',str(i+1));a.find(tag('wp:positionH')).find(tag('wp:posOffset')).text=str(offset*12700);a.find(tag('wp:positionV')).set('relativeFrom','paragraph');a.find(tag('wp:extent')).set('cx',str(width*12700))
  a.find('.//pic:spPr/a:xfrm/a:ext',NS).set('cx',str(width*12700))
  nodes.extend([heading,tbl,deepcopy(base.getnext())]);cases.append(dict(page=i,width=width,offset=offset))
body.clear();body.extend(nodes);body.append(sect);parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(OUT/'control.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(OUT/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
