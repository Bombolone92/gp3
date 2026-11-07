"""Original WPS symbol editing control; stdlib only, no corpus assets/fonts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import tempfile
import sys
import json
import drawing_text_editing_fixture as base

def generate(destination):
 destination.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='drawing-symbols-') as directory:
  base.ROOT=Path(directory);base.generate()
  with ZipFile(base.ROOT/'control.docx') as z:parts={name:z.read(name) for name in z.namelist()}
 document=parts['word/document.xml'].decode('utf-8')
 original=base.paragraph('Original second paragraph')
 cases=[{'font':'Arial','code':'0061','capitalization':'caps'},{'font':'Arial','code':'0061','capitalization':'smallCaps'},{'font':'Arial','code':'0041','capitalization':None}]
 for case in cases:
  properties='<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>'+('<w:'+case['capitalization']+'/>' if case['capitalization'] else '')+'</w:rPr>'
  replacement='<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r>'+properties+'<w:t xml:space="preserve">L </w:t></w:r><w:r>'+properties+f'<w:sym w:font="{case["font"]}" w:char="{case["code"]}"/></w:r><w:r>'+properties+'<w:t xml:space="preserve"> R</w:t></w:r></w:p>'
  document=document.replace(original,replacement,1)
 parts['word/document.xml']=document.encode('utf-8')
 with ZipFile(destination/'control.docx','w',ZIP_DEFLATED) as z:
  for name,value in parts.items():z.writestr(name,value)
 # Replace only each complete symbol run; keep neighboring font/caps settings.
 literal=document
 for case in cases:
  properties='<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="24"/>'+('<w:'+case['capitalization']+'/>' if case['capitalization'] else '')+'</w:rPr>'
  symbol='<w:r>'+properties+f'<w:sym w:font="{case["font"]}" w:char="{case["code"]}"/></w:r>'
  ordinary='<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr><w:t>'+chr(int(case['code'],16))+'</w:t></w:r>'
  literal=literal.replace(symbol,ordinary,1)
 with ZipFile(destination/'literal.docx','w',ZIP_DEFLATED) as z:
  for name,value in parts.items():z.writestr(name,literal.encode('utf-8') if name=='word/document.xml' else value)
 (destination/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
 print(destination/'control.docx')
if __name__=='__main__':generate(Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'tests/fixtures/drawing-text-symbols')
