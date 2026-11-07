"""Original controls isolating the Mac wrappingTextBoxFlag extension."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E
from copy import deepcopy
import canvas_group_fixture as groups

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/mac-wrapping-flag'
MAC = 'http://schemas.microsoft.com/office/mac/drawingml/2011/main'
URI = '{C572A759-6A51-4108-AA02-DFA0A04FC94B}'

def generate():
    ROOT.mkdir(exist_ok=True)
    groups.SOURCE = ROOT / 'absent.docx'
    groups.generate()
    with ZipFile(groups.SOURCE) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    # Exercise real wrapping and overflow, not only short text that always fits.
    for text in root.xpath('//wps:txbx//w:t', namespaces=groups.NS):
        text.text = 'Alpha beta gamma delta epsilon zeta eta theta'
    # A shape without text and a standalone picture also carry the extension.
    group = root.find('.//' + groups.tag('wpg:wgp'))
    groups.shape(group, 901, 200000, 100000, 800000, 200000, '11AABB')
    drawing = deepcopy(root.find('.//' + groups.tag('mc:Fallback') + '/' + groups.tag('w:drawing')))
    drawing.find('.//' + groups.tag('wp:docPr')).set('id', '902')
    p = E.Element(groups.tag('w:p')); groups.add(p, 'w:r').append(drawing)
    root.find(groups.tag('w:body')).insert(1, p)
    p = E.Element(groups.tag('w:p'))
    frame = groups.add(groups.add(groups.add(p, 'w:r'), 'w:drawing'), 'wp:inline', distT=0, distB=0, distL=0, distR=0)
    size = 1524000
    groups.add(frame, 'wp:extent', cx=size, cy=size)
    groups.add(frame, 'wp:docPr', id=903, name='Visible wrapping control')
    groups.add(frame, 'wp:cNvGraphicFramePr')
    data = groups.add(groups.add(frame, 'a:graphic'), 'a:graphicData', uri=groups.NS['wpg'])
    group = groups.add(data, 'wpg:wgp'); groups.add(group, 'wpg:cNvGrpSpPr')
    props = groups.add(group, 'wpg:grpSpPr'); groups.transform(props, size, size, group=True)
    transform = props[0]
    transform.find(groups.tag('a:chOff')).attrib.update({'x': '0', 'y': '0'})
    transform.find(groups.tag('a:chExt')).attrib.update({'cx': str(size), 'cy': str(size)})
    shape = groups.shape(group, 904, size, size, 0, 0, 'DDEEFF',
                         'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi')
    rp = shape.find('.//' + groups.tag('w:rPr'))
    rp.find(groups.tag('w:sz')).set(groups.tag('w:val'), '24')
    font = E.Element(groups.tag('w:rFonts'), {groups.tag('w:ascii'): 'Arial', groups.tag('w:hAnsi'): 'Arial'})
    rp.insert(0, font)
    root.find(groups.tag('w:body')).insert(-1, p)
    for name, value in [('absent', None), ('empty', None), ('false', 'false'),
                        ('true', 'true'), ('zero', '0'), ('one', '1')]:
        variant = deepcopy(root)
        if name != 'absent':
            for properties in variant.xpath('//pic:spPr | //wps:spPr', namespaces=groups.NS):
                ext = groups.add(groups.add(properties, 'a:extLst'), 'a:ext', uri=URI)
                flag = E.SubElement(ext, '{' + MAC + '}wrappingTextBoxFlag', nsmap={'ma14': MAC})
                if value is not None:
                    flag.set('val', value)
        parts['word/document.xml'] = E.tostring(variant, xml_declaration=True, encoding='UTF-8', standalone=True)
        with ZipFile(ROOT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
            for n, data in parts.items():
                z.writestr(n, data)

if __name__ == '__main__':
    generate()
