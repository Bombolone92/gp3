"""Original drawing identity fixture; reuses our Python-authored artwork probe.

python-docx (MIT), lxml (BSD), and original XML/PNG; no user artwork is copied.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from uuid import UUID, uuid5
from lxml import etree as E
import sys
import canvas_artwork_metadata_fixture as artwork

SOURCE = Path(__file__).resolve().parents[1] / 'public/fixtures/drawing-creation-ids.docx'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
A16 = 'http://schemas.microsoft.com/office/drawing/2014/main'
URI = '{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}'


def generate():
    artwork.SOURCE = SOURCE
    artwork.generate()
    with ZipFile(SOURCE) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    root = E.fromstring(parts['word/document.xml'])
    properties = root.xpath('//*[local-name()="docPr" or local-name()="cNvPr"]')
    for i, node in enumerate(properties):
        extensions = node.find(f'{{{A}}}extLst')
        if extensions is None: extensions = E.SubElement(node, f'{{{A}}}extLst')
        extension = E.Element(f'{{{A}}}ext', uri=URI)
        # Alternate extension order, and retain an optional absent identifier.
        extensions.insert(0 if i % 2 else len(extensions), extension)
        identity = E.SubElement(extension, f'{{{A16}}}creationId', nsmap={'identity': A16})
        if i != len(properties) - 1:
            identity.set('id', '{' + str(uuid5(UUID('2A7DBCFB-9750-45C1-B9DD-BCB8465EEC74'), str(i))).upper() + '}')
    parts['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    with ZipFile(SOURCE, 'w', ZIP_DEFLATED) as z:
        for name, data in parts.items(): z.writestr(name, data)


def verify(path):
    artwork.SOURCE = SOURCE
    artwork.verify(path)
    with ZipFile(SOURCE) as a, ZipFile(path) as b:
        ids = lambda z: [n.get('id') for n in E.fromstring(z.read('word/document.xml')).iter(f'{{{A16}}}creationId')]
        assert ids(a) == ids(b)
        assert len(ids(b)) >= 7 and None in ids(b)
    print('PASS retained drawing creation IDs:', path)


if __name__ == '__main__':
    if len(sys.argv) == 1: generate()
    else:
        for path in sys.argv[1:]: verify(path)
