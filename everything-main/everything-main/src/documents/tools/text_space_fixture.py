"""Original edge-whitespace controls; --nonconforming adds invalid ancestor declarations."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';XML='http://www.w3.org/XML/1998/namespace'
with ZipFile(root/'public/fixtures/exhausted-cell-indents.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.Element('{'+W+'}document',nsmap={'w':W});body=E.SubElement(doc,'{'+W+'}body')
cases=[('absent',None,None,' Alpha '),('default','t','default',' Alpha '),('preserve','t','preserve',' Alpha '),('spaces',None,None,'   '),('internal',None,None,'A  B'),('tabs',None,None,'\tAlpha\t'),('newlines',None,None,'\nAlpha\n')]
if '--nonconforming' in __import__('sys').argv:cases[3:3]=[('run','r','preserve',' Alpha '),('paragraph','p','preserve',' Alpha ')]
for label,scope,mode,text in cases:
 p=E.SubElement(body,'{'+W+'}p');pr=E.SubElement(p,'{'+W+'}pPr');E.SubElement(pr,'{'+W+'}spacing',{'{'+W+'}before':'0','{'+W+'}after':'0','{'+W+'}line':'280','{'+W+'}lineRule':'exact'})
 if scope=='p':p.set('{'+XML+'}space',mode)
 for value,active in [(label+'|',False),(text,True),('|end',False)]:
  r=E.SubElement(p,'{'+W+'}r');rp=E.SubElement(r,'{'+W+'}rPr');E.SubElement(rp,'{'+W+'}rFonts',{'{'+W+'}ascii':'Arial','{'+W+'}hAnsi':'Arial'});E.SubElement(rp,'{'+W+'}sz',{'{'+W+'}val':'20'})
  t=E.SubElement(r,'{'+W+'}t');t.text=value
  if active and scope=='t':t.set('{'+XML+'}space',mode)
  if active and scope=='r':r.set('{'+XML+'}space',mode)
s=E.SubElement(body,'{'+W+'}sectPr');E.SubElement(s,'{'+W+'}pgSz',{'{'+W+'}w':'12240','{'+W+'}h':'15840'});E.SubElement(s,'{'+W+'}pgMar',{**{'{'+W+'}'+k:'720' for k in ['top','bottom','left','right']},'{'+W+'}header':'360','{'+W+'}footer':'360','{'+W+'}gutter':'0'})
parts['word/document.xml']=E.tostring(doc)
with ZipFile(root/'tests/fixtures/text-space'/('inherited-nonconforming.docx' if '--nonconforming' in __import__('sys').argv else 'source.docx'),'w',ZIP_DEFLATED) as z:
 for n,v in parts.items():z.writestr(n,v)
