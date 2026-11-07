from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import sys
work=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables'
work.mkdir(parents=True,exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
for mode in ['width-half','width-full']:
 with ZipFile(work/'nested-clipping-inner-exact.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);tables=xml.findall('.//'+q('tbl'));inner=tables[1]
 for height in xml.findall('.//'+q('trHeight')):height.getparent().remove(height)
 width=inner.find(q('tblPr')+'/'+q('tblW'));width.set(q('type'),'pct');width.set(q('w'),'2500' if mode=='width-half' else '5000')
 inner.find(q('tblPr')+'/'+q('tblLayout')).set(q('type'),'autofit')
 for cellWidth in inner.findall('.//'+q('tcW')):cellWidth.set(q('type'),'auto');cellWidth.set(q('w'),'0')
 parts['word/document.xml']=E.tostring(xml,xml_declaration=True,encoding='UTF-8')
 path=work/f'nested-clipping-{mode}.docx'
 with ZipFile(path,'w') as z:
  for name,data in parts.items():
   info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
 print(path)
