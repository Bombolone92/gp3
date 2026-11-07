"""Independent MACROBUTTON display cases, with no macro project or executable code."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr
import sys

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'


def run(content, properties=''):
    return f'<w:r>{"<w:rPr>"+properties+"</w:rPr>" if properties else ""}{content}</w:r>'


def text(value):
    return run(f'<w:t xml:space="preserve">{escape(value)}</w:t>')


def field(instructions, cached=None, locked=False):
    result = run(f'<w:fldChar w:fldCharType="begin"{" w:fldLock="+quoteattr("true") if locked else ""}/>')
    for value, properties in instructions:
        result += run(f'<w:instrText xml:space="preserve">{escape(value)}</w:instrText>', properties)
    if cached is not None:
        result += run('<w:fldChar w:fldCharType="separate"/>') + text(cached)
    return result + run('<w:fldChar w:fldCharType="end"/>')


cases = [
    ('Unquoted', field([('MACROBUTTON DoFieldClick [Last, First Name of Author]', '')])),
    ('Quoted', field([(' MACROBUTTON NoMacro "Quoted display label" ', '')])),
    ('Split', field([('MACRO', ''), ('BUTTON NoMacro ', ''), ('Split ', '<w:b/><w:color w:val="2050C0"/>'), ('label', '<w:i/><w:color w:val="C02050"/>')])),
    ('Cached', field([('MACROBUTTON NoMacro Instruction label', '')], 'Stale cached label')),
    ('Locked', field([('MACROBUTTON NoMacro Locked instruction', '')], 'Locked cached label', True)),
    ('Simple', '<w:fldSimple w:instr="MACROBUTTON NoMacro Simple display">'+text('Simple cached')+'</w:fldSimple>'),
    ('Multiple', field([('MACROBUTTON NoMacro [First]', '')])+text(' / ')+field([('MACROBUTTON NoMacro [Second]', '')])),
    ('Quoted command', field([('MACROBUTTON "Command With Spaces" "Safe display"', '')])),
    ('Not a button', field([('DATE', '')], 'Cached date')),
]
editing = '--editing' in sys.argv
body = ''.join(f'<w:p><w:pPr><w:spacing w:after="180"/></w:pPr>{text(label+": ")}{content}{text(" | end")}</w:p>' for label, content in cases if not editing or label != 'Not a button')
parts = {
    'word/document.xml': f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>',
    'word/styles.xml': f'<w:styles xmlns:w="{W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="main" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="styles" Type="{R}/styles" Target="styles.xml"/></Relationships>',
    '[Content_Types].xml': f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="{CT}document.main+xml"/><Override PartName="/word/styles.xml" ContentType="{CT}styles+xml"/></Types>',
}
root = Path(__file__).resolve().parents[1]
path = root / ('tests/fixtures/macro-buttons/editing.docx' if editing else 'public/fixtures/macro-button-labels.docx')
with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
    for name, content in parts.items():
        archive.writestr(name, content)
print(path)
