"""Independent controls for unequal-column count precedence."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import sys
repo=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(repo/'tools'))
from canvas_anchor_position_fixture import make,W
out=repo/'tests/fixtures/column-count';out.mkdir(exist_ok=True)
for mode in [12,15]:
 for count in [None,1,2,3]:
  parts=make(mode)
  name=f'mode{mode}-num{count if count is not None else "omitted"}'
  attr='' if count is None else f' w:num="{count}"'
  cols=f'<w:cols{attr} w:equalWidth="0"><w:col w:w="1440" w:space="720"/><w:col w:w="3600"/></w:cols>'
  def p(text,br=''):
   return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr>'+br+f'<w:t>{text}</w:t></w:r></w:p>'
  body=p('FIRST')+p('SECOND','<w:br w:type="column"/>')+p('THIRD','<w:br w:type="column"/>')
  sect='<w:sectPr><w:pgSz w:w="7200" w:h="5760"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>'+cols+'</w:sectPr>'
  parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}{sect}</w:body></w:document>'
  with ZipFile(out/(name+'.docx'),'w',ZIP_DEFLATED) as z:
   for path,value in parts.items():z.writestr(path,value)
