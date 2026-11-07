"""Original two-column controls isolating zero-margin noWrap allowances."""
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from xml.etree import ElementTree as E
from copy import deepcopy
import json
import base64
r=Path(__file__).resolve().parents[1];out=r/'tests/fixtures/nowrap-edge-allowance';out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda n:'{'+W+'}'+n;E.register_namespace('w',W)
with ZipFile(r/'tests/fixtures/mixed-cell-width-content/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}

# The one-pixel blue square and its DrawingML are authored for this control.
parts['word/media/integer.png']=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC')
rels=E.fromstring(parts['word/_rels/document.xml.rels'])
E.SubElement(rels,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id='integerProbe',Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',Target='media/integer.png')
parts['word/_rels/document.xml.rels']=E.tostring(rels,encoding='utf-8')
types=E.fromstring(parts['[Content_Types].xml'])
E.SubElement(types,'{http://schemas.openxmlformats.org/package/2006/content-types}Default',Extension='png',ContentType='image/png')
parts['[Content_Types].xml']=E.tostring(types,encoding='utf-8')

doc=E.fromstring(parts['word/document.xml']);body=doc.find(q('body'));section=deepcopy(body.find(q('sectPr')));base=deepcopy(body.find(q('tbl')));label=deepcopy(body.find(q('p')));rows=base.findall(q('tr'));first=deepcopy(rows[2].findall(q('tc'))[0]);picture=deepcopy(rows[2].findall(q('tc'))[2]);footer=deepcopy(rows[-1].find(q('tc')));body.clear();cases=[]
for pref in [240,2400]:
 for left,right in [(0,0),(1,0),(0,1),(8,0),(0,48),(48,48)]:
  for nowrap in [False,True]:
   p=deepcopy(label);p.find('.//'+q('t')).text='Two-column '+str(len(cases)+1)
   if cases:p.find(q('pPr')).insert(0,E.Element(q('pageBreakBefore')))
   body.append(p);t=deepcopy(base)
   for row in list(t.findall(q('tr'))):t.remove(row)
   for m in t.find(q('tblPr')).find(q('tblCellMar')):m.set(q('w'),str(left if m.tag==q('left') else right if m.tag==q('right') else 0))
   grid=t.find(q('tblGrid'));grid.clear()
   for w in [pref,40]:E.SubElement(grid,q('gridCol'),{q('w'):str(w)})
   row=E.SubElement(t,q('tr'));tc=deepcopy(first);tc.find(q('tcPr')).find(q('tcW')).set(q('w'),str(pref));tc.find('.//'+q('t')).text='.';tc.find('.//'+q('sz')).set(q('val'),'18');row.append(tc)
   tc=deepcopy(picture)
   p=tc.find(q('p'))
   for run in list(p.findall(q('r'))):p.remove(run)
   E.SubElement(p,q('r')).append(E.fromstring('<ns0:drawing xmlns:ns0="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:ns1="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:ns2="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:ns3="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:ns4="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><ns1:inline><ns1:extent cx="25400" cy="127000" />\n                      <ns1:docPr id="1" name="Original integer-width square 1" />\n                      <ns2:graphic><ns2:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">\n                      <ns3:pic><ns3:nvPicPr><ns3:cNvPr id="0" name="Original square" /><ns3:cNvPicPr /></ns3:nvPicPr>\n                      <ns3:blipFill><ns2:blip ns4:embed="integerProbe" /><ns2:stretch><ns2:fillRect /></ns2:stretch></ns3:blipFill>\n                      <ns3:spPr><ns2:xfrm><ns2:off x="0" y="0" /><ns2:ext cx="25400" cy="127000" /></ns2:xfrm>\n                      <ns2:prstGeom prst="rect"><ns2:avLst /></ns2:prstGeom></ns3:spPr></ns3:pic>\n                      </ns2:graphicData></ns2:graphic></ns1:inline></ns0:drawing>'))
   for el in tc.iter():
    if el.tag.endswith('}extent') or el.tag.endswith('}ext'):el.set('cx',str(40*635))
    if el.tag.endswith('}docPr'):el.set('id',str(len(cases)+1))
   row.append(tc);row=E.SubElement(t,q('tr'));tc=deepcopy(footer);tc.find(q('tcPr')).find(q('gridSpan')).set(q('val'),'2');tc.find('.//'+q('t')).text='.';tc.find('.//'+q('sz')).set(q('val'),'18')
   if nowrap:E.SubElement(tc.find(q('tcPr')),q('noWrap'))
   row.append(tc);body.append(t);cases.append(dict(preference=pref,imageWidthTwips=40,leftMargin=left,rightMargin=right,footerNoWrap=nowrap))
body.append(section);parts['word/document.xml']=E.tostring(doc,encoding='utf-8',xml_declaration=True)
with ZipFile(out/'control.docx','w') as z:
 for n,b in parts.items():
  i=ZipInfo(n,(2026,9,28,18,0,0));i.create_system=0;i.external_attr=0o600<<16;z.writestr(i,b,compress_type=ZIP_DEFLATED)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
