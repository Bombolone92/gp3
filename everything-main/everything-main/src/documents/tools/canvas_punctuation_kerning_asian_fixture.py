from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
import json
out=Path(__file__).resolve().parents[1]/'public/fixtures'
strings=['AVATAR','To','T.A','T,A','漢、字。','「日本語」','漢（字）','漢：字；','A、V。','漢,字.','한,글.','한（글）']
cases=[]
for font,lang in [('MS Gothic','ja-JP'),('Yu Gothic','ja-JP'),('Malgun Gothic','ko-KR')]:
 for kern in [0,2]:
  for text in strings:cases.append({'id':f'K{len(cases)+1:02}','font':font,'text':text,'kern':kern,'lang':lang})
paras=[]
for c in cases:
 fmt=f'<w:rFonts w:ascii="{c["font"]}" w:hAnsi="{c["font"]}" w:eastAsia="{c["font"]}"/><w:kern w:val="{c["kern"]}"/><w:sz w:val="48"/><w:lang w:val="en-US" w:eastAsia="{c["lang"]}"/>'
 paras.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="600" w:lineRule="exact"/></w:pPr><w:r><w:rPr>'+fmt+'</w:rPr><w:t xml:space="preserve">'+escape(c['id']+' '+c['text']+' |')+'</w:t></w:r></w:p>')
for flag in ['on','off','omitted']:
 with ZipFile(out/f'punctuation-kerning-{flag}.docx') as z: parts={n:z.read(n) for n in z.namelist()}
 old=parts['word/document.xml'].decode()
 parts['word/document.xml']=(old[:old.index('<w:body>')+8]+''.join(paras)+old[old.index('<w:sectPr>'):]).encode()
 with ZipFile(out/f'punctuation-kerning-asian-{flag}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
(out.parent.parent/'tests/fixtures/punctuation-kerning/punctuation-kerning-asian-cases.json').write_text(json.dumps(cases,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')

