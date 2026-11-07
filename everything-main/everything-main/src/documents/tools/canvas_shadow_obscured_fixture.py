"""Independent shadow-free pictures/shapes with the a14 shadowObscured extension flag."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from copy import deepcopy
from lxml import etree as E
import canvas_group_fixture as groups

SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/shadow-obscured.docx'
A14 = 'http://schemas.microsoft.com/office/drawing/2010/main'
URI = '{53640926-AAD7-44D8-BBD7-CCE9431645EC}'

def generate():
    groups.SOURCE = SOURCE; groups.generate()
    with ZipFile(SOURCE) as z: parts = {n:z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    # Include a normal inline picture as well as grouped pictures and WPS shapes.
    drawing = deepcopy(root.find('.//' + groups.tag('mc:Fallback') + '/' + groups.tag('w:drawing')))
    drawing.find('.//' + groups.tag('wp:docPr')).set('id', '900')
    p = E.Element(groups.tag('w:p')); groups.add(p, 'w:r').append(drawing)
    root.find(groups.tag('w:body')).insert(1, p)
    nodes = root.xpath('//pic:spPr | //wps:spPr', namespaces=groups.NS)
    for i, properties in enumerate(nodes):
        flag = E.SubElement(groups.add(groups.add(properties, 'a:extLst'), 'a:ext', uri=URI), '{'+A14+'}shadowObscured', nsmap={'a14':A14})
        value = [None, 'true', 'false', '1', '0'][i % 5]
        if value is not None: flag.set('val', value)
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(SOURCE, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)

if __name__ == '__main__': generate()
