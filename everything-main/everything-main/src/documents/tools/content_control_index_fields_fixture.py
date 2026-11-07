"""Independent XE field/control composition reference, without corpus XML."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/content-control-index-fields'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def text(value):
    return f'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">{value}</w:t></w:r>'

def field():
    return ('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
            '<w:r><w:instrText xml:space="preserve"> XE "</w:instrText></w:r>'
            '<w:r><w:instrText>entry</w:instrText></w:r>'
            '<w:r><w:instrText xml:space="preserve">" </w:instrText></w:r>'
            '<w:r><w:fldChar w:fldCharType="end"/></w:r>')

def paragraph(content):
    return '<w:p><w:pPr><w:spacing w:after="200" w:line="480" w:lineRule="exact"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="28"/></w:rPr></w:pPr>' + content + '</w:p>'

def control(content, identifier, temporary):
    return (f'<w:sdt><w:sdtPr><w:id w:val="{identifier}"/>'
            + ('<w:temporary/>' if temporary else '')
            + '</w:sdtPr><w:sdtContent>' + content + '</w:sdtContent></w:sdt>')

body = paragraph(text('C01 plain L') + field() + text('R'))
for identifier, temporary in [(2, True), (3, False)]:
    body += paragraph(text(f'C0{identifier} outside ') + control(text('L') + field() + text('R'), identifier, temporary) + text(' outside'))
for identifier, position in [(4, 'start'), (5, 'end')]:
    content = field() + text('LR') if position == 'start' else text('LR') + field()
    body += paragraph(text(f'C0{identifier} boundary ') + control(content, identifier, True) + text(' outside'))
body += control(paragraph(text('C06 block L') + field() + text('R')), 6, True)
body += paragraph(text('C07 adjacent L') + field() + field() + text('R'))
body += paragraph(text('C08 visible LR'))
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT / 'public/fixtures/empty-table-fragment.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
parts['word/document.xml'] = f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>'
OUT.mkdir(exist_ok=True)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as target:
    for name, data in parts.items():
        target.writestr(name, data)
