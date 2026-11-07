"""Original reference controls for explicit column breaks."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
from zipfile import ZipFile,ZIP_DEFLATED
from xml.etree import ElementTree as E
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';E.register_namespace('w',W)
def el(p,tag,**a):return E.SubElement(p,'{'+W+'}'+tag,{'{'+W+'}'+k:str(v) for k,v in a.items()})
with ZipFile(ROOT/'public/fixtures/exhausted-cell-indents.docx') as z:base={n:z.read(n) for n in z.namelist()}
for name,columns,paras in [('inline',2,['Before|After']),('terminal',2,['Before|','After']),('leading',2,['|After']),('repeated',2,['Before||After']),('single',1,['Before|After']),('terminal-single',1,['Before|','After'])]:
 parts=base.copy();r=E.Element('{'+W+'}document');body=el(r,'body')
 for text in paras:
  p=el(body,'p');pp=el(p,'pPr');el(pp,'spacing',before=0,after=0,line=240,lineRule='exact');run=el(p,'r');rp=el(run,'rPr');el(rp,'rFonts',ascii='Arial',hAnsi='Arial');el(rp,'sz',val=20)
  for i,t in enumerate(text.split('|')):
   if i:el(run,'br',type='column')
   if t:el(run,'t').text=t
 s=el(body,'sectPr');el(s,'pgSz',w=6120,h=7920);el(s,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0);el(s,'cols',num=columns,space=360)
 parts['word/document.xml']=E.tostring(r)
 with ZipFile(ROOT/f'tests/fixtures/column-breaks/{name}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
