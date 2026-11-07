from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
import json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/ribbons'
ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}
with ZipFile(root/'control.docx') as z:parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml']);colors=['FFFFFF','000000','FF0000','00FF00','0000FF','808080','010203','D6E8F5']
for shape,color in zip(doc.findall('.//wps:wsp',ns),colors):
 shape.find('wps:spPr/a:prstGeom/a:avLst',ns).clear()
 shape.find('wps:spPr/a:solidFill/a:srgbClr',ns).set('val',color)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'colors.docx','w',ZIP_DEFLATED) as z:
 for name,data in parts.items():z.writestr(name,data)
(root/'colors.json').write_text(json.dumps(colors,indent=2)+'\n')
