"""Original rotated-cell controls with explicit compatibility modes.

Reuses the independently authored direction fixture, changing only the
relationship-resolved compatibility setting. No corpus content is included.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as E

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/cell-text-direction'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
C = 'http://schemas.openxmlformats.org/package/2006/content-types'
with ZipFile(folder / 'control.docx') as source:
    original = {name: source.read(name) for name in source.namelist()}
for mode in (14, 15):
    parts = dict(original)
    rels = E.fromstring(parts['word/_rels/document.xml.rels'])
    assert not any(x.get('Type', '').endswith('/settings') for x in rels)
    E.SubElement(rels, '{' + R + '}Relationship', Id='rIdCompatibility',
                 Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings', Target='settings.xml')
    parts['word/_rels/document.xml.rels'] = E.tostring(rels)
    types = E.fromstring(parts['[Content_Types].xml'])
    E.SubElement(types, '{' + C + '}Override', PartName='/word/settings.xml',
                 ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml')
    parts['[Content_Types].xml'] = E.tostring(types)
    parts['word/settings.xml'] = (f'<w:settings xmlns:w="{W}"><w:compat>'
        f'<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/>'
        '</w:compat></w:settings>').encode()
    path = folder / f'mode{mode}.docx'
    with ZipFile(path, 'w', ZIP_DEFLATED) as target:
        for name, data in parts.items():
            target.writestr(name, data)
    print(path)
