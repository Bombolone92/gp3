"""Independent ribbon controls for translucent, gradient, pattern and picture fills."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
from PIL import Image
from io import BytesIO
root=Path(__file__).resolve().parents[1]/'tests/fixtures/ribbons'
A='http://schemas.openxmlformats.org/drawingml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ns={'a':A,'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
with ZipFile(root/'colors.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml'])
for i,shape in enumerate(doc.findall('.//wps:wsp',ns)):
 props=shape.find('wps:spPr',ns);old=props.find('a:solidFill',ns);at=props.index(old);props.remove(old)
 def el(name,**attrs):return E.Element('{'+A+'}'+name,**attrs)
 if i%4==0:
  fill=el('solidFill');c=E.SubElement(fill,'{'+A+'}srgbClr',val='D6E8F5');E.SubElement(c,'{'+A+'}alpha',val='50000')
 elif i%4==1:
  fill=el('gradFill',rotWithShape='1');stops=E.SubElement(fill,'{'+A+'}gsLst')
  for pos,col in [('0','FF0000'),('100000','0000FF')]:
   stop=E.SubElement(stops,'{'+A+'}gs',pos=pos);E.SubElement(stop,'{'+A+'}srgbClr',val=col)
  E.SubElement(fill,'{'+A+'}lin',ang='0',scaled='1')
 elif i%4==2:
  fill=el('pattFill',prst='pct50')
  for tag,col in [('fgClr','FF0000'),('bgClr','0000FF')]:E.SubElement(E.SubElement(fill,'{'+A+'}'+tag),'{'+A+'}srgbClr',val=col)
 else:
  fill=el('blipFill',rotWithShape='1');b=E.SubElement(fill,'{'+A+'}blip');b.set('{'+R+'}embed','rIdRibbonPicture');E.SubElement(E.SubElement(fill,'{'+A+'}stretch'),'{'+A+'}fillRect')
 props.insert(at,fill)
relpath='word/_rels/document.xml.rels';REL='http://schemas.openxmlformats.org/package/2006/relationships'
rels=E.fromstring(parts[relpath]) if relpath in parts else E.Element('{'+REL+'}Relationships',nsmap={None:REL})
E.SubElement(rels,'{'+REL+'}Relationship',Id='rIdRibbonPicture',Type=R+'/image',Target='media/ribbon-colors.png')
parts[relpath]=E.tostring(rels,xml_declaration=True,encoding='UTF-8',standalone=True)
ct=E.fromstring(parts['[Content_Types].xml']);CT='http://schemas.openxmlformats.org/package/2006/content-types'
if not ct.xpath('*[@Extension="png"]'):E.SubElement(ct,'{'+CT+'}Default',Extension='png',ContentType='image/png')
parts['[Content_Types].xml']=E.tostring(ct,xml_declaration=True,encoding='UTF-8',standalone=True)
im=Image.new('RGB',(64,64),'#ff0000');im.paste('#0000ff',(32,0,64,64));buf=BytesIO();im.save(buf,format='PNG');parts['word/media/ribbon-colors.png']=buf.getvalue()
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'fills.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
