"""Regenerate manually authored synthetic-bold advance controls (no engine code)."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/synthetic-bold-advance'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
O = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
for name in ['modern', 'thousand', 'ligatures']:
    cases = json.loads((folder / (name + '-cases.json')).read_text())
    paragraphs = []
    for c in cases:
        props = f'<w:rFonts w:ascii="{c["family"]}" w:hAnsi="{c["family"]}"/><w:kern w:val="0"/><w:sz w:val="{c["size"]*2}"/>' + ('<w:b/>' if c['bold'] else '')
        if 'ligatures' in c: props += f'<w14:ligatures w14:val="{c["ligatures"]}"/>'
        paragraphs.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="560" w:lineRule="exact"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{escape(c["text"])}</w:t></w:r></w:p>')
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{R}"><Relationship Id="document" Type="{O}officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>'+''.join(paragraphs)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{R}"><Relationship Id="styles" Type="{O}styles" Target="styles.xml"/></Relationships>',
        'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
    }
    if name in ['modern', 'ligatures']:
        parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
        parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>')
        parts['word/_rels/document.xml.rels'] = parts['word/_rels/document.xml.rels'].replace('</Relationships>', f'<Relationship Id="settings" Type="{O}settings" Target="settings.xml"/></Relationships>')
    if name == 'ligatures':
        parts['word/document.xml'] = parts['word/document.xml'].replace(f'xmlns:w="{W}"', f'xmlns:w="{W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14"', 1)
        parts['word/settings.xml'] = parts['word/settings.xml'].replace('</w:compat>', '<w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat>')
    if name == 'thousand':
        parts['word/document.xml'] = parts['word/document.xml'].replace('w:header="0" w:footer="0"', 'w:header="360" w:footer="360"')
    stamp = (2026, 9, 25, 4, 54, 20) if name == 'modern' else (2026, 9, 25, 4, 40, 50)
    if name == 'ligatures': stamp = (2026, 9, 25, 5, 4, 46)
    with ZipFile(folder / (name + '.docx'), 'w') as z:
        for path, data in parts.items():
            info = ZipInfo(path, stamp); info.create_system = 0
            info.external_attr = 0o600 << 16
            z.writestr(info, data.encode(), compress_type=ZIP_DEFLATED)
