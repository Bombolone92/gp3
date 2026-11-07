from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
repo=Path(__file__).resolve().parents[1]
w=repo/'tests/fixtures/text-contrast';w.mkdir(parents=True,exist_ok=True)

with ZipFile(repo/'tests/fixtures/automatic-table-borders/controls.docx') as z: parts={n:z.read(n) for n in z.namelist()}
body=[];cases=[]
for font in ['Century Gothic','Arial','Times New Roman','Harrington']:
 for fg,bg in [('123456','FFFFFF'),('FFFFFF','123456')]:
  text='Celebrate with friends, games, food, and more.'
  body.append(f'<w:p><w:pPr><w:shd w:val="clear" w:fill="{bg}"/><w:spacing w:before="0" w:after="240" w:line="600" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="{font}" w:hAnsi="{font}"/><w:color w:val="{fg}"/><w:sz w:val="36"/></w:rPr><w:t>{text}</w:t></w:r></w:p>')
  cases.append(dict(font=font,fg=fg,bg=bg,text=text))
parts['word/document.xml']=('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(body)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(w/'controls.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(w/'cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8')

