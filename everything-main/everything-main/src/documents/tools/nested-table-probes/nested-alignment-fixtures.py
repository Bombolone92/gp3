from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import sys
w=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
cases=[('align-outer-center','width-outer-thick-15',0,'center'),('align-outer-right','width-outer-thick-15',0,'right'),('align-inner-center','width-inner-thick-15',1,'center'),('align-inner-right','width-inner-thick-15',1,'right'),('align-inner-dxa','width-inner-thick-15',1,'dxa'),('align-inner-fixed','width-inner-thick-15',1,'fixed')]
for mode,source,index,kind in cases:
 with ZipFile(w/f'nested-clipping-{source}.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);props=xml.findall('.//'+q('tbl'))[index].find(q('tblPr'))
 if kind in ['center','right']:
  jc=E.Element(q('jc'));jc.set(q('val'),kind);props.insert(1,jc)
 elif kind=='dxa':
  width=props.find(q('tblW'));width.set(q('type'),'dxa');width.set(q('w'),'2340')
 elif kind=='fixed':props.find(q('tblLayout')).set(q('type'),'fixed')
 parts['word/document.xml']=E.tostring(xml,encoding='UTF-8',xml_declaration=True)
 with ZipFile(w/f'nested-clipping-{mode}.docx','w') as z:
  for name,data in parts.items():
   info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
 print(mode)
