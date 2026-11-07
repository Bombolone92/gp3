"""Original OPC control: legacy space pairs across size, spacing and faces."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import json

root = Path(__file__).resolve().parents[1]
folder = root / 'tests/fixtures/legacy-space-variants'
folder.mkdir(exist_ok=True)
w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
rows, cases = [], []
for bold, italic in [(False, False), (True, False), (False, True), (True, True)]:
    for size in [12, 18]:
        for spacing in [-.5, 0, .5]:
            for kern in [False, True]:
                text = 'AVATAR Toffee The\u00a0World'
                cases.append(dict(text=text, bold=bold, italic=italic, size=size, spacing=spacing, kern=kern))
                index = len(rows)
                page_break = '<w:pageBreakBefore/>' if index == 24 else ''
                props = '<w:rFonts w:ascii="Rockwell" w:hAnsi="Rockwell"/>'
                props += ('<w:b/>' if bold else '') + ('<w:i/>' if italic else '')
                props += f'<w:spacing w:val="{int(spacing*20)}"/><w:kern w:val="{2 if kern else 0}"/><w:sz w:val="{size*2}"/>'
                rows.append(f'<w:p><w:pPr>{page_break}<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="exact"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr>{props}</w:rPr><w:t>{escape(text)}</w:t></w:r></w:p>')
parts = {
 '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
 '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml': f'<w:document xmlns:w="{w}"><w:body>'+''.join(rows)+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
with ZipFile(folder / 'control.docx', 'w', ZIP_DEFLATED) as out:
    for name, data in parts.items():
        out.writestr(name, data)
(folder / 'cases.json').write_text(json.dumps(cases, indent=2)+'\n', encoding='utf8')
