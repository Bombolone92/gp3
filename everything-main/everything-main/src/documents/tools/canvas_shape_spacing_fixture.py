"""Independent shape spacing and overflow probes, built from authored XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

OUT = Path(__file__).resolve().parents[1] / 'public/fixtures'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape'}

def write(name, parts):
    with ZipFile(OUT / (name + '.docx'), 'w', ZIP_DEFLATED) as z:
        for n, b in parts.items(): z.writestr(n, b)

def generate():
    # Base packages are independently authored by the sibling generators.
    for flag in [0, 1]:
        with ZipFile(OUT / 'group-text-scaling.docx') as z: parts = {n: z.read(n) for n in z.namelist()}
        root = E.fromstring(parts['word/document.xml'])
        for body in root.findall('.//wps:bodyPr', NS): body.set('compatLnSpc', str(flag))
        parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        write(f'shape-spacing-{flag}', parts)
    with ZipFile(OUT / 'ellipses.docx') as z: parts = {n: z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    for i, shape in enumerate(root.findall('.//wps:wsp', NS)):
        ext = shape.find('./wps:spPr/a:xfrm/a:ext', NS)
        ext.set('cx', '485775'); ext.set('cy', '485775')
        body = shape.find('wps:bodyPr', NS)
        for k, v in dict(lIns=91440, rIns=91440, tIns=45720, bIns=45720, compatLnSpc=1, anchor=['t', 'ctr', 'b'][i]).items(): body.set(k, str(v))
        tx = shape.find('wps:txbx', NS)
        if tx is None:
            tx = E.Element('{' + NS['wps'] + '}txbx'); shape.insert(list(shape).index(body), tx)
            E.SubElement(tx, '{' + NS['w'] + '}txbxContent')
        content = tx[0]; content.clear()
        p = E.SubElement(content, '{' + NS['w'] + '}p'); run = E.SubElement(p, '{' + NS['w'] + '}r')
        pr = E.SubElement(run, '{' + NS['w'] + '}rPr')
        E.SubElement(pr, '{' + NS['w'] + '}sz').set('{' + NS['w'] + '}val', '22')
        E.SubElement(run, '{' + NS['w'] + '}t').text = 'Sample text longer than its frame'
    xml = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    write('shape-text-overflow', {**parts, 'word/document.xml': xml})
    write('shape-text-overflow-zero', {**parts, 'word/document.xml': xml.replace(b'compatLnSpc="1"', b'compatLnSpc="0"')})
    write('shape-text-overflow-rect', {**parts, 'word/document.xml': xml.replace(b'prst="ellipse"', b'prst="rect"')})

if __name__ == '__main__': generate()
