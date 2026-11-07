"""Original OPC/XML probe for first-line-only paragraphs with hanging indents."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'
def p(text, indent=None):
    props = '<w:spacing w:before="0" w:after="0"/>'
    if indent is not None: props += f'<w:ind w:left="{indent}" w:hanging="{indent}"/>'
    return f'<w:p><w:pPr>{props}</w:pPr><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
rows = ''
for label, text, indent in [('Empty', '', 720), ('One character', 'A', 720), ('One space', ' ', 720), ('Valid continuation width', 'B', 120)]:
    rows += '<w:tr>'
    for width, content in [(3600, p(label)), (300, p(text, indent))]:
        rows += f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>{content}</w:tc>'
    rows += '</w:tr>'
borders = ''.join(f'<w:{edge} w:val="single" w:sz="8" w:color="000000"/>' for edge in ['top','left','bottom','right','insideH','insideV'])
margins = ''.join(f'<w:{edge} w:w="0" w:type="dxa"/>' for edge in ['top','left','bottom','right'])
table = f'<w:tbl><w:tblPr><w:tblW w:w="3900" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="300"/></w:tblGrid>{rows}</w:tbl>'
body = p('Unused continuation indents') + table + p('Body first line only', 10000) + p('Following paragraph')
parts = {
 '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/></Types>',
 '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
 'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
 'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
}
path = Path(__file__).resolve().parents[1] / 'public/fixtures/unused-continuation-indent.docx'
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, xml in parts.items(): archive.writestr(name, '<?xml version="1.0" encoding="UTF-8"?>' + xml)
print(path)
