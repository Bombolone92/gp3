"""Independent variable-width paragraph and balanced-region controls."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from canvas_anchor_position_fixture import make,W
import sys
root=Path(__file__).resolve().parents[1]/'tests/fixtures/unequal-columns';root.mkdir(exist_ok=True)
def section(columns=True,continuous=False,third=False):
 cols='<w:cols w:num="3" w:equalWidth="0" w:sep="1"><w:col w:w="1440" w:space="720"/><w:col w:w="1440" w:space="720"/><w:col w:w="1440" w:space="0"/></w:cols>' if third else '<w:cols w:num="2" w:equalWidth="0" w:sep="1"><w:col w:w="1440" w:space="720"/><w:col w:w="3600"/></w:cols>'
 return '<w:sectPr>'+('<w:type w:val="continuous"/>' if continuous else '')+'<w:pgSz w:w="7200" w:h="5760"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>'+(cols if columns else '')+'</w:sectPr>'
def paragraph(text,end='',br=''):
 return '<w:p><w:pPr><w:widowControl w:val="0"/><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>'+end+'</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>'+br+'<w:t xml:space="preserve">'+text+'</w:t></w:r></w:p>'
for name in sys.argv[1:] or ['flow','balanced','break','three']:
 parts=make(15)
 text=' '.join('word%02d'%i for i in range(80 if name=='flow' else 18 if name=='three' else 22))
 body=paragraph(text)
 if name=='break':body+=paragraph(' '.join('next%02d'%i for i in range(20)),br='<w:br w:type="column"/>')
 if name=='balanced':body+=paragraph('',end=section())+paragraph('AFTER COLUMNS')+section(False,True)
 else:body+=section(third=name=='three')
 parts['word/document.xml']=f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
 with ZipFile(root/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for path,value in parts.items():z.writestr(path,value)
