"""Original paragraph-relative square-wrap controls; no corpus assets."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from html import escape
import json
root=Path(__file__).resolve().parents[1]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
ns=f'xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}" xmlns:pic="{PIC}"'
with ZipFile(root/'public/fixtures/table-shading-scope.docx') as z:parts={n:z.read(n) for n in z.namelist()}
with ZipFile(root/'public/fixtures/header-drawings.docx') as z:parts['word/media/square.png']=z.read('word/media/green.png')
def anchor(i,x,y,w,h,distance=9):
 x,y,w,h,distance=[round(n*12700) for n in (x,y,w,h,distance)]
 return f'''<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="{distance}" distR="{distance}" simplePos="0" relativeHeight="{i}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>{x}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>{y}</wp:posOffset></wp:positionV><wp:extent cx="{w}" cy="{h}"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="{i}" name="Original green square"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Original green square"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="square"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'''
def para(text,prefix='',extra=''):
 return f'<w:p><w:pPr>{extra}<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/></w:pPr>{prefix}<w:r><w:t xml:space="preserve">{escape(text)}</w:t></w:r></w:p>'
text='Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu. '
cases=[dict(name='left',x=0,y=0,w=72,h=54),dict(name='right',x=216,y=0,w=72,h=54),dict(name='middle',x=108,y=0,w=72,h=54),dict(name='following-paragraph',x=0,y=0,w=72,h=72)]
body=[]
for i,c in enumerate(cases):
 body.append(para('CASE '+c['name'],extra='<w:pageBreakBefore/>' if i else ''))
 body.append(para('Short anchor.' if i==3 else text*3,anchor(i+1,c['x'],c['y'],c['w'],c['h'])))
 body.append(para(text*3 if i==3 else 'Following paragraph returns to the full writing width.'))
section='<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="7200" w:h="8640"/><w:pgMar w:top="720" w:right="720" w:bottom="1440" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
parts['word/document.xml']=f'<w:document {ns}><w:body>{"".join(body)}{section}</w:body></w:document>'.encode()
parts['word/footer.xml']=f'<w:ftr {ns}>{para("Footer text beside the square.",anchor(10,-.45,-1.3,14.4,14.4))}</w:ftr>'.encode()
def rels(items):return (f'<Relationships xmlns="{REL}">'+''.join(f'<Relationship Id="{i}" Type="{R}/{kind}" Target="{target}"/>' for i,kind,target in items)+'</Relationships>').encode()
parts['word/_rels/document.xml.rels']=rels([('styles','styles','styles.xml'),('square','image','media/square.png'),('footer','footer','footer.xml')])
parts['word/_rels/footer.xml.rels']=rels([('square','image','media/square.png')])
parts['[Content_Types].xml']=parts['[Content_Types].xml'].replace(b'</Types>',b'<Default Extension="png" ContentType="image/png"/><Override PartName="/word/footer.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>')
with ZipFile(root/'public/fixtures/square-wrap-flow.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
folder=root/'tests/fixtures/square-wrap-flow';folder.mkdir(exist_ok=True)
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')

# Distinguish story context from line-height/anchor-size effects.
footer_cases=[('exact18-small',18,14.4,12),('exact18-tall',18,36,12),('auto12-small',0,14.4,12),('auto9-small',0,14.4,9)]
body=[];links=[('styles','styles','styles.xml'),('square','image','media/square.png')]
types=parts['[Content_Types].xml']
for i,(name,line,height,size) in enumerate(footer_cases):
 path=f'word/footer-case{i}.xml';links.append((f'footer{i}','footer',f'footer-case{i}.xml'))
 props=f'<w:spacing w:before="0" w:after="0" w:line="{line*20 if line else 240}" w:lineRule="{"exact" if line else "auto"}"/><w:rPr><w:sz w:val="{size*2}"/></w:rPr>'
 runs=anchor(20+i,-.45,-1.3,14.4,height)+f'<w:r><w:rPr><w:sz w:val="{size*2}"/></w:rPr><w:t>Footer text beside the square.</w:t></w:r>'
 parts[path]=f'<w:ftr {ns}><w:p><w:pPr>{props}</w:pPr>{runs}</w:p></w:ftr>'.encode()
 parts[f'word/_rels/footer-case{i}.xml.rels']=rels([('square','image','media/square.png')])
 types=types.replace(b'</Types>',f'<Override PartName="/{path}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'.encode())
 sect=section.replace('r:id="footer"',f'r:id="footer{i}"')
 body.append(para('CASE '+name))
 body.append(f'<w:p><w:pPr>{sect}</w:pPr></w:p>' if i<len(footer_cases)-1 else sect)
parts['word/document.xml']=f'<w:document {ns}><w:body>{"".join(body)}</w:body></w:document>'.encode()
parts['word/_rels/document.xml.rels']=rels(links);parts['[Content_Types].xml']=types
with ZipFile(root/'public/fixtures/square-wrap-footer-heights.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
(folder/'footer-cases.json').write_text(json.dumps([dict(name=n,line=l,height=h,size=s) for n,l,h,s in footer_cases],indent=2)+'\n')
parts['word/settings.xml']=f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'.encode()
parts['word/_rels/document.xml.rels']=rels(links+[('settings','settings','settings.xml')])
parts['[Content_Types].xml']=types.replace(b'</Types>',b'<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
with ZipFile(root/'public/fixtures/square-wrap-footer-modern.docx','w',ZIP_DEFLATED) as z:
 for n,d in parts.items():z.writestr(n,d)
