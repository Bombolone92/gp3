"""Original saved-fill controls, using our own shape defaults OPC shell."""
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
ROOT=Path(__file__).resolve().parents[1]
A='http://schemas.openxmlformats.org/drawingml/2006/main';S='http://schemas.microsoft.com/office/word/2010/wordprocessingShape';A14='http://schemas.microsoft.com/office/drawing/2010/main'
with ZipFile(ROOT/'public/fixtures/shape-defaults.docx') as z:parts={n:z.read(n) for n in z.namelist()}
r=E.fromstring(parts['word/document.xml'])
fillxml=[None,'<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>',None,'<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>','<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>','<a:pattFill prst="pct50"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr><a:bgClr><a:srgbClr val="0000FF"/></a:bgClr></a:pattFill>','<a:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></a:blipFill>','<a:grpFill/>']
for i,props in enumerate(r.iter('{'+S+'}spPr')):
 if i in [2,3]:
  fill=props.find('{'+A+'}solidFill');props.replace(fill,E.Element('{'+A+'}noFill'))
 if fillxml[i]:
  ext=E.SubElement(E.SubElement(props,'{'+A+'}extLst'),'{'+A+'}ext',uri='{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}')
  saved=E.SubElement(ext,'{'+A14+'}hiddenFill');saved.append(E.fromstring(f'<a:root xmlns:a="{A}">{fillxml[i]}</a:root>')[0])
parts['word/document.xml']=E.tostring(r,encoding='UTF-8',xml_declaration=True,standalone=True)
with ZipFile(ROOT/'public/fixtures/hidden-fill-controls.docx','w',ZIP_DEFLATED) as z:
 for n,b in parts.items():z.writestr(n,b)
(ROOT/'tests/fixtures/hidden-fill-controls').mkdir(exist_ok=True)
