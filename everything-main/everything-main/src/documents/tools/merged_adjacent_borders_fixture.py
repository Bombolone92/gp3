"""Independent merged-cell controls with borders in adjacent columns."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/merged-adjacent-borders';out.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def n(p,t,**a):return E.SubElement(p,'{'+W+'}'+t,{'{'+W+'}'+k:str(v) for k,v in a.items()})
def para(parent,text='',size=10,space=0,page=False):
 p=n(parent,'p');pr=n(p,'pPr')
 if page:n(pr,'pageBreakBefore')
 n(pr,'spacing',before=space,after=space,line=271,lineRule='auto');rp=n(pr,'rPr');n(rp,'rFonts',ascii='Arial',hAnsi='Arial');n(rp,'sz',val=size*2)
 r=n(p,'r');rp=n(r,'rPr');n(rp,'rFonts',ascii='Arial',hAnsi='Arial');n(rp,'sz',val=size*2);n(r,'t').text=text
 return p
def cell(tr,width,merge=None,span=None,borders=(),text='',size=10,space=0,center=False,padding=None):
 tc=n(tr,'tc');pr=n(tc,'tcPr');n(pr,'tcW',w=width,type='dxa')
 if span:n(pr,'gridSpan',val=span)
 if merge:n(pr,'vMerge',**({'val':'restart'} if merge=='restart' else {}))
 if borders:
  b=n(pr,'tcBorders')
  for side in ['top','left','bottom','right']:
   if side in borders:n(b,side,val='single',sz=12,color='7030A0')
 if padding:
  m=n(pr,'tcMar');n(m,'top',w=padding[0],type='dxa');n(m,'bottom',w=padding[1],type='dxa')
 if center:n(pr,'vAlign',val='center')
 para(tc,text,size,space)
with ZipFile(root/'tests/fixtures/latin-ligature-defaults/control-0.docx') as z:parts={k:z.read(k) for k in z.namelist()}
doc=E.Element('{'+W+'}document',nsmap={'w':W});body=n(doc,'body');cases=[]
for padded in [False,True]:
 for minimum in [False,True]:
  for outer,inner in [(False,False),(True,False),(False,True),(True,True)]:
   index=len(cases);cases.append(dict(index=index,minimum=minimum,outer=outer,inner=inner,padded=padded));para(body,f'Control {index}',page=index>0)
   table=n(body,'tbl');pr=n(table,'tblPr');n(pr,'tblW',w=9000,type='dxa');n(pr,'tblLayout',type='fixed');m=n(pr,'tblCellMar')
   for side in ['top','left','bottom','right']:n(m,side,w=0,type='dxa')
   grid=n(table,'tblGrid')
   for width in [3000,3000,3000]:n(grid,'gridCol',w=width)
   for i in range(3):
    tr=n(table,'tr')
    if minimum:
     pr=n(tr,'trPr');n(pr,'trHeight',val=[243,72,500][i],hRule='atLeast')
    cell(tr,3000,'restart' if i==0 else 'continue',borders=(['top','left','right','bottom'] if outer else []),text='Sidebar' if i==0 else '',padding=([144 if i==0 else 72,72] if padded else None))
    if i<2:
     cell(tr,3000,'restart' if i==0 else 'continue',text='Heading' if i==0 else '',size=14 if i==0 else 10,space=120 if i==0 else 0,center=i==0)
     cell(tr,3000,borders=([['bottom'],['top']][i] if inner else []))
    else:cell(tr,6000,span=2,text='Following')
   para(body,'After')
sect=n(body,'sectPr');n(sect,'pgSz',w=12240,h=15840);n(sect,'pgMar',top=720,right=720,bottom=720,left=720,header=360,footer=360,gutter=0)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(out/'control.docx','w',ZIP_DEFLATED) as z:
 for k,v in parts.items():z.writestr(k,v)
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
