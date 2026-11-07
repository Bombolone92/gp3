"""Original cached HYPERLINK fields, including a paragraph-spanning form."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/hyperlink-fields'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
FONT = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>'
def run(xml): return '<w:r>' + FONT + xml + '</w:r>'
def text(value): return run('<w:t xml:space="preserve">' + escape(value) + '</w:t>')
def char(kind): return run('<w:fldChar w:fldCharType="' + kind + '"' + (' w:fldLock="true"' if kind == 'begin' else '') + '/>')
def opening(code): return char('begin') + run('<w:instrText xml:space="preserve">' + escape(code) + '</w:instrText>')
def field(code, result=None, simple=False):
    if simple: return '<w:fldSimple w:instr=' + quoteattr(code) + ' w:fldLock="true">' + (result or '') + '</w:fldSimple>'
    return opening(code) + (char('separate') + result if result is not None else '') + char('end')
def para(xml, before=''): return '<w:p><w:pPr>' + before + '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>' + FONT + '</w:pPr>' + xml + '</w:p>'

body = para(text('Hyperlink field controls'))
body += para(text('Complex: [') + field(' HYPERLINK \\l "Target" \\o "Jump to target" ', text('Internal target')) + text(']'))
body += para(text('Word flag: [') + field(' HYPERLINK \\l "Target" \\h ', text('Native flag target')) + text(']'))
body += para(text('Simple: [') + field(' HYPERLINK \\l "Target" ', text('Simple target'), True) + text(']'))
body += para(text('External: [') + field(' HYPERLINK "https://example.com/reference?q=a%20b" \\o "Open reference" \\t "_blank" ', text('External reference')) + text(']'))
body += para(text('Across: [') + opening(' HYPERLINK \\l "Target" ') + char('separate') + text('First part'))
body += para(text('Second part ') + field(' PAGEREF Target \\h ', text('2')) + char('end') + text(']'))
body += para(text('Empty complex: [') + field(' HYPERLINK \\l "Target" ') + text(']'))
body += para(text('Empty simple: [') + field(' HYPERLINK \\l "Target" ', '', True) + text(']'))
body += para('<w:bookmarkStart w:id="1" w:name="Target"/>' + text('Destination') + '<w:bookmarkEnd w:id="1"/>', '<w:pageBreakBefore/>')
body += para(text('After the destination.'))
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT / 'public/fixtures/inline-object-baseline.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
parts['word/document.xml'] = ('<w:document xmlns:w="' + W + '"><w:body>' + body + '</w:body></w:document>').encode()
OUT.mkdir(parents=True, exist_ok=True)
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as target:
    for name, data in parts.items(): target.writestr(name, data)
print(OUT / 'control.docx')
