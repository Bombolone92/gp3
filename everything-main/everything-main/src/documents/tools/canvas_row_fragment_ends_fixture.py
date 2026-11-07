"""Manual OOXML variants for split row content bounds, spacing and alignment."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1];W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';N={'w':W};q=lambda s:'{'+W+'}'+s
with ZipFile(root/'public/fixtures/style-cell-borders.docx') as z:original={n:z.read(n) for n in z.namelist()}
output=root/'public/fixtures/row-fragment-ends';output.mkdir(exist_ok=True)
for case in ['bottom-neighbor','merged','spaced','minimum','contextual']:
 parts=dict(original);doc=E.fromstring(parts['word/document.xml']);rows=doc.findall('.//w:tbl/w:tr',N)
 if case=='bottom-neighbor':
  pr=rows[1].findall('w:tc',N)[1].find('w:tcPr',N)
  E.SubElement(pr,q('shd'),{q('val'):'clear',q('fill'):'FFFF00'})
  E.SubElement(pr,q('vAlign'),{q('val'):'bottom'})
 elif case=='merged':
  for i,row in enumerate(rows[1:]):
   cell=row.find('w:tc',N);pr=cell.find('w:tcPr',N)
   merge=E.Element(q('vMerge'),{q('val'):'restart' if i==0 else 'continue'});pr.insert(1,merge)
   if i:
    for p in cell.findall('w:p',N):cell.remove(p)
    E.SubElement(cell,q('p'))
 elif case in ['spaced','contextual']:
  for p in rows[1].find('w:tc',N).findall('w:p',N):
   pr=E.Element(q('pPr'));p.insert(0,pr);E.SubElement(pr,q('spacing'),{q('before'):'60',q('after'):'120'})
   if case=='contextual':E.SubElement(pr,q('contextualSpacing'))
 else:E.SubElement(rows[1].find('w:trPr',N),q('trHeight'),{q('val'):'2400',q('hRule'):'atLeast'})
 parts['word/document.xml']=E.tostring(doc,encoding='utf-8',xml_declaration=True)
 with ZipFile(output/f'{case}.docx','w',ZIP_DEFLATED) as z:
  for n,data in parts.items():z.writestr(n,data)


# Oversized after-spacing is retained as an explicit unresolved native reference.
with ZipFile(output/'spaced.docx') as z:parts={x:z.read(x) for x in z.namelist()}
r=E.fromstring(parts['word/document.xml']);cell=r.findall('.//w:tbl/w:tr',N)[1].find('w:tc',N)
for p in cell.findall('w:p',N)[2:]:cell.remove(p)
for p in cell.findall('w:p',N):p.find('w:pPr/w:spacing',N).set(q('after'),'8000')
parts['word/document.xml']=E.tostring(r,encoding='utf-8',xml_declaration=True)
with ZipFile(output/'oversized-spacing.docx','w',ZIP_DEFLATED) as z:
 for x,d in parts.items():z.writestr(x,d)
