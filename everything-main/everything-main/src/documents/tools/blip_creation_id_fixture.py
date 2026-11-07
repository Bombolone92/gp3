"""Original image-data identity controls, using our original artwork fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/blip-creation-ids'
folder.mkdir(exist_ok=True)
with ZipFile(root / 'public/fixtures/drawing-creation-ids.docx') as package:
    parts = {name: package.read(name) for name in package.namelist()}
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
A16 = 'http://schemas.microsoft.com/office/drawing/2014/main'
A14 = 'http://schemas.microsoft.com/office/drawing/2010/main'
document = E.fromstring(parts['word/document.xml'])
for index, blip in enumerate(document.iter(f'{{{A}}}blip')):
    extensions = blip.find(f'{{{A}}}extLst')
    if extensions is None:
        extensions = E.SubElement(blip, f'{{{A}}}extLst')
    extension = E.SubElement(extensions, f'{{{A}}}ext', uri='{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}')
    identity = E.SubElement(extension, f'{{{A16}}}creationId', nsmap={'identity': A16})
    if index != 0:
        identity.set('id', '{00000000-0000-0000-0000-%012X}' % index)
    # Both extension orders must coexist with the existing local-DPI metadata.
    dpi = E.Element(f'{{{A}}}ext', uri='{28A0092B-C50C-407E-A947-70E740481C1C}')
    E.SubElement(dpi, f'{{{A14}}}useLocalDpi', nsmap={'a14': A14}, val='0')
    extensions.insert(0 if index % 2 else len(extensions), dpi)
parts['word/document.xml'] = E.tostring(document, xml_declaration=True, encoding='UTF-8', standalone=True)
with ZipFile(folder / 'control.docx', 'w', ZIP_DEFLATED) as package:
    for name, data in parts.items():
        package.writestr(name, data)
print('Image-data identities:', index + 1)
