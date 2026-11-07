"""Original OPC/XML controls for empty hidden-cell paragraph spacing.

Uses the independently authored hidden-cell-mark fixture only as an OPC scaffold.
Export the output through the installed reference application; retain that PDF separately as evidence.
"""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
repo=Path(__file__).resolve().parents[1]
with ZipFile(repo/'public/fixtures/hidden-cell-mark.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);body=root[0];sect=body[-1];body.remove(sect);body.clear();W=root.nsmap['w']
def add(p,n,**attrs):return E.SubElement(p,'{'+W+'}'+n,{'{'+W+'}'+k:str(v) for k,v in attrs.items()})
cases=[('auto-zero','auto',240,0,0),('auto-before','auto',240,160,0),('auto-after','auto',240,0,160),('auto-both','auto',240,160,160),('exact-zero','exact',240,0,0),('exact-both','exact',240,160,160),('minimum-zero','atLeast',240,0,0),('minimum-both','atLeast',240,160,160)]
for name,rule,line,before,after in cases:
 p=add(body,'p');pr=add(p,'pPr');add(pr,'spacing',before=0,after=0,line=240,lineRule='exact');r=add(p,'r');rp=add(r,'rPr');add(rp,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,'sz',val=16);add(r,'t').text=name
 t=add(body,'tbl');tp=add(t,'tblPr');add(tp,'tblW',w=2880,type='dxa');b=add(tp,'tblBorders')
 for side in ['top','left','bottom','right']:add(b,side,val='single',sz=4,color='000000')
 add(tp,'tblLayout',type='fixed');m=add(tp,'tblCellMar')
 for side in ['top','left','bottom','right']:add(m,side,w=0,type='dxa')
 add(add(t,'tblGrid'),'gridCol',w=2880);row=add(t,'tr');add(add(row,'trPr'),'trHeight',val=60,hRule='atLeast');c=add(row,'tc');cp=add(c,'tcPr');add(cp,'tcW',w=2880,type='dxa');add(cp,'hideMark');p=add(c,'p');pr=add(p,'pPr');add(pr,'spacing',before=before,after=after,line=line,lineRule=rule);rp=add(pr,'rPr');add(rp,'sz',val=72)
add(body,'p');body.append(sect);parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(repo/'public/fixtures/hidden-cell-spacing-controls.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)

