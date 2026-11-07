"""Original tall-inline PNG controls; authored extents exceed the writing height."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from io import BytesIO
from PIL import Image,ImageDraw
from lxml import etree as E
root=Path(__file__).resolve().parents[1]/'tests/fixtures/oversized-body-lines'
with ZipFile(root/'fresh.docx') as z:base={n:z.read(n) for n in z.namelist()}
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';A='http://schemas.openxmlformats.org/drawingml/2006/main';PIC='http://schemas.openxmlformats.org/drawingml/2006/picture'
def text(t):return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:color w:val="D02030"/></w:rPr><w:t>{t}</w:t></w:r></w:p>'
def picture(height,index=1):
 w,h=80*12700,height*12700
 return f'<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:drawing><wp:inline><wp:extent cx="{w}" cy="{h}"/><wp:docPr id="{index}" name="Original tall bands"/><a:graphic><a:graphicData uri="{PIC}"><pic:pic><pic:nvPicPr><pic:cNvPr id="{index}" name="bands.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
image=Image.new('RGB',(80,800),'#1255AA');ImageDraw.Draw(image).rectangle((0,400,79,799),fill='#EE6622');data=BytesIO();image.save(data,format='PNG')
for name,body in {'inline-fresh':picture(740)+text('After'),'inline-preceded':text('Before')+picture(740)+text('After'),'inline-beyond-page':picture(820)+text('After'),'inline-consecutive':picture(740)+picture(740,2)+text('After')}.items():
 parts=dict(base)
 old=E.fromstring(parts['word/document.xml']);sect=E.tostring(old.find('{'+W+'}body')[-1],encoding='unicode')
 parts['word/document.xml']=(f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="{WP}" xmlns:a="{A}" xmlns:pic="{PIC}"><w:body>{body}{sect}</w:body></w:document>').encode()
 rel=E.fromstring(parts['word/_rels/document.xml.rels']);E.SubElement(rel,'{http://schemas.openxmlformats.org/package/2006/relationships}Relationship',Id='rIdImage',Type=R+'/image',Target='media/bands.png');parts['word/_rels/document.xml.rels']=E.tostring(rel)
 ct=E.fromstring(parts['[Content_Types].xml']);E.SubElement(ct,'{http://schemas.openxmlformats.org/package/2006/content-types}Default',Extension='png',ContentType='image/png');parts['[Content_Types].xml']=E.tostring(ct)
 parts['word/media/bands.png']=data.getvalue()
 with ZipFile(root/(name+'.docx'),'w',ZIP_DEFLATED) as z:
  for n,b in parts.items():z.writestr(n,b)
 print(name)
