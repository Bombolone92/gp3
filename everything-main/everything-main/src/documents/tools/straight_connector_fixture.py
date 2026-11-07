"""Independent straightConnector1 controls derived only from our authored fixtures."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
ns = {'a': A}
for kind, source, target in [
    ('straight-flat-lines', root/'tests/fixtures/flat-lines/flat-lines.docx', root/'tests/fixtures/straight-flat-lines/flat-lines.docx'),
    ('straight-oval-lines', root/'tests/fixtures/flat-lines/flat-lines.docx', root/'tests/fixtures/straight-oval-lines/flat-lines.docx'),
    ('straight-connector-groups', root/'public/fixtures/zero-axis-groups.docx', root/'public/fixtures/straight-connector-groups.docx'),
]:
    folder = root/'tests/fixtures'/kind
    folder.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as z:
        parts = {n:z.read(n) for n in z.namelist()}
    document = E.fromstring(parts['word/document.xml'])
    for i, geometry in enumerate(document.findall('.//a:prstGeom', ns)):
        assert geometry.get('prst') == 'line'
        geometry.set('prst', 'straightConnector1')
        if kind in ['straight-flat-lines', 'straight-oval-lines']:
            props = geometry.getparent()
            if i % 2 == 0:
                props.find('a:xfrm', ns).set('flipH', '1')
            if kind == 'straight-oval-lines':
                # Independent native evidence for the still-unsupported marker.
                E.SubElement(props.find('a:ln', ns), '{'+A+'}tailEnd', type='oval')
    parts['word/document.xml'] = E.tostring(document, encoding='UTF-8', xml_declaration=True, standalone=True)
    old = {}
    if target.exists():
        with ZipFile(target) as z: old = {n:z.read(n) for n in z.namelist()}
    if old != parts:
        with ZipFile(target, 'w', ZIP_DEFLATED) as z:
            for name, data in parts.items(): z.writestr(name, data)
    if kind == 'straight-connector-groups':
        (folder/'cases.json').write_bytes((root/'tests/fixtures/zero-axis-groups/cases.json').read_bytes())
    print(target)
