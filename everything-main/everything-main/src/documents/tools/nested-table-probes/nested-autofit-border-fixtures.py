from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import sys
w=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
for mode in ['autofit-parent-fixed','autofit-parent-dxa','autofit-parent-deep']:
 with ZipFile(w/'nested-clipping-align-inner-dxa.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);outer,inner=xml.findall('.//'+q('tbl'))
 def auto(table):
  props=table.find(q('tblPr'));props.find(q('tblW')).set(q('type'),'auto');props.find(q('tblW')).set(q('w'),'0');props.find(q('tblLayout')).set(q('type'),'autofit')
  for col in table.find(q('tblGrid')):col.set(q('w'),'0')
  for row in table.findall(q('tr')):
   for cell in row.findall(q('tc')):
    width=cell.find(q('tcPr')+'/'+q('tcW'));width.set(q('type'),'auto');width.set(q('w'),'0')
 auto(outer)
 if mode!='autofit-parent-dxa':inner.find(q('tblPr')+'/'+q('tblLayout')).set(q('type'),'fixed')
 if mode=='autofit-parent-deep':
  deep=deepcopy(inner)
  for border in deep.find(q('tblPr')+'/'+q('tblBorders')):border.set(q('color'),'B4D7FF')
  for fill in deep.findall('.//'+q('shd')):fill.set(q('fill'),'B4D7FF')
  cell=inner.find(q('tr')+'/'+q('tc'));terminal=deepcopy(cell.find(q('p')));terminal.find('.//'+q('t')).text='Middle terminal'
  for node in list(cell):
   if node.tag!=q('tcPr'):cell.remove(node)
  cell.append(deep);cell.append(terminal);auto(inner)
  for border in inner.find(q('tblPr')+'/'+q('tblBorders')):border.set(q('sz'),'16')
 parts['word/document.xml']=E.tostring(xml,encoding='UTF-8',xml_declaration=True)
 with ZipFile(w/f'nested-clipping-{mode}.docx','w') as z:
  for name,data in parts.items():
   info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
 print(mode)
