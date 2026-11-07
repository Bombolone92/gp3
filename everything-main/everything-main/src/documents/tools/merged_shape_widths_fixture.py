"""Original six-case merged AutoFit control; no corpus content or external assets."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/merged-shape-widths'
root.mkdir(exist_ok=True)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
ns={'w':W,'wp':'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
def tag(n):return '{'+W+'}'+n
def add(parent,n,**attrs):return E.SubElement(parent,tag(n),{tag(k):str(v) for k,v in attrs.items()})
A=ns['a'];WP=ns['wp'];WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'}
doc=E.Element(tag('document'),nsmap={**ns,'wps':WPS});body=add(doc,'body')
shape=E.fromstring(f'''<w:drawing xmlns:w="{W}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:wps="{WPS}"><wp:inline><wp:extent cx="914400" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Original rectangle"/><a:graphic><a:graphicData uri="{WPS}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="0080C0"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing>''')
cases=[]
for size in [30,42,60]:
 for count in [0,30]:
  case={'index':len(cases),'shapeWidthPt':size,'underscores':count};cases.append(case)
  p=add(body,'p');pr=add(p,'pPr')
  if case['index']:add(pr,'pageBreakBefore')
  add(add(p,'r'),'t').text=f'{size} point rectangle, {count} underscores'
  tbl=add(body,'tbl');pr=add(tbl,'tblPr');add(pr,'tblW',w=4800,type='dxa')
  borders=add(pr,'tblBorders')
  for edge in ['top','left','bottom','right','insideH','insideV']:add(borders,edge,val='single',sz=8,color='008000')
  margins=add(pr,'tblCellMar')
  for edge in ['top','left','bottom','right']:add(margins,edge,w=115,type='dxa')
  grid=add(tbl,'tblGrid')
  for width in [900,3000,900]:add(grid,'gridCol',w=width)
  for ri, cells in enumerate([[(3,4800,'_'*count)],[(2,3900,''),(1,900,'shape')],[(1,900,'shape'),(2,3900,'')]]):
   row=add(tbl,'tr')
   for ci,(span,width,text) in enumerate(cells):
    cell=add(row,'tc');cp=add(cell,'tcPr');add(cp,'tcW',w=width,type='dxa')
    if span>1:add(cp,'gridSpan',val=span)
    p=add(cell,'p');pp=add(p,'pPr');add(pp,'spacing',before=0,after=0);r=add(p,'r');rp=add(r,'rPr');add(rp,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,'sz',val=24)
    if text=='shape':
     d=deepcopy(shape);d.find('.//wp:extent',ns).set('cx',str(size*12700));d.find('.//a:ext',ns).set('cx',str(size*12700));d.find('.//wp:docPr',ns).set('id',str(case['index']*10+ri*2+ci+1));r.append(d)
    else:add(r,'t').text=text
sec=add(body,'sectPr');add(sec,'pgSz',w=12240,h=15840);add(sec,'pgMar',top=1440,right=1440,bottom=1440,left=1440,header=720,footer=720,gutter=0)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'merged-shape-width-control.docx','w',ZIP_DEFLATED) as z:
 for n,data in parts.items():z.writestr(n,data)
(root/'merged-shape-width-cases.json').write_text(json.dumps(cases,indent=2))
