"""Original OOXML controls for cached TOC/PAGEREF and inert MACROBUTTON prompts."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/nested-body-fields'
OUT.mkdir(parents=True, exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def text(value):
    return '<w:r><w:t xml:space="preserve">' + escape(value) + '</w:t></w:r>'

def delimiter(kind):
    return '<w:r><w:fldChar w:fldCharType="' + kind + '"/></w:r>'

def instruction(value):
    return '<w:r><w:instrText xml:space="preserve">' + escape(value) + '</w:instrText></w:r>'

def field(code, result=None):
    return delimiter('begin') + instruction(code) + (delimiter('separate') + result if result is not None else '') + delimiter('end')

def paragraph(content, properties=''):
    spacing = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
    properties = properties.replace('<w:outlineLvl', spacing + '<w:outlineLvl') if '<w:outlineLvl' in properties else properties + spacing
    mark = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>'
    return '<w:p><w:pPr>' + properties + mark + '</w:pPr>' + content + '</w:p>'

tabs = '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="7200"/></w:tabs>'
body = paragraph(text('Before the contents'))
body += paragraph(delimiter('begin') + instruction(' TOC \\o "1-1" \\h \\z ') + delimiter('separate') +
                  text('First chapter') + '<w:r><w:tab/></w:r>' + field(' PAGEREF ChapterOne \\h ', text('2')), tabs)
body += paragraph(text('Second chapter') + '<w:r><w:tab/></w:r>' +
                  field(' PAGEREF ChapterTwo \\h ', text('2')) + delimiter('end'), tabs)
body += paragraph(text('After the contents'))
body += paragraph(field(' MACROBUTTON DoFieldClick "Enter author" '))
body += paragraph(field(' MACROBUTTON DoFieldClick "Enter title" ', text('Enter title')))
body += paragraph('<w:bookmarkStart w:id="1" w:name="ChapterOne"/>' + text('First chapter') +
                  '<w:bookmarkEnd w:id="1"/>', '<w:pageBreakBefore/><w:outlineLvl w:val="0"/>')
body += paragraph(text('First chapter body.'))
body += paragraph('<w:bookmarkStart w:id="2" w:name="ChapterTwo"/>' + text('Second chapter') +
                  '<w:bookmarkEnd w:id="2"/>', '<w:outlineLvl w:val="0"/>')
body += paragraph(text('Second chapter body.'))
body += '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
with ZipFile(ROOT / 'public/fixtures/inline-object-baseline.docx') as source:
    parts = {name: source.read(name) for name in source.namelist()}
parts['word/document.xml'] = ('<w:document xmlns:w="' + W + '"><w:body>' + body + '</w:body></w:document>').encode()
# Explicit per-run formatting isolates field behavior from installed theme faces.
parts['word/document.xml'] = parts['word/document.xml'].replace(b'<w:r>', b'<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr>')
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as target:
    for name, content in parts.items():
        target.writestr(name, content)
print(OUT / 'control.docx')
