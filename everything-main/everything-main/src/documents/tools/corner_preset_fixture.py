"""Original corner-preset controls; no external artwork."""
import sys
kind=sys.argv[1]
assert kind in ["octagon","plaque","roundRect","round2SameRect","star5"]
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
cases=[(kind,a) for a in [None,0,25000,49999,-5000,75000,10000,None]]
for i,(shape,(kind,adj)) in enumerate(zip(shapes,cases)):
    props=shape.find('wps:spPr',ns)
    geom=props.find('a:prstGeom',ns); geom.set('prst',kind)
    values=geom.find('a:avLst',ns); values.clear()
    if kind == 'round2SameRect':
        pair = [None, (0,0), (10000,40000), (50000,0), (-5000,75000), (75000,-5000), (25000,10000), (40000,5000)][i]
        if pair is not None:
            for name, value in zip(['adj1','adj2'],pair):
                E.SubElement(values,'{'+ns['a']+'}gd',name=name,fmla=f'val {value}')
    elif kind == 'star5':
        adjustments = [{}, {'adj':10000}, {'adj':40000}, {'adj':0}, {'adj':-5000}, {'adj':75000}, {'adj':25000,'hf':85000,'vf':95000}, {'adj':19098}][i]
        if adjustments: adjustments = {'adj':19098,'hf':105146,'vf':110557,**adjustments}
        for name,value in adjustments.items(): E.SubElement(values,'{'+ns['a']+'}gd',name=name,fmla=f'val {value}')
    elif adj is not None: E.SubElement(values,'{'+ns['a']+'}gd',name='adj',fmla=f'val {adj}')
    for name in ['solidFill','ln','effectLst','sp3d']:
        for node in props.findall('a:'+name,ns): props.remove(node)
    fill=E.SubElement(props,'{'+ns['a']+'}solidFill')
    E.SubElement(fill,'{'+ns['a']+'}srgbClr',val='228844')
    E.SubElement(E.SubElement(props,'{'+ns['a']+'}ln'),'{'+ns['a']+'}noFill')
    if i==5:
        props.find('a:xfrm/a:ext',ns).set('cx','1016000')
        props.find('a:xfrm/a:ext',ns).set('cy','1397000')
    if i==7:
        x=props.find('a:xfrm',ns); x.set('flipH','1'); x.set('flipV','1'); x.set('rot','1800000')
    old=shape.find('wps:txbx',ns)
    if old is not None: shape.remove(old)
    if i in [0,1,2]:
        prompt=deepcopy(text)
        for t in prompt.findall('.//w:t',ns): t.text='Inset text'
        for rp in prompt.findall('.//w:rPr',ns):
            f=E.SubElement(rp,'{'+ns['w']+'}rFonts')
            for key in ['ascii','hAnsi','cs','eastAsia']: f.set('{'+ns['w']+'}'+key,'Arial')
        shape.insert(list(shape).index(shape.find('wps:bodyPr',ns)),prompt)
parts['word/document.xml']=E.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
with ZipFile(root/f'public/fixtures/corner-{kind}.docx','w',ZIP_DEFLATED) as z:
    for name,data in parts.items(): z.writestr(name,data)
