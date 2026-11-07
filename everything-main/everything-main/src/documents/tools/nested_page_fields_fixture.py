"""Independent nested field envelopes, including coincident result boundaries."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/nested-page-fields'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
FORMAT = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>'

if '--locked-copy' in sys.argv:
    with ZipFile(OUT / 'control.docx') as source:
        parts = {name: source.read(name) for name in source.namelist()}
    parts['word/document.xml'] = parts['word/document.xml'].replace(b'w:fldCharType="begin"', b'w:fldCharType="begin" w:fldLock="true"')
    with ZipFile(OUT / 'locked.docx', 'w', ZIP_DEFLATED) as target:
        for name, data in parts.items():
            target.writestr(name, data)
    print(OUT / 'locked.docx')
    raise SystemExit

def run(xml):
    return '<w:r>' + FORMAT + xml + '</w:r>'

def text(value):
    return run('<w:t xml:space="preserve">' + escape(value) + '</w:t>')

def token(kind):
    return run('<w:fldChar w:fldCharType="' + kind + '"/>')

def opening(code):
    return token('begin') + run('<w:instrText xml:space="preserve">' + escape(code) + '</w:instrText>') + token('separate')

def field(code, result, simple=False):
    if simple:
        return '<w:fldSimple w:instr=' + quoteattr(code) + ' w:fldLock="true">' + result + '</w:fldSimple>'
    return opening(code) + result + token('end')

def paragraph(content):
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' + FORMAT + '</w:pPr>' + content + '</w:p>'

body = paragraph(text('Nested field result controls'))
for outer, inner in [(False, False), (False, True), (True, False), (True, True)]:
    label = ('simple' if outer else 'complex') + '/' + ('simple' if inner else 'complex')
    bookmark = '<w:bookmarkStart w:id="' + str(int(outer)*2+int(inner)) + '" w:name="Case' + str(int(outer)*2+int(inner)) + '"/>'
    bookmark += text('42') + '<w:bookmarkEnd w:id="' + str(int(outer)*2+int(inner)) + '"/>'
    body += paragraph(text(label + ': [') + field(' PAGE ', text('A') + field(' NUMPAGES ', bookmark, inner) + text('Z'), outer) + text(']'))
for label, result in [('empty-start', field(' NUMPAGES ', '', True) + text('Z')),
                      ('empty-end', text('A') + field(' NUMPAGES ', '')),
                      ('all-empty', field(' NUMPAGES ', field(' SECTIONPAGES ', '', True)))]:
    body += paragraph(text(label + ': [') + field(' PAGE ', result, True) + text(']'))
body += paragraph(text('Across: [') + opening(' PAGE ') + text('A') + opening(' NUMPAGES ') + text('4'))
body += paragraph(text('2') + token('end') + text('Z') + token('end') + text(']'))
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT / 'public/fixtures/inline-object-baseline.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
parts['word/document.xml'] = ('<w:document xmlns:w="' + W + '"><w:body>' + body + '</w:body></w:document>').encode()
OUT.mkdir(parents=True, exist_ok=True)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as target:
    for name, data in parts.items():
        target.writestr(name, data)
print(OUT / 'control.docx')
