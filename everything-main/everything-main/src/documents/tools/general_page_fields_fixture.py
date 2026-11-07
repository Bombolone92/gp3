"""Manually author original general numeric page-field controls, with stale caches."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

ROOT = Path(__file__).resolve().parents[1]
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
FORMATS = [r'PAGE', r'PAGE \* Arabic', r'PAGE \* ROMAN', r'PAGE \* roman',
           r'PAGE \* ALPHABETIC', r'PAGE \* alphabetic', r'PAGE \* ArabicDash',
           r'PAGE \* Arabic \* MERGEFORMAT', r'PAGE \* MERGEFORMAT \* Arabic',
           r'PAGE \* ROMAN \# 0000', r'PAGE \# 0000 \* ROMAN',
           r'NUMPAGES \* ROMAN', r'SECTIONPAGES \* Arabic',
           r'PAGE \* Arabic \* roman', r'PAGE \* roman \* Arabic']

def run(text):
    return '<w:r><w:t xml:space="preserve">'+escape(text)+'</w:t></w:r>'

def p(contents, properties=''):
    return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/>'+properties+'</w:pPr>'+contents+'</w:p>'

def field(instruction, complex=False):
    if not complex:
        return '<w:fldSimple w:instr='+quoteattr(instruction)+'>'+run('99')+'</w:fldSimple>'
    return '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">'+escape(instruction)+'</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'+run('99')+'<w:r><w:fldChar w:fldCharType="end"/></w:r>'

footer = ''
for i, instruction in enumerate(FORMATS):
    footer += p(run(f'{i+1:02d} [')+field(instruction, i % 2 == 1)+run(']'))

def section(start, fmt):
    return '<w:sectPr><w:footerReference w:type="default" r:id="footer"/><w:type w:val="nextPage"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="9000" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgNumType w:fmt="'+fmt+'" w:start="'+str(start)+'"/></w:sectPr>'

body = ''
cases = [(0,'decimal'), (1,'decimal'), (12,'upperRoman'), (27,'decimal'), (54,'decimal')]
for i,(start,fmt) in enumerate(cases):
    body += p(run(f'General page control: {start}, {fmt}'), section(start,fmt) if i < len(cases)-1 else '')
body += section(*cases[-1])
parts = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join('<Override PartName="/word/'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+t+'+xml"/>' for n,t in [('document','document.main'),('footer','footer'),('styles','styles'),('settings','settings')])+'</Types>',
    '_rels/.rels': '<Relationships xmlns="'+REL+'"><Relationship Id="main" Type="'+R+'/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="'+REL+'">'+''.join('<Relationship Id="'+n+'" Type="'+R+'/'+n+'" Target="'+n+'.xml"/>' for n in ['footer','styles','settings'])+'</Relationships>',
    'word/document.xml': '<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body>'+body+'</w:body></w:document>',
    'word/footer.xml': '<w:ftr xmlns:w="'+W+'">'+footer+'</w:ftr>',
    'word/styles.xml': '<w:styles xmlns:w="'+W+'"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
    'word/settings.xml': '<w:settings xmlns:w="'+W+'"><w:updateFields w:val="true"/></w:settings>',
}
with ZipFile(ROOT/'public/fixtures/general-page-fields.docx', 'w', ZIP_DEFLATED) as z:
    for name, text in parts.items():
        z.writestr(name, text.encode())
