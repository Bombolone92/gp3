"""Original OPC/XML cell-control editing probes, without corpus content."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/persistent-cell-controls'
out.mkdir(exist_ok=True)
with ZipFile(root / 'tests/fixtures/persistent-block-controls/control.docx') as z:
    parts = {n: z.read(n) for n in z.namelist()}
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def p(text):
    return '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">' + escape(text) + '</w:t></w:r></w:p>'

cases = ['insert', 'replace', 'delete-all', 'split', 'format', 'placeholder', 'temporary-false', 'two-paragraphs']
body = []
for i, name in enumerate(cases):
    props = f'<w:alias w:val="{name}"/><w:tag w:val="original-cell-{name}"/><w:id w:val="{800+i}"/>'
    if name == 'placeholder':
        props += '<w:showingPlcHdr/>'
    if name == 'temporary-false':
        props += '<w:temporary w:val="false"/>'
    props += '<w:richText/>'
    content = p('Alpha beta') + (p('Second paragraph') if name in ['placeholder', 'two-paragraphs'] else '')
    cell = '<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr>' + content + '</w:tc>'
    wrapped = f'<w:sdt><w:sdtPr>{props}</w:sdtPr><w:sdtContent>{cell}</w:sdtContent></w:sdt>'
    body.append(p(name) + '<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblBorders>' +
        ''.join(f'<w:{side} w:val="single" w:sz="4"/>' for side in ['top','left','bottom','right','insideV']) +
        '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3600"/><w:gridCol w:w="3600"/></w:tblGrid><w:tr>' + wrapped +
        '<w:tc><w:tcPr><w:tcW w:w="3600" w:type="dxa"/></w:tcPr>' + p('Ordinary neighbor') + '</w:tc></w:tr></w:tbl>' + p(''))
parts['word/document.xml'] = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="' + W + '"><w:body>' + ''.join(body) +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>').encode()
with ZipFile(out / 'control.docx', 'w', ZIP_DEFLATED) as z:
    for name, data in parts.items():
        z.writestr(name, data)
