"""Original OPC/XML paragraph and table border controls for native reference comparison."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
repo=Path(__file__).resolve().parents[1]
with ZipFile(repo/'public/fixtures/inline-object-baseline.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);ns=root.nsmap;body=root[0];sect=deepcopy(body[-1]);body.clear()
def tag(n):return '{'+ns['w']+'}'+n
def add(p,n,**a):return E.SubElement(p,tag(n),{tag(k):v for k,v in a.items()})
def borders(p,name,size):
 b=add(p,name)
 for side in ['top','left','bottom','right']:
  edge=add(b,side,val='thinThickLargeGap',sz=str(size),space='0',color='000000')
  if '--frame' in __import__('sys').argv:edge.set(tag('frame'),'1')
def para(text):
 p=add(body,'p');pr=add(p,'pPr');add(pr,'spacing',before='120',after='0');add(add(p,'r'),'t').text=text;return p
for context in ['paragraph','table']:
 for size in ([0,2,11,12,13,17] if '--edges' in __import__('sys').argv else [8,24,48,96]):
  para(f'{context}: thinThickLargeGap, size={size}/8 pt')
  if context=='paragraph':
   p=add(body,'p');pr=add(p,'pPr');borders(pr,'pBdr',size);add(pr,'spacing',before='0',after='120',line='480',lineRule='exact');add(pr,'ind',right='5040');add(add(p,'r'),'t').text='Border control'
  else:
   t=add(body,'tbl');pr=add(t,'tblPr');add(pr,'tblW',w='4320',type='dxa');borders(pr,'tblBorders',size);add(pr,'tblLayout',type='fixed');grid=add(t,'tblGrid');add(grid,'gridCol',w='4320');row=add(t,'tr');add(add(row,'trPr'),'trHeight',val='480',hRule='exact');c=add(row,'tc');add(add(c,'tcPr'),'tcW',w='4320',type='dxa');p=add(c,'p');add(add(p,'pPr'),'spacing',before='0',after='0');add(add(p,'r'),'t').text='Border control'
para('');body.append(sect);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(repo/'public/fixtures'/('compound-border-edges.docx' if '--edges' in __import__('sys').argv else 'compound-border-frame.docx' if '--frame' in __import__('sys').argv else 'compound-border-controls.docx'),'w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)


