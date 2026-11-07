"""Original OPC/XML controls for joined paragraph border spacing."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
O = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

def paragraph(text, borders=False, keep=False, page=False, between=False, different=False):
    props = ('<w:keepNext/>' if keep else '') + ('<w:pageBreakBefore/>' if page else '')
    if borders:
        props += '<w:pBdr>' + ''.join(f'<w:{s} w:val="single" w:sz="2" w:space="{18 if different and s == "bottom" else 3 if s == "bottom" else 10}" w:color="224466"/>' for s in ['top','left','bottom','right'])
        if between: props += '<w:between w:val="single" w:sz="16" w:space="0" w:color="CC3300"/>'
        props += '</w:pBdr>'
    props += '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/>'
    return f'<w:p><w:pPr>{props}</w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'

body = ''
for index, name in enumerate(['BodyJoined','CellJoined','BodyKeep','CellKeep','BodyBetween','CellBetween','BodyDifferent','CellDifferent']):
    body += paragraph(name, page=index > 0)
    content = ''.join(paragraph(name+letter, borders=True, keep='Keep' in name and letter == 'A', between='Between' in name, different='Different' in name and letter == 'C') for letter in 'ABC')
    if name.startswith('Cell'):
        margins = ''.join(f'<w:{s} w:w="0" w:type="dxa"/>' for s in ['top','left','bottom','right'])
        content = f'<w:tbl><w:tblPr><w:tblW w:w="4320" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar>{margins}</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4320"/></w:tblGrid><w:tr><w:tc><w:tcPr/>{content}</w:tc></w:tr></w:tbl>'
    body += content + paragraph(name+'End')
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' + ''.join(f'<Override PartName="/word/{name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>' for name,kind in [('document','document.main'),('styles','styles'),('settings','settings')]) + '</Types>',
    '_rels/.rels': f'<Relationships xmlns="{R}"><Relationship Id="rId1" Type="{O}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="{R}">' + ''.join(f'<Relationship Id="rId{i}" Type="{O}/{name}" Target="{name}.xml"/>' for i,name in enumerate(['styles','settings'],1)) + '</Relationships>',
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>',
    'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
}
for mode in [12,15]:
    parts['word/settings.xml'] = f'<w:settings xmlns:w="{W}"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="{mode}"/></w:compat></w:settings>'
    with ZipFile(ROOT/f'public/fixtures/joined-border-spacing-{mode}.docx','w',ZIP_DEFLATED) as archive:
        for name, content in parts.items(): archive.writestr(name,content)
