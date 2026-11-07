from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/legacy-continuation';out.mkdir(exist_ok=True)
w='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with ZipFile(root/'public/fixtures/reviewed-family.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);body=doc.find(w+'body');paragraphs=body.findall(w+'p');section=deepcopy(body.find(w+'sectPr'))
for n in list(body):body.remove(n)
for source in paragraphs[2:4]:
 body.append(deepcopy(source));p=deepcopy(source);texts=p.findall('.//'+w+'t');assert len(texts)==1
 texts[0].text='numbers 12345. Alpha beta gamma delta epsilon zeta eta theta.';body.append(p)
body.append(section);parts['word/document.xml']=E.tostring(doc)
with ZipFile(out/'source.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():
  entry=ZipInfo(name,(2026,9,29,0,0,0));entry.compress_type=ZIP_DEFLATED;z.writestr(entry,data)
print(out/'source.docx')
