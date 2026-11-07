"""Original OPC/XML body and table page fields, deliberately stale caches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/body-page-fields'
OUT.mkdir(exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'

def run(text, properties=''):
    return '<w:r>' + ('<w:rPr>' + properties + '</w:rPr>' if properties else '') + '<w:t xml:space="preserve">' + escape(text) + '</w:t></w:r>'

def paragraph(contents, properties=''):
    section = properties if properties.startswith('<w:sectPr>') else ''
    before = '' if section else properties
    return '<w:p><w:pPr>' + before + '<w:spacing w:before="0" w:after="120"/>' + section + '</w:pPr>' + contents + '</w:p>'

def field(code, simple=False, locked=False, cache='99'):
    lock = ' w:fldLock="true"' if locked else ''
    result = run(cache, '<w:b/><w:sz w:val="28"/>')
    if simple:
        return '<w:fldSimple w:instr=' + quoteattr(code) + lock + '>' + result + '</w:fldSimple>'
    return '<w:r><w:fldChar w:fldCharType="begin"' + lock + '/></w:r><w:r><w:rPr><w:i/><w:sz w:val="22"/></w:rPr><w:instrText xml:space="preserve">' + escape(code) + '</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' + result + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'

def example(label, code, **options):
    return paragraph(run(label + ': [') + field(code, **options) + run('] after'))

def table(contents):
    return '<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="7200" w:type="dxa"/></w:tcPr>' + contents + '</w:tc></w:tr></w:tbl>'

def section(start, fmt):
    return '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgNumType w:fmt="' + fmt + '" w:start="' + str(start) + '"/></w:sectPr>'

body = paragraph(run('Body page fields: section one, page one'))
body += example('Body PAGE', 'PAGE')
body += example('Body PAGE merge', r'PAGE \* MERGEFORMAT')
body += example('Body total', 'NUMPAGES', simple=True)
body += example('Body section total', 'SECTIONPAGES')
body += example('Locked PAGE', 'PAGE', locked=True, cache='88')
body += table(example('Cell PAGE', r'PAGE \* MERGEFORMAT') + example('Cell total', 'NUMPAGES'))
body += paragraph(run('Body page fields: section one, page two'), '<w:pageBreakBefore/>')
body += example('Second PAGE', 'PAGE', simple=True)
body += example('Second Roman PAGE', r'PAGE \* ROMAN')
body += example('Second section total', 'SECTIONPAGES', simple=True)
body += paragraph(run('End of section one'), section(1, 'decimal'))
body += paragraph(run('Body page fields: restarted section'))
body += example('Restart PAGE', 'PAGE')
body += example('Restart numeric PAGE', r'PAGE \# 0000')
body += example('Restart total', 'NUMPAGES', simple=True)
body += table(example('Restart cell PAGE', r'PAGE \* MERGEFORMAT') + example('Restart section total', 'SECTIONPAGES'))
body += paragraph(run('End of original controls')) + section(7, 'upperRoman')

parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + ''.join('<Override PartName="/word/' + name + '.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + '+xml"/>' for name, kind in [('document', 'document.main'), ('styles', 'styles'), ('settings', 'settings')]) + '</Types>',
    '_rels/.rels': '<Relationships xmlns="' + REL + '"><Relationship Id="main" Type="' + R + '/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="' + REL + '">' + ''.join('<Relationship Id="' + name + '" Type="' + R + '/' + name + '" Target="' + name + '.xml"/>' for name in ['styles', 'settings']) + '</Relationships>',
    'word/document.xml': '<w:document xmlns:w="' + W + '"><w:body>' + body + '</w:body></w:document>',
    'word/styles.xml': '<w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    'word/settings.xml': '<w:settings xmlns:w="' + W + '"><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
}
with ZipFile(OUT / 'control.docx', 'w', ZIP_DEFLATED) as archive:
    for name, content in parts.items():
        archive.writestr(name, content.encode('utf-8'))
