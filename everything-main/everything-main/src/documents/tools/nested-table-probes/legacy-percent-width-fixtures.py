from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from lxml import etree as E
import sys
w=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[2]/'tests/fixtures/nested-tables';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda s:'{'+W+'}'+s
for mode,margin,layout in [('align-legacy-pct-zero',0,'autofit'),('align-legacy-pct-wide',240,'autofit'),('align-legacy-pct-fixed',60,'fixed')]:
 with ZipFile(w/'nested-clipping-align-outer-pct-12.docx') as z:parts={n:z.read(n) for n in z.namelist()}
 xml=E.fromstring(parts['word/document.xml']);props=xml.find('.//'+q('tbl')).find(q('tblPr'));props.find(q('tblLayout')).set(q('type'),layout)
 for side in ['left','right']:props.find(q('tblCellMar')+'/'+q(side)).set(q('w'),str(margin))
 parts['word/document.xml']=E.tostring(xml,encoding='UTF-8',xml_declaration=True)
 with ZipFile(w/f'nested-clipping-{mode}.docx','w') as z:
  for name,data in parts.items():
   info=ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;z.writestr(info,data)
 print(mode)
