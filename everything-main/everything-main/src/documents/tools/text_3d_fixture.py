"""Original text bevel/extrusion controls; no corpus content or font binaries."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
NS = f'xmlns:w="{W}" xmlns:w14="{W14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"'
ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/text-3d'
BEVEL = '<w14:bevelT w14:w="63500" w14:h="12700" w14:prst="angle"/>'


def properties(depth=0, bevel=False, contour=0, material=None):
    attrs = f'w14:extrusionH="{depth}" w14:contourW="{contour}"'
    if material:
        attrs += f' w14:prstMaterial="{material}"'
    children = BEVEL if bevel else ''
    if contour:
        children += '<w14:contourClr><w14:srgbClr w14:val="008080"/></w14:contourClr>'
    return f'<w14:props3d {attrs}>{children}</w14:props3d>'


def generate():
    cases = [
        ('plain', '', False),
        ('empty', '<w14:props3d/>', False),
        ('extrusion', properties(depth=57150), False),
        ('bevel', properties(bevel=True), False),
        ('bevel-extrusion-default', properties(depth=57150, bevel=True), False),
        ('bevel-extrusion-matte', properties(depth=57150, bevel=True, material='matte'), False),
        ('bevel-extrusion-flat', properties(depth=57150, bevel=True, material='flat'), False),
        ('contour', properties(contour=12700), False),
        ('inherited-matte', properties(depth=57150, bevel=True, material='matte'), True),
        ('direct-empty-overrides-inherited', '<w14:props3d/>', True),
    ]
    style_effect = properties(depth=57150, bevel=True, material='matte')
    body = ''
    for index, (name, effect, inherited) in enumerate(cases):
        before = '<w:pageBreakBefore/>' if index else ''
        body += f'<w:p><w:pPr>{before}<w:spacing w:after="240"/></w:pPr><w:r><w:t>{name}</w:t></w:r></w:p>'
        run_style = '<w:rStyle w:val="Depth"/>' if inherited else ''
        direct = '' if name == 'inherited-matte' else effect
        body += f'<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr>{run_style}<w:b/><w:color w:val="D02030"/><w:sz w:val="288"/>{direct}</w:rPr><w:t>Ao</w:t></w:r></w:p>'
        body += '<w:p><w:r><w:t>Following text stays in ordinary document flow.</w:t></w:r></w:p>'
    body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/><Relationship Id="settings" Type="{R}/settings" Target="settings.xml"/></Relationships>',
        'word/document.xml': f'<w:document {NS}><w:body>{body}</w:body></w:document>',
        'word/styles.xml': f'<w:styles {NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="character" w:styleId="Depth"><w:name w:val="Depth"/><w:rPr>{style_effect}</w:rPr></w:style></w:styles>',
        'word/settings.xml': f'<w:settings xmlns:w="{W}"><w:zoom w:percent="100"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    }
    ROOT.mkdir(parents=True, exist_ok=True)
    with ZipFile(ROOT / 'control.docx', 'w', ZIP_DEFLATED) as archive:
        for name, value in parts.items():
            archive.writestr(name, value)
    (ROOT / 'cases.json').write_text(json.dumps([
        {'page': i + 1, 'name': name, 'inherited': inherited, 'directEffectXml': '' if name == 'inherited-matte' else effect}
        for i, (name, effect, inherited) in enumerate(cases)
    ], indent=2) + '\n', encoding='utf-8')
    print(ROOT / 'control.docx')


if __name__ == '__main__':
    generate()
