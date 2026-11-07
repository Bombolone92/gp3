"""Original OPC/XML controls for page fill and automatic foreground colors."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
q=lambda n:'{'+W+'}'+n
def add(parent,name,**attrs):return E.SubElement(parent,q(name),{q(k):str(v) for k,v in attrs.items()})
def paragraph(parent,text,fill=None,color='auto',highlight=None,pagebreak=False,runfill=None):
 p=add(parent,'p');pr=add(p,'pPr')
 if pagebreak:add(pr,'pageBreakBefore')
 if fill:add(pr,'shd',val='clear',fill=fill)
 add(pr,'spacing',after=240)
 r=add(p,'r');rp=add(r,'rPr');add(rp,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,'sz',val=32);add(rp,'color',val=color)
 if highlight:add(rp,'highlight',val=highlight)
 if runfill:add(rp,'shd',val='clear',fill=runfill)
 add(r,'t').text=text
 return p
with ZipFile(root/'public/fixtures/picture-ellipse.docx') as z:base={n:z.read(n) for n in z.namelist()}
for name,color in [('dark','0A3556'),('light','EFEFEF')]:
 parts=dict(base);doc=E.Element(q('document'),nsmap={'w':W});add(doc,'background',color=color);body=add(doc,'body')
 paragraph(body,'PAGE AUTO')
 paragraph(body,'PARAGRAPH WHITE',fill='FFFFFF')
 paragraph(body,'PARAGRAPH DARK',fill='000000')
 paragraph(body,'HIGHLIGHT YELLOW',highlight='yellow')
 paragraph(body,'HIGHLIGHT BLACK',highlight='black')
 paragraph(body,'RUN WHITE',runfill='FFFFFF')
 paragraph(body,'RUN DARK',runfill='000000')
 paragraph(body,'EXPLICIT BLACK',color='000000')
 table=add(body,'tbl');pr=add(table,'tblPr');add(pr,'tblW',w=6000,type='dxa');add(pr,'tblLayout',type='fixed');grid=add(table,'tblGrid');add(grid,'gridCol',w=3000);add(grid,'gridCol',w=3000)
 tr=add(table,'tr')
 for label,fill in [('CELL AUTO',None),('CELL WHITE','FFFFFF')]:
  tc=add(tr,'tc');pr=add(tc,'tcPr');add(pr,'tcW',w=3000,type='dxa')
  if fill:add(pr,'shd',val='clear',fill=fill)
  paragraph(tc,label)
 paragraph(body,'SECOND PAGE AUTO',pagebreak=True)
 sect=add(body,'sectPr');add(sect,'pgSz',w=12240,h=15840);add(sect,'pgMar',top=1440,left=1440,right=1440,bottom=1440,header=720,footer=720,gutter=0)
 parts['word/document.xml']=E.tostring(doc,encoding='UTF-8',xml_declaration=True,standalone=True)
 with ZipFile(root/f'public/fixtures/page-background-{name}.docx','w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
