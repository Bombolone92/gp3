from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
base=Path(__file__).resolve().parents[2]/'public/fixtures';W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';q=lambda n:'{'+W+'}'+n
with ZipFile(base/'paragraph-border-width-control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root.find(q('body'))
for n in list(body)[4:-1]:body.remove(n)
parts['word/document.xml']=E.tostring(root)
for name,font,size in [('arial20','Arial',40),('courier10','Courier New',20)]:
 styles=E.fromstring(parts['word/styles.xml']);styles.find('.//'+q('rFonts')).set(q('ascii'),font);styles.find('.//'+q('rFonts')).set(q('hAnsi'),font);styles.find('.//'+q('sz')).set(q('val'),str(size))
 with ZipFile(base/f'paragraph-border-default-{name}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,E.tostring(styles) if n=='word/styles.xml' else b)
