from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import sys
w=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
for mode,source,index in [('width-outer-thick-12','width-half',0),('width-outer-thick-15','width-half-15',0),('width-inner-thick-15','width-half-15',1)]:
 with ZipFile(w/f'nested-clipping-{source}.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);table=xml.findall('.//'+q('tbl'))[index]
 for border in table.find(q('tblPr')+'/'+q('tblBorders')):border.set(q('sz'),'32')
 parts['word/document.xml']=E.tostring(xml,encoding='UTF-8',xml_declaration=True)
 with ZipFile(w/f'nested-clipping-{mode}.docx','w') as z:
  for name,data in parts.items():
   info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
 print(mode)
