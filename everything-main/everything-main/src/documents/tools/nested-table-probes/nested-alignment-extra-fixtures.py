from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import sys
w=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
for mode,source,index,kind in [('align-outer-pct-15','width-outer-thick-15',0,'pct'),('align-outer-pct-12','width-outer-thick-12',0,'pct'),('align-outer-asym-center','align-outer-center',0,'asym'),('align-inner-asym-center','align-inner-center',1,'asym')]:
 with ZipFile(w/f'nested-clipping-{source}.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);props=xml.findall('.//'+q('tbl'))[index].find(q('tblPr'))
 if kind=='pct':
  width=props.find(q('tblW'));width.set(q('type'),'pct');width.set(q('w'),'2500');props.find(q('tblLayout')).set(q('type'),'autofit')
  for width in xml.findall('.//'+q('tcW')):width.set(q('type'),'auto');width.set(q('w'),'0')
 else:props.find(q('tblBorders')+'/'+q('right')).set(q('sz'),'8')
 parts['word/document.xml']=E.tostring(xml,encoding='UTF-8',xml_declaration=True)
 with ZipFile(w/f'nested-clipping-{mode}.docx','w') as z:
  for name,data in parts.items():
   info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
 print(mode)
