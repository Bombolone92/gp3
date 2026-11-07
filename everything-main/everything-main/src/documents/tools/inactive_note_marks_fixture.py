"""Original XML controls for note marks outside their owning note stories."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--format')
parser.add_argument('--literal', action='store_true')
args = parser.parse_args()

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'

def run(content, properties=''):
    return '<w:r>' + ('<w:rPr>'+properties+'</w:rPr>' if properties else '') + content + '</w:r>'

def text(value):
    return run('<w:t xml:space="preserve">'+escape(value)+'</w:t>')

def para(content):
    return '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>'+content+'</w:p>'

body = para(text('Inactive note mark controls'))
body += para(text('Plain: AB'))
for name in ['footnoteRef', 'endnoteRef']:
    body += para(run(f'<w:t>{name}: A</w:t><w:{name}/><w:t>B</w:t>'))
    body += para(text('Formatted '+name+': A')+run(f'<w:{name}/>', '<w:b/><w:color w:val="CC0000"/><w:sz w:val="80"/><w:vertAlign w:val="superscript"/>')+text('B'))
body += para(run('<w:footnoteRef/><w:endnoteRef/>'))
body += para(text('After the marker-only paragraph'))
body += '<w:tbl><w:tblPr><w:tblW w:w="4800" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4800"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4800" w:type="dxa"/></w:tcPr>'+para(text('Table: A')+run('<w:footnoteRef/><w:endnoteRef/>')+text('B'))+'</w:tc></w:tr></w:tbl>'
body += para(text('After the table'))
parts = {
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
    'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
    '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/></Types>',
}
target = Path(__file__).resolve().parents[1] / 'tests/fixtures/inactive-note-marks'
target.mkdir(exist_ok=True)
name = 'control'
if args.format:
    name = 'numbering-'+args.format
    props = f'<w:footnotePr><w:numFmt w:val="{escape(args.format)}"/><w:numStart w:val="7"/></w:footnotePr><w:endnotePr><w:numFmt w:val="lowerLetter"/><w:numStart w:val="3"/></w:endnotePr>'
    parts['word/document.xml'] = parts['word/document.xml'].replace('<w:sectPr>', '<w:sectPr>'+props)
if args.literal:
    name = 'literal'
    parts['word/document.xml'] = parts['word/document.xml'].replace('<w:footnoteRef/>','<w:t>1</w:t>').replace('<w:endnoteRef/>','<w:t>1</w:t>')
with ZipFile(target/(name+'.docx'), 'w', ZIP_DEFLATED) as archive:
    for part, contents in parts.items():
        archive.writestr(part, contents)
print(target/(name+'.docx'))
