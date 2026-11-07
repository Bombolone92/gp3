"""Independent book-fold controls; package and body are authored without corpus XML."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json

folder = Path(__file__).resolve().parents[1] / 'tests/fixtures/book-fold'
folder.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
cases = []
profiles = [
    ('absent', ''), ('off', '<w:bookFoldPrinting w:val="0"/>'),
    ('forward', '<w:bookFoldPrinting/>'),
    ('reverse', '<w:bookFoldRevPrinting/>'),
    ('both', '<w:bookFoldRevPrinting/><w:bookFoldPrinting/>'),
    ('four', '<w:bookFoldPrinting/><w:bookFoldPrintingSheets w:val="4"/>'),
]
for name, flags in profiles:
    cases.append(dict(name=name, flags=flags, width=7920, height=12240, orientation='landscape', gutter=0, topGutter=False))
for name, width, height, orient, gutter, top in [
    ('portrait',7920,12240,'portrait',0,False),
    ('wide',12240,7920,'landscape',0,False),
    ('gutter',7920,12240,'landscape',360,False),
    ('small-gutter',7920,12240,'landscape',180,False),
    ('large-gutter',7920,12240,'landscape',720,False),
    ('top-gutter',7920,12240,'landscape',360,True),
]:
    cases.append(dict(name=name, flags='<w:bookFoldPrinting/>', width=width,height=height,orientation=orient,gutter=gutter,topGutter=top))
cases.append(dict(name='reverse-gutter',flags='<w:bookFoldRevPrinting/>',width=7920,height=12240,orientation='landscape',gutter=180,topGutter=False))
for case in cases:
    paragraphs = []
    for page in range(4):
        paragraphs.append(f'<w:p><w:pPr>{"<w:pageBreakBefore/>" if page else ""}<w:spacing w:after="0"/></w:pPr><w:r><w:t>Page {page+1} left edge</w:t></w:r></w:p>')
        paragraphs.append('<w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr><w:r><w:t>Right edge</w:t></w:r></w:p>')
    section = f'<w:sectPr><w:pgSz w:w="{case["width"]}" w:h="{case["height"]}" w:orient="{case["orientation"]}"/><w:pgMar w:top="720" w:right="1080" w:bottom="900" w:left="1440" w:header="0" w:footer="0" w:gutter="{case["gutter"]}"/></w:sectPr>'
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + ''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>' for name,kind in [('document','document.main'),('styles','styles'),('settings','settings')]) + '</Types>',
        '_rels/.rels': f'<Relationships xmlns="{R}"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/_rels/document.xml.rels': f'<Relationships xmlns="{R}">' + ''.join(f'<Relationship Id="{name}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{name}" Target="{name}.xml"/>' for name in ['styles','settings']) + '</Relationships>',
        'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{"".join(paragraphs)}{section}</w:body></w:document>',
        'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>',
        'word/settings.xml': f'<w:settings xmlns:w="{W}">{"<w:gutterAtTop/>" if case["topGutter"] else ""}{case["flags"]}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
    }
    with ZipFile(folder / f'{case["name"]}.docx','w',ZIP_DEFLATED) as package:
        for name,data in parts.items():
            info = ZipInfo(name, (2026,1,1,0,0,0))
            info.compress_type = ZIP_DEFLATED
            package.writestr(info,data.encode('utf-8'))
(folder/'cases.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
