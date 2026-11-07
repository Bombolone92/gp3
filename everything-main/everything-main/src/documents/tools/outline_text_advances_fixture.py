from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
repo=Path(__file__).resolve().parents[1];out=repo/'tests/fixtures/outline-text-advances/control.docx'
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def n(p,t,**a):return E.SubElement(p,'{'+W+'}'+t,{'{'+W+'}'+k:str(v) for k,v in a.items()})
root=E.Element('{'+W+'}document',nsmap={'w':W});body=n(root,'body');cases=[]
for family in ['Cambria','Arial','Calibri']:
 for size in [10,11,12,14]:
  for bold in [False,True]:
   idx=len(cases);cases.append(dict(index=idx,font=family,size=size,bold=bold))
   p=n(body,'p');pr=n(p,'pPr')
   if idx:n(pr,'pageBreakBefore')
   n(pr,'spacing',before=0,after=0,line=240,lineRule='auto')
   for text,color in [(f'Control {idx:02d}: HAMBURG AVENUE | WINTER 2048','000000'),('END','CC0000')]:
    r=n(p,'r');rp=n(r,'rPr');n(rp,'rFonts',ascii=family,hAnsi=family)
    if bold:n(rp,'b')
    n(rp,'color',val=color);n(rp,'sz',val=size*2);n(r,'t').text=text
   for repeated in [1,2]:
    p=n(body,'p');pr=n(p,'pPr');n(pr,'spacing',before=120,after=0,line=240,lineRule='auto');r=n(p,'r');rp=n(r,'rPr');n(rp,'rFonts',ascii=family,hAnsi=family)
    if bold:n(rp,'b')
    n(rp,'sz',val=size*2);t=n(r,'t');t.text=('HAMBURG AVENUE | WINTER 2048 | EASTERN COMMUNITY COLLEGE '*repeated).strip()
s=n(body,'sectPr');n(s,'pgSz',w=12240,h=15840);n(s,'pgMar',top=720,right=1152,bottom=720,left=1152,header=360,footer=360,gutter=0)
with ZipFile(repo/'tests/fixtures/latin-ligature-defaults/control-0.docx') as z:parts={k:z.read(k) for k in z.namelist()}
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out,'w',ZIP_DEFLATED) as z:
 for k,v in parts.items():z.writestr(k,v)
out.with_name('cases.json').write_text(json.dumps(cases,indent=2))


