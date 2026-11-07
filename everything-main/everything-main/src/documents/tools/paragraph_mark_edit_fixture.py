from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json
repo=Path(__file__).resolve().parents[1]
root=repo/'tests/fixtures/paragraph-mark-edit';root.mkdir(exist_ok=True)
with ZipFile(repo/'tests/fixtures/script-size-commands/control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
cases=[dict(name=name,start=a,end=b,text=text) for name,a,b,text in [('split-middle',1,1,'\n'),('split-end',2,2,'\n'),('split-start',0,0,'\n'),('split-twice',1,1,'\n\n'),('batch',1,1,'X\nY'),('merge-middle',1,4,''),('replace-crossing',1,4,'\n'),('replace-all-text',0,5,'X'),('delete-mark',2,3,''),('split-last-end',5,5,'\n'),('split-last-middle',4,4,'\n')]]
body=[]
for _ in cases:
 for text,size,mark,color in [('AB',24,12,'0000FF'),('CD',30,18,'FF0000')]:
  body.append(f'<w:p><w:pPr><w:rPr><w:color w:val="{color}"/><w:sz w:val="{mark*2}"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="{size*2}"/></w:rPr><w:t>{text}</w:t></w:r></w:p>')
parts['word/document.xml']=f'<w:document xmlns:w="{w}"><w:body>{"".join(body)}<w:sectPr/></w:body></w:document>'.encode()
with ZipFile(root/'control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(root/'cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8')
