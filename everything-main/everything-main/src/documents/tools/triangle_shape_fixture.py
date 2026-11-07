"""Original triangle controls built from our original shape-defaults OPC."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
root = Path(__file__).resolve().parents[1]
ns = {k: 'http://schemas.openxmlformats.org/'+v for k,v in [('w','wordprocessingml/2006/main'),('a','drawingml/2006/main')]}
ns['wps']='http://schemas.microsoft.com/office/word/2010/wordprocessingShape'
with ZipFile(root/'public/fixtures/shape-defaults.docx') as z:
    parts={n:z.read(n) for n in z.namelist()}
doc=E.fromstring(parts['word/document.xml'])
shapes=doc.findall('.//wps:wsp',ns)
text=deepcopy(shapes[4].find('wps:txbx',ns))
cases=[('triangle',None),('triangle',20000),('triangle',0),('triangle',100000),('triangle',-5000),('triangle',125000),('rtTriangle',None),('rtTriangle',None)]
for i,(shape,(kind,adj)) in enumerate(zip(shapes,cases)):
    props=shape.find('wps:spPr',ns)
    geom=props.find('a:prstGeom',ns); geom.set('prst',kind)
    values=geom.find('a:avLst',ns); values.clear()
    if adj is not None: E.SubElement(values,'{'+ns['a']+'}gd',name='adj',fmla=f'val {adj}')
    for name in ['solidFill','ln','effectLst','sp3d']:
        for node in props.findall('a:'+name,ns): props.remove(node)
    fill=E.SubElement(props,'{'+ns['a']+'}solidFill')
    E.SubElement(fill,'{'+ns['a']+'}srgbClr',val='228844')
    E.SubElement(E.SubElement(props,'{'+ns['a']+'}ln'),'{'+ns['a']+'}noFill')
    if i==7:
        x=props.find('a:xfrm',ns); x.set('flipH','1'); x.set('flipV','1'); x.set('rot','1800000')
    old=shape.find('wps:txbx',ns)
    if old is not None: shape.remove(old)
    if i in [0,1,6]:
        prompt=deepcopy(text)
        for t in prompt.findall('.//w:t',ns): t.text='Inset text'
        for rp in prompt.findall('.//w:rPr',ns):
            f=E.SubElement(rp,'{'+ns['w']+'}rFonts')
            for key in ['ascii','hAnsi','cs','eastAsia']: f.set('{'+ns['w']+'}'+key,'Arial')
        shape.insert(list(shape).index(shape.find('wps:bodyPr',ns)),prompt)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/'public/fixtures/triangle-shapes.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
