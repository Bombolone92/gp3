"""Original controls for normal-autofit metadata on shapes without text boxes."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
root=Path(__file__).resolve().parents[1]
with ZipFile(root/'public/fixtures/shape-defaults.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
ns={'wps':'http://schemas.microsoft.com/office/word/2010/wordprocessingShape','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
doc=E.fromstring(parts['word/document.xml'])
cases=[{}, {'fontScale':'100000'}, {'fontScale':'50000'}, {'fontScale':'50%'}, {'fontScale':'1000'}, {'lnSpcReduction':'0'}, {'lnSpcReduction':'20000'}, {'fontScale':'75%','lnSpcReduction':'20%'}]
for shape,attrs in zip(doc.findall('.//wps:wsp',ns),cases):
    tx=shape.find('wps:txbx',ns)
    if tx is not None:shape.remove(tx)
    body=shape.find('wps:bodyPr',ns)
    for child in list(body):
        if E.QName(child).localname in ('spAutoFit','noAutofit','normAutofit'):body.remove(child)
    E.SubElement(body,'{'+ns['a']+'}normAutofit',attrs)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'public/fixtures/inactive-normal-autofit.docx','w',ZIP_DEFLATED) as z:
    for n,b in parts.items():z.writestr(n,b)
