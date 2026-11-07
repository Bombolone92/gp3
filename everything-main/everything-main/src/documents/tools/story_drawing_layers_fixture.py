"""Original overlapping body/header/footer controls, directly authored as XML."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
with ZipFile(ROOT/'public/fixtures/positioned-picture-crop.docx') as z:parts={n:z.read(n) for n in z.namelist()}
root=E.fromstring(parts['word/document.xml']);template=deepcopy(next(root.iter('{'+WP+'}anchor')))
body=root.find('{'+W+'}body');body.clear()
def add(parent,ns,name,**attrs):return E.SubElement(parent,'{'+ns+'}'+name,{'{'+W+'}'+k:str(v) for k,v in attrs.items()})
def para(parent,text,size,line,before=0):
 p=add(parent,W,'p');pr=add(p,W,'pPr');add(pr,W,'spacing',before=before*20,after=0,line=line*20,lineRule='exact')
 r=add(p,W,'r');rp=add(r,W,'rPr');add(rp,W,'rFonts',ascii='Arial',hAnsi='Arial');add(rp,W,'sz',val=size*2);add(rp,W,'color',val='000000');add(r,W,'t').text=text
 return p
def picture(p,ident,x,y,w,h,behind):
 anchor=deepcopy(template);anchor.set('behindDoc',str(int(behind)));anchor.set('relativeHeight',str(ident))
 for axis,value in [('H',x),('V',y)]:
  pos=anchor.find('{'+WP+'}position'+axis);pos.set('relativeFrom','page');pos.find('{'+WP+'}posOffset').text=str(value*12700)
 for ext in [anchor.find('{'+WP+'}extent'),anchor.find('.//{'+A+'}xfrm/{'+A+'}ext')]:ext.set('cx',str(w*12700));ext.set('cy',str(h*12700))
 anchor.find('{'+WP+'}docPr').set('id',str(ident));anchor.find('{'+WP+'}docPr').set('name','Layer '+str(ident))
 add(add(p,W,'r'),W,'drawing').append(anchor)
rels=E.fromstring(parts['word/_rels/document.xml.rels']);types=E.fromstring(parts['[Content_Types].xml'])
for i,headerBehind in enumerate([True,False]):
 h=E.Element('{'+W+'}hdr',nsmap={'w':W,'r':R});p=para(h,'HEADER TEXT',24,36);picture(p,100+i,72,140,300,90,headerBehind)
 parts[f'word/header{i}.xml']=E.tostring(h,xml_declaration=True,encoding='UTF-8')
 parts[f'word/_rels/header{i}.xml.rels']=parts['word/_rels/document.xml.rels']
 E.SubElement(rels,'{'+REL+'}Relationship',Id=f'layerHeader{i}',Type=R+'/header',Target=f'header{i}.xml')
 E.SubElement(types,'{'+CT+'}Override',PartName=f'/word/header{i}.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml')
footer=E.Element('{'+W+'}ftr',nsmap={'w':W});para(footer,'FOOTER TEXT',24,36)
parts['word/layerFooter.xml']=E.tostring(footer,xml_declaration=True,encoding='UTF-8')
E.SubElement(rels,'{'+REL+'}Relationship',Id='layerFooter',Type=R+'/footer',Target='layerFooter.xml')
E.SubElement(types,'{'+CT+'}Override',PartName='/word/layerFooter.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml')
for i in range(5):
 p=para(body,'BODY TEXT',36,48,72)
 if i<4:
  picture(p,10+i*3,36,0,400,90,i%2==0);picture(p,11+i*3,36,710,400,82,i%2==0);picture(p,12+i*3,180,140,250,90,i%2==0)
 section=E.Element('{'+W+'}sectPr');E.SubElement(section,'{'+W+'}headerReference',{'{'+W+'}type':'default','{'+R+'}id':f'layerHeader{min(i//2,1)}'})
 E.SubElement(section,'{'+W+'}footerReference',{'{'+W+'}type':'default','{'+R+'}id':'layerFooter'})
 add(section,W,'pgSz',w=12240,h=15840);add(section,W,'pgMar',top=1440,right=1440,bottom=1440,left=1440,header=400,footer=400,gutter=0)
 if i==4:body.append(section)
 else:p.find('{'+W+'}pPr').append(section)
parts['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8')
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
E.SubElement(rels,'{'+REL+'}Relationship',Id='layerSettings',Type=R+'/settings',Target='settings.xml')
E.SubElement(types,'{'+CT+'}Override',PartName='/word/settings.xml',ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
parts['word/_rels/document.xml.rels']=E.tostring(rels,xml_declaration=True,encoding='UTF-8')
parts['[Content_Types].xml']=E.tostring(types,xml_declaration=True,encoding='UTF-8')
with ZipFile(ROOT/'public/fixtures/story-drawing-layers.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
(ROOT/'tests/fixtures/story-drawing-layers').mkdir(parents=True,exist_ok=True)
