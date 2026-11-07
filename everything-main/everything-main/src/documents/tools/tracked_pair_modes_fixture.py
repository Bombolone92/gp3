"""Original OOXML controls for tracked pairs; no font binaries are included."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.etree import ElementTree as E
import json, sys

folder = Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1] / 'tests/fixtures/tracked-pair-modes'
folder.mkdir(parents=True, exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
for prefix, uri in [('w', W), ('w14', W14), ('mc', MC)]:
    E.register_namespace(prefix, uri)

def node(parent, tag, **attrs):
    return E.SubElement(parent, '{'+W+'}'+tag, {'{'+W+'}'+k: str(v) for k, v in attrs.items()})

def xml(element):
    return E.tostring(element, encoding='utf-8', xml_declaration=True)

cases = []
for family in ['Arial', 'Goudy Old Style', 'Constantia', 'Palatino Linotype']:
    for spacing in [-6, 0, 6]:
        for ligatures in ['none', 'standard']:
            for kern in [2, 48]:
                cases.append(dict(family=family, spacing=spacing/20, ligatures=ligatures,
                                  kerning=kern/2, text='AVATARLY CONTACT'))

for enabled in [0, 1]:
    document = E.Element('{'+W+'}document', {'{'+MC+'}Ignorable': 'w14'})
    body = node(document, 'body')
    for case in cases:
        p = node(body, 'p'); pp = node(p, 'pPr')
        node(pp, 'spacing', before=0, after=0, line=260, lineRule='exact')
        node(pp, 'jc', val='right')
        r = node(p, 'r'); rp = node(r, 'rPr')
        node(rp, 'rFonts', ascii=case['family'], hAnsi=case['family'])
        node(rp, 'spacing', val=round(case['spacing']*20))
        node(rp, 'kern', val=round(case['kerning']*2)); node(rp, 'sz', val=24)
        E.SubElement(rp, '{'+W14+'}ligatures', {'{'+W14+'}val': case['ligatures']})
        node(r, 't').text = case['text']
    section = node(body, 'sectPr'); node(section, 'pgSz', w=12240, h=15840)
    node(section, 'pgMar', top=720, right=720, bottom=720, left=720, header=360, footer=360, gutter=0)
    settings = E.Element('{'+W+'}settings'); compat = node(settings, 'compat')
    node(compat, 'compatSetting', name='compatibilityMode', uri='http://schemas.microsoft.com/office/word', val=15)
    node(compat, 'compatSetting', name='enableOpenTypeFeatures', uri='http://schemas.microsoft.com/office/word', val=enabled)
    parts = {
        '[Content_Types].xml': b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml': xml(document), 'word/settings.xml': xml(settings),
    }
    with ZipFile(folder/f'control-{enabled}.docx', 'w') as z:
        for name, data in parts.items():
            info = ZipInfo(name, (2026, 10, 1, 12, 0, 0)); info.create_system = 0
            info.external_attr = 0o600 << 16
            z.writestr(info, data, compress_type=ZIP_DEFLATED)
(folder/'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf-8')
