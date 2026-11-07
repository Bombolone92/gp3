"""Original controls for absent versus explicitly empty paragraph defaults."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
with ZipFile(ROOT / 'public/fixtures/header-drawings-footer-blank.docx') as source:
    base = {name: source.read(name) for name in source.namelist()}
for name in ['empty', 'after', 'line', 'container', 'legacy', 'no-styles', 'style']:
    parts = dict(base)
    if name == 'legacy':
        parts['word/settings.xml'] = parts['word/settings.xml'].replace(b'w:val="15"', b'w:val="12"')
    elif name == 'style':
        parts['word/styles.xml'] = parts['word/styles.xml'].replace(b'</w:styles>', b'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr></w:style></w:styles>')
    elif name == 'no-styles':
        del parts['word/styles.xml']
        for path in ['word/_rels/document.xml.rels', '[Content_Types].xml']:
            root = ET.fromstring(parts[path])
            for node in list(root):
                if node.get('Id') == 'styles' or node.get('PartName') == '/word/styles.xml':
                    root.remove(node)
            parts[path] = ET.tostring(root)
    else:
        inside = {'empty': '', 'after': '<w:spacing w:after="0"/>', 'line': '<w:spacing w:line="240"/>', 'container': None}[name]
        defaults = '<w:pPrDefault/>' if inside is None else '<w:pPrDefault><w:pPr>' + inside + '</w:pPr></w:pPrDefault>'
        parts['word/styles.xml'] = parts['word/styles.xml'].replace(b'</w:docDefaults>', (defaults + '</w:docDefaults>').encode())
    target = ROOT / 'public/fixtures' / ('default-paragraph-spacing-' + name + '.docx')
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for path, data in parts.items():
            archive.writestr(ZipInfo(path, (2026, 9, 18, 0, 0, 0)), data, compress_type=ZIP_DEFLATED)
