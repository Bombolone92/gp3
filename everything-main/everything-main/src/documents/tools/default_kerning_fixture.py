"""Manually authored controls for absent versus empty run defaults."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/default-kerning'
OUT.mkdir(parents=True, exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
O = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
text = 'AVATAR controls compare flowing words.'
cases = []
for name, defaults in [('absent', ''), ('doc-empty', '<w:docDefaults/>'),
                       ('container', '<w:docDefaults><w:rPrDefault/></w:docDefaults>'),
                       ('properties', '<w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults>'),
                       ('no-styles', None),
                       ('explicit', '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="12"/></w:rPr></w:rPrDefault></w:docDefaults>')]:
    rows = []
    body = []
    for family in ['Arial', 'Times New Roman']:
        for threshold in [None, 0, 1, 100]:
            props = f'<w:rFonts w:ascii="{family}" w:hAnsi="{family}"/>'
            if threshold is not None:
                props += f'<w:kern w:val="{threshold * 2}"/>'
            props += '<w:sz w:val="28"/>'
            body.append(f'<w:p><w:pPr><w:spacing w:before="0" w:after="120" w:line="240" w:lineRule="auto"/><w:rPr>{props}</w:rPr></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r></w:p>')
            rows.append(dict(family=family, threshold=threshold, text=text))
    style_type = '' if defaults is None else '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' + style_type + '</Types>',
        '_rels/.rels': f'<Relationships xmlns="{R}"><Relationship Id="document" Type="{O}officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>',
    }
    if defaults is not None:
        parts['word/_rels/document.xml.rels'] = f'<Relationships xmlns="{R}"><Relationship Id="styles" Type="{O}styles" Target="styles.xml"/></Relationships>'
        parts['word/styles.xml'] = f'<w:styles xmlns:w="{W}">{defaults}<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>'
    with ZipFile(OUT / (name + '.docx'), 'w') as z:
        for path, data in parts.items():
            z.writestr(ZipInfo(path, (2026, 9, 25, 0, 0, 0)), data, compress_type=ZIP_DEFLATED)
    cases.append(dict(name=name, rows=rows))
(OUT / 'cases.json').write_text(json.dumps(cases, indent=2) + '\n', encoding='utf-8')
