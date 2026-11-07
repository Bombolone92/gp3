"""Original minimum-line controls; requires the original column-boundary scaffold."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/minimum-line-baselines';out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
E.register_namespace('w',W)
with ZipFile(root/'tests/fixtures/column-break-boundaries/large.docx') as z: parts={n:z.read(n) for n in z.namelist()}
for mark in [10,11,12]:
 for rule in ['atLeast','auto']:
  p=parts.copy();doc=E.fromstring(p['word/document.xml']);body=doc.find('{'+W+'}body')
  for node in list(body)[:-2]:body.remove(node)
  para=body.find('{'+W+'}p')
  for run in list(para.findall('{'+W+'}r')):
   if run.find('{'+W+'}br') is not None:para.remove(run)
  pr=para.find('{'+W+'}pPr');spacing=pr.find('{'+W+'}spacing');spacing.set('{'+W+'}lineRule',rule)
  rpr=E.SubElement(pr,'{'+W+'}rPr');E.SubElement(rpr,'{'+W+'}sz',{'{'+W+'}val':str(mark*2)})
  p['word/document.xml']=E.tostring(doc)
  with ZipFile(out/f'mark{mark}-{rule}.docx','w',ZIP_DEFLATED) as z:
   for n,v in p.items():z.writestr(n,v)
print(out)

for font in ['Arial','Times New Roman','Calibri']:
 for size in [10,16]:
  for minimum in [6,18,24]:
   p=parts.copy();doc=E.fromstring(p['word/document.xml']);body=doc.find('{'+W+'}body')
   sect=list(body)[-1]
   for node in list(body):body.remove(node)
   para=E.SubElement(body,'{'+W+'}p');pr=E.SubElement(para,'{'+W+'}pPr')
   E.SubElement(pr,'{'+W+'}spacing',{'{'+W+'}before':'0','{'+W+'}after':'0','{'+W+'}line':str(minimum*20),'{'+W+'}lineRule':'atLeast'})
   run=E.SubElement(para,'{'+W+'}r');rpr=E.SubElement(run,'{'+W+'}rPr')
   E.SubElement(rpr,'{'+W+'}rFonts',{'{'+W+'}ascii':font,'{'+W+'}hAnsi':font})
   E.SubElement(rpr,'{'+W+'}sz',{'{'+W+'}val':str(size*2)})
   for i in range(3):
    if i:E.SubElement(run,'{'+W+'}br')
    E.SubElement(run,'{'+W+'}t').text='After'
   body.append(sect);p['word/document.xml']=E.tostring(doc)
   name=f'{font.replace(" ","")}-{size}-{minimum}'
   with ZipFile(out/(name+'.docx'),'w',ZIP_DEFLATED) as z:
    for n,v in p.items():z.writestr(n,v)
