"""Original Open Sans kerning/OpenType controls; contains no font binaries."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.etree import ElementTree as E
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/empty-gpos-kerning'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
for prefix, uri in [('w', W), ('w14', W14), ('mc', MC)]:
    E.register_namespace(prefix, uri)

def node(parent, tag, **attributes):
    return E.SubElement(parent, '{'+W+'}'+tag, {'{'+W+'}'+k: str(v) for k, v in attributes.items()})

def generate():
    OUT.mkdir(parents=True, exist_ok=True)
    cases = []
    for bold, italic in [(False, False), (True, False), (False, True), (True, True)]:
        for kern in [0, 2]:
            for ligatures in ['none', 'standardContextual']:
                cases.append(dict(bold=bold, italic=italic, kern=kern, ligatures=ligatures))
    for enabled in [0, 1]:
        doc = E.Element('{'+W+'}document', {'{'+MC+'}Ignorable': 'w14'})
        body = node(doc, 'body')
        for index, case in enumerate(cases):
            label = node(body, 'p'); prop = node(label, 'pPr'); node(prop, 'spacing', after=0)
            run = node(label, 'r'); rp = node(run, 'rPr'); node(rp, 'rFonts', ascii='Arial', hAnsi='Arial'); node(rp, 'sz', val=14)
            node(run, 't').text = f'C{index:02d} bold={int(case["bold"])} italic={int(case["italic"])} kern={case["kern"]} ligatures={case["ligatures"]}'
            p = node(body, 'p'); pp = node(p, 'pPr'); node(pp, 'spacing', after=40); node(pp, 'jc', val='right')
            run = node(p, 'r'); rp = node(run, 'rPr'); node(rp, 'rFonts', ascii='Open Sans', hAnsi='Open Sans')
            if case['bold']: node(rp, 'b')
            if case['italic']: node(rp, 'i')
            node(rp, 'kern', val=case['kern']); node(rp, 'sz', val=28)
            E.SubElement(rp, '{'+W14+'}ligatures', {'{'+W14+'}val': case['ligatures']})
            node(run, 't').text = 'AVATAR To Wa controls compare flowing words.'
        sect = node(body, 'sectPr'); node(sect, 'pgSz', w=12240, h=15840)
        node(sect, 'pgMar', top=720, right=720, bottom=720, left=720, header=360, footer=360, gutter=0)
        settings = E.Element('{'+W+'}settings'); compat = node(settings, 'compat')
        node(compat, 'compatSetting', name='compatibilityMode', uri='http://schemas.microsoft.com/office/word', val=15)
        node(compat, 'compatSetting', name='enableOpenTypeFeatures', uri='http://schemas.microsoft.com/office/word', val=enabled)
        parts = {
            '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'.encode(),
            '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>'.encode(),
            'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>'.encode(),
            'word/document.xml': E.tostring(doc), 'word/settings.xml': E.tostring(settings),
        }
        with ZipFile(OUT / f'enabled-{enabled}.docx', 'w', ZIP_DEFLATED) as archive:
            for name, data in parts.items():
                info = ZipInfo(name, (2026, 1, 1, 0, 0, 0)); info.compress_type = ZIP_DEFLATED
                archive.writestr(info, data)
    (OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n')

if __name__ == '__main__':
    generate()
